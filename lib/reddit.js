// Reddit access: OAuth app-only token (preferred) with an RSS fallback.
import { normalize, originalFromPreview } from './parse.js';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const OAUTH_BASE = 'https://oauth.reddit.com';
// A hung socket would stall the whole poll loop; every call is time-boxed.
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20_000);

export class RedditClient {
  constructor({ clientId, clientSecret, userAgent, deviceId = 'DO_NOT_TRACK_THIS_DEVICE' }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret || '';
    this.userAgent = userAgent;
    this.deviceId = deviceId;
    this.token = null;
    this.tokenExpires = 0;
    // Unauthenticated reddit.com allows roughly one request per minute per IP and reports it
    // in x-ratelimit-*. Tracking it lets the scheduler pace itself instead of eating 429s.
    this.rate = { remaining: null, reset: 60, at: 0 };
  }

  noteRateHeaders(res) {
    const rem = parseFloat(res.headers.get('x-ratelimit-remaining'));
    const reset = parseFloat(res.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(rem)) {
      this.rate = { remaining: rem, reset: Number.isFinite(reset) ? reset : 60, at: Date.now() };
    }
  }

  // ms to wait before the next unauthenticated request is likely to be allowed.
  nextAllowedIn() {
    if (this.mode === 'api') return 0;
    if (this.rate.remaining === null || this.rate.remaining > 0) return 0;
    return Math.max(0, this.rate.at + this.rate.reset * 1000 - Date.now());
  }

  get mode() { return this.clientId ? 'api' : 'rss'; }

