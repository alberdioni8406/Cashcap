// CashCap — app entry, router, and view renderers.

import { CONFIG } from './config.js';
import * as api from './api.js';
import {
  fmtUsd, fmtCompact, fmtPct, pctClass, el, debounce, csvFromRows, downloadFile, shortId, copyToClipboard,
} from './utils.js';

const view = document.getElementById('view');
const searchInput = document.getElementById('global-search');
const themeToggle = document.getElementById('theme-toggle');
const refreshBtn = document.getElementById('refresh-btn');

// ---- State ------------------------------------------------------------------
const state = {
  directory: [],       // flattened cache of loaded pages
  page: 1,
  sortKey: 'tvlUsd',
  sortDir: 'desc',
  filter: { type: 'all', hasLiquidity: true, hasBcmr: false, query: '' },
  watchlist: new Set(JSON.parse(localStorage.getItem('cashcap:watchlist') || '[]')),
  compare: new Set(),
};

function saveWatchlist() {
  localStorage.setItem('cashcap:watchlist', JSON.stringify([...state.watchlist]));
}

// ---- Router -------------------------------------------------------------------
const routes = {
  '#/': renderHome,
  '#/markets': renderMarkets,
  '#/watchlist': renderWatchlist,
  '#/compare': renderCompare,
};

function router() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/token/')) {
    const category = decodeURIComponent(hash.replace('#/token/', ''));
    return renderTokenDetail(category);
  }
  const fn = routes[hash] || renderHome;
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === hash));
  return fn();
}

window.addEventListener('hashchange', router);

// ---- Loading / error / empty state helpers -----------------------------------
function skeleton(rows = 6) {
  const wrap = el('div', { class: 'skeleton-list' });
  for (let i = 0; i < rows; i++) wrap.appendChild(el('div', { class: 'skeleton-row' }));
  return wrap;
}

function errorState(message, retryFn) {
  const box = el('div', { class: 'state-box error' }, [
    el('p', {}, `Couldn't load this data. ${message}`),
    el('button', { class: 'btn', onclick: retryFn }, 'Retry'),
  ]);
  return box;
}

function emptyState(message) {
  return el('div', { class: 'state-box empty' }, [el('p', {}, message)]);
}

// ---- Icon element with IPFS/gateway fallback ---------------------------------
// bcmr.uris.icon is used on the token detail page (per-token BCMR fetch);
// directory rows use TokenStork's own `icon` field directly (rawIcon) since
// fetching BCMR for every row in a table would be far too many requests.
function iconImg(bcmrOrRawIcon, size = 28) {
  const img = el('img', {
    class: 'token-icon', width: String(size), height: String(size), alt: '', loading: 'lazy',
  });
  const raw = typeof bcmrOrRawIcon === 'string' ? bcmrOrRawIcon : bcmrOrRawIcon?.uris?.icon;
  const src = raw ? api.iconUrl(raw) : null;
  img.src = src || placeholderIcon();
  img.onerror = () => { img.src = placeholderIcon(); img.onerror = null; };
  return img;
}

function placeholderIcon() {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="6" fill="#123b32"/><text x="14" y="19" font-size="14" text-anchor="middle" fill="#0ac18e" font-family="sans-serif">?</text></svg>',
  );
}

// ---- Cauldron merge ------------------------------------------------------------
// TokenStork's directory carries identity + supply only (no price/TVL/volume
// — see api/tokens.js). This merges Cauldron's bulk cached list onto it by
// category. Field mapping below is verified against a real
// tokens/list_cached response (2026-08-23):
//   token_id            → category (join key)
//   display_name/symbol → fallback name/symbol when TokenStork has none
//   price_now_usd       → current USD price
//   change_24h_usd_bp / change_7d_usd_bp → basis points (÷100 for %)
//   tvl_sats            → TVL in BCH satoshis (÷1e8 × BCH/USD for USD TVL)
//   bcmr.uris.icon      → usually an ipfs:// URI, richer than TokenStork's
//                         own (frequently null) icon field
//   price_series_7d     → sparkline points
// NOT present: any USD trading-volume figure. `trade_volume`'s denomination
// is unconfirmed (BCH? token units?), so volume is left as null (honest
// "unavailable") rather than guessed — see README known limitations.
function toArray(x) {
  if (Array.isArray(x)) return x;
  return x?.tokens || x?.items || x?.data || [];
}

