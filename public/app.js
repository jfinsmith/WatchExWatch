// Watchexchange live monitor — client.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const PAGE = 60;

const state = {
  posts: new Map(),      // id -> post
  read: new Set(),
  starred: new Set(),
  alerted: new Set(),    // matched an alert this session
  sessionNew: new Set(), // arrived live, not part of the startup backlog
  imgIdx: new Map(),     // id -> index of the photo currently shown
  view: 'all',
  focusId: null,
  brands: [],
  meta: {},
  pendingNew: 0,
  limit: PAGE,
};

const ALERT_DEFAULTS = { enabled: false, sound: true, notify: true, keywords: '', maxPrice: '', wtsOnly: true, brands: [] };
const FILTER_DEFAULTS = { q: '', tag: '', min: '', max: '', sort: 'new', brand: '', author: '', pricedOnly: false, hideSold: true };

const load = (k, fallback) => { try { return { ...fallback, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return { ...fallback }; } };
let cfg = load('wx.alerts', ALERT_DEFAULTS);
let filters = load('wx.filters', FILTER_DEFAULTS);

const saveCfg = () => localStorage.setItem('wx.alerts', JSON.stringify(cfg));
const saveFilters = () => localStorage.setItem('wx.filters', JSON.stringify(filters));

// ------------------------------------------------------------------ theme
function applyTheme(t) {
  const resolved = t === 'auto'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : t;
  document.documentElement.dataset.theme = resolved;
  localStorage.setItem('wx.theme', t);
}
applyTheme(localStorage.getItem('wx.theme') || 'auto');

// ------------------------------------------------------------------- boot
init();

async function init() {
  bindUI();
  applyUIFromConfig();
  const data = await (await fetch('/api/state')).json();
  state.brands = data.brands;
  state.meta = data.meta;
  Object.keys(data.read || {}).forEach((id) => state.read.add(id));
  Object.keys(data.starred || {}).forEach((id) => state.starred.add(id));
  data.posts.forEach((p) => state.posts.set(p.id, p));
  buildBrandList();
  render();
  updateStatus();
  connect();
}

function connect() {
  const es = new EventSource('/api/stream');

  es.addEventListener('posts', (e) => {
    const { posts, backfill } = JSON.parse(e.data);
    const fresh = [];
    for (const p of posts) {
      const isNew = !state.posts.has(p.id);
      state.posts.set(p.id, p);
      if (!isNew) continue;
      fresh.push(p.id);
      if (backfill) continue;
      state.sessionNew.add(p.id);
      if (matchesAlert(p)) fireAlert(p);
    }
    if (!fresh.length) return;
    if (window.scrollY < 120) {
      render(fresh);
    } else {
      state.pendingNew += fresh.length;
      const pill = $('#newpill');
      pill.textContent = `↑ ${state.pendingNew} new post${state.pendingNew > 1 ? 's' : ''}`;
      pill.hidden = false;
      requestAnimationFrame(() => pill.classList.add('show'));
      render(fresh, true);
    }
  });

  es.addEventListener('update', (e) => {
    const p = JSON.parse(e.data);
    const had = state.posts.get(p.id);
    state.posts.set(p.id, p);
    // A post that arrived priceless can qualify once the seller comments a price.
    if (state.sessionNew.has(p.id) && !state.alerted.has(p.id)
        && had?.price.value == null && p.price.value != null && matchesAlert(p)) fireAlert(p);
    // Retire a card the moment it sells, if sold posts are hidden.
    if (p.sold && !had?.sold && filters.hideSold) {
      const el = $(`.card[data-id="${p.id}"]`);
      if (el) { el.classList.add('leaving'); setTimeout(render, 320); return; }
    }
    render();
    if (lb.id === p.id) fillLightbox(p);
  });

  es.addEventListener('meta', (e) => { state.meta = JSON.parse(e.data); updateStatus(); });
  es.onerror = () => {
    $('#dot').className = 'pulse err';
    $('#status').className = 'status err';
    $('#status').textContent = 'reconnecting…';
  };
  es.onopen = () => updateStatus();
}

function updateStatus() {
  const m = state.meta;
  const dot = $('#dot');
  const st = $('#status');
  if (m.lastError) {
    dot.className = 'pulse err';
    st.className = 'status err';
    st.textContent = m.lastError;
    return;
  }
  dot.className = 'pulse live';
  st.className = 'status';
  const secs = m.lastFetch ? Math.round((Date.now() - m.lastFetch) / 1000) : null;
  st.textContent = [
    m.mode === 'rss' ? 'public feed' : 'Reddit API',
    `r/${(m.subreddits || []).join(', r/')}`,
    secs === null ? null : `checked ${secs}s ago`,
    m.awaitingPrice ? `${m.awaitingPrice} awaiting price` : null,
  ].filter(Boolean).join('  ·  ');
}
setInterval(updateStatus, 5000);

// -------------------------------------------------------------- filtering
// Search matches when every whitespace-separated term appears somewhere in the post — title,
// brands, seller, flair, the seller's comment, the detected price, and any candidate figures.
// AND-ing terms lets "omega speedmaster 3861" narrow instead of needing that exact phrase.
function haystack(p) {
  if (p._hay) return p._hay;
  const parts = [
    p.title, p.author, p.flair, p.brands.join(' '),
    p.bodyPreview, p.sellerComment,
    p.price?.display, (p.price?.candidates || []).map((v) => '$' + v).join(' '),
    p.tags.join(' '),
  ];
  return (p._hay = parts.filter(Boolean).join(' \u0001 ').toLowerCase());
}
function matchesQuery(p, terms) {
  const hay = haystack(p);
  return terms.every((t) => hay.includes(t));
}

// A price is either known exactly (title / body / seller's comment) or bracketed by the flair
// the subreddit requires on WTS posts. Filters and sorting work off whichever exists.
function priceBounds(p) {
  if (p.price.value != null) return { min: p.price.value, max: p.price.value };
  const r = p.price.flairRange;
  if (r) return { min: r.min, max: r.max == null ? Infinity : r.max };
  return null;
}

function fmtMoney(n) { return '$' + Number(n).toLocaleString('en-US'); }

function fmtRange(r) {
  if (!r) return null;
  if (r.max == null) return `${fmtMoney(r.min)}+`;
  if (r.min === 0) return `under ${fmtMoney(r.max)}`;
  if (r.min === r.max) return fmtMoney(r.min);
  return `${fmtMoney(r.min)}–${fmtMoney(r.max)}`;
}

const SORTERS = {
  new: (a, b) => b.created - a.created,
  priceasc: (a, b) => (priceBounds(a)?.min ?? Infinity) - (priceBounds(b)?.min ?? Infinity) || b.created - a.created,
  pricedesc: (a, b) => (priceBounds(b)?.min ?? -1) - (priceBounds(a)?.min ?? -1) || b.created - a.created,
};

function visiblePosts() {
  const q = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const min = filters.min === '' ? null : Number(filters.min);
  const max = filters.max === '' ? null : Number(filters.max);
  return [...state.posts.values()]
    .filter((p) => {
      if (state.view === 'unread' && state.read.has(p.id)) return false;
      if (state.view === 'starred' && !state.starred.has(p.id)) return false;
      if (state.view === 'alerts' && !state.alerted.has(p.id)) return false;
      if (filters.hideSold && (p.sold || p.tags.includes('SOLD'))) return false;
      if (filters.tag && !p.tags.includes(filters.tag)) return false;
      if (filters.brand && !p.brands.includes(filters.brand)) return false;
      if (filters.author && p.author !== filters.author) return false;
      if (filters.pricedOnly && p.price.value == null) return false;
      if (min !== null || max !== null) {
        const b = priceBounds(p);
        if (!b) return false;
        if (min !== null && b.max < min) return false;
        if (max !== null && b.min > max) return false;
      }
      if (q.length && !matchesQuery(p, q)) return false;
      return true;
    })
    .sort(SORTERS[filters.sort] || SORTERS.new);
}

const countUnread = () => [...state.posts.values()].filter((p) => !state.read.has(p.id)).length;

// ----------------------------------------------------------------- render
// Rebuilding every card on each update restarts every image download, so cards are cached by a
// key covering everything that affects their markup: an unchanged card is re-inserted as the
// very same DOM node, decoded image included.
const cardCache = new Map();

function cardKey(p) {
  const r = p.price.flairRange;
  return [
    p.id, p.comments, p.flair, p.price.value, p.price.source, r ? `${r.min}-${r.max}` : '',
    state.read.has(p.id) ? 'r' : '', state.starred.has(p.id) ? 's' : '',
    state.alerted.has(p.id) ? 'a' : '', state.focusId === p.id ? 'f' : '',
    p.sold ? 'sold' : '', p.sellerComment ? 'c' : '',
    state.imgIdx.get(p.id) || 0,
  ].join('|');
}

function render(newIds = [], keepScroll = false) {
  const y = window.scrollY;
  const all = visiblePosts();
  const list = all.slice(0, state.limit);

  const nodes = list.map((p) => {
    const key = cardKey(p);
    let el = cardCache.get(p.id);
    if (!el || el.dataset.key !== key) {
      el = card(p, newIds.includes(p.id));
      el.dataset.key = key;
      cardCache.set(p.id, el);
    }
    return el;
  });
  const live = new Set(list.map((p) => p.id));
  for (const id of cardCache.keys()) if (!live.has(id)) cardCache.delete(id);

  $('#grid').replaceChildren(...nodes);
  $('#empty').hidden = all.length > 0;
  $('#n-all').textContent = state.posts.size;
  $('#n-unread').textContent = countUnread();
  $('#n-alerts').textContent = state.alerted.size;
  $('#n-starred').textContent = state.starred.size;
  renderActiveFilters();
  if (keepScroll) window.scrollTo(0, y);
  const unread = countUnread();
  document.title = unread ? `(${unread}) Watchexchange Live` : 'Watchexchange Live';
}

function resetPaging() { state.limit = PAGE; }

// Cards ask the proxy for a scaled copy; the lightbox always wants the original. If the URL is
// already a preview at or below the requested width, skip the resize.
function img(url, w) {
  const have = Number((url.match(/[?&]width=(\d+)/i) || [])[1] || 0);
  const want = w && (!have || have > w) ? `&w=${w}` : '';
  return `/img?u=${encodeURIComponent(url)}${want}`;
}

const ICON = {
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14l-5-4 5-4"/><path d="M4 10h9a6 6 0 010 12h-3"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M14 11a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1.4-1.4"/><path d="M10 13a4.5 4.5 0 006.4 0l3-3A4.5 4.5 0 0013 3.6L11.6 5"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-6 6"/></svg>',
};

function card(p, isNew) {
  const el = document.createElement('article');
  const read = state.read.has(p.id);
  el.className = ['card', read ? 'read' : 'unread', isNew ? 'enter' : '',
    state.alerted.has(p.id) ? 'alerted' : '', p.sold ? 'sold' : '',
    state.focusId === p.id ? 'focused' : ''].filter(Boolean).join(' ');
  el.dataset.id = p.id;

  const images = p.images || [];
  const idx = Math.min(state.imgIdx.get(p.id) || 0, Math.max(images.length - 1, 0));
  const cur = images[idx];

  const shot = document.createElement('div');
  shot.className = 'thumb';
  if (cur) {
    shot.innerHTML = `<img loading="lazy" alt="" />
      <div class="scrim"></div>` +
      (images.length > 1 ? `
        <button class="nav prev" data-nav="-1" aria-label="Previous photo">‹</button>
        <button class="nav next" data-nav="1" aria-label="Next photo">›</button>
        <span class="count-pip">${idx + 1}/${images.length}</span>
        <div class="dots">${images.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')}</div>` : '');
    mountImage(shot, cur);
  } else {
    shot.classList.add('ready');
    shot.innerHTML = `<div class="noimg">${ICON.photo}<span>no photo${p.partial ? ' in the public feed' : ''}</span></div>`;
  }
  shot.append(priceTag(p));
  if (p.sold) { const r = document.createElement('span'); r.className = 'sold-ribbon'; r.textContent = 'SOLD'; shot.append(r); }
  el.append(shot);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = `
    <div class="title">${esc(p.title)}</div>
    <div class="chips">${chipsFor(p)}</div>
    <div class="meta">
      <span class="unread-dot"></span>
      <span class="age" data-created="${p.created}" title="${new Date(p.created).toLocaleString()}">${ago(p.created)}</span>
      <span class="dot-sep"></span>
      <span class="seller" data-author="${esc(p.author || '')}">u/${esc(p.author || '?')}</span>
      <span class="grow"></span>
      <button class="act star${state.starred.has(p.id) ? ' on' : ''}" title="Save (s)" aria-label="Save">${ICON.star}</button>
      <button class="act toggleread" title="${read ? 'Mark unread' : 'Mark read'} (m)" aria-label="Toggle read">${read ? ICON.undo : ICON.check}</button>
      <a class="act" href="${p.permalink}" target="_blank" rel="noreferrer" title="Open on Reddit (o)">${ICON.link}</a>
    </div>`;
  el.append(body);

  el.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { e.stopPropagation(); flipPhoto(p.id, Number(nav.dataset.nav)); return; }
    if (e.target.closest('.star')) { e.stopPropagation(); toggleStar(p.id); return; }
    if (e.target.closest('.toggleread')) { e.stopPropagation(); setRead(p.id, !state.read.has(p.id)); return; }
    const brand = e.target.closest('.chip.brand');
    if (brand) { e.stopPropagation(); setFilter('brand', brand.dataset.brand); return; }
    const seller = e.target.closest('.seller');
    if (seller) { e.stopPropagation(); setFilter('author', seller.dataset.author); return; }
    if (e.target.closest('a')) { setRead(p.id, true); return; }
    state.focusId = p.id;
    openLightbox(p.id);
  });
  return el;
}

