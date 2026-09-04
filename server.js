// Local server for the r/Watchexchange live monitor.
// Polls Reddit, keeps a rolling store of posts, pushes new ones to browsers over SSE.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RedditClient } from './lib/reddit.js';
import { isProxyableHost, BRANDS, priceFromComment, originalFromPreview, detectSold } from './lib/parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 5173);
const SUBREDDITS = (process.env.SUBREDDITS || 'Watchexchange').split(',').map((s) => s.trim()).filter(Boolean);
const POLL_SECONDS = Math.max(10, Number(process.env.POLL_SECONDS || 30));
const MAX_POSTS = Number(process.env.MAX_POSTS || 1500);
// Sellers are required to put sale details in a top-level comment, which often lands minutes
// after the post. These control how hard we chase that comment.
const COMMENT_CHECKS_PER_CYCLE = Number(process.env.COMMENT_CHECKS_PER_CYCLE || 8);
const COMMENT_WATCH_HOURS = Number(process.env.COMMENT_WATCH_HOURS || 6);
// Unauthenticated reddit.com allows about one request per minute per IP. In RSS mode every
// request is rationed: the listing gets priority, and spare slots chase price comments.
const RSS_GAP_SECONDS = Number(process.env.RSS_GAP_SECONDS || 65);
const RSS_LISTING_SECONDS = Number(process.env.RSS_LISTING_SECONDS || 130);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const IMG_CACHE = path.join(DATA_DIR, 'imgcache');
const IMG_CACHE_MAX = Number(process.env.IMG_CACHE_MAX || 4000);
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const client = new RedditClient({
  clientId: process.env.REDDIT_CLIENT_ID || '',
  clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
  userAgent: process.env.REDDIT_USER_AGENT || `macos:watchexchange-monitor:v1.0 (by /u/${process.env.REDDIT_USERNAME || 'anonymous'})`,
});

// ---------- store ----------
const posts = new Map();      // id -> normalized post
let state = { read: {}, starred: {} };
let meta = {
  mode: client.mode,
  subreddits: SUBREDDITS,
  pollSeconds: client.mode === 'rss' ? RSS_GAP_SECONDS : POLL_SECONDS,
  listingSeconds: client.mode === 'rss' ? RSS_LISTING_SECONDS : POLL_SECONDS,
  lastFetch: null,
  lastError: null,
  consecutiveErrors: 0,
  awaitingPrice: 0,
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(IMG_CACHE, { recursive: true });
try {
  const raw = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
  for (const p of raw) {
    const up = upgradeStoredImages(p);
    if (up.sold === undefined) up.sold = detectSold({ flair: up.flair, title: up.title });
    posts.set(up.id, up);
  }
} catch {}

// Posts archived before the image work stored 140px crops. The originals are reachable from the
// same media ids, so lift them on load rather than leaving old posts permanently blurry.
function upgradeStoredImages(p) {
  if (!Array.isArray(p.images)) return p;
  const tinyish = (u = '') => /[?&]width=140\b/.test(u);
  p.images = p.images.map((im) => {
    const original = originalFromPreview(im.url);
    if (!original) return im;
    const tiny = tinyish(im.url) ? im.url : im.tiny;
    return {
      url: original,
      thumb: im.thumb && !tinyish(im.thumb) ? im.thumb : original,
      ...(tiny ? { tiny } : {}),
    };
  });
  return p;
}
try { state = { read: {}, starred: {}, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}

let saveTimer = null;
async function saveNow() {
  const arr = sortedPosts().slice(0, MAX_POSTS);
  const keep = new Set(arr.map((p) => p.id));
  for (const id of [...posts.keys()]) if (!keep.has(id)) posts.delete(id);
  await fsp.writeFile(POSTS_FILE, JSON.stringify(arr)).catch(() => {});
  await fsp.writeFile(STATE_FILE, JSON.stringify(state)).catch(() => {});
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveNow(); }, 1500);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearTimeout(saveTimer);
    saveNow().finally(() => process.exit(0));
  });
}

const sortedPosts = () => [...posts.values()].sort((a, b) => b.created - a.created);

// ---------- SSE ----------
const clients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch {} }
}

// ---------- price-in-comments watcher ----------
// The subreddit's rules put sale details in a top-level comment by the seller, so a post can
// appear with no price and gain one a few minutes later. Re-check priceless posts, fastest
// while they are new, and push an update when a price shows up.
const commentWatch = new Map(); // id -> { checks, last }