function mergeCauldronData(tokens, cauldronRaw, bchUsd) {
  const map = new Map();
  for (const c of toArray(cauldronRaw)) {
    const cat = c.token_id || c?.bcmr?.token?.category;
    if (cat) map.set(cat, c);
  }
  return tokens.map((t) => {
    const c = map.get(t.category);
    if (!c) return t;
    const decimals = c.bcmr?.token?.decimals ?? null;
    const supply = t.circulatingSupply != null && decimals != null
      ? Number(t.circulatingSupply) / 10 ** decimals
      : null;
    const priceUsd = c.price_now_usd ?? null;
    return {
      ...t,
      symbol: t.symbol || c.display_symbol || null,
      name: t.name || c.display_name || null,
      priceUsd,
      change24h: c.change_24h_usd_bp != null ? c.change_24h_usd_bp / 100 : null,
      change7d: c.change_7d_usd_bp != null ? c.change_7d_usd_bp / 100 : null,
      tvlUsd: bchUsd && c.tvl_sats != null ? (c.tvl_sats / 1e8) * bchUsd : null,
      volume24hUsd: null, // unavailable — see comment above
      marketCapUsd: priceUsd != null && supply != null ? priceUsd * supply : null,
      cauldronIcon: c.bcmr?.uris?.icon || null,
      sparkline: c.price_series_7d || null,
    };
  });
}

// ---- Aggregate helper: sum a numeric field, treating "no data anywhere" as
// null (shows "—") rather than a misleading $0. ------------------------------
function sumUsd(tokens, key) {
  const vals = tokens.map((t) => t[key]).filter((v) => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0);
}

// ---- Home dashboard -----------------------------------------------------------
async function renderHome() {
  view.innerHTML = '';
  const grid = el('div', { class: 'stat-grid' });
  view.appendChild(el('h1', { class: 'page-title' }, 'Ecosystem overview'));
  view.appendChild(grid);
  grid.appendChild(skeleton(1));

  try {
    const [dir, bch, block, cauldronList] = await Promise.all([
      api.fetchTokenDirectory(1, 500),
      api.fetchBchPrice().catch(() => null),
      api.fetchLatestBlock().catch(() => null),
      api.fetchCauldronTokenList({ limit: 500 }).catch(() => []),
    ]);
    const tokens = mergeCauldronData(dir?.items || [], cauldronList, bch?.usd);
    const listed = tokens.filter((t) => (t.tvlUsd || 0) >= CONFIG.MIN_LIQUIDITY_USD);
    const tvl = sumUsd(listed, 'tvlUsd');
    const vol24 = sumUsd(listed, 'volume24hUsd');
    const new24 = tokens.filter((t) => Date.now() - (t.genesisTime || 0) < 86400000).length;

    grid.innerHTML = '';
    grid.append(
      statCard('Categories tracked', fmtCompact(dir?.total ?? tokens.length)),
      statCard('Listed (with liquidity)', fmtCompact(listed.length)),
      statCard('Total TVL', fmtUsd(tvl, { compact: true })),
      statCard('24h volume', fmtUsd(vol24, { compact: true })),
      statCard('New tokens (24h)', fmtCompact(new24)),
      statCard('Block height', block ? fmtCompact(block.height) : '—'),
      statCard('BCH / USD', bch ? fmtUsd(bch.usd) : '—'),
    );

    view.appendChild(section('Top movers (24h)', moversTable(listed)));
    view.appendChild(section('Top by TVL', rankTable(listed, 'tvlUsd', 8)));
    view.appendChild(section('Recently minted', recentTable(tokens, 8)));
  } catch (err) {
    grid.innerHTML = '';
    grid.appendChild(errorState('Directory source may be unreachable.', renderHome));
  }
}

function statCard(label, value) {
  return el('div', { class: 'stat-card' }, [
    el('div', { class: 'stat-value' }, value),
    el('div', { class: 'stat-label' }, label),
  ]);
}

function section(title, content) {
  return el('section', { class: 'section' }, [el('h2', {}, title), content]);
}

function moversTable(tokens) {
  const sorted = [...tokens].sort((a, b) => (b.change24h || 0) - (a.change24h || 0));
  const gainers = sorted.slice(0, 5);
  const losers = sorted.slice(-5).reverse();
  if (!tokens.length) return emptyState('No liquid tokens found yet.');
  const wrap = el('div', { class: 'movers-cols' });
  wrap.append(moversCol('Gainers', gainers), moversCol('Losers', losers));
  return wrap;
}

