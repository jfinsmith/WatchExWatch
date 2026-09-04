# Watchexchange Live

A local web app that watches r/Watchexchange `/new` and streams posts into a browser as they
appear — primary image with arrow-key shuffling through the rest, detected asking price, read /
unread tracking, starring, and brand + keyword alerts with a desktop notification and a chime.

## Why it needs a server

Reddit returns **403** on `www.reddit.com/*.json` for non-browser clients, allows only about one
request per minute per IP on the public feeds, and browsers can't call it cross-origin anyway. So a
small Node process does the polling, rations requests against that budget, and pushes new posts to
the page over Server-Sent Events. It also proxies Reddit's image hosts, which reject hot-linking.

## Setup

```bash
npm start
```

Then open <http://localhost:5173>. No dependencies, no build step, no credentials — Node 18+ only.

### About Reddit API credentials

You do **not** need them, and as of 2026 most people can't get them. Reddit's Responsible Builder
Policy gated self-serve app creation: hitting "create app" on `/prefs/apps` now just shows a link
to the policy. Access is by request and approval, which skews toward commercial use cases and is
frequently declined for personal projects.

So this app runs on Reddit's public Atom feeds by default. If you ever *are* approved, drop the
credentials in and it upgrades itself automatically:

```bash
cp .env.example .env
```

| | public feed (default) | approved API |
|---|---|---|
| listing latency | ~65s, or ~130s while chasing prices | 30s |
| request budget | ~1/min per IP, enforced by Reddit | 100/min |
| images | full resolution, one per post | full resolution, whole galleries |
| price-range flair | not exposed in the feed | yes |
| price comments | ~1 post checked per 2 min | 8 per cycle |

**Run one instance at a time.** The public-feed budget is per IP, so a second copy on the same
network makes both of them collect 429s.

## Using it

| | |
|---|---|
| `/` | focus search |
| `j` / `k` | move between posts |
| `←` / `→` | flip through a post's photos |
| `Enter` | open the focused post |
| `m` | toggle read |
| `s` | save / unsave |
| `o` | open on Reddit |
| `u` | jump to newest |
| `?` | shortcut list |
| `Esc` | close whatever's open |

- **Read state** lives on the server (`data/state.json`), so it survives refreshes and is shared
  between browsers/devices pointed at the same instance. Opening a post marks it read.
