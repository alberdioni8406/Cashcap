// /api/latest-block — current BCH block height, via Haskoin (established
// primary BCH data source across this project family).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=25, stale-while-revalidate=60');
  try {
    const r = await fetch('https://api.blockchain.info/haskoin-store/bch/block/best?notx=true');
    if (!r.ok) throw new Error('haskoin');
    const j = await r.json();
    res.status(200).json({ height: j.height });
  } catch (err) {
    res.status(502).json({ error: 'block_unavailable', message: err.message });
  }
}
