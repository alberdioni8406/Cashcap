// /api/bcmr — proxies Paytaca's BCMR (Bitcoin Cash Metadata Registry) API for
// clean, issuer-published token metadata: name, symbol, icon, description,
// links, NFT schema.
const BCMR_BASE = 'https://bcmr.paytaca.com/api/tokens';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { category } = req.query;
  if (!category) return res.status(400).json({ error: 'missing_category' });

  try {
    const upstream = await fetch(`${BCMR_BASE}/${encodeURIComponent(category)}/`, {
      headers: { accept: 'application/json' },
    });
    if (!upstream.ok) throw new Error(`BCMR ${upstream.status}`);
    const b = await upstream.json();

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.status(200).json({
      name: b.name,
      description: b.description,
      uris: b.uris || {},
      types: b.types || null,
      nftSchema: b.nfts?.parse?.types || null,
    });
  } catch (err) {
    res.status(404).json({ error: 'no_bcmr_metadata', message: err.message });
  }
}
