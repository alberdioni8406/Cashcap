// api/cauldron.js
//
// Thin serverless proxy in front of the official Riften Labs Cauldron indexer
// (https://docs.riftenlabs.com/cauldron/API/cauldron/). The indexer already
// serves permissive CORS headers (it's called client-side by the official
// Cauldron DEX at app.cauldron.quest), so this proxy isn't strictly required
// for the app to function — but it protects the app if that ever changes,
// lets us set a short edge cache (the data changes at most every few
// seconds), and keeps every outbound request going through one place we
// control instead of scattering the upstream hostname across the frontend.
//
// Usage from the frontend:
//   /api/cauldron?path=tokens/list_cached&limit=100&by=tvl&order=desc
//
// `path` is anything documented at https://docs.riftenlabs.com/cauldron/API/cauldron/
// (e.g. "tokens/list_cached", "price/<token>/current", "pool/active").
// Every other query param is forwarded through unchanged.

const UPSTREAM_BASE = 'https://indexer.riften.net/cauldron/';

// Allow-list of path prefixes we're willing to proxy. This is a public,
// read-only, keyless API, but we still don't want this function turned into
// an open proxy for arbitrary URLs.
const ALLOWED_PREFIXES = [
  'contract/',
  'pool/',
  'price/',
  'token/',
  'tokens/',
  'tx/',
  'user/',
  'valuelocked',
  'volume',
];

function isAllowed(path) {
  return ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(p));
}

module.exports = async (req, res) => {
  // CORS: allow this to be called from any origin the app is deployed to.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Only GET is supported.' });
    return;
  }

  const { path, ...rest } = req.query;

  if (!path || Array.isArray(path)) {
    res.status(400).json({ error: 'Missing required "path" query parameter.' });
    return;
  }

  const cleanPath = path.replace(/^\/+/, '');

  if (!isAllowed(cleanPath)) {
    res.status(400).json({ error: 'Path not allowed.' });
    return;
  }

  const upstreamUrl = new URL(cleanPath, UPSTREAM_BASE);
  for (const [key, value] of Object.entries(rest)) {
    if (Array.isArray(value)) {
      value.forEach((v) => upstreamUrl.searchParams.append(key, v));
    } else if (value !== undefined) {
      upstreamUrl.searchParams.set(key, value);
    }
  }

  try {
    const upstreamRes = await fetch(upstreamUrl.toString(), {
      headers: { Accept: 'application/json' },
    });

    const bodyText = await upstreamRes.text();

    // Cache at the edge for a few seconds — the indexer updates roughly
    // block-to-block, so this keeps the dashboard fast without serving
    // meaningfully stale data.
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=45');
    res.status(upstreamRes.status);
    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/json');
    res.send(bodyText);
  } catch (err) {
    res.status(502).json({ error: 'Upstream indexer request failed.', detail: String(err) });
  }
};
