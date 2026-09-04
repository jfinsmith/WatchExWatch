// Post normalization: tags, prices, brands, images.

export const BRANDS = [
  { name: 'Rolex', aliases: ['submariner', 'datejust', 'daytona', 'explorer', 'gmt-master', 'oyster perpetual', 'seadweller', 'sea-dweller', 'yacht-master', 'milgauss', 'air-king'] },
  { name: 'Tudor', aliases: ['black bay', 'pelagos', 'ranger'] },
  { name: 'Omega', aliases: ['speedmaster', 'speedy', 'seamaster', 'aqua terra', 'planet ocean', 'constellation'] },
  { name: 'Seiko', aliases: ['skx', 'sarb', 'turtle', 'samurai', 'alpinist', 'willard', 'sumo'] },
  { name: 'Grand Seiko', aliases: ['sbga', 'sbgn', 'sbgw', 'snowflake'] },
  { name: 'Cartier', aliases: ['santos', 'tank ', 'ballon bleu'] },
  { name: 'Patek Philippe', aliases: ['patek', 'nautilus', 'aquanaut', 'calatrava'] },
  { name: 'Audemars Piguet', aliases: ['royal oak', 'audemars'] },
  { name: 'Vacheron Constantin', aliases: ['vacheron', 'overseas'] },
  { name: 'Jaeger-LeCoultre', aliases: ['jlc', 'reverso', 'master control', 'polaris'] },
  { name: 'IWC', aliases: ['portugieser', 'portuguese', 'ingenieur', 'big pilot', 'mark xviii', 'aquatimer'] },
  { name: 'Breitling', aliases: ['navitimer', 'superocean', 'chronomat', 'avenger'] },
  { name: 'TAG Heuer', aliases: ['tag ', 'heuer', 'carrera', 'monaco', 'aquaracer', 'formula 1'] },
  { name: 'Panerai', aliases: ['luminor', 'radiomir', 'submersible', 'pam'] },
  { name: 'Zenith', aliases: ['el primero', 'defy', 'chronomaster'] },
  { name: 'Longines', aliases: ['spirit', 'hydroconquest', 'legend diver'] },
  { name: 'Tissot', aliases: ['prx', 'seastar', 'gentleman'] },
  { name: 'Hamilton', aliases: ['khaki field', 'ventura', 'intra-matic'] },
  { name: 'Oris', aliases: ['aquis', 'divers sixty-five', 'big crown'] },
  { name: 'Sinn', aliases: ['556', 'u1', 'ezm'] },
  { name: 'Nomos', aliases: ['tangente', 'club campus', 'metro', 'orion'] },
  { name: 'Casio', aliases: ['g-shock', 'gshock', 'royale', 'duro', 'edifice'] },
  { name: 'Citizen', aliases: ['promaster', 'tsuyosa', 'eco-drive'] },
  { name: 'Orient', aliases: ['bambino', 'kamasu', 'mako'] },
  { name: 'Christopher Ward', aliases: ['c60', 'c65', 'bel canto', 'twelve'] },
  { name: 'Monta', aliases: ['oceanking', 'atlas', 'noble'] },
  { name: 'Halios', aliases: ['seaforth', 'universa', 'fairwind'] },
  { name: 'Farer', aliases: [] },
  { name: 'Doxa', aliases: ['sub 300', 'sub 200'] },
  { name: 'Bremont', aliases: [] },
  { name: 'Bell & Ross', aliases: ['bell and ross', 'br03', 'br 03'] },
  { name: 'Hublot', aliases: ['big bang', 'classic fusion'] },
  { name: 'Chopard', aliases: ['alpine eagle', 'l.u.c'] },
  { name: 'Blancpain', aliases: ['fifty fathoms', 'bathyscaphe'] },
  { name: 'Breguet', aliases: ['marine', 'classique'] },
  { name: 'A. Lange & Sohne', aliases: ['lange', 'lange 1', 'odysseus', 'saxonia'] },
  { name: 'Glashutte', aliases: ['glashutte original', 'seaq', 'senator'] },
  { name: 'Frederique Constant', aliases: [] },
  { name: 'Baume & Mercier', aliases: ['baume et mercier', 'clifton', 'riviera'] },
  { name: 'Rado', aliases: ['captain cook', 'true square'] },
  { name: 'Movado', aliases: ['museum'] },
  { name: 'Bulova', aliases: ['lunar pilot', 'oceanographer', 'computron'] },
  { name: 'Timex', aliases: ['marlin', 'q timex', 'weekender'] },
  { name: 'Swatch', aliases: ['moonswatch', 'sistem51'] },
  { name: 'Junghans', aliases: ['max bill'] },
  { name: 'Stowa', aliases: ['flieger', 'marine', 'antea'] },
  { name: 'Laco', aliases: [] },
  { name: 'Squale', aliases: ['1521', '2002'] },
  { name: 'Steinhart', aliases: ['ocean one'] },
  { name: 'Marathon', aliases: ['gsar', 'msar', 'navigator'] },
  { name: 'Zodiac', aliases: ['super sea wolf'] },
  { name: 'Vaer', aliases: [] },
  { name: 'Lorier', aliases: ['neptune', 'falcon', 'hyperion'] },
  { name: 'Traska', aliases: ['freediver', 'summiteer'] },
  { name: 'Baltic', aliases: ['aquascaphe', 'hms', 'tricompax'] },
  { name: 'Serica', aliases: ['5303', '8315'] },
  { name: 'Nodus', aliases: ['sector', 'avalon', 'retrospect'] },
  { name: 'Islander', aliases: [] },
  { name: 'Vostok', aliases: ['amphibia', 'komandirskie'] },
  { name: 'Raketa', aliases: [] },
  { name: 'Ball', aliases: ['engineer', 'roadmaster', 'fireman'] },
  { name: 'Alpina', aliases: ['alpiner', 'seastrong'] },
  { name: 'Mido', aliases: ['ocean star', 'multifort', 'commander'] },
  { name: 'Certina', aliases: ['ds action', 'ds ph200m'] },
  { name: 'Maurice Lacroix', aliases: ['aikon'] },
  { name: 'Ulysse Nardin', aliases: ['diver', 'freak'] },
  { name: 'Girard-Perregaux', aliases: ['girard perregaux', 'laureato'] },
  { name: 'H. Moser', aliases: ['moser', 'streamliner', 'pioneer'] },
  { name: 'F.P. Journe', aliases: ['journe', 'chronometre'] },
  { name: 'Richard Mille', aliases: [] },
  { name: 'MB&F', aliases: ['mbf', 'legacy machine'] },
  { name: 'Fortis', aliases: ['flieger', 'marinemaster'] },
  { name: 'Yema', aliases: ['superman', 'navygraf'] },
  { name: 'Autodromo', aliases: ['group b', 'intereuropa'] },
  { name: 'Unimatic', aliases: ['modello'] },
  { name: 'Anordain', aliases: ['model 1', 'model 2'] },
  { name: 'Ming', aliases: ['17.06', '20.01'] },
  { name: 'Kurono', aliases: ['tokyo'] },
  { name: 'Apple', aliases: ['apple watch'] },
  { name: 'Garmin', aliases: ['fenix', 'epix', 'instinct'] },
];