function priceTag(p) {
  const tag = document.createElement('span');
  if (p.price.value != null) {
    tag.className = 'price' + (p.price.source === 'body' ? ' soft' : '');
    tag.innerHTML = p.price.display
      + (p.price.source === 'comment' ? '<small>comment</small>' : '')
      + (p.price.obo ? '<small>obo</small>' : '')
      + (p.price.shipped ? '<small>shipped</small>' : '')
      + (p.price.multiple ? `<small>+${p.price.candidates.length - 1}</small>` : '');
  } else if (p.price.flairRange) {
    tag.className = 'price soft';
    tag.innerHTML = `${fmtRange(p.price.flairRange)}<small>flair</small>`;
  } else if (Date.now() - p.created < 6 * 3600e3) {
    tag.className = 'price pending';
    tag.textContent = 'watching for price';
  } else {
    tag.className = 'price pending';
    tag.textContent = 'no price';
  }
  return tag;
}

function chipsFor(p) {
  return [
    ...p.tags.map((t) => `<span class="chip ${t.toLowerCase()}">${t}</span>`),
    p.flair && !p.tags.includes(p.flair.toUpperCase()) ? `<span class="chip">${esc(p.flair)}</span>` : '',
    ...p.brands.slice(0, 3).map((b) => `<span class="chip brand" data-brand="${esc(b)}">${esc(b)}</span>`),
  ].join('');
}

