// /api/tokens — proxies the TokenStork category directory.
// TokenStork does not send CORS headers, so the browser can't call it
// directly; this function fetches server-side and re-serves the result.
//
// Field mapping below is verified against a real TokenStork response
// (2026-08-22), shape: { tokens: [...], count, limit, offset, total }.
// IMPORTANT: this endpoint carries NO price/TVL/volume/market-cap data —
// TokenStork's directory is identity + supply + holders only. Those market
// figures have to come from a Cauldron merge step (not yet wired in — see
// cauldron.js, which is still pointed at an unverified base URL).
const TOKENSTORK_BASE = 'https://tokenstork.com/api/tokens';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { page = '1', pageSize = '50' } = req.query;
  const limit = Number(pageSize);
  const offset = (Number(page) - 1) * limit;

  try {
    const upstream = await fetch(`${TOKENSTORK_BASE}?limit=${limit}&offset=${offset}`, {
      headers: { accept: 'application/json' },
    });
    if (!upstream.ok) throw new Error(`TokenStork ${upstream.status}`);
    const raw = await upstream.json();

    const items = (raw.tokens || []).map(normalize);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ items, total: raw.total ?? items.length, page: Number(page) });
  } catch (err) {
    res.status(502).json({ error: 'tokenstork_unreachable', message: err.message, items: [], total: 0 });
  }
}

// TokenStork returns "=" as a literal placeholder for unnamed/undecoded
// tokens (no BCMR name registered) rather than omitting the field.
function cleanLabel(v) {
  return v && v !== '=' ? v : null;
}

function mapType(tokenType) {
  if (tokenType === 'FT+NFT') return 'Hybrid';
  if (tokenType === 'NFT') return 'NFT';
  return 'FT';
}

function normalize(t) {
  return {
    category: t.id,
    symbol: cleanLabel(t.symbol),
    name: cleanLabel(t.name),
    type: mapType(t.tokenType),
    holders: t.holderCount ?? null,
    circulatingSupply: t.currentSupply ?? null,
    isVerified: !!t.isVerifiedOnchain,
    hasActiveMinting: !!t.hasActiveMinting,
    // Not present at this endpoint — populated later by a Cauldron merge.
    priceUsd: null,
    change24h: null,
    marketCapUsd: null,
    tvlUsd: 0,
    volume24hUsd: 0,
    // TokenStork timestamps are Unix seconds, not ISO strings.
    genesisTime: t.genesisTime ? t.genesisTime * 1000 : null,
    firstSeenAt: t.firstSeenAt ? t.firstSeenAt * 1000 : null,
    genesisBlock: t.genesisBlock ?? null,
    // Icon field shape is unconfirmed (every sampled row had icon: null so
    // far) — if it turns out to be a bare IPFS CID rather than a full URL,
    // iconUrl() in api.js will need a gateway prefix added here.
    icon: t.icon || null,
    bcmr: null,
  };
}