- **Prices** come from four places, in order of confidence:
  1. the **title** — `$3,400`, `3400 USD`, `asking 3.4k`, `Price: 3400`
  2. the **post body**
  3. the **seller's own comment**. The subreddit requires sale details in a top-level comment, so
     a post often appears with no price and gains one minutes later. That comment is also kept and
     shown in the detail view (the public feed carries no post body) and folded into search. Any post under
     `COMMENT_WATCH_HOURS` old with no price is re-checked — every 45s for its first 10 minutes,
     then every 5 minutes for an hour, then every 15 minutes. Only comments written by the post's
     author count; a buyer quoting their own number doesn't. When one lands, the card updates live
     and the badge reads `from comment`. (**API mode only** — the public comment feeds are
     On the public feed this costs a whole request slot, so the scheduler alternates: the listing
     when it's due, one price-comment check otherwise.)
  4. the **flair bracket** — WTS posts require a price-range flair (`$1000-$2500`, `Under $500`,
     `$10k+`), which is there from the moment the post appears (API mode only; the public feed
     doesn't expose flair). It shows as a dim range badge
     until an exact price is found, and it counts for the min/max filters and for alerts, so a
     `$10k+` post won't slip past a `max $4000` filter while its price is still missing.

  Model and reference numbers (`3861`, `ref 16610`, `310.30.42`) are excluded. Body-sourced prices
  render dimmer; a post with several numbers shows `+n more`, with the full list in the detail view.
- **Images** come through at full resolution. Reddit's `preview.redd.it` URLs are signed against
  their width, so a 140px gallery crop can't simply be requested larger — but the media id in the
  path is the same one `i.redd.it` serves the unsigned original under, so the app rewrites
  `preview.redd.it/abc123.jpg?width=140&…` to `i.redd.it/abc123.jpg`. That's what the lightbox
  shows. Since i.redd.it ignores resize parameters and hands back the full 3000px original, the
  proxy scales a 640px copy for grid cards with `sips` and caches both on disk under
  `data/imgcache/` — later loads are instant. Without `sips` (non-macOS) it serves originals
  instead. Gallery posts paint their 140px crop immediately and sharpen when the scaled copy is
  ready. Posts archived before this existed get their URLs lifted on load.

  The one exception is a post linking off-site (imgur and the like): Reddit only ever exposes its
  own 640px preview of those, so that's what you get.

- **Alerts** (⚙︎ Alerts) match on brands, free-text keywords (good for references like `5513`),
  a max price, and optionally WTS-only. Matches chime, raise a desktop notification, and collect
  in the Alerts tab. Alerts only fire for posts that arrive while the app is open — the backlog
  loaded at startup is never alerted on. A post that arrives priceless and only qualifies once the
  seller comments a price alerts at that moment, not before.
- **Search** matches every whitespace-separated term (AND), across the title, brands, seller,
  flair, the detected price, and — crucially — the seller's comment. So `omega speedmaster 3861`
  narrows instead of needing that exact phrase, and reference numbers like `116610` or `3506.31`
  find their post even when they only appear in the comment.
- **Filters** — type, price range, has-price, hide-sold, sort (newest / price up / price down).
  Clicking a brand chip or a seller name filters to it; active filters show as removable chips in
  the toolbar. Everything persists in localStorage.
- **Sold posts** are hidden by default and retire live: when a listing's flair flips to Sold, its
  title changes, or the seller comments that it's gone, the card fades out (or shows a SOLD ribbon
  and greys out if you've unchecked *Hide sold*). Detection is deliberately tight, so "never sold
  by a dealer" in a description won't retire a live post.
- **Light and dark themes**, following the system by default, with a toggle in the toolbar.
- Cards render in pages of 60 and grow as you scroll, so a 1,500-post archive stays responsive.

## Config

Environment variables (in `.env`):

| var | default | |
|---|---|---|
| `SUBREDDITS` | `Watchexchange` | comma-separated; e.g. `Watchexchange,Watchexchange_bst` |
| `POLL_SECONDS` | `30` | API mode only; minimum 10 |
| `RSS_GAP_SECONDS` | `65` | public-feed mode: minimum spacing between any two requests |
| `RSS_LISTING_SECONDS` | `130` | public-feed mode: how stale the listing may get while chasing price comments |
| `PORT` | `5173` | |
| `MAX_POSTS` | `1500` | rolling cap on the on-disk archive |
| `DATA_DIR` | `./data` | where posts, read state, and the image cache live |
| `IMG_CACHE_MAX` | `4000` | cached image files kept before the oldest are pruned |
| `RESIZE_CONCURRENCY` | `3` | parallel `sips` resizes; keeps a cold grid from spawning dozens |
| `COMMENT_WATCH_HOURS` | `6` | how long to keep checking a priceless post's comments |
| `COMMENT_CHECKS_PER_CYCLE` | `8` | comment fetches per poll; 1 poll + 8 checks per 30s is well inside Reddit's 100/min |

## Layout

```
server.js        scheduler, SSE, resizing image proxy, static files, read/saved state
lib/reddit.js    OAuth + /new fetch, rate-limit pacing, Atom parsers
lib/parse.js     tags, price extraction, brand detection, flair brackets, image URLs
public/          the UI — no framework, no build step
test/            node:test suites for the parsing and rate-limit logic
data/            posts.json, state.json, imgcache/ (gitignored)
```

## Tests

```bash
npm test
```

Covers price extraction (including the reference-number false positives), flair brackets, brand
and tag detection, the Atom parsers, image-URL selection, and the rate-limit pacing — the parts
where reddit's data is messy enough to regress quietly.
