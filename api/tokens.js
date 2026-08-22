// /api/tokens — proxies the TokenStork category directory.
// TokenStork does not send CORS headers, so the browser can't call it
// directly; this function fetches server-side and re-serves the result.
//
// NOTE: TokenStork's public API surface has moved before. If this 404s,
// check https://tokenstork.com for the current documented base path and
// update TOKENSTORK_BASE below — the rest of the app only depends on the
// { items: [...], total } shape returned here, not on TokenStork's own shape.
const TOKENSTORK_BASE = 'https://tokenstork.com/api/tokens';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { page = '1', pageSize = '50' } = req.query;

  try {
    const upstream = await fetch(`${TOKENSTORK_BASE}?page=${page}&limit=${pageSize}`, {
      headers: { accept: 'application/json' },
    });
    if (!upstream.ok) throw new Error(`TokenStork ${upstream.status}`);
    const raw = await upstream.json();

    // Normalize into the shape the frontend expects. Field names here are
    // best-effort against TokenStork's documented response — adjust the
    // mapping if their schema differs.
    const items = (raw.tokens || raw.items || raw.data || []).map(normalize);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ items, total: raw.total ?? items.length, page: Number(page) });
  } catch (err) {
    res.status(502).json({ error: 'tokenstork_unreachable', message: err.message, items: [], total: 0 });
  }
}

function normalize(t) {
  return {
    category: t.category || t.categoryId || t.id,
    symbol: t.symbol || t.ticker,
    name: t.name,
    type: t.nftCapability ? (t.amount > 0 ? 'Hybrid' : 'NFT') : 'FT',
    holders: t.holderCount ?? t.holders ?? null,
    priceUsd: t.priceUsd ?? null,
    change24h: t.change24h ?? null,
    marketCapUsd: t.marketCapUsd ?? null,
    tvlUsd: t.tvlUsd ?? 0,
    volume24hUsd: t.volume24hUsd ?? 0,
    genesisTime: t.genesisTime ? Date.parse(t.genesisTime) : null,
    bcmr: t.bcmr || null,
  };
}
