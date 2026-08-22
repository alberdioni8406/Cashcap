// /api/cauldron — thin pass-through proxy in front of the official Riften
// Labs Cauldron indexer (https://docs.riftenlabs.com/cauldron/API/cauldron/).
//
// This mirrors the proven-working proxy from the [[cauldron-radar]] project
// (github.com/alberdioni8406/Cauldron-Radar/blob/main/api/cauldron.js) rather
// than guessing a shape — the indexer already sends permissive CORS itself
// (it's called client-side by app.cauldron.quest), so this proxy exists for
// a short edge cache and a single controlled egress point, not CORS relief.
//
// Usage from the frontend: /api/cauldron?path=tokens/list_cached&limit=100&by=tvl&order=desc
// `path` is anything documented at the Riften Labs API docs above
// (e.g. "tokens/list_cached", "price/<category>/current", "pool/active").
// Every other query param is forwarded through unchanged.
const UPSTREAM_BASE = 'https://indexer.riften.net/cauldron/';

const ALLOWED_PREFIXES = [
  'contract/', 'pool/', 'price/', 'token/', 'tokens/', 'tx/', 'user/', 'valuelocked', 'volume',
];

function isAllowed(path) {
  return ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(p));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Only GET is supported.' }); return; }

  const { path, ...rest } = req.query;
  if (!path || Array.isArray(path)) {
    res.status(400).json({ error: 'Missing required "path" query parameter.' });
    return;
  }
  const cleanPath = path.replace(/^\/+/, '');
  if (!isAllowed(cleanPath)) { res.status(400).json({ error: 'Path not allowed.' }); return; }

  const upstreamUrl = new URL(cleanPath, UPSTREAM_BASE);
  for (const [key, value] of Object.entries(rest)) {
    if (Array.isArray(value)) value.forEach((v) => upstreamUrl.searchParams.append(key, v));
    else if (value !== undefined) upstreamUrl.searchParams.set(key, value);
  }

  try {
    const upstreamRes = await fetch(upstreamUrl.toString(), { headers: { Accept: 'application/json' } });
    const bodyText = await upstreamRes.text();
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=45');
    res.status(upstreamRes.status);
    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/json');
    res.send(bodyText);
  } catch (err) {
    res.status(502).json({ error: 'Upstream indexer request failed.', detail: String(err) });
  }
}
