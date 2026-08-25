# Watchexchange Live

A local web app that watches r/Watchexchange `/new` and streams posts into a browser as they
appear — primary image with arrow-key shuffling through the rest, detected asking price, read /
unread tracking, starring, and brand + keyword alerts with a desktop notification and a chime.

## Why it needs a server

Reddit now returns **403** on `www.reddit.com/*.json` for non-browser clients and rate-limits the
`.rss` feed hard, and browsers can't call Reddit cross-origin anyway. So a small Node process holds
an OAuth token, polls on your behalf, and pushes new posts to the page over Server-Sent Events.
It also proxies Reddit's image hosts, which reject hot-linking.

## Setup

1. Create a Reddit app at <https://www.reddit.com/prefs/apps> → **create another app…** →
   type **script** → redirect uri `http://localhost:5173`.
2. Copy the credentials:

   ```bash
   cp .env.example .env
   ```

   Put the client id (the short string under the app's name) in `REDDIT_CLIENT_ID`, the secret in
   `REDDIT_CLIENT_SECRET`, and your reddit username in `REDDIT_USERNAME` (it goes in the
   User-Agent, which Reddit asks for).
3. Run it:

   ```bash
   npm start
   ```

   Then open <http://localhost:5173>.

No dependencies, no build step — Node 18+ only.

Without credentials it falls back to the public Atom feed. It still works — that's what the
screenshot-worthy first run uses — but you get one low-resolution (140px) thumbnail per post
instead of the full gallery, no flair, and Reddit rate-limits it aggressively (the poll interval
drops to 120s automatically and backs off further on 429s).

## Using it

| | |
|---|---|
| `/` | focus search |
| `j` / `k` | move between posts |
| `←` / `→` | shuffle images of the focused post |
| `Enter` | open the post detail / full-size image |
| `m` | toggle read | 
| `s` | star |
| `o` | open on Reddit |
| `Esc` | close |

- **Read state** lives on the server (`data/state.json`), so it survives refreshes and is shared
  between browsers/devices pointed at the same instance. Opening a post marks it read.
- **Prices** come from four places, in order of confidence:
  1. the **title** — `$3,400`, `3400 USD`, `asking 3.4k`, `Price: 3400`
  2. the **post body**
  3. the **seller's own comment**. The subreddit requires sale details in a top-level comment, so
     a post often appears with no price and gains one minutes later. Any post under
     `COMMENT_WATCH_HOURS` old with no price is re-checked — every 45s for its first 10 minutes,
     then every 5 minutes for an hour, then every 15 minutes. Only comments written by the post's
     author count; a buyer quoting their own number doesn't. When one lands, the card updates live
     and the badge reads `from comment`. (**API mode only** — the public comment feeds are
     rate-limited far too hard to poll per post.)
  4. the **flair bracket** — WTS posts require a price-range flair (`$1000-$2500`, `Under $500`,
     `$10k+`), which is there from the moment the post appears. It shows as a dim range badge
     until an exact price is found, and it counts for the min/max filters and for alerts, so a
     `$10k+` post won't slip past a `max $4000` filter while its price is still missing.

  Model and reference numbers (`3861`, `ref 16610`, `310.30.42`) are excluded. Body-sourced prices
  render dimmer; a post with several numbers shows `+n more`, with the full list in the detail view.
- **Alerts** (⚙︎ Alerts) match on brands, free-text keywords (good for references like `5513`),
  a max price, and optionally WTS-only. Matches chime, raise a desktop notification, and collect
  in the Alerts tab. Alerts only fire for posts that arrive while the app is open — the backlog
  loaded at startup is never alerted on. A post that arrives priceless and only qualifies once the
  seller comments a price alerts at that moment, not before.
- **Filters** (type, price range, has-price, hide-sold, search) persist in localStorage.

## Config

Environment variables (in `.env`):

| var | default | |
|---|---|---|
| `SUBREDDITS` | `Watchexchange` | comma-separated; e.g. `Watchexchange,Watchexchange_bst` |
| `POLL_SECONDS` | `30` | minimum 10; Reddit's free tier allows 100 requests/min |
| `PORT` | `5173` | |
| `MAX_POSTS` | `1500` | rolling cap on the on-disk archive |
| `COMMENT_WATCH_HOURS` | `6` | how long to keep checking a priceless post's comments |
| `COMMENT_CHECKS_PER_CYCLE` | `8` | comment fetches per poll; 1 poll + 8 checks per 30s is well inside Reddit's 100/min |

## Layout

```
server.js        polling loop, SSE, image proxy, static files, read/star state
lib/reddit.js    OAuth token + /new fetch, Atom fallback parser
lib/parse.js     tags, price extraction, brand detection, gallery/preview images
public/          the UI (no framework)
data/            posts.json + state.json (gitignored)
```