function commentCheckInterval(ageMs) {
  if (ageMs < 10 * 60_000) return 45_000;
  if (ageMs < 60 * 60_000) return 5 * 60_000;
  return 15 * 60_000;
}

function needsCommentCheck(p) {
  if (p.sold) return false;
  // Even once priced, keep an eye out briefly for a "sold" comment so it can retire itself.
  const age = Date.now() - p.created;
  if (age > COMMENT_WATCH_HOURS * 3600_000) return false;
  if (p.price.value != null) return age < 3 * 3600_000;
  const w = commentWatch.get(p.id);
  if (!w) return true;
  return Date.now() - w.last > commentCheckInterval(age);
}

async function checkCommentPrices(maxChecks) {
  if (maxChecks < 1) return 0;
  const due = sortedPosts().filter(needsCommentCheck).slice(0, maxChecks);
  let spent = 0;
  for (const p of due) {
    spent += 1;
    const w = commentWatch.get(p.id) || { checks: 0, last: 0 };
    w.checks += 1;
    w.last = Date.now();
    commentWatch.set(p.id, w);
    try {
      const comments = await client.fetchComments(p.id);
      if (!comments) continue;
      // Only the seller's own comments count — replies from buyers quote their own numbers.
      // In RSS mode the submission itself appears as an entry by the same author; it has no
      // price and simply falls through.
      const mine = comments
        .filter((c) => c.author && c.author === p.author && !c.stickied)
        .sort((a, b) => a.created - b.created);

      let updated = posts.get(p.id) || p;
      let changed = false;

      // Retire the post if the seller has said it's sold.
      if (!updated.sold && mine.some((c) => detectSold({ comment: c.body }))) {
        updated = { ...updated, sold: true };
        changed = true;
        console.log(`[sold] ${p.id} — seller's comment`);
      }

      // The seller's first substantive comment is the real listing (price, condition, terms) —
      // the public feed never carries this, so keep it for search and the detail view.
      if (!updated.sellerComment) {
        const detail = mine.find((c) => c.body && c.body.length > 40);
        if (detail) { updated = { ...updated, sellerComment: detail.body.slice(0, 2000) }; changed = true; }
      }

      // First price the seller quotes.
      if (updated.price.value == null) {
        for (const c of mine) {
          const found = priceFromComment(c.body);
          if (!found) continue;
          updated = { ...updated, price: { ...found, flairRange: updated.price.flairRange, commentUrl: c.permalink } };
          changed = true;
          console.log(`[price] ${p.id} → ${found.display} from u/${c.author}'s comment`);
          break;
        }
      }

      if (changed) {
        posts.set(p.id, updated);
        broadcast('update', updated);
        scheduleSave();
      }
      if (updated.sold || (updated.price.value != null && Date.now() - p.created > 3 * 3600_000)) {
        commentWatch.delete(p.id);
      }
    } catch (err) {
      console.error(`[price] ${p.id}: ${err.message}`);
      if (/401|429/.test(err.message)) return spent;   // stop the cycle, the loop backs off
    }
  }
  // Stop tracking posts that aged out.
  for (const id of [...commentWatch.keys()]) {
    const p = posts.get(id);
    if (!p || Date.now() - p.created > COMMENT_WATCH_HOURS * 3600_000) commentWatch.delete(id);
  }
  return spent;
}

// ---------- polling ----------
// A fresh listing entry never carries a comment price, the seller's comment, or (in public-feed
// mode) flair — those are discovered later and live only on the stored copy. Merge so a re-poll
// refreshes the volatile fields without discarding what we already learned.
function mergePost(prev, next) {
  const m = { ...next, firstSeen: prev.firstSeen };
  // Keep the better price: an exact one already found (comment/body/title) beats a fresh blank.
  if (prev.price?.value != null && next.price?.value == null) {
    m.price = prev.price;
  } else {
    m.price = { ...next.price, flairRange: next.price?.flairRange ?? prev.price?.flairRange ?? null };
  }
  if (prev.sellerComment && !m.sellerComment) m.sellerComment = prev.sellerComment;
  // The listing's flair can flip to Sold; otherwise keep whatever we detected before.
  m.sold = detectSold({ flair: next.flair, title: next.title }) || prev.sold || false;
  return m;
}