// Gallery posts only expose a 140px crop, so paint that blurred straight away and swap in the
// scaled copy once the proxy has produced it.
function mountImage(shot, image) {
  const el = $('img', shot);
  const full = img(image.thumb || image.url, 640);
  const ready = () => { shot.classList.add('ready'); el.classList.add('shown'); };
  el.addEventListener('error', () => shot.classList.add('ready'), { once: true });

  if (image.tiny) {
    el.classList.add('blur');
    el.addEventListener('load', ready, { once: true });
    el.src = img(image.tiny);
    const hi = new Image();
    hi.onload = () => { el.src = full; el.classList.remove('blur'); ready(); };
    hi.src = full;
  } else {
    el.classList.remove('blur');
    el.addEventListener('load', ready, { once: true });
    el.src = full;
    if (el.complete && el.naturalWidth) ready();
  }
}

function flipPhoto(id, delta) {
  const p = state.posts.get(id);
  if (!p || p.images.length < 2) return;
  const next = ((state.imgIdx.get(id) || 0) + delta + p.images.length) % p.images.length;
  state.imgIdx.set(id, next);
  const el = $(`.card[data-id="${id}"]`);
  if (el) {
    const shot = $('.thumb', el);
    shot.classList.remove('ready');
    $('img', shot).classList.remove('shown');
    mountImage(shot, p.images[next]);
    $('.count-pip', el).textContent = `${next + 1}/${p.images.length}`;
    $$('.dots i', el).forEach((d, i) => d.classList.toggle('on', i === next));
    el.dataset.key = cardKey(p);
  }
  if (lb.id === id) showLbImage(next);
}

