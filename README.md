# CashCap

A CoinGecko-style market data aggregator for **CashTokens**, the native
token layer of Bitcoin Cash. CashCap tracks every registered category —
price, TVL, volume, holders, supply, and metadata — in one fast, static,
read-only site.

## Vision

CashTokens has no single place that does for it what CoinGecko/CoinMarketCap
do for the wider crypto market: a fast overview, deep per-asset pages, and
honest data with no wallet or custody involved. CashCap is that layer —
pure frontend, zero private keys, zero wallet connection in v1.

## Stack

- HTML + CSS + vanilla JavaScript (ES modules) — no framework, no build step.
- Chart.js (CDN) for price charts.
- Hash-based client-side routing.
- Multi-level caching: in-memory → localStorage → IndexedDB for the full
  ~19k-category directory, so repeat visits feel instant.
- Vercel serverless functions under `/api` solely to work around upstream
  CORS restrictions and to proxy token icons safely (see Known limitations).

## Architecture

```
cashcap/
├── index.html          # App shell: topbar (nav, search, theme, refresh), #view mount point
├── css/
│   └── styles.css      # Single stylesheet, CSS custom properties for theming
├── js/
│   ├── app.js          # Router + all view renderers (home, markets, token detail, watchlist, compare)
│   ├── api.js          # Data layer: cached fetch wrappers around every external source
│   ├── config.js       # API paths, cache TTLs, feature constants
│   └── utils.js        # Formatting, DOM helper (el()), debounce, CSV export
├── api/                # Vercel serverless functions (Node runtime) — CORS/SSRF relief only
│   ├── tokens.js        → proxies TokenStork directory listing
│   ├── token-detail.js  → proxies TokenStork single-category detail
│   ├── bcmr.js          → proxies Paytaca BCMR metadata
│   ├── cauldron.js      → proxies Cauldron indexer (price / candles / pools)
│   ├── bch-price.js     → BCH/USD (CoinGecko, CryptoCompare fallback)
│   ├── latest-block.js  → current block height (Haskoin)
│   └── icon-proxy.js    → fetches token icons server-side, blocks private/loopback hosts
├── vercel.json
├── package.json
└── README.md
```

**Why a frontend/backend split at all, if this is "pure frontend"?** The
`/api` functions do no business logic — they exist only because TokenStork
and BCMR don't send CORS headers (so the browser can't call them directly)
and because rendering third-party icon URLs directly would let a malicious
issuer probe a visitor's LAN. Every one of them is a thin pass-through: fetch
upstream, normalize the shape, cache-control header, done. All routing,
filtering, sorting, and rendering logic lives in the browser.

**Data flow:** `app.js` (view) → `api.js` (cache check → miss → `fetch()`)
→ `/api/*.js` (CORS/SSRF relief → upstream provider) → response flows back
up and is cached at the tier `api.js` decided (memory for live prices,
localStorage for metadata, IndexedDB for the full directory) before being
handed to the view to render.

**Routing:** hash-based (`#/`, `#/markets`, `#/token/<category>`,
`#/watchlist`, `#/compare`), dispatched from a single `router()` in
`app.js` — no history API, no server-side routes needed, so it works
identically as a static file with no rewrites configured.

## Data sources & credit

| Source | Used for |
|---|---|
| [TokenStork](https://tokenstork.com) | Full category directory, supply, holders, genesis |
| [Cauldron Indexer](https://indexer.riften.net) (Riften Labs) | Live prices, candlesticks, liquidity pools, TVL |
| [Paytaca BCMR](https://bcmr.paytaca.com) | Token metadata: name, icon, description, links, NFT schema |
| CoinGecko / CryptoCompare | BCH/USD reference price |
| [Haskoin](https://api.haskoin.com) | Current block height |

None of these are affiliated with CashCap; all data is fetched live and
attributed. No data is ever fabricated — a token with no verified price or
liquidity shows an honest "—" or a low-liquidity warning, never a guess.

## Run locally

```bash
npx serve .
# or
python3 -m http.server 8080
```

Open the printed URL. The `/api/*` proxy routes only run under Vercel (or
`vercel dev`); serving the static files alone means those calls will 404,
so for full functionality use `vercel dev` locally instead:

```bash
npm i -g vercel
vercel dev
```

## Deploy to Vercel (under 2 minutes)

1. Push this folder to a GitHub repo.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo.
3. Framework preset: **Other**. No build command, no output directory
   override needed — Vercel serves `index.html` and the static assets, and
   auto-detects the `/api/*.js` files as serverless functions.
4. Deploy. That's it — no environment variables are required for v1.

## Known limitations

- TokenStork and BCMR don't send CORS headers, so all calls to them are
  proxied through `/api` rather than fetched directly from the browser.
  Cauldron's indexer already sends permissive CORS itself — its proxy exists
  only for a short edge cache and a single controlled egress point.
- **Trading volume is currently unavailable.** Cauldron's `tokens/list_cached`
  response has no confirmed USD-denominated volume field (`trade_volume`
  exists but its unit is unconfirmed — token-native? BCH? — so it's left
  unmapped rather than guessed). Volume shows as "—" everywhere rather than
  a fabricated number.
- **Price charts are unverified.** The candlestick endpoint path in
  `api/cauldron.js`'s caller (`token/<category>/candles`) has not been
  confirmed against a real response the way the directory and price-list
  endpoints have. It fails silently if wrong — the token page still loads,
  just without a chart.
- TVL is derived as `tvl_sats ÷ 1e8 × BCH/USD` from Cauldron's per-token
  `tvl_sats` field; market cap is derived as `price_now_usd × circulating
  supply` (using TokenStork's supply and Cauldron's BCMR-reported decimals).
  Neither is provided pre-computed by either source.
- Token icons are routed through `/api/icon-proxy`, which fetches
  server-side and blocks private/loopback/link-local hosts (including after
  redirects). This exists because icon URLs come from third-party issuers,
  and loading one directly in an `<img>` tag would let a malicious issuer
  make a visitor's browser probe their own LAN.
- Liquidity and TVL figures are only as good as what's routed through
  Cauldron; tokens trading exclusively on venues CashCap doesn't index will
  show as illiquid even if they trade elsewhere.
- v1 is read-only: no wallet connect, no portfolio tracking beyond the
  local (device-only) watchlist.

## Roadmap

- [ ] Wallet-connect (read-only balance import, still no signing) via WalletConnect for BCH
- [ ] Real-time price updates over WebSocket instead of polling
- [ ] Optional accounts to sync watchlist/compare across devices
- [ ] Additional DEX/liquidity venues beyond Cauldron
- [ ] NFT collection-level analytics (floor, volume, holder concentration)
- [ ] Public API for CashCap's own normalized data

## Disclaimer

CashCap aggregates public on-chain and third-party data for informational
purposes only. **Nothing on this site is financial advice.** Always verify
independently before transacting.