let firstRun = true;
async function pollListing() {
  const fresh = [];
  let errored = null;
  for (const sub of SUBREDDITS) {
    try {
      const list = await client.fetchNew(sub);
      for (const p of list) {
        const prev = posts.get(p.id);
        if (!prev) {
          p.firstSeen = Date.now();
          p.sold = detectSold({ flair: p.flair, title: p.title });
          posts.set(p.id, p);
          fresh.push(p);
        } else {
          const merged = mergePost(prev, p);
          posts.set(p.id, merged);
          if (prev.flair !== merged.flair || prev.comments !== merged.comments || prev.sold !== merged.sold) {
            broadcast('update', merged);
          }
        }
      }
    } catch (err) {
      errored = err.message;
    }
  }

  if (errored) {
    meta.consecutiveErrors += 1;
    meta.lastError = errored;
    console.error(`[poll] ${errored}`);
  } else {
    meta.consecutiveErrors = 0;
    meta.lastError = null;
    meta.lastFetch = Date.now();
  }
  meta.mode = client.mode;
  meta.awaitingPrice = sortedPosts().filter((p) => !p.sold && p.price.value == null && Date.now() - p.created < COMMENT_WATCH_HOURS * 3600_000).length;

  if (fresh.length) {
    fresh.sort((a, b) => a.created - b.created);
    // On a cold start everything is "new"; don't fire alerts for the whole backlog.
    broadcast('posts', { posts: fresh, backfill: firstRun });
    console.log(`[poll] +${fresh.length} post(s)`);
    scheduleSave();
  }
  lastListingAt = Date.now();
  broadcast('meta', meta);
  firstRun = false;
}

// One scheduler for both modes. In API mode there is headroom for a listing poll plus a batch
// of comment checks every cycle. In RSS mode there is room for a single request, so the loop
// alternates: the listing when it is due, otherwise one price-comment check.
let lastListingAt = 0;
const backoffMs = () => Math.min(meta.consecutiveErrors, 5) * 15_000;

function schedule(ms) {
  meta.nextPollAt = Date.now() + ms;
  setTimeout(loop, ms);
}

async function loop() {
  try {
    if (client.mode === 'api') {
      await pollListing();
      await checkCommentPrices(COMMENT_CHECKS_PER_CYCLE);
      return schedule(meta.pollSeconds * 1000 + backoffMs());
    }

    const wait = client.nextAllowedIn();
    if (wait > 0) return schedule(wait + 1500);

    const listingDue = Date.now() - lastListingAt >= RSS_LISTING_SECONDS * 1000;
    let spent = 0;
    if (!listingDue) spent = await checkCommentPrices(1);
    if (!spent) await pollListing();
    schedule(RSS_GAP_SECONDS * 1000 + backoffMs());
  } catch (err) {
    meta.consecutiveErrors += 1;
    meta.lastError = err.message;
    broadcast('meta', meta);
    console.error(`[loop] ${err.message}`);
    schedule(RSS_GAP_SECONDS * 1000 + backoffMs());
  }
}

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/state') return json(res, {
    meta, brands: BRANDS.map((b) => b.name),
    posts: sortedPosts().slice(0, 400),
    read: state.read, starred: state.starred,
  }, req);

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    res.write(`event: meta\ndata: ${JSON.stringify(meta)}\n\n`);
    clients.add(res);
    const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch {} }, 25_000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); });
    return;
  }

  if (url.pathname === '/api/read' && req.method === 'POST') {
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids : [body.id];
    for (const id of ids.filter(Boolean)) {
      if (body.read === false) delete state.read[id];
      else state.read[id] = Date.now();
    }
    scheduleSave();
    return json(res, { ok: true, count: Object.keys(state.read).length }, req);
  }

  if (url.pathname === '/api/star' && req.method === 'POST') {
    const body = await readJson(req);
    if (body.starred === false) delete state.starred[body.id];
    else state.starred[body.id] = Date.now();
    scheduleSave();
    return json(res, { ok: true }, req);
  }

  if (url.pathname === '/img') {
    const target = url.searchParams.get('u');
    const width = Math.min(Math.max(Number(url.searchParams.get('w')) || 0, 0), 2048);
    if (!target || !isProxyableHost(target)) { res.writeHead(400); return res.end('bad image host'); }
    try {
      const { buf, type } = await getImage(target, width);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' });
      return res.end(buf);
    } catch (e) {
      res.writeHead(e.status || 502);
      return res.end('image fetch failed');
    }
  }

  // static
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(__dirname, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  try {
    const buf = await fsp.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      // Revalidate every load: otherwise the browser happily serves a stale UI after an update.
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
});