// ---------------------------------------------------------- read / saved
function setRead(id, read) {
  read ? state.read.add(id) : state.read.delete(id);
  const el = $(`.card[data-id="${id}"]`);
  if (el) {
    el.classList.toggle('read', read);
    el.classList.toggle('unread', !read);
    const b = $('.toggleread', el);
    if (b) { b.innerHTML = read ? ICON.undo : ICON.check; b.title = read ? 'Mark unread (m)' : 'Mark read (m)'; }
    el.dataset.key = cardKey(state.posts.get(id));
  }
  $('#n-unread').textContent = countUnread();
  const unread = countUnread();
  document.title = unread ? `(${unread}) Watchexchange Live` : 'Watchexchange Live';
  if (state.view === 'unread' && read) setTimeout(render, 400);
  post('/api/read', { ids: [id], read });
}

function toggleStar(id) {
  const on = !state.starred.has(id);
  on ? state.starred.add(id) : state.starred.delete(id);
  const el = $(`.card[data-id="${id}"]`);
  if (el) { $('.star', el)?.classList.toggle('on', on); el.dataset.key = cardKey(state.posts.get(id)); }
  $('#n-starred').textContent = state.starred.size;
  if (lb.id === id) $('#lbstar').textContent = on ? '★ Saved' : '★ Save';
  post('/api/star', { id, starred: on });
}