function moversCol(title, list) {
  const col = el('div', { class: 'movers-col' }, [el('h3', {}, title)]);
  list.forEach((t) => col.appendChild(tokenRowMini(t)));
  return col;
}

function tokenRowMini(t) {
  const row = el('a', { class: 'token-row-mini', href: `#/token/${encodeURIComponent(t.category)}` });
  row.append(
    iconImg(t.cauldronIcon || t.icon, 22),
    el('span', { class: 'symbol' }, t.symbol || shortId(t.category, 4, 4)),
    el('span', { class: `pct ${pctClass(t.change24h)}` }, fmtPct(t.change24h)),
  );
  return row;
}

function rankTable(tokens, key, limit) {
  const sorted = [...tokens].sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, limit);
  if (!sorted.length) return emptyState('Nothing to rank yet.');
  const table = el('table', { class: 'data-table' });
  sorted.forEach((t, i) => table.appendChild(el('tr', {}, [
    el('td', {}, String(i + 1)),
    el('td', {}, tokenNameCell(t)),
    el('td', { class: 'num' }, fmtUsd(t[key], { compact: true })),
  ])));
  return table;
}

function recentTable(tokens, limit) {
  const sorted = [...tokens].filter((t) => t.genesisTime).sort((a, b) => b.genesisTime - a.genesisTime).slice(0, limit);
  if (!sorted.length) return emptyState('No recent genesis data available.');
  const table = el('table', { class: 'data-table' });
  sorted.forEach((t) => table.appendChild(el('tr', {}, [
    el('td', {}, tokenNameCell(t)),
    el('td', { class: 'num' }, new Date(t.genesisTime).toLocaleString()),
  ])));
  return table;
}

function tokenNameCell(t) {
  const cell = el('a', { class: 'token-name-cell', href: `#/token/${encodeURIComponent(t.category)}` });
  cell.append(iconImg(t.cauldronIcon || t.icon, 20), el('span', {}, t.symbol || shortId(t.category)));
  return cell;
}

// ---- Markets table --------------------------------------------------------------
async function renderMarkets() {
  view.innerHTML = '';
  view.appendChild(el('h1', { class: 'page-title' }, 'Markets'));
  view.appendChild(filterBar());
  const tableHost = el('div', { class: 'table-host' }, skeleton(10));
  view.appendChild(tableHost);
  view.appendChild(el('button', { class: 'btn btn-ghost', onclick: exportCsv }, 'Export CSV'));

  try {
    const [dir, cauldronList, bch] = await Promise.all([
      api.fetchTokenDirectory(1, 2000),
      api.fetchCauldronTokenList({ limit: 2000 }).catch(() => []),
      api.fetchBchPrice().catch(() => null),
    ]);
    state.directory = mergeCauldronData(dir.items || [], cauldronList, bch?.usd);
    drawMarketsTable(tableHost);
  } catch {
    tableHost.innerHTML = '';
    tableHost.appendChild(errorState('Token directory unavailable right now.', renderMarkets));
  }
}

function filterBar() {
  const bar = el('div', { class: 'filter-bar' });
  const typeSel = el('select', { onchange: (e) => { state.filter.type = e.target.value; drawMarketsTable(document.querySelector('.table-host')); } });
  ['all', 'FT', 'NFT', 'Hybrid'].forEach((t) => typeSel.appendChild(el('option', { value: t }, t)));
  const liqCk = el('label', {}, [
    el('input', {
      type: 'checkbox', checked: 'checked',
      onchange: (e) => { state.filter.hasLiquidity = e.target.checked; drawMarketsTable(document.querySelector('.table-host')); },
    }),
    ' Has liquidity',
  ]);
  bar.append(typeSel, liqCk);
  return bar;
}

function applyFilters(list) {
  return list.filter((t) => {
    if (state.filter.type !== 'all' && t.type !== state.filter.type) return false;
    if (state.filter.hasLiquidity && !(t.tvlUsd > 0)) return false;
    if (state.filter.query) {
      const q = state.filter.query.toLowerCase();
      if (!(t.symbol?.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q) || t.category?.toLowerCase().includes(q))) return false;
    }
    return true;
  });
}