const execFileP = promisify(execFile);
const IMG_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
let sipsOk = null;

// Reddit serves originals only — i.redd.it ignores resize params — so a 3000px photo would
// otherwise be sent to every grid card. macOS ships sips; without it we serve the original.
async function canResize() {
  if (sipsOk === null) {
    try { await execFileP('sips', ['--version'], { timeout: 5000 }); sipsOk = true; }
    catch { sipsOk = false; console.log('  (no sips found — serving full-size images to the grid)'); }
  }
  return sipsOk;
}

let resizeSlots = Number(process.env.RESIZE_CONCURRENCY || 3);
const resizeQueue = [];
function acquireResize() {
  if (resizeSlots > 0) { resizeSlots -= 1; return Promise.resolve(); }
  return new Promise((resolve) => resizeQueue.push(resolve));
}
function releaseResize() {
  const next = resizeQueue.shift();
  if (next) next(); else resizeSlots += 1;
}

async function getImage(target, width) {
  const ext = (target.match(/\.(jpe?g|png|webp|gif)/i) || [, 'jpg'])[1].toLowerCase();
  const type = IMG_TYPES[ext] || 'image/jpeg';
  const key = crypto.createHash('sha1').update(`${target}|${width}`).digest('hex');
  const file = path.join(IMG_CACHE, `${key}.${ext}`);
  try { return { buf: await fsp.readFile(file), type }; } catch {}

  const upstream = await fetch(target, {
    headers: { 'User-Agent': client.userAgent, Accept: 'image/*', Referer: 'https://www.reddit.com/' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!upstream.ok) throw Object.assign(new Error('upstream'), { status: upstream.status });
  let buf = Buffer.from(await upstream.arrayBuffer());

  if (width && ext !== 'gif' && await canResize()) {
    const src = path.join(IMG_CACHE, `${key}.src.${ext}`);
    const out = path.join(IMG_CACHE, `${key}.out.${ext}`);
    await acquireResize();
    try {
      await fsp.writeFile(src, buf);
      await execFileP('sips', ['-Z', String(width), src, '--out', out], { timeout: 20_000 });
      const resized = await fsp.readFile(out);
      if (resized.length) buf = resized;
    } catch (err) {
      // Leave buf as the original; a failed resize shouldn't cost the user the image.
    } finally {
      releaseResize();
      fsp.unlink(src).catch(() => {});
      fsp.unlink(out).catch(() => {});
    }
  }
  fsp.writeFile(file, buf).catch(() => {});
  return { buf, type };
}

async function pruneImageCache() {
  try {
    const names = await fsp.readdir(IMG_CACHE);
    if (names.length <= IMG_CACHE_MAX) return;
    const stats = await Promise.all(names.map(async (n) => {
      const f = path.join(IMG_CACHE, n);
      try { return { f, t: (await fsp.stat(f)).mtimeMs }; } catch { return null; }
    }));
    stats.filter(Boolean).sort((a, b) => a.t - b.t).slice(0, names.length - IMG_CACHE_MAX)
      .forEach(({ f }) => fsp.unlink(f).catch(() => {}));
  } catch {}
}

function json(res, obj, req) {
  const body = Buffer.from(JSON.stringify(obj));
  const wantsGzip = /\bgzip\b/.test(req?.headers['accept-encoding'] || '') && body.length > 1024;
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (!wantsGzip) { res.writeHead(200, headers); return res.end(body); }
  zlib.gzip(body, (err, gz) => {
    if (err) { res.writeHead(200, headers); return res.end(body); }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
    res.end(gz);
  });
}

function readJson(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

function loadDotEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const v = m[2].replace(/^['"]|['"]$/g, '');
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {}
}

server.listen(PORT, () => {
  console.log(`\n  Watchexchange monitor → http://localhost:${PORT}`);
  console.log(`  mode: ${client.mode === 'api' ? 'Reddit API (OAuth)' : 'RSS fallback — add credentials to .env for full data'}`);
  console.log(`  watching: ${SUBREDDITS.map((s) => 'r/' + s).join(', ')} every ${meta.pollSeconds}s\n`);
  pruneImageCache();
  setInterval(pruneImageCache, 6 * 3600_000);
  loop();
});
