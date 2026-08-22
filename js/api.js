// CashCap — data layer.
// Every external call is cached (memory -> localStorage -> IndexedDB for the
// full directory) with sensible TTLs, and degrades gracefully when a source
// is unavailable rather than breaking the page.

import { CONFIG } from './config.js';

const mem = new Map();

// ---- IndexedDB (used only for the full ~19k-row directory) ----------------
const DB_NAME = 'cashcap-db';
const STORE = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(key);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* IndexedDB unavailable (private mode etc.) — silently skip persistence */
  }
}

// ---- Generic cached-fetch helper ------------------------------------------
// tier: 'mem' | 'local' | 'idb' — controls where the cache entry lives.
async function cached(key, ttl, tier, fetcher) {
  const now = Date.now();

  if (mem.has(key)) {
    const hit = mem.get(key);
    if (now - hit.t < ttl) return hit.v;
  }

  if (tier === 'local') {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const hit = JSON.parse(raw);
        if (now - hit.t < ttl) {
          mem.set(key, hit);
          return hit.v;
        }
      }
    } catch { /* corrupt cache entry — ignore and refetch */ }
  }

  if (tier === 'idb') {
    const hit = await idbGet(key);
    if (hit && now - hit.t < ttl) {
      mem.set(key, hit);
      return hit.v;
    }
  }

  try {
    const v = await fetcher();
    const entry = { t: now, v };
    mem.set(key, entry);
    if (tier === 'local') {
      try { localStorage.setItem(key, JSON.stringify(entry)); } catch { /* quota — ignore */ }
    }
    if (tier === 'idb') idbSet(key, entry);
    return v;
  } catch (err) {
    // Graceful degradation: serve stale cache if we have any, else rethrow.
    if (mem.has(key)) return mem.get(key).v;
    if (tier === 'local') {
      try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw).v;
      } catch { /* no usable stale copy */ }
    }
    if (tier === 'idb') {
      const stale = await idbGet(key);
      if (stale) return stale.v;
    }
    throw err;
  }
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

// ---- Public API -------------------------------------------------------------

/** Full token directory, paginated. Cached in IndexedDB — this is the big list. */
export async function fetchTokenDirectory(page = 1, pageSize = CONFIG.PAGE_SIZE) {
  const key = `dir:${page}:${pageSize}`;
  return cached(key, CONFIG.TTL.DIRECTORY, 'idb', () =>
    getJson(`${CONFIG.API.TOKENS}?page=${page}&pageSize=${pageSize}`));
}

/** Single token detail: supply, holders, genesis, BCMR-enriched. */
export async function fetchTokenDetail(categoryId) {
  const key = `detail:${categoryId}`;
  return cached(key, CONFIG.TTL.METADATA, 'local', () =>
    getJson(`${CONFIG.API.TOKEN_DETAIL}?category=${categoryId}`));
}

/** BCMR metadata (name, symbol, icon, description, links, NFT schema). */
export async function fetchBcmr(categoryId) {
  const key = `bcmr:${categoryId}`;
  return cached(key, CONFIG.TTL.METADATA, 'local', () =>
    getJson(`${CONFIG.API.BCMR}?category=${categoryId}`));
}

/** Live price + pools from Cauldron for a token. */
export async function fetchCauldronPrice(categoryId) {
  const key = `price:${categoryId}`;
  return cached(key, CONFIG.TTL.PRICE, 'mem', () =>
    getJson(`${CONFIG.API.CAULDRON}?type=price&category=${categoryId}`));
}

/** Candlestick history for the price chart. */
export async function fetchCandles(categoryId, timeframe = '24h') {
  const key = `candles:${categoryId}:${timeframe}`;
  return cached(key, CONFIG.TTL.CANDLES, 'mem', () =>
    getJson(`${CONFIG.API.CAULDRON}?type=candles&category=${categoryId}&tf=${timeframe}`));
}

/** All active Cauldron pools (used for the DeFi / liquidity leaderboard). */
export async function fetchActivePools() {
  const key = 'pools:active';
  return cached(key, CONFIG.TTL.PRICE, 'mem', () =>
    getJson(`${CONFIG.API.CAULDRON}?type=pools`));
}

/** BCH/USD spot price. */
export async function fetchBchPrice() {
  const key = 'bch:usd';
  return cached(key, CONFIG.TTL.PRICE, 'local', () => getJson(CONFIG.API.BCH_PRICE));
}

/** Current indexed block height, for the "as of block N" footer stat. */
export async function fetchLatestBlock() {
  const key = 'block:latest';
  return cached(key, CONFIG.TTL.BLOCK_HEIGHT, 'mem', () => getJson(CONFIG.API.LATEST_BLOCK));
}

/** Icon URL, safely proxied server-side (blocks LAN/loopback SSRF vectors). */
export function iconUrl(rawUrl) {
  if (!rawUrl) return null;
  return `${CONFIG.API.ICON}?u=${encodeURIComponent(rawUrl)}`;
}

/** Clears every cache tier — used by the manual "Refresh" control. */
export async function clearAllCaches() {
  mem.clear();
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('dir:') || k.startsWith('detail:') || k.startsWith('bcmr:') || k === 'bch:usd')
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* localStorage unavailable */ }
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
  } catch { /* IndexedDB unavailable */ }
}