const post = (url, body) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).catch(() => {});

// ------------------------------------------------------------- lightbox
const lb = { id: null, idx: 0 };

function openLightbox(id) {
  const p = state.posts.get(id);
  if (!p) return;
  lb.id = id;
  lb.idx = Math.min(state.imgIdx.get(id) || 0, Math.max(p.images.length - 1, 0));
  fillLightbox(p);
  showLbImage(lb.idx);
  $('#lb').hidden = false;
  setRead(id, true);
}

function fillLightbox(p) {
  $('#lbtitle').textContent = p.title;

  const price = $('#lbprice');
  if (p.price.value != null) {
    const qual = [
      p.price.source === 'comment' ? "from the seller's comment" : `from the ${p.price.source}`,
      p.price.shipped ? 'shipped' : null,
      p.price.obo ? 'or best offer' : null,
      p.price.multiple ? `all prices seen: ${p.price.candidates.map(fmtMoney).join(', ')}` : null,
    ].filter(Boolean).join(' · ');
    price.className = 'lb-price';
    price.innerHTML = `${esc(p.price.display)}<span class="qual">${esc(qual)}</span>`;
  } else if (p.price.flairRange) {
    price.className = 'lb-price';
    price.innerHTML = `${esc(fmtRange(p.price.flairRange))}<span class="qual">flair bracket — exact price not posted yet</span>`;
  } else {
    price.className = 'lb-price none';
    price.textContent = 'No price posted yet';
  }

  const facts = [
    ['Seller', `u/${p.author}`],
    ['Posted', `${ago(p.created)} · ${new Date(p.created).toLocaleString()}`],
    ['Comments', String(p.comments)],
    p.brands.length ? ['Brands', p.brands.join(' · ')] : null,
    p.flair ? ['Flair', p.flair] : null,
  ].filter(Boolean);
  $('#lbfacts').innerHTML = facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

  const openLink = $('#lbopen');
  openLink.href = p.price.commentUrl || p.permalink;
  openLink.textContent = p.price.commentUrl ? 'Open the price comment ↗' : 'Open on Reddit ↗';
  $('#lbstar').textContent = state.starred.has(p.id) ? '★ Saved' : '★ Save';

  const detail = (p.sellerComment || p.bodyPreview || '').trim();
  const bodyEl = $('#lbbody');
  bodyEl.textContent = detail;
  bodyEl.classList.toggle('from-comment', !!p.sellerComment && !p.bodyPreview);
  $('#lbthumbs').innerHTML = p.images.length > 1
    ? p.images.map((im, i) => `<img data-i="${i}" class="${i === lb.idx ? 'on' : ''}" src="${img(im.thumb || im.url, 160)}" alt="" />`).join('')
    : '';
}

function showLbImage(i) {
  const p = state.posts.get(lb.id);
  if (!p || !p.images.length) { $('#lbimg').removeAttribute('src'); $('#lbcounter').textContent = ''; return; }
  lb.idx = (i + p.images.length) % p.images.length;
  state.imgIdx.set(lb.id, lb.idx);
  $('#lbimg').src = img(p.images[lb.idx].url);
  $$('#lbthumbs img').forEach((t, n) => t.classList.toggle('on', n === lb.idx));
  const many = p.images.length > 1;
  $('#lbcounter').textContent = many ? `${lb.idx + 1} / ${p.images.length}` : '';
  $('#lbprev').hidden = !many;
  $('#lbnext').hidden = !many;
}

