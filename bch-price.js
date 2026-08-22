// /api/bch-price — BCH/USD spot price. CoinGecko primary (free, keyless),
// CryptoCompare as fallback if CoinGecko rate-limits.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=90');

  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd');
    if (!r.ok) throw new Error('coingecko');
    const j = await r.json();
    return res.status(200).json({ usd: j['bitcoin-cash'].usd, source: 'coingecko' });
  } catch {
    try {
      const r2 = await fetch('https://min-api.cryptocompare.com/data/price?fsym=BCH&tsyms=USD');
      const j2 = await r2.json();
      return res.status(200).json({ usd: j2.USD, source: 'cryptocompare' });
    } catch (err) {
      return res.status(502).json({ error: 'price_unavailable', message: err.message });
    }
  }
}
