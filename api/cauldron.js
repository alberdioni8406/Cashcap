// /api/cauldron — proxies the Riften Labs Cauldron indexer for live prices,
// candlesticks, and active liquidity pools.
//
// Base verified against the CashCompass/BCH Lab family's existing Cauldron
// Radar build (indexer.riften.net/cauldron). If Riften moves the indexer,
// update CAULDRON_BASE — everything downstream depends only on this file's
// normalized response, not on Cauldron's raw shape.
const CAULDRON_BASE = 'https://indexer.riften.net/cauldron';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { type, category, tf = '24h' } = req.query;

  try {
    if (type === 'price') {
      if (!category) return res.status(400).json({ error: 'missing_category' });
      const upstream = await fetch(`${CAULDRON_BASE}/price/${encodeURIComponent(category)}`);
      if (!upstream.ok) throw new Error(`Cauldron ${upstream.status}`);
      const p = await upstream.json();
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json({
        priceUsd: p.priceUsd ?? p.price_usd ?? null,
        priceBch: p.priceBch ?? p.price_bch ?? null,
        change24h: p.change24h ?? null,
        liquidityUsd: p.liquidityUsd ?? p.tvlUsd ?? 0,
      });
    }

    if (type === 'candles') {
      if (!category) return res.status(400).json({ error: 'missing_category' });
      const upstream = await fetch(`${CAULDRON_BASE}/candles/${encodeURIComponent(category)}?tf=${tf}`);
      if (!upstream.ok) throw new Error(`Cauldron ${upstream.status}`);
      const c = await upstream.json();
      const candles = (c.candles || c.data || []).map((row) => ({
        t: row.t ?? row.time ?? row.timestamp,
        open: row.open, high: row.high, low: row.low, close: row.close,
      }));
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
      return res.status(200).json(candles);
    }

    if (type === 'pools') {
      const upstream = await fetch(`${CAULDRON_BASE}/pools/active`);
      if (!upstream.ok) throw new Error(`Cauldron ${upstream.status}`);
      const p = await upstream.json();
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json(p.pools || p.data || []);
    }

    return res.status(400).json({ error: 'unknown_type' });
  } catch (err) {
    res.status(502).json({ error: 'cauldron_unreachable', message: err.message });
  }
}