function drawMarketsTable(host) {
  host.innerHTML = '';
  const rows = applyFilters(state.directory).sort((a, b) => (b[state.sortKey] || 0) - (a[state.sortKey] || 0));
  if (!rows.length) { host.appendChild(emptyState('No tokens match these filters.')); return; }

  const table = el('table', { class: 'data-table markets-table' });
  const head = el('tr', {}, [
    el('th', {}, '#'), el('th', {}, 'Token'), el('th', { class: 'num' }, 'Price'),
    el('th', { class: 'num' }, '24h %'), el('th', { class: 'num' }, 'Market Cap'),
    el('th', { class: 'num' }, 'TVL'), el('th', { class: 'num' }, 'Volume 24h'),
    el('th', { class: 'num' }, 'Holders'), el('th', {}, 'Watch'),
  ]);
  table.appendChild(head);

  rows.slice(0, 300).forEach((t, i) => {
    const watching = state.watchlist.has(t.category);
    table.appendChild(el('tr', {}, [
      el('td', {}, String(i + 1)),
      el('td', {}, tokenNameCell(t)),
      el('td', { class: 'num' }, fmtUsd(t.priceUsd)),
      el('td', { class: `num ${pctClass(t.change24h)}` }, fmtPct(t.change24h)),
      el('td', { class: 'num' }, fmtUsd(t.marketCapUsd, { compact: true })),
      el('td', { class: 'num' }, fmtUsd(t.tvlUsd, { compact: true })),
      el('td', { class: 'num' }, fmtUsd(t.volume24hUsd, { compact: true })),
      el('td', { class: 'num' }, fmtCompact(t.holders)),
      el('td', {}, el('button', {
        class: `star ${watching ? 'active' : ''}`,
        onclick: () => { toggleWatch(t.category); drawMarketsTable(host); },
      }, watching ? '★' : '☆')),
    ]));
  });
  host.appendChild(table);
}

function toggleWatch(category) {
  if (state.watchlist.has(category)) state.watchlist.delete(category);
  else state.watchlist.add(category);
  saveWatchlist();
}

function exportCsv() {
  const rows = applyFilters(state.directory).map((t) => [t.symbol, t.category, t.priceUsd, t.change24h, t.marketCapUsd, t.tvlUsd, t.volume24hUsd, t.holders]);
  const csv = csvFromRows(['Symbol', 'Category', 'Price USD', '24h %', 'Market Cap', 'TVL', 'Volume 24h', 'Holders'], rows);
  downloadFile('cashcap-markets.csv', csv);
}

// ---- Token detail ----------------------------------------------------------------
async function renderTokenDetail(category) {
  view.innerHTML = '';
  view.appendChild(skeleton(4));
  try {
    const [detail, bcmr, price] = await Promise.all([
      api.fetchTokenDetail(category),
      api.fetchBcmr(category).catch(() => null),
      api.fetchCauldronPrice(category).catch(() => null),
    ]);
    view.innerHTML = '';

    const hero = el('div', { class: 'token-hero' });
    hero.append(
      iconImg(bcmr, 48),
      el('div', {}, [
        el('h1', {}, bcmr?.name || detail.symbol || shortId(category)),
        el('div', { class: 'muted copy-id', onclick: () => copyToClipboard(category) }, `${shortId(category, 10, 10)} · click to copy`),
      ]),
    );
    view.appendChild(hero);

    if ((price?.liquidityUsd || 0) < CONFIG.MIN_LIQUIDITY_USD) {
      view.appendChild(el('div', { class: 'warning-banner' }, '⚠ Low or no verified on-chain liquidity — price data may be unreliable or unavailable.'));
    }

    const priceRow = el('div', { class: 'stat-grid' }, [
      statCard('Price', price ? fmtUsd(price.priceUsd) : '—'),
      statCard('24h change', price ? fmtPct(price.change24h) : '—'),
      statCard('Market cap', fmtUsd(detail.marketCapUsd, { compact: true })),
      statCard('TVL', fmtUsd(detail.tvlUsd, { compact: true })),
      statCard('24h volume', fmtUsd(detail.volume24hUsd, { compact: true })),
      statCard('Holders', fmtCompact(detail.holders)),
    ]);
    view.appendChild(priceRow);

    view.appendChild(section('Price chart', chartCanvas(category)));
    view.appendChild(section('Supply', supplyTable(detail)));
    view.appendChild(section('Metadata', metadataCard(bcmr)));
    view.appendChild(section('Genesis', genesisCard(detail)));
    loadChart(category);
  } catch {
    view.innerHTML = '';
    view.appendChild(errorState('This token could not be loaded.', () => renderTokenDetail(category)));
  }
}

