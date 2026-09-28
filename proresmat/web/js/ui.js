// Rendering helpers and shared components. All interpolated values are escaped by default.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
const val = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(val).join('') : v === false || v === null || v === undefined ? '' : esc(v));
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += val(vals[i]) + strings[i + 1];
  return new Safe(out);
}
// Branches may be thunks so that property access inside them only runs when the branch is chosen.
export const when = (cond, a, b = '') => { const v = cond ? a : b; return typeof v === 'function' ? v() : v; };

// ---------- formatting ----------
export const money = (p) => 'GH₵ ' + ((p || 0) / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const fmtDay = (iso) => { const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
export const fmtTime = (iso) => (iso ? new Date(iso).toISOString().slice(11, 16) : '');
export const fmtDateTime = (iso) => (iso ? `${fmtDay(iso)}, ${fmtTime(iso)}` : '');
export const phone = (e164) => { if (!e164) return ''; const d = e164.replace('+233', '0'); return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`; };
export const words = (s) => String(s || '').replace(/_/g, ' ');
export const regLabel = (council, reg) => (String(reg || '').toUpperCase().startsWith(String(council || '').toUpperCase()) ? reg : `${council} ${reg}`);
export const cap = (s) => { const w = words(s); return w.charAt(0).toUpperCase() + w.slice(1); };
export function ago(iso, nowMs) {
  const s = Math.round((nowMs - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}

// ---------- icons (inline SVG, stroke-based) ----------
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  consult: 'M8 3v4M16 3v4M3.5 9h17M5 5h14a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6.5A1.5 1.5 0 0 1 5 5zm3 8h3m-3 3.5h6',
  leaf: 'M5 19C5 10 11 4 20 4c0 9-6 15-15 15zm0 0 7-7',
  bag: 'M5 8h14l-1.2 12H6.2zM9 8V6a3 3 0 0 1 6 0v2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7.5 8.5a7.5 7.5 0 0 1 15 0',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  cart: 'M3 4h2l2.4 11h11l2-8H6.3M9.5 20a1 1 0 1 0 0-.01M17.5 20a1 1 0 1 0 0-.01',
  back: 'M15 5l-7 7 7 7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4.5-4.5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  shield: 'M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6zm-3.2 9 2.2 2.2 4.3-4.4',
  alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5m0 2.5v.01',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z',
  video: 'M3.5 7.5A1.5 1.5 0 0 1 5 6h9a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 14 18H5a1.5 1.5 0 0 1-1.5-1.5zm12 3.5 5-3v8l-5-3z',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  doc: 'M7 3h7l5 5v13H7a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 7 3zm7 0v5h5M9 13h6m-6 3.5h6',
  card: 'M3 7a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 7v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17zm0 3h18M6.5 15h3',
  momo: 'M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zm3 16h2',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H3',
  wallet: 'M4 7h15a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5V6A2 2 0 0 1 5.5 4H17v3m-1.5 6.5h.01',
  box: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5zm0 0L12 12l8.5-4.5M12 12v9',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  clip: 'M9 4h6v3H9zM7 5.5H5.5V21h13V5.5H17M9 12l2 2 4-4',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm-6 9a6 6 0 0 1 12 0m1.5-9a3 3 0 1 0 0-6m3.5 15a5.5 5.5 0 0 0-3.5-5',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z',
  logout: 'M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 8l-4 4 4 4M6 12h10',
  book: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13z',
  lock: 'M6 10.5h12V20H6zM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v4.5l3 2',
  upload: 'M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 16v3.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V16',
  truck: 'M3 6.5h11V16H3zm11 3h4l3 3.5V16h-7M7 19a1.8 1.8 0 1 0 0-.01M17 19a1.8 1.8 0 1 0 0-.01',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4m-4 5a8 8 0 0 0 14.6 4.5M20 20v-4h-4',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-9-9h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z',
};
export const icon = (name, cls = '') => raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${P[name] || P.leaf}"/></svg>`);

export const logo = (size = 44) => raw(`<span class="brand-tile lg" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px" aria-hidden="true">P</span>`);
export const logoMark = (size = 28) => raw(`<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="var(--primary)"/><path d="M9 22c0-8 5.5-13 14-13 0 8.5-5.5 13-14 13zm0 0 7.5-7.5" fill="none" stroke="var(--gold-soft)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`);

// ---------- components ----------
export const avatar = (a, size = 48, label = '') => raw(`<span class="avatar" style="--h:${a?.hue ?? 150};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px" role="img" aria-label="${esc(label || 'Practitioner')}">${esc(a?.initials || '?')}</span>`);

// Consistent neutral pack illustrations instead of stock photography.
export function packArt(image = {}, size = 72, name = '') {
  const h = image.hue ?? 120;
  const shape = image.shape || 'Capsule';
  const body = {
    Capsule: '<rect x="22" y="14" width="28" height="44" rx="6" class="pk-b"/><rect x="22" y="14" width="28" height="10" rx="4" class="pk-c"/><rect x="27" y="32" width="18" height="14" rx="2" class="pk-l"/>',
    Tablet: '<rect x="22" y="14" width="28" height="44" rx="6" class="pk-b"/><rect x="22" y="14" width="28" height="10" rx="4" class="pk-c"/><rect x="27" y="32" width="18" height="14" rx="2" class="pk-l"/>',
    Syrup: '<rect x="30" y="8" width="12" height="8" rx="2" class="pk-c"/><path d="M28 16h16l4 8v30a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4V24z" class="pk-b"/><rect x="28" y="32" width="16" height="16" rx="2" class="pk-l"/>',
    Tincture: '<rect x="32" y="6" width="8" height="10" rx="2" class="pk-c"/><path d="M29 16h14v6l3 4v28a4 4 0 0 1-4 4H30a4 4 0 0 1-4-4V26l3-4z" class="pk-b"/><rect x="29" y="34" width="14" height="14" rx="2" class="pk-l"/>',
    'Tea bags': '<rect x="14" y="18" width="44" height="38" rx="4" class="pk-b"/><path d="M14 26h44" class="pk-s" stroke-width="4" fill="none"/><rect x="24" y="33" width="24" height="15" rx="2" class="pk-l"/>',
    Balm: '<ellipse cx="36" cy="46" rx="22" ry="8" class="pk-c"/><rect x="14" y="30" width="44" height="16" class="pk-b"/><ellipse cx="36" cy="30" rx="22" ry="8" class="pk-l"/>',
    Powder: '<path d="M22 20h28l-3 38H25z" class="pk-b"/><rect x="20" y="14" width="32" height="8" rx="2" class="pk-c"/><rect x="28" y="32" width="16" height="14" rx="2" class="pk-l"/>',
  }[shape] || '';
  return raw(`<svg class="pack" style="--h:${h}" width="${size}" height="${size}" viewBox="0 0 72 72" role="img" aria-label="${esc(name ? name + ' pack' : 'Product pack')}"><rect width="72" height="72" rx="12" class="pk-bg"/>${body}</svg>`);
}

const TONE = {
  confirmed: 'ok', completed: 'ok', approved: 'ok', active: 'ok', success: 'ok', paid: 'ok', delivered: 'ok', acknowledged: 'ok', eligible: 'ok', published: 'ok', resolved: 'ok', closed: 'muted', won: 'ok', endorsed: 'ok', followed_up: 'ok', validated: 'ok', quoted: 'info', processed: 'ok',
  pending_payment: 'warn', pending: 'warn', submitted: 'info', under_review: 'info', in_progress: 'info', received: 'info', accepted: 'info', stock_confirmed: 'info', prepared: 'info', dispatched: 'info', ready_for_pickup: 'info', processing: 'info', open: 'warn', investigating: 'info', requested: 'warn', new: 'warn',
  changes_required: 'warn', changes_advised: 'warn', on_hold: 'warn', draft: 'muted', expired: 'bad', suspended: 'bad', recalled: 'bad', deactivated: 'bad', failed: 'bad', rejected: 'bad', cancelled: 'muted', cancelled_customer: 'muted', cancelled_provider: 'muted', cancelled_system: 'muted', refunded: 'muted', void: 'muted', lost: 'bad', no_show: 'bad', duplicate_refunded: 'muted', urgent: 'bad', referred_fda: 'info', initialized: 'muted', gateway_failed: 'bad', pending_gateway: 'warn',
};
const TONE_ICON = { ok: 'check', warn: 'clock', bad: 'alert', info: 'refresh', muted: 'x' };
const STATUS_LABEL = { pending_payment: 'Awaiting payment', cancelled_customer: 'Cancelled by you', cancelled_provider: 'Cancelled by practitioner', cancelled_system: 'Cancelled – refunded', no_show: 'Missed', duplicate_refunded: 'Duplicate – refunded', ready_for_pickup: 'Ready for pickup', stock_confirmed: 'Stock confirmed', on_hold: 'On hold', changes_required: 'Changes required' };
export const statusLabel = (s) => STATUS_LABEL[s] || cap(s);
// Status is always colour + icon + text.
export const status = (s, label) => { const t = TONE[s] || 'muted'; return html`<span class="status ${t}">${icon(TONE_ICON[t])}${label || statusLabel(s)}</span>`; };

export const classBadge = (providerClass, label) => html`<span class="badge ${providerClass === 'supervised' ? 'gold' : 'green'}">${icon('shield')}${label || (providerClass === 'supervised' ? 'PRORESMAT-supervised' : 'Verified independent')}</span>`;
export const sellerBadge = (label, isProresmat) => html`<span class="badge ${isProresmat ? 'gold' : 'line'}">${icon('box')}${label}</span>`;
export const stars = (r) => (r?.avg ? html`<span class="stars" aria-label="Rated ${r.avg} out of 5 from ${r.count} reviews">${icon('star')}${r.avg.toFixed(1)} <span class="muted">(${r.count})</span></span>` : html`<span class="muted small">No reviews yet</span>`);
export const empty = (title, body = '', action = '') => html`<div class="empty">${icon('leaf')}<p class="empty-title">${title}</p>${when(body, html`<p class="muted">${body}</p>`)}${action}</div>`;
export const kv = (rows) => html`<dl class="kv">${rows.filter(Boolean).map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
export const section = (title, body, extra = '') => html`<section class="sec"><div class="sec-head"><h2>${title}</h2>${extra}</div>${body}</section>`;
export const tabs = (items, active, name = 'tab') => html`<div class="tabs" role="tablist">${items.map(([id, label, count]) => html`<button type="button" role="tab" class="tab ${id === active ? 'on' : ''}" aria-selected="${id === active}" data-act="${name}" data-v="${id}">${label}${count ? html` <span class="count">${count}</span>` : ''}</button>`)}</div>`;
export const emergency = (compact = false) => html`<div class="emergency ${compact ? 'compact' : ''}" role="note">${icon('alert')}<div><strong>Emergency?</strong> Call <b>112</b> or <b>193</b> (National Ambulance Service), or go to the nearest hospital emergency unit. PRORESMAT is not an emergency service.</div></div>`;

// ---------- form helpers ----------
export const field = (label, input, hint = '', name = '') => html`<label class="field" ${name ? raw(`data-field="${esc(name)}"`) : ''}><span class="lbl">${label}</span>${input}${when(hint, html`<span class="hint">${hint}</span>`)}<span class="err" aria-live="polite"></span></label>`;
export const input = (name, { type = 'text', value = '', placeholder = '', required = false, attrs = '' } = {}) => html`<input id="f-${name}" name="${name}" type="${type}" value="${value}" placeholder="${placeholder}" ${required ? raw('required') : ''} ${raw(attrs)}>`;
export const textarea = (name, { value = '', placeholder = '', rows = 3, required = false } = {}) => html`<textarea id="f-${name}" name="${name}" rows="${rows}" placeholder="${placeholder}" ${required ? raw('required') : ''}>${value}</textarea>`;
export const select = (name, options, value = '', { required = false, blank = '' } = {}) => html`<select id="f-${name}" name="${name}" ${required ? raw('required') : ''}>${when(blank, html`<option value="">${blank}</option>`)}${options.map(([v, l]) => html`<option value="${v}" ${String(v) === String(value) ? raw('selected') : ''}>${l}</option>`)}</select>`;
export const check = (name, label, checked = false, value = 'true') => html`<label class="check"><input type="checkbox" name="${name}" value="${value}" ${checked ? raw('checked') : ''}><span>${label}</span></label>`;

// Reads a form into an object. Supports dotted names (a.b) and repeated names ending in [] for arrays.
export function formData(form) {
  const out = {};
  const setPath = (obj, path, v) => {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ||= {};
    o[parts.at(-1)] = v;
  };
  const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
  for (const el of form.elements) {
    if (!el.name || el.disabled || el.type === 'submit' || el.type === 'button' || el.type === 'file') continue;
    const isArr = el.name.endsWith('[]');
    const name = isArr ? el.name.slice(0, -2) : el.name;
    if (el.type === 'checkbox') {
      if (isArr) { const arr = getPath(out, name) || []; if (el.checked) arr.push(el.value); setPath(out, name, arr); } else setPath(out, name, el.checked);
    } else if (el.type === 'radio') {
      if (el.checked) setPath(out, name, el.value);
    } else if (isArr) { const arr = getPath(out, name) || []; arr.push(el.value); setPath(out, name, arr); } else setPath(out, name, el.value);
  }
  return out;
}

export function showFieldErrors(form, err) {
  form.querySelectorAll('.field.invalid').forEach((f) => { f.classList.remove('invalid'); f.querySelector('.err').textContent = ''; });
  const box = form.querySelector('.form-error');
  const name = err?.details?.field;
  let target = null;
  if (name) {
    const n = String(name).toLowerCase().replace(/[^a-z]/g, '');
    target = [...form.querySelectorAll('.field')].find((f) => {
      const key = (f.dataset.field || f.querySelector('[name]')?.name || '').toLowerCase().replace(/[^a-z]/g, '');
      const lbl = (f.querySelector('.lbl')?.textContent || '').toLowerCase().replace(/[^a-z]/g, '');
      return key === n || lbl === n || key.endsWith(n);
    });
  }
  if (target) {
    target.classList.add('invalid');
    target.querySelector('.err').textContent = err.message;
    target.querySelector('input,select,textarea')?.focus();
    if (box) box.hidden = true;
  } else if (box) {
    box.textContent = err.message;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

export const readFileB64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

export const idem = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

// ---------- template components (report figures 2–5) ----------
export const pageHead = (title, sub = '', aside = '') => html`<header class="page-head"><div><h2 class="page-title">${title}</h2>${when(sub, () => html`<p class="page-sub">${sub}</p>`)}</div>${aside}</header>`;
export const banner = (tone, content, ic) => html`<div class="banner ${tone}" role="${tone === 'bad' ? 'alert' : 'status'}">${icon(ic || (tone === 'bad' ? 'alert' : tone === 'warn' ? 'clock' : 'check'))}<span>${content}</span></div>`;
export const iconTile = (name, tone = '') => html`<span class="itile ${tone}" aria-hidden="true">${icon(name)}</span>`;
export const qaTile = (go, ic, title, sub) => html`<button type="button" class="qa" data-go="${go}"><span class="qa-icon" aria-hidden="true">${icon(ic)}</span><strong>${title}</strong><span>${sub}</span></button>`;
export const statTile = (value, label, sub = '', tone = 'green', go = '') => html`<${raw(go ? 'button type="button"' : 'div')} class="stat-tile ${tone}" ${go ? raw(`data-go="${esc(go)}"`) : ''}><strong>${value}</strong><span class="st-label">${label}</span>${when(sub, () => html`<span class="st-sub">${sub}</span>`)}</${raw(go ? 'button' : 'div')}>`;
export const pill = (text, tone = '') => html`<span class="pill ${tone}">${text}</span>`;
// Entity card: icon square (or avatar), title, subtitle, optional pill and right-hand value.
export function ecard({ go = '', act = '', data = {}, lead, title, sub = '', pill: p = '', aside = '', extra = '' }) {
  const attrs = raw([go && `data-go="${esc(go)}"`, act && `data-act="${esc(act)}"`, ...Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`)].filter(Boolean).join(' '));
  const tag = go || act ? 'button type="button"' : 'div';
  return html`<${raw(tag)} class="ecard ${go || act ? 'tap' : ''}" ${attrs}>${lead}<span class="ec-main"><strong class="ec-title">${title}</strong>${when(sub, () => html`<span class="ec-sub">${sub}</span>`)}${p}${extra}</span>${when(aside, () => html`<span class="ec-aside">${aside}</span>`)}</${raw(go || act ? 'button' : 'div')}>`;
}
export function greeting(nowMs = Date.now()) {
  const h = new Date(nowMs).getUTCHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