  async getToken() {
    if (this.token && Date.now() < this.tokenExpires - 60_000) return this.token;
    const body = this.clientSecret
      ? new URLSearchParams({ grant_type: 'client_credentials' })
      : new URLSearchParams({
          grant_type: 'https://oauth.reddit.com/grants/installed_client',
          device_id: this.deviceId,
        });
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`token request failed (${res.status}): ${text.slice(0, 200)}`);
    }
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`token response was not JSON: ${text.slice(0, 200)}`); }
    if (!json.access_token) throw new Error(`no access_token in response: ${text.slice(0, 200)}`);
    this.token = json.access_token;
    this.tokenExpires = Date.now() + (json.expires_in || 3600) * 1000;
    return this.token;
  }

  async fetchNew(subreddit, limit = 100) {
    if (this.mode === 'rss') return this.fetchNewRss(subreddit);
    const token = await this.getToken();
    const url = `${OAUTH_BASE}/r/${encodeURIComponent(subreddit)}/new?limit=${limit}&raw_json=1`;
    const res = await fetch(url, {
      headers: { Authorization: `bearer ${token}`, 'User-Agent': this.userAgent },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401) { this.token = null; throw new Error('401 from Reddit (token rejected); will re-auth'); }
    if (res.status === 429) throw new Error('429 rate limited by Reddit; backing off');
    if (!res.ok) throw new Error(`Reddit returned ${res.status}`);
    const json = await res.json();
    const children = json?.data?.children || [];
    return children.filter((c) => c.kind === 't3').map((c) => normalize(c.data, subreddit));
  }

  // Flattened comment tree for one post. API mode only — the public comment feeds are
  // rate-limited far too hard to poll per post.
  async fetchComments(postId, { limit = 100, depth = 3 } = {}) {
    if (this.mode === 'rss') return this.fetchCommentsRss(postId);
    const token = await this.getToken();
    const url = `${OAUTH_BASE}/comments/${postId}?limit=${limit}&depth=${depth}&sort=old&raw_json=1`;
    const res = await fetch(url, {
      headers: { Authorization: `bearer ${token}`, 'User-Agent': this.userAgent },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401) { this.token = null; throw new Error('401 from Reddit (token rejected)'); }
    if (!res.ok) throw new Error(`comments returned ${res.status}`);
    const json = await res.json();
    const out = [];
    walk(json?.[1]?.data?.children || [], out);
    return out;
  }

  // Comments without OAuth. Same shape as fetchComments, one request per post — expensive
  // against the ~1/min unauthenticated budget, so the scheduler rations these.
  async fetchCommentsRss(postId) {
    const url = `https://www.reddit.com/comments/${encodeURIComponent(postId)}.rss`;
    const res = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/atom+xml' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    this.noteRateHeaders(res);
    if (!res.ok) throw new Error(`comments RSS returned ${res.status}`);
    return parseCommentAtom(await res.text());
  }

  // Fallback: the public Atom feed. No gallery data, aggressive rate limits.
  async fetchNewRss(subreddit) {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new.rss?limit=50`;
    const res = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/atom+xml' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    this.noteRateHeaders(res);
    if (!res.ok) throw new Error(`RSS returned ${res.status}${res.status === 429 ? ' (rate limited — reddit allows ~1 request/min unauthenticated)' : ''}`);
    const xml = await res.text();
    return parseAtom(xml, subreddit);
  }
}

function walk(children, out, depth = 0) {
  for (const c of children) {
    if (c.kind !== 't1' || !c.data) continue;
    const d = c.data;
    out.push({
      id: d.id,
      author: d.author,
      body: d.body || '',
      created: Math.round((d.created_utc || 0) * 1000),
      stickied: !!d.stickied,
      depth,
      permalink: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
    });
    if (d.replies?.data?.children) walk(d.replies.data.children, out, depth + 1);
  }
}

const unescapeXml = (s = '') => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

// The Atom <content> ends with reddit's own "submitted by /u/x [link] [comments]" footer.
const stripFooter = (s = '') => s
  .replace(/submitted by\s*\/u\/[\w-]+\s*\[link\]\s*\[comments\]\s*$/i, '')
  .replace(/submitted by\s*\/u\/[\w-]+\s*to\s*r\/[\w-]+\s*/i, '')
  .replace(/\[link\]\s*\[comments\]\s*$/i, '')
  .trim();

// The comments feed's first entry is the post's own submission, not a reply. It carries the
// permalink to the post itself (no /comment id) and, for a link/timestamp post, only the footer.
const isSubmissionEntry = (e) =>
  /submitted by\s*\/u\/[\w-]+\s*to\s*r\//i.test(e) || /<category\b/i.test(e);

function tag(entry, name) {
  const m = entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? unescapeXml(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')).trim() : '';
}

const entryText = (e) => {
  const m = e.match(/<content[^>]*>([\s\S]*?)<\/content>/);
  if (!m) return '';
  // Content is HTML nested in XML: unescape, drop tags, unescape again.
  const inner = unescapeXml(m[1].replace(/<!\[CDATA\[|\]\]>/g, ''));
  return stripFooter(unescapeXml(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
};

export function parseCommentAtom(xml) {
  return xml.split('<entry>').slice(1)
    .filter((e) => !isSubmissionEntry(e))
    .map((e) => {
      const author = (tag(e, 'name').match(/\/u\/([\w-]+)/) || [])[1] || null;
      const link = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || null;
      return {
        id: (tag(e, 'id') || '').split('_').pop(),
        author,
        body: entryText(e),
        created: Date.parse(tag(e, 'published') || tag(e, 'updated')) || 0,
        stickied: false,
        depth: 0,
        permalink: link ? unescapeXml(link) : null,
      };
    })
    .filter((c) => c.author && c.body);
}

// The entry body links to better images than <media:thumbnail>, which is a 140px crop:
// i.redd.it originals for single-image posts, 640px preview.redd.it for the rest.
const MEDIA_RE = /https?:\/\/(?:i|preview|external-preview)\.redd\.it\/[^\s"'<>)\]]+/gi;

function mediaKey(u) {
  const m = u.match(/redd\.it\/([A-Za-z0-9_-]+)\.(?:jpe?g|png|webp|gif)/i);
  return m ? m[1] : u.split('?')[0];
}

function rankMedia(u) {
  if (/\/\/i\.redd\.it\//i.test(u)) return 3;                     // original
  const w = Number((u.match(/[?&]width=(\d+)/i) || [])[1] || 0);
  return w >= 320 ? 2 : 1;                                          // sized preview vs 140px crop
}

export function imagesFromContent(contentHtml, thumbnail) {
  const html = unescapeXml(unescapeXml(contentHtml || ''));
  const best = new Map();          // key -> highest-quality URL seen
  const sizedPreviews = new Map(); // key -> best sized (>=320px) preview, for grid thumbnails
  const tinyPreviews = new Map();  // key -> 140px crop, used as an instant placeholder
  for (const raw of [...(html.match(MEDIA_RE) || []), thumbnail].filter(Boolean)) {
    const url = unescapeXml(raw).replace(/&amp;/g, '&');
    const key = mediaKey(url);
    const prev = best.get(key);
    if (!prev || rankMedia(url) > rankMedia(prev)) best.set(key, url);
    if (rankMedia(url) === 1 && /preview\.redd\.it/.test(url) && !tinyPreviews.has(key)) tinyPreviews.set(key, url);
    if (rankMedia(url) === 2) {
      const prevSized = sizedPreviews.get(key);
      const width = (u) => Number((u.match(/[?&]width=(\d+)/i) || [])[1] || 0);
      if (!prevSized || width(url) > width(prevSized)) sizedPreviews.set(key, url);
    }
  }
  // Full size for the lightbox, the largest sized preview for the grid. When no sized preview
  // exists (gallery posts only ever expose a 140px crop) the grid falls back to the original
  // and the image proxy scales it down.
  return [...best.entries()].map(([key, url]) => {
    const original = originalFromPreview(url) || url;
    const sized = sizedPreviews.get(key);
    const tiny = tinyPreviews.get(key);
    // tiny paints instantly while the scaled copy is prepared; only gallery posts need it.
    return { url: original, thumb: sized || original, ...(sized ? {} : { tiny }) };
  });
}

export function parseAtom(xml, subreddit) {
  const entries = xml.split('<entry>').slice(1);
  return entries.map((e) => {
    const link = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    const id = (link.match(/comments\/([a-z0-9]+)/i) || [])[1] || (tag(e, 'id') || '').split('_').pop();
    const contentHtml = tag(e, 'content');
    const body = entryText(e);
    const thumb = (e.match(/<media:thumbnail[^>]*url="([^"]+)"/) || [])[1];
    const imgs = imagesFromContent(contentHtml, thumb);
    const fake = {
      id,
      name: `t3_${id}`,
      subreddit,
      title: tag(e, 'title'),
      author: (tag(e, 'author').match(/\/u\/([\w-]+)/) || [])[1] || tag(e, 'author').replace(/\s+/g, ' ').trim(),
      created_utc: Date.parse(tag(e, 'published') || tag(e, 'updated')) / 1000,
      permalink: link.replace('https://www.reddit.com', ''),
      selftext: body,
      url: link,
      preview: null,
      thumbnail: thumb || imgs[0]?.url || '',
    };
    const n = normalize(fake, subreddit);
    if (imgs.length) n.images = imgs;
    n.partial = true; // RSS mode: fewer images, no flair
    return n;
  }).filter((p) => p.id);
}
