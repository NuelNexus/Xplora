// API client. Talks to the PRORESMAT server when one is reachable; otherwise runs the same
// domain engine inside the browser (offline demo), persisting to IndexedDB.

const TOKEN_KEY = 'proresmat.token';
let mode = 'unknown';
let routes = null;
let localEngine = null;
let token = null;

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
token = safe(() => localStorage.getItem(TOKEN_KEY), null);

export const getMode = () => mode;
export const hasToken = () => !!token;
export function setToken(t) {
  token = t;
  safe(() => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)));
}

// ---------- IndexedDB persistence for the in-browser engine ----------
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('proresmat-demo', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv'); req.result.createObjectStore('blobs'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbOp(store, fn) {
  return idb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  }));
}

async function bootLocal() {
  const { createEngine } = await import('../core/engine.js');
  const mem = new Map();
  let persist = true;
  try { await idbOp('kv', (s) => s.get('probe')); } catch { persist = false; }
  let docKey = persist ? await idbOp('kv', (s) => s.get('docKey')).catch(() => null) : null;
  if (!docKey) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    docKey = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (persist) await idbOp('kv', (s) => s.put(docKey, 'docKey')).catch(() => {});
  }
  let saveTimer = null;
  let pending = null;
  const store = {
    load: async () => (persist ? (await idbOp('kv', (s) => s.get('db')).catch(() => null)) || null : null),
    save: async (db) => {
      if (!persist) return;
      pending = db;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { const snap = pending; idbOp('kv', (s) => s.put(snap, 'db')).catch(() => {}); }, 150);
    },
  };
  const blobs = {
    put: async (k, b) => (persist ? idbOp('blobs', (s) => s.put(b, k)).catch(() => mem.set(k, b)) : mem.set(k, b)),
    get: async (k) => (persist ? (await idbOp('blobs', (s) => s.get(k)).catch(() => null)) || mem.get(k) || null : mem.get(k) || null),
    del: async (k) => (persist ? idbOp('blobs', (s) => s.delete(k)).catch(() => mem.delete(k)) : mem.delete(k)),
  };
  localEngine = await createEngine({ store, blobs, config: { demo: true, docKey } });
  localEngine.persistent = persist;
}

let detecting = null;
function detect() {
  if (mode !== 'unknown') return Promise.resolve();
  return (detecting ||= detectOnce());
}
async function detectOnce() {
  if (globalThis.PRORESMAT_STANDALONE) { mode = 'local'; await bootLocal(); return; }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch('api/v1/meta', { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      mode = 'server';
      return;
    }
  } catch { /* no server */ }
  mode = 'local';
  await bootLocal();
}

export class ApiError extends Error {
  constructor(code, message, status, details) { super(message); this.code = code; this.status = status; this.details = details; }
}

const device = () => {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : 'Linux';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
};

async function routeTable() {
  if (routes) return routes;
  const res = await fetch('api/v1/routes', { cache: 'no-store' });
  routes = (await res.json()).data;
  return routes;
}

async function viaHttp(name, params) {
  const table = await routeTable();
  const r = table[name];
  if (!r) throw new ApiError('NOT_FOUND', `Unknown action ${name}`, 404);
  const [method, pattern] = r;
  const rest = { ...params };
  const path = pattern.replace(/:(\w+)/g, (_, k) => { const v = rest[k]; delete rest[k]; return encodeURIComponent(v ?? ''); });
  let url = 'api/v1' + path;
  const init = { method, headers: {}, cache: 'no-store' };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (method === 'GET') {
    const qs = new URLSearchParams(Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    if (qs) url += '?' + qs;
  } else {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(rest);
  }
  let lastErr;
  // Retry idempotent reads (and writes carrying an idempotency key) on network failure.
  const attempts = method === 'GET' || rest.idempotencyKey ? 3 : 1;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(json.error?.code || 'ERROR', json.error?.message || 'Request failed.', res.status, json.error?.details);
      return json.data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw new ApiError('NETWORK', 'You appear to be offline or the connection dropped. Check your connection and try again.', 0, { cause: String(lastErr) });
}

export async function api(name, params = {}) {
  await detect();
  if (mode === 'server') return viaHttp(name, params);
  try {
    return await localEngine.call(name, params, { token, device: device() + ' (demo)' });
  } catch (e) {
    throw new ApiError(e.code || 'ERROR', e.message, e.status || 400, e.details);
  }
}

// Opens a medical document through a short-lived link.
export async function openDocument(docId) {
  const link = await api('documents.link', { id: docId });
  if (mode === 'server') return { url: link.url, name: link.name, mime: link.mime, revoke: () => {} };
  const file = await api('documents.fetch', { token: link.token });
  const bytes = Uint8Array.from(atob(file.dataB64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  return { url, name: file.name, mime: file.mime, revoke: () => URL.revokeObjectURL(url) };
}

export async function apiInfo() {
  await detect();
  return { mode, persistent: mode === 'server' ? true : !!localEngine?.persistent };
}
