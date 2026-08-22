// /api/token-detail — single-category detail from TokenStork (supply, holders, genesis, TVL).
const TOKENSTORK_BASE = 'https://tokenstork.com/api/tokens';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { category } = req.query;
  if (!category) return res.status(400).json({ error: 'missing_category' });

  try {
    const upstream = await fetch(`${TOKENSTORK_BASE}/${encodeURIComponent(category)}`, {
      headers: { accept: 'application/json' },
    });
    if (!upstream.ok) throw new Error(`TokenStork ${upstream.status}`);
    const t = await upstream.json();

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.status(200).json({
      category,
      symbol: t.symbol,
      name: t.name,
      circulatingSupply: t.circulatingSupply ?? t.supply ?? null,
      totalSupply: t.totalSupply ?? null,
      burnedSupply: t.burnedSupply ?? null,
      holders: t.holderCount ?? t.holders ?? null,
      marketCapUsd: t.marketCapUsd ?? null,
      tvlUsd: t.tvlUsd ?? 0,
      volume24hUsd: t.volume24hUsd ?? 0,
      genesisTx: t.genesisTx || t.genesisTransaction || null,
      genesisTime: t.genesisTime ? Date.parse(t.genesisTime) : null,
    });
  } catch (err) {
    res.status(502).json({ error: 'tokenstork_unreachable', message: err.message });
  }
}