function chartCanvas(category) {
  const wrap = el('div', { class: 'chart-wrap' });
  const canvas = el('canvas', { id: `chart-${category}`, height: '260' });
  wrap.appendChild(canvas);
  return wrap;
}

async function loadChart(category) {
  try {
    const candles = await api.fetchCandles(category, '24h');
    const ctx = document.getElementById(`chart-${category}`);
    if (!ctx || !window.Chart) return;
    new window.Chart(ctx, {
      type: 'line',
      data: {
        labels: candles.map((c) => new Date(c.t).toLocaleTimeString()),
        datasets: [{ data: candles.map((c) => c.close), borderColor: '#0ac18e', tension: 0.25, pointRadius: 0 }],
      },
      options: { plugins: { legend: { display: false } }, scales: { x: { display: false } } },
    });
  } catch { /* chart is a progressive enhancement — page still works without it */ }
}

function supplyTable(detail) {
  return el('table', { class: 'data-table' }, [
    el('tr', {}, [el('td', {}, 'Circulating'), el('td', { class: 'num' }, fmtCompact(detail.circulatingSupply))]),
    el('tr', {}, [el('td', {}, 'Total'), el('td', { class: 'num' }, fmtCompact(detail.totalSupply))]),
    el('tr', {}, [el('td', {}, 'Burned'), el('td', { class: 'num' }, fmtCompact(detail.burnedSupply))]),
  ]);
}

function metadataCard(bcmr) {
  if (!bcmr) return emptyState('No BCMR metadata registered for this category yet.');
  const box = el('div', { class: 'metadata-card' }, [el('p', {}, bcmr.description || '—')]);
  if (bcmr.uris) {
    Object.entries(bcmr.uris).filter(([k]) => k !== 'icon').forEach(([k, v]) => {
      box.appendChild(el('a', { href: v, target: '_blank', rel: 'noopener' }, k));
    });
  }
  return box;
}

function genesisCard(detail) {
  return el('table', { class: 'data-table' }, [
    el('tr', {}, [el('td', {}, 'Genesis tx'), el('td', {}, shortId(detail.genesisTx || '', 10, 10))]),
    el('tr', {}, [el('td', {}, 'Genesis time'), el('td', {}, detail.genesisTime ? new Date(detail.genesisTime).toLocaleString() : '—')]),
  ]);
}

// ---- Watchlist / compare --------------------------------------------------------
async function renderWatchlist() {
  view.innerHTML = '';
  view.appendChild(el('h1', { class: 'page-title' }, 'Watchlist'));
  if (!state.watchlist.size) { view.appendChild(emptyState('Star a token from the markets table to track it here.')); return; }
  const dir = await api.fetchTokenDirectory(1, 2000).catch(() => ({ items: [] }));
  const rows = dir.items.filter((t) => state.watchlist.has(t.category));
  const host = el('div');
  view.appendChild(host);
  drawMarketsTable(host);
  // reuse markets renderer against the filtered subset
  const original = state.directory;
  state.directory = rows;
  drawMarketsTable(host);
  state.directory = original;
}

async function renderCompare() {
  view.innerHTML = '';
  view.appendChild(el('h1', { class: 'page-title' }, 'Compare'));
  if (!state.compare.size) { view.appendChild(emptyState('Add up to 4 tokens from a token page to compare them side by side.')); return; }
}

// ---- Global search (Cmd/Ctrl+K) --------------------------------------------------
const runSearch = debounce(async (q) => {
  state.filter.query = q;
  if (!state.directory.length) {
    try { state.directory = (await api.fetchTokenDirectory(1, 2000)).items; } catch { /* search degrades to empty until directory loads */ }
  }
  location.hash = '#/markets';
  requestAnimationFrame(() => drawMarketsTable(document.querySelector('.table-host')));
}, 250);

searchInput?.addEventListener('input', (e) => runSearch(e.target.value));
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    searchInput?.focus();
  }
});

// ---- Theme + refresh --------------------------------------------------------------
themeToggle?.addEventListener('click', () => {
  document.documentElement.classList.toggle('light');
  localStorage.setItem('cashcap:theme', document.documentElement.classList.contains('light') ? 'light' : 'dark');
});
if (localStorage.getItem('cashcap:theme') === 'light') document.documentElement.classList.add('light');

refreshBtn?.addEventListener('click', async () => {
  await api.clearAllCaches();
  router();
});

// ---- Boot ---------------------------------------------------------------------
router();
