// Shared helpers. Runs unchanged in Node 22+ and modern browsers (uses WebCrypto).

export class AppError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export const fail = (code, message, status = 400, details) => { throw new AppError(code, message, status, details); };

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();

export function randomToken(bytes = 16) {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function newId(prefix) {
  return `${prefix}_${randomToken(6)}`;
}

export function randomDigits(n) {
  const b = new Uint32Array(n);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => String(x % 10)).join('');
}

export function toB64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => new Uint8Array(h.match(/.{2}/g).map((x) => parseInt(x, 16)));

export async function sha256Hex(data) {
  return hex(await subtle().digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
}

export async function hmacSha512Hex(secret, message) {
  const key = await subtle().importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return hex(await subtle().sign('HMAC', key, enc.encode(message)));
}

const PBKDF2_ITER = 60000;

export async function hashPassword(password, saltHex = randomToken(16)) {
  const key = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITER }, key, 256);
  return { salt: saltHex, hash: hex(bits) };
}

export async function verifyPassword(password, salt, expected) {
  const { hash } = await hashPassword(password, salt);
  // constant-time-ish comparison
  if (hash.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function aesEncrypt(keyHex, bytes) {
  const key = await subtle().importKey('raw', fromHex(keyHex), 'AES-GCM', false, ['encrypt']);
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { iv: hex(iv), data: ct };
}

export async function aesDecrypt(keyHex, ivHex, bytes) {
  const key = await subtle().importKey('raw', fromHex(keyHex), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromHex(ivHex) }, key, bytes));
}

// ---------- validation ----------

export function str(v, field, { min = 1, max = 500, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return '';
    fail('VALIDATION', `${field} is required.`, 422, { field });
  }
  if (typeof v !== 'string') fail('VALIDATION', `${field} must be text.`, 422, { field });
  const t = v.trim();
  if (t.length < min) fail('VALIDATION', `${field} must be at least ${min} characters.`, 422, { field });
  if (t.length > max) fail('VALIDATION', `${field} must be at most ${max} characters.`, 422, { field });
  return t;
}

export function int(v, field, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if ((v === undefined || v === null || v === '') && optional) return undefined;
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isInteger(n)) fail('VALIDATION', `${field} must be a whole number.`, 422, { field });
  if (n < min || n > max) fail('VALIDATION', `${field} must be between ${min} and ${max}.`, 422, { field });
  return n;
}

export function oneOf(v, field, options) {
  if (!options.includes(v)) fail('VALIDATION', `${field} must be one of: ${options.join(', ')}.`, 422, { field });
  return v;
}

export function dateStr(v, field, { optional = false } = {}) {
  if (!v && optional) return '';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) {
    fail('VALIDATION', `${field} must be a date (YYYY-MM-DD).`, 422, { field });
  }
  return v;
}

export function email(v, field = 'Email') {
  const e = str(v, field, { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) fail('VALIDATION', 'Enter a valid email address.', 422, { field });
  return e;
}

// Ghana numbers: 0XX XXX XXXX or +233 XX XXX XXXX. Returns E.164.
export function ghPhone(v, field = 'Phone') {
  const raw = str(v, field, { max: 30 }).replace(/[\s\-()]/g, '');
  const m = raw.match(/^(?:\+?233|0)([235]\d{8})$/);
  if (!m) fail('VALIDATION', 'Enter a Ghana phone number, e.g. 024 123 4567 or +233 24 123 4567.', 422, { field });
  return '+233' + m[1];
}

export function formatPhone(e164) {
  if (!e164) return '';
  const d = e164.replace('+233', '0');
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

export function passwordRule(p) {
  const s = str(p, 'Password', { min: 8, max: 128 });
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) fail('VALIDATION', 'Password needs at least 8 characters with letters and numbers.', 422, { field: 'Password' });
  return s;
}

// ---------- dates (Ghana runs on GMT all year, so UTC == local time) ----------

export const DAY = 86400000;
export const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (dateString, n) => isoDate(Date.parse(dateString + 'T00:00:00Z') + n * DAY);
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function money(pesewas) {
  const v = (pesewas || 0) / 100;
  return 'GH₵ ' + v.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

// Words that imply cure / guaranteed efficacy. Blocked in listings, flagged in reviews.
export const CLAIM_PATTERN = /\b(cures?|cured|curing|guarantee[sd]?|miracle|100\s?%|permanent(ly)? (heal|remov)|heals? (all|every)|eliminates? (diabetes|hypertension|cancer|hiv|malaria))\b/i;