const TAG_RE = /\[\s*(wts|wtb|wtt|wtst|wtstf|wtsf|sold|found|giveaway|meta|mod|wtb\/wtt|wts\/wtt)[^\]]*\]/gi;

export function extractTags(title = '', flair = '') {
  const tags = new Set();
  const src = `${title} ${flair}`;
  let m;
  const re = new RegExp(TAG_RE.source, 'gi');
  while ((m = re.exec(src)) !== null) {
    m[1].toUpperCase().split('/').forEach((t) => tags.add(t));
  }
  if (/\bsold\b/i.test(flair)) tags.add('SOLD');
  return [...tags];
}

// ---------- price ----------

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const PRICE_PATTERNS = [
  // $1,200 / $1200 / $1.2k / USD 1200 / 1200 USD
  new RegExp(String.raw`(?:\$|usd\s*\$?)\s*(${NUM})\s*(k\b)?`, 'gi'),
  new RegExp(String.raw`\b(${NUM})\s*(k)?\s*(?:usd|dollars)\b`, 'gi'),
  // price: 1200 / asking 1200 / obo 1200
  new RegExp(String.raw`\b(?:price|asking|ask|sale price|net|firm|obo)\b[:\s~-]*(${NUM})\s*(k\b)?`, 'gi'),
  // 200$ / 1,200$ / 3.5k$ — dollar sign trailing, common in titles
  new RegExp(String.raw`\b(${NUM})\s*(k)?\s*\$`, 'gi'),
];

