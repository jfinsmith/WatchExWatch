// Reddit access: OAuth app-only token (preferred) with an RSS fallback.
import { normalize } from './parse.js';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const OAUTH_BASE = 'https://oauth.reddit.com';

export class RedditClient {
  constructor({ clientId, clientSecret, userAgent, deviceId = 'DO_NOT_TRACK_THIS_DEVICE' }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret || '';
    this.userAgent = userAgent;
    this.deviceId = deviceId;
    this.token = null;
    this.tokenExpires = 0;
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
    if (this.mode === 'rss') return null;
    const token = await this.getToken();
    const url = `${OAUTH_BASE}/comments/${postId}?limit=${limit}&depth=${depth}&sort=old&raw_json=1`;
    const res = await fetch(url, {
      headers: { Authorization: `bearer ${token}`, 'User-Agent': this.userAgent },
    });
    if (res.status === 401) { this.token = null; throw new Error('401 from Reddit (token rejected)'); }
    if (!res.ok) throw new Error(`comments returned ${res.status}`);
    const json = await res.json();
    const out = [];
    walk(json?.[1]?.data?.children || [], out);
    return out;
  }

  // Fallback: the public Atom feed. No gallery data, aggressive rate limits.
  async fetchNewRss(subreddit) {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new.rss?limit=50`;
    const res = await fetch(url, { headers: { 'User-Agent': this.userAgent, Accept: 'application/atom+xml' } });
    if (!res.ok) throw new Error(`RSS returned ${res.status}${res.status === 429 ? ' (rate limited — add API credentials)' : ''}`);
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
  .replace(/\[link\]\s*\[comments\]\s*$/i, '')
  .trim();

function tag(entry, name) {
  const m = entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? unescapeXml(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')).trim() : '';
}

export function parseAtom(xml, subreddit) {
  const entries = xml.split('<entry>').slice(1);
  return entries.map((e) => {
    const link = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    const id = (link.match(/comments\/([a-z0-9]+)/i) || [])[1] || (tag(e, 'id') || '').split('_').pop();
    const contentHtml = tag(e, 'content');
    // contentHtml is HTML nested inside XML, so entities need a second decode pass.
    const body = stripFooter(unescapeXml(contentHtml.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
    const thumb = (e.match(/<media:thumbnail[^>]*url="([^"]+)"/) || [])[1];
    const imgs = [...contentHtml.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => unescapeXml(m[1]));
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
      thumbnail: thumb || imgs[0] || '',
    };
    const n = normalize(fake, subreddit);
    if (!n.images.length) {
      const uniq = [...new Set([thumb, ...imgs].filter(Boolean))];
      n.images = uniq.map((u) => ({ url: u, thumb: u }));
    }
    n.partial = true; // RSS mode: fewer images, no flair
    return n;
  }).filter((p) => p.id);
}