function closeLightbox() { $('#lb').hidden = true; lb.id = null; }

// --------------------------------------------------------------- alerts
function matchesAlert(p) {
  if (!cfg.enabled) return false;
  if (cfg.wtsOnly && !p.tags.includes('WTS')) return false;
  if (cfg.maxPrice !== '' && cfg.maxPrice != null) {
    const b = priceBounds(p);
    // Nothing known yet: let it through, since this re-runs when a price comment lands.
    if (b && b.min > Number(cfg.maxPrice)) return false;
  }
  const kws = String(cfg.keywords || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!cfg.brands.length && !kws.length) return true;   // type / price filter only
  if (cfg.brands.length && p.brands.some((b) => cfg.brands.includes(b))) return true;
  const hay = `${p.title} ${p.bodyPreview}`.toLowerCase();
  return kws.some((k) => hay.includes(k));
}

function fireAlert(p) {
  state.alerted.add(p.id);
  $('#n-alerts').textContent = state.alerted.size;
  if (cfg.sound) chime();
  toast(p);
  if (cfg.notify && 'Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(p.price.display ? `${p.price.display} — ${p.brands[0] || 'Watchexchange'}` : 'New Watchexchange post', {
      body: p.title,
      icon: p.images[0] ? img(p.images[0].thumb || p.images[0].url, 256) : undefined,
      tag: p.id,
    });
    n.onclick = () => { window.focus(); openLightbox(p.id); };
  }
}

