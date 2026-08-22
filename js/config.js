// CashCap — configuration constants
// Central place for API bases, cache TTLs, and feature flags.

export const CONFIG = {
  // All third-party calls that need CORS relief go through our own
  // Vercel serverless functions under /api (see /api/*.js).
  API: {
    TOKENS: '/api/tokens',            // TokenStork directory (list + pagination)
    TOKEN_DETAIL: '/api/token-detail',// TokenStork single-category detail
    BCMR: '/api/bcmr',                // Paytaca BCMR metadata
    CAULDRON: '/api/cauldron',        // Cauldron indexer proxy (price/candles/pools)
    BCH_PRICE: '/api/bch-price',      // BCH/USD spot price
    LATEST_BLOCK: '/api/latest-block',
    ICON: '/api/icon-proxy',          // Safe icon fetch (blocks private/loopback hosts)
  },

  // Cache time-to-live, in milliseconds.
  TTL: {
    PRICE: 45 * 1000,          // 45s — live prices
    CANDLES: 60 * 1000,        // 1 min
    METADATA: 60 * 60 * 1000,  // 1 hour — BCMR rarely changes
    DIRECTORY: 10 * 60 * 1000, // 10 min — full token list
    BLOCK_HEIGHT: 30 * 1000,
  },

  // Pagination / list defaults
  PAGE_SIZE: 50,
  SPARKLINE_POINTS: 24,

  // IPFS gateways tried in order for token icons before falling back to placeholder.
  IPFS_GATEWAYS: [
    'https://ipfs.io/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://dweb.link/ipfs/',
  ],

  // Liquidity floor (USD) used to decide what counts as a "listed" / active token
  // in dashboard aggregates, so a handful of dust pools don't skew rankings.
  MIN_LIQUIDITY_USD: 25,

  DISCLAIMER: 'CashCap aggregates public on-chain and third-party data for information only. Nothing here is financial advice. Verify independently before transacting.',
};
