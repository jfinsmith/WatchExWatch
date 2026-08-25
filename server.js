// Local server for the r/Watchexchange live monitor.
// Polls Reddit, keeps a rolling store of posts, pushes new ones to browsers over SSE.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RedditClient } from './lib/reddit.js';
import { isProxyableHost, BRANDS, priceFromComment } from './lib/parse.js';

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
const DATA_DIR = path.join(__dirname, 'data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
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
  pollSeconds: client.mode === 'rss' ? Math.max(POLL_SECONDS, 120) : POLL_SECONDS,
  lastFetch: null,
  lastError: null,
  consecutiveErrors: 0,
  awaitingPrice: 0,
};

fs.mkdirSync(DATA_DIR, { recursive: true });
try {
  const raw = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
  for (const p of raw) posts.set(p.id, p);
} catch {}
try { state = { read: {}, starred: {}, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const arr = sortedPosts().slice(0, MAX_POSTS);
    for (const id of [...posts.keys()]) if (!arr.find((p) => p.id === id)) posts.delete(id);
    await fsp.writeFile(POSTS_FILE, JSON.stringify(arr)).catch(() => {});
    await fsp.writeFile(STATE_FILE, JSON.stringify(state)).catch(() => {});
  }, 1500);
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
  if (p.price.value != null) return false;
  const age = Date.now() - p.created;
  if (age > COMMENT_WATCH_HOURS * 3600_000) return false;
  const w = commentWatch.get(p.id);
  if (!w) return true;
  return Date.now() - w.last > commentCheckInterval(age);
}

async function checkCommentPrices() {
  if (client.mode !== 'api') return;   // public comment feeds rate-limit far too hard
  const due = sortedPosts().filter(needsCommentCheck).slice(0, COMMENT_CHECKS_PER_CYCLE);
  for (const p of due) {
    const w = commentWatch.get(p.id) || { checks: 0, last: 0 };
    w.checks += 1;
    w.last = Date.now();
    commentWatch.set(p.id, w);
    try {
      const comments = await client.fetchComments(p.id);
      if (!comments) continue;
      // Only the seller's own comments count — replies from buyers quote their own numbers.
      const mine = comments
        .filter((c) => c.author && c.author === p.author && !c.stickied)
        .sort((a, b) => a.created - b.created);
      for (const c of mine) {
        const found = priceFromComment(c.body);
        if (!found) continue;
        const updated = {
          ...p,
          price: { ...found, flairRange: p.price.flairRange, commentUrl: c.permalink },
        };
        posts.set(p.id, updated);
        commentWatch.delete(p.id);
        console.log(`[price] ${p.id} → ${found.display} from u/${c.author}'s comment`);
        broadcast('update', updated);
        scheduleSave();
        break;
      }
    } catch (err) {
      console.error(`[price] ${p.id}: ${err.message}`);
      if (/401|429/.test(err.message)) return;   // stop the cycle, the poll loop backs off
    }
  }
  // Stop tracking posts that aged out.
  for (const id of [...commentWatch.keys()]) {
    const p = posts.get(id);
    if (!p || Date.now() - p.created > COMMENT_WATCH_HOURS * 3600_000) commentWatch.delete(id);
  }
}

// ---------- polling ----------
let firstRun = true;
async function poll() {
  const fresh = [];
  let errored = null;
  for (const sub of SUBREDDITS) {
    try {
      const list = await client.fetchNew(sub);
      for (const p of list) {
        const prev = posts.get(p.id);
        if (!prev) {
          p.firstSeen = Date.now();
          posts.set(p.id, p);
          fresh.push(p);
        } else {
          // Keep first-seen ordering but refresh mutable fields (flair flips to SOLD, comment count).
          posts.set(p.id, { ...p, firstSeen: prev.firstSeen });
          if (prev.flair !== p.flair || prev.comments !== p.comments) {
            broadcast('update', { ...p, firstSeen: prev.firstSeen });
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
  meta.awaitingPrice = sortedPosts().filter((p) => p.price.value == null && Date.now() - p.created < COMMENT_WATCH_HOURS * 3600_000).length;

  if (fresh.length) {
    fresh.sort((a, b) => a.created - b.created);
    // On a cold start everything is "new"; don't fire alerts for the whole backlog.
    broadcast('posts', { posts: fresh, backfill: firstRun });
    console.log(`[poll] +${fresh.length} post(s)`);
    scheduleSave();
  }
  broadcast('meta', meta);
  firstRun = false;

  await checkCommentPrices().catch((e) => console.error(`[price] ${e.message}`));

  const backoff = Math.min(meta.consecutiveErrors, 5) * 15;
  setTimeout(poll, (meta.pollSeconds + backoff) * 1000);
}

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/state') return json(res, {
    meta, brands: BRANDS.map((b) => b.name),
    posts: sortedPosts().slice(0, 400),
    read: state.read, starred: state.starred,
  });

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
    return json(res, { ok: true, count: Object.keys(state.read).length });
  }

  if (url.pathname === '/api/star' && req.method === 'POST') {
    const body = await readJson(req);
    if (body.starred === false) delete state.starred[body.id];
    else state.starred[body.id] = Date.now();
    scheduleSave();
    return json(res, { ok: true });
  }

  if (url.pathname === '/img') {
    const target = url.searchParams.get('u');
    if (!target || !isProxyableHost(target)) { res.writeHead(400); return res.end('bad image host'); }
    try {
      const upstream = await fetch(target, {
        headers: { 'User-Agent': client.userAgent, Accept: 'image/*', Referer: 'https://www.reddit.com/' },
      });
      if (!upstream.ok) { res.writeHead(upstream.status); return res.end(); }
      res.writeHead(200, {
        'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.end(buf);
    } catch (e) { res.writeHead(502); return res.end('image fetch failed'); }
  }

  // static
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(__dirname, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  try {
    const buf = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
});

function json(res, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(s);
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
  poll();
});