const NEGATIVE_CONTEXT = /\b(ref|reference|model|caliber|cal|movement|serial|mm|year)\b[\s.:#]*$/i;

function toNumber(raw, kFlag) {
  let n = parseFloat(String(raw).replace(/,/g, ''));
  if (!isFinite(n)) return null;
  if (kFlag) n *= 1000;
  // "$1.2" with a k-ish magnitude typo guard: 1.2 alone is implausible for a watch
  return n;
}

export function extractPrices(text = '') {
  const found = [];
  for (const re of PRICE_PATTERNS) {
    const r = new RegExp(re.source, re.flags);
    let m;
    while ((m = r.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 14), m.index);
      if (NEGATIVE_CONTEXT.test(before)) continue;
      const value = toNumber(m[1], m[2]);
      if (value === null) continue;
      if (value < 20 || value > 2_000_000) continue;
      found.push({ value: Math.round(value), raw: m[0].trim(), index: m.index });
    }
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set();
  return found.filter((p) => {
    const k = `${p.value}@${p.index}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function derivePrice(title = '', body = '') {
  const fromTitle = extractPrices(title);
  const fromBody = extractPrices(body);
  const all = [...fromTitle, ...fromBody];
  if (!all.length) return { value: null, display: null, source: null, candidates: [] };

  // Prefer a price in the title; otherwise the first plausible one in the body.
  const picked = fromTitle[0] || fromBody[0];
  const values = [...new Set(all.map((p) => p.value))].sort((a, b) => a - b);
  const multi = values.length > 1 && values[values.length - 1] / values[0] > 1.15;
  return {
    value: picked.value,
    display: fmtMoney(picked.value),
    source: fromTitle.length ? 'title' : 'body',
    multiple: multi,
    range: multi ? [values[0], values[values.length - 1]] : null,
    candidates: values.slice(0, 12),
    shipped: /\b(shipped|ship(?:ping)? included|inc(?:l)?\.? ship)\b/i.test(`${title} ${body}`),
    obo: /\bobo\b|\bor best offer\b/i.test(`${title} ${body}`),
  };
}

// Prices posted in the seller's own comment, per the subreddit's "details in a top-level
// comment" rule. Same extraction, tagged so the UI can show where it came from.
export function priceFromComment(body = '') {
  const p = derivePrice('', body);
  if (p.value == null) return null;
  return { ...p, source: 'comment' };
}

export function fmtMoney(n) {
  if (n === null || n === undefined) return null;
  return '$' + n.toLocaleString('en-US');
}

// ---------- flair price range ----------
// r/Watchexchange requires a price-bracket flair on WTS posts ("$1000-$2500", "Under $500",
// "$10k+"). It is coarse, but it is there the moment the post appears — unlike the price,
// which the rules say belongs in a top-level comment the seller may add minutes later.

const FNUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

function flairNum(raw, kSuffix) {
  if (raw == null) return null;
  let str = String(raw).trim().toLowerCase();
  let k = !!kSuffix;
  if (str.endsWith('k')) { k = true; str = str.slice(0, -1).trim(); }
  let n = parseFloat(str.replace(/,/g, ''));
  if (!isFinite(n)) return null;
  if (k) n *= 1000;
  return Math.round(n);
}

export function parseFlairRange(flair = '') {
  const f = flair.replace(/\s+/g, ' ').trim();
  if (!f) return null;

  // "$1,000 - $2,500" / "1k-5k" / "500 to 1000"
  let m = f.match(new RegExp(String.raw`\$?\s*(${FNUM})\s*(k)?\s*(?:-|–|—|to)\s*\$?\s*(${FNUM})\s*(k)?`, 'i'));
  if (m) {
    let min = flairNum(m[1], m[2]);
    const max = flairNum(m[3], m[4]);
    // "1-5k" means 1000-5000, not 1-5000.
    if (min !== null && max !== null && !m[2] && m[4] && min < max / 100) min *= 1000;
    if (min !== null && max !== null && max >= min) return { min, max };
  }
  // "Under $500" / "< $500" / "Below 1k"
  m = f.match(new RegExp(String.raw`(?:under|below|less than|up to|<)\s*\$?\s*(${FNUM})\s*(k)?`, 'i'));
  if (m) { const max = flairNum(m[1], m[2]); if (max !== null) return { min: 0, max }; }

  // "Over $10,000" / "$10k+" / "10000 and up"
  m = f.match(new RegExp(String.raw`(?:over|above|more than|>)\s*\$?\s*(${FNUM})\s*(k)?`, 'i'));
  if (!m) m = f.match(new RegExp(String.raw`\$?\s*(${FNUM})\s*(k)?\s*(?:\+|and up|or more)`, 'i'));
  if (m) { const min = flairNum(m[1], m[2]); if (min !== null) return { min, max: null }; }

  // Bare bracket like "$500" used as a single-value flair.
  m = f.match(new RegExp(String.raw`^\$\s*(${FNUM})\s*(k)?$`, 'i'));
  if (m) { const v = flairNum(m[1], m[2]); if (v !== null) return { min: v, max: v }; }

  return null;
}

export function fmtRange(r) {
  if (!r) return null;
  if (r.max === null) return `${fmtMoney(r.min)}+`;
  if (r.min === 0) return `under ${fmtMoney(r.max)}`;
  if (r.min === r.max) return fmtMoney(r.min);
  return `${fmtMoney(r.min)}–${fmtMoney(r.max)}`;
}

// ---------- brands ----------

export function detectBrands(title = '', body = '', flair = '') {
  const hay = ` ${title} ${flair} ${body} `.toLowerCase();
  const hits = [];
  for (const b of BRANDS) {
    const needles = [b.name.toLowerCase(), ...b.aliases.map((a) => a.toLowerCase())];
    for (const n of needles) {
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, 'i');
      if (re.test(hay)) { hits.push(b.name); break; }
    }
  }
  return [...new Set(hits)];
}

// ---------- sold ----------
// A listing is done when the flair flips to "Sold", the title is edited to say so, or the seller
// drops a "sold"/"sale pending" comment. Kept deliberately tight so a phrase like "never sold by
// a dealer" in a description doesn't retire a live post.
const SOLD_RE = /\b(sold|sale pending|pending sale|no longer available|sale complete|deal done)\b/i;
const SOLD_NEG = /\b(never sold|not sold|unsold|before it sells|will be sold|to be sold)\b/i;

export function detectSold({ flair = '', title = '', comment = '' } = {}) {
  if (/\bsold\b/i.test(flair)) return true;
  for (const text of [title, comment]) {
    if (!text) continue;
    if (SOLD_NEG.test(text)) continue;
    if (SOLD_RE.test(text)) return true;
  }
  return false;
}

// ---------- images ----------

const IMG_HOST = /(?:^|\.)(redd\.it|redditmedia\.com|imgur\.com|imgur\.io)$/i;

function clean(u = '') {
  return u.replace(/&amp;/g, '&');
}

export function extractImages(post) {
  const out = [];
  const push = (url, thumb) => {
    if (!url) return;
    const u = clean(url);
    if (!/^https?:\/\//i.test(u)) return;
    if (out.some((i) => i.url === u)) return;
    out.push({ url: u, thumb: clean(thumb || url) });
  };

  // Gallery posts
  if (post.is_gallery && post.media_metadata) {
    const order = post.gallery_data?.items?.map((i) => i.media_id) || Object.keys(post.media_metadata);
    for (const id of order) {
      const m = post.media_metadata[id];
      if (!m || m.status !== 'valid') continue;
      const full = m.s?.u || m.s?.gif || m.s?.mp4;
      const previews = m.p || [];
      const thumb = previews.length ? previews[Math.min(previews.length - 1, 3)].u : full;
      push(full, thumb);
    }
  }

  // Preview images (single image / link posts)
  for (const p of post.preview?.images || []) {
    const full = p.source?.u || p.source?.url;
    const res = p.resolutions || [];
    const thumb = res.length ? (res[Math.min(res.length - 1, 3)].u || res[res.length - 1].url) : full;
    push(full, thumb);
  }

  // Direct image link
  const direct = post.url_overridden_by_dest || post.url;
  if (direct && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(direct)) push(direct, direct);

  // Imgur single-image page -> guess direct asset
  if (direct && /^https?:\/\/(www\.)?imgur\.com\/[A-Za-z0-9]{5,8}$/i.test(direct)) {
    push(direct.replace('imgur.com', 'i.imgur.com') + '.jpeg', null);
  }

  if (!out.length && post.thumbnail && /^https?:/.test(post.thumbnail)) push(post.thumbnail, post.thumbnail);
  return out;
}

// Reddit's preview URLs are signed against their width, so a 140px gallery crop can't just be
// asked for at a bigger size. The media id in the path is the same one i.redd.it serves the
// unsigned original under, though — preview.redd.it/abc123.jpg -> i.redd.it/abc123.jpg.
// (external-preview.redd.it hosts previews of off-site images; those ids 404 on i.redd.it.)
export function originalFromPreview(url = '') {
  const m = url.match(/^https?:\/\/preview\.redd\.it\/([A-Za-z0-9_-]+\.(?:jpe?g|png|webp|gif))(?:\?|$)/i);
  return m ? `https://i.redd.it/${m[1]}` : null;
}

export function isProxyableHost(urlStr) {
  try {
    const h = new URL(urlStr).hostname;
    return IMG_HOST.test(h);
  } catch { return false; }
}

// ---------- normalize ----------

export function normalize(post, subreddit) {
  const title = post.title || '';
  const body = post.selftext || '';
  const flair = post.link_flair_text || '';
  const price = derivePrice(title, body);
  price.flairRange = parseFlairRange(flair);
  return {
    id: post.id,
    fullname: post.name || `t3_${post.id}`,
    subreddit: post.subreddit || subreddit,
    title,
    author: post.author,
    created: Math.round((post.created_utc || 0) * 1000),
    permalink: `https://www.reddit.com${post.permalink || `/r/${subreddit}/comments/${post.id}/`}`,
    url: post.url_overridden_by_dest || post.url || null,
    flair,
    tags: extractTags(title, flair),
    price,
    brands: detectBrands(title, body, flair),
    images: extractImages(post),
    bodyPreview: body.slice(0, 900),
    bodyLength: body.length,
    comments: post.num_comments || 0,
    over18: !!post.over_18,
    removed: !!post.removed_by_category,
  };
}