function toast(p) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    ${p.images[0] ? `<img src="${img(p.images[0].thumb || p.images[0].url, 128)}" alt="" />` : ''}
    <div class="t-copy">
      <div class="t-price">${esc(p.price.display || fmtRange(p.price.flairRange) || 'new post')}</div>
      <div class="t-title">${esc(p.title)}</div>
    </div>`;
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  el.addEventListener('click', () => { openLightbox(p.id); kill(); });
  $('#toasts').append(el);
  setTimeout(kill, 9000);
}

let ac;
function chime() {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = ac.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.12);
      g.gain.linearRampToValueAtTime(0.16, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.35);
      o.connect(g).connect(ac.destination);
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.4);
    });
  } catch {}
}

// ------------------------------------------------------- alerts: brands
function buildBrandList() {
  const needle = $('#a-brandsearch').value.trim().toLowerCase();
  const shown = state.brands.filter((b) => !needle || b.toLowerCase().includes(needle));
  $('#a-brands').innerHTML = shown.length
    ? shown.map((b) => `<label class="check"><input type="checkbox" value="${esc(b)}"${cfg.brands.includes(b) ? ' checked' : ''} /><span>${esc(b)}</span></label>`).join('')
    : '<div class="none">No brand matches that.</div>';
  renderChosenBrands();
}

function renderChosenBrands() {
  $('#a-brandcount').textContent = cfg.brands.length;
  $('#a-chosen').innerHTML = cfg.brands
    .map((b) => `<span class="filter-chip">${esc(b)}<button data-brand="${esc(b)}" aria-label="Remove ${esc(b)}">✕</button></span>`).join('');
}

// ------------------------------------------------------- active filters
function setFilter(key, value) {
  filters[key] = filters[key] === value ? '' : value;
  saveFilters();
  resetPaging();
  render();
  if (key === 'tag') $('#ftag').value = filters.tag;
}

function renderActiveFilters() {
  const chips = [];
  if (filters.brand) chips.push(['brand', filters.brand, filters.brand]);
  if (filters.author) chips.push(['author', filters.author, `u/${filters.author}`]);
  if (filters.tag) chips.push(['tag', filters.tag, filters.tag]);
  if (filters.min || filters.max) {
    const label = filters.min && filters.max ? `$${filters.min}–$${filters.max}`
      : filters.min ? `over $${filters.min}` : `under $${filters.max}`;
    chips.push(['price', '', label]);
  }
  $('#activefilters').innerHTML = chips
    .map(([k, , label]) => `<span class="filter-chip">${esc(label)}<button data-clear="${k}" aria-label="Clear">✕</button></span>`).join('');
}

// ------------------------------------------------------------ UI wiring
function applyUIFromConfig() {
  $('#a-enabled').checked = cfg.enabled;
  $('#a-sound').checked = cfg.sound;
  $('#a-notify').checked = cfg.notify;
  $('#a-keywords').value = cfg.keywords;
  $('#a-maxprice').value = cfg.maxPrice;
  $('#a-wtsonly').checked = cfg.wtsOnly;
  $('#openpanel').classList.toggle('on', cfg.enabled);
  $('#q').value = filters.q;
  $('#ftag').value = filters.tag;
  $('#fmin').value = filters.min;
  $('#fmax').value = filters.max;
  $('#fsort').value = filters.sort;
  $('#fpriced').checked = filters.pricedOnly;
  $('#fhidesold').checked = filters.hideSold;
}

function bindUI() {
  const onFilter = (key, prop = 'value') => (e) => {
    filters[key] = e.target[prop];
    saveFilters(); resetPaging(); render();
  };
  $('#q').addEventListener('input', debounce(onFilter('q'), 180));
  $('#ftag').addEventListener('change', onFilter('tag'));
  $('#fsort').addEventListener('change', onFilter('sort'));
  $('#fmin').addEventListener('input', debounce(onFilter('min'), 250));
  $('#fmax').addEventListener('input', debounce(onFilter('max'), 250));
  $('#fpriced').addEventListener('change', onFilter('pricedOnly', 'checked'));
  $('#fhidesold').addEventListener('change', onFilter('hideSold', 'checked'));

  $('#activefilters').addEventListener('click', (e) => {
    const k = e.target.closest('[data-clear]')?.dataset.clear;
    if (!k) return;
    if (k === 'price') { filters.min = ''; filters.max = ''; $('#fmin').value = ''; $('#fmax').value = ''; }
    else { filters[k] = ''; if (k === 'tag') $('#ftag').value = ''; }
    saveFilters(); resetPaging(); render();
  });

  $$('#viewseg button').forEach((b) => b.addEventListener('click', () => {
    $$('#viewseg button').forEach((x) => x.classList.toggle('on', x === b));
    state.view = b.dataset.view;
    resetPaging();
    render();
    window.scrollTo({ top: 0 });
  }));

  $('#markall').addEventListener('click', () => {
    const ids = visiblePosts().map((p) => p.id);
    ids.forEach((id) => state.read.add(id));
    post('/api/read', { ids, read: true });
    render();
  });

  $('#themebtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });

  $('#newpill').addEventListener('click', jumpToNewest);

  const openP = () => { $('#panel').hidden = false; $('#scrim').hidden = false; };
  const closeP = () => { $('#panel').hidden = true; $('#scrim').hidden = true; };
  $('#openpanel').addEventListener('click', openP);
  $('#closepanel').addEventListener('click', closeP);
  $('#scrim').addEventListener('click', closeP);

  $('#a-enabled').addEventListener('change', (e) => {
    cfg.enabled = e.target.checked; saveCfg();
    $('#openpanel').classList.toggle('on', cfg.enabled);
    if (cfg.enabled && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  });
  $('#a-sound').addEventListener('change', (e) => { cfg.sound = e.target.checked; saveCfg(); if (cfg.sound) chime(); });
  $('#a-notify').addEventListener('change', (e) => { cfg.notify = e.target.checked; saveCfg(); });
  $('#a-keywords').addEventListener('input', debounce((e) => { cfg.keywords = e.target.value; saveCfg(); }, 300));
  $('#a-maxprice').addEventListener('input', debounce((e) => { cfg.maxPrice = e.target.value; saveCfg(); }, 300));
  $('#a-wtsonly').addEventListener('change', (e) => { cfg.wtsOnly = e.target.checked; saveCfg(); });
  $('#a-brandsearch').addEventListener('input', debounce(buildBrandList, 120));
  $('#a-brands').addEventListener('change', () => {
    const checked = $$('#a-brands input:checked').map((x) => x.value);
    const hidden = cfg.brands.filter((b) => !$(`#a-brands input[value="${CSS.escape(b)}"]`));
    cfg.brands = [...new Set([...hidden, ...checked])];
    saveCfg(); renderChosenBrands();
  });
  $('#a-chosen').addEventListener('click', (e) => {
    const b = e.target.closest('[data-brand]')?.dataset.brand;
    if (!b) return;
    cfg.brands = cfg.brands.filter((x) => x !== b);
    saveCfg(); buildBrandList();
  });
  $('#a-perm').addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    const r = await Notification.requestPermission();
    $('#a-perm').textContent = r === 'granted' ? 'Notifications enabled ✓' : `Permission: ${r}`;
    if (r === 'granted') new Notification('Watchexchange monitor', { body: 'Alerts will show up here.' });
  });

  $('#lbclose').addEventListener('click', closeLightbox);
  $('#lbprev').addEventListener('click', () => showLbImage(lb.idx - 1));
  $('#lbnext').addEventListener('click', () => showLbImage(lb.idx + 1));
  $('#lbstar').addEventListener('click', () => lb.id && toggleStar(lb.id));
  $('#lbcopy').addEventListener('click', async (e) => {
    const p = state.posts.get(lb.id);
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p.permalink);
      e.target.textContent = 'Copied ✓';
      setTimeout(() => { e.target.textContent = 'Copy link'; }, 1600);
    } catch { e.target.textContent = 'Copy failed'; }
  });
  $('#lbthumbs').addEventListener('click', (e) => {
    const t = e.target.closest('img');
    if (t) showLbImage(Number(t.dataset.i));
  });
  $('.lb-stage').addEventListener('click', (e) => { if (e.target.classList.contains('lb-stage')) closeLightbox(); });

  $('#helpclose').addEventListener('click', () => { $('#help').hidden = true; });
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') $('#help').hidden = true; });

  addEventListener('scroll', () => {
    if (window.scrollY < 120 && state.pendingNew) {
      state.pendingNew = 0;
      $('#newpill').classList.remove('show');
    }
  }, { passive: true });

  // Grow the rendered page as the bottom comes into view.
  new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    if (state.limit >= visiblePosts().length) return;
    state.limit += PAGE;
    render([], true);
  }, { rootMargin: '600px' }).observe($('#sentinel'));

  addEventListener('keydown', onKey);
}

