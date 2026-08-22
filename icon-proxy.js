// /api/icon-proxy — fetches token icons server-side instead of loading
// issuer-supplied URLs directly in <img> tags.
//
// Why: icon URLs come from third-party token issuers (BCMR/TokenStork data).
// A malicious issuer could point an icon at a private/loopback address,
// making a visitor's own browser probe their LAN. This proxy resolves and
// blocks private/loopback/link-local hosts (including after redirects)
// before ever touching the URL from the browser.
import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_RANGES = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/, /^fc00:/, /^fe80:/,
];

function isBlockedIp(ip) {
  return BLOCKED_RANGES.some((re) => re.test(ip));
}

async function isSafeHost(hostname) {
  if (hostname === 'localhost') return false;
  if (net.isIP(hostname)) return !isBlockedIp(hostname);
  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.every((r) => !isBlockedIp(r.address));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const { u } = req.query;
  if (!u) return res.status(400).json({ error: 'missing_url' });

  let target;
  try {
    target = new URL(u);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('bad_protocol');
  } catch {
    return res.status(400).json({ error: 'invalid_url' });
  }

  const MAX_REDIRECTS = 3;
  let currentUrl = target;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (!(await isSafeHost(currentUrl.hostname))) {
      return res.status(403).json({ error: 'blocked_host' });
    }
    let upstream;
    try {
      upstream = await fetch(currentUrl, { redirect: 'manual' });
    } catch (err) {
      return res.status(502).json({ error: 'fetch_failed', message: err.message });
    }
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const loc = upstream.headers.get('location');
      if (!loc) return res.status(502).json({ error: 'bad_redirect' });
      currentUrl = new URL(loc, currentUrl);
      continue;
    }
    if (!upstream.ok) return res.status(502).json({ error: 'upstream_error', status: upstream.status });

    const contentType = upstream.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) return res.status(415).json({ error: 'not_an_image' });

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(buf);
  }
  return res.status(508).json({ error: 'too_many_redirects' });
}