function jumpToNewest() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  state.pendingNew = 0;
  $('#newpill').classList.remove('show');
}

function onKey(e) {
  const typing = /input|textarea|select/i.test(document.activeElement.tagName);
  if (e.key === 'Escape') {
    if (typing) return document.activeElement.blur();
    if (!$('#help').hidden) return void ($('#help').hidden = true);
    if (!$('#lb').hidden) return closeLightbox();
    $('#panel').hidden = true; $('#scrim').hidden = true;
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === '/') { e.preventDefault(); return $('#q').focus(); }
  if (e.key === '?') { $('#help').hidden = !$('#help').hidden; return; }

  if (lb.id) {
    if (e.key === 'ArrowRight') showLbImage(lb.idx + 1);
    else if (e.key === 'ArrowLeft') showLbImage(lb.idx - 1);
    else if (e.key === 's') toggleStar(lb.id);
    else if (e.key === 'o') window.open(state.posts.get(lb.id).permalink, '_blank');
    return;
  }

  const list = visiblePosts().slice(0, state.limit);
  const i = list.findIndex((p) => p.id === state.focusId);
  const keys = {
    j: () => focusAt(list, i + 1), ArrowDown: () => focusAt(list, i + 1),
    k: () => focusAt(list, Math.max(0, i - 1)), ArrowUp: () => focusAt(list, Math.max(0, i - 1)),
    ArrowRight: () => state.focusId && flipPhoto(state.focusId, 1),
    ArrowLeft: () => state.focusId && flipPhoto(state.focusId, -1),
    m: () => state.focusId && setRead(state.focusId, !state.read.has(state.focusId)),
    s: () => state.focusId && toggleStar(state.focusId),
    u: jumpToNewest,
    o: () => {
      if (!state.focusId) return;
      window.open(state.posts.get(state.focusId).permalink, '_blank');
      setRead(state.focusId, true);
    },
    Enter: () => state.focusId && openLightbox(state.focusId),
  };
  if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
}

function focusAt(list, i) {
  const p = list[Math.min(Math.max(i, 0), list.length - 1)];
  if (!p) return;
  $$('.card.focused').forEach((c) => c.classList.remove('focused'));
  state.focusId = p.id;
  const el = $(`.card[data-id="${p.id}"]`);
  if (el) {
    el.classList.add('focused');
    el.dataset.key = cardKey(p);
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ----------------------------------------------------------------- utils
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// Refresh relative timestamps in place — a full render would discard loaded images.
setInterval(() => {
  for (const el of $$('.age')) el.textContent = ago(Number(el.dataset.created));
}, 60_000);
