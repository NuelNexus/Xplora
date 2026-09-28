// App shell: state, hash router, environments, event delegation, sheets, toasts, idle timeout.
import { api, apiInfo, setToken, hasToken } from './api.js';
import { html, raw, esc, icon, logo, formData, showFieldErrors, when } from './ui.js';
import { t, setLang } from './i18n.js';

export const S = { user: null, meta: null, unread: 0, cartCount: 0, info: null, nowOffsetDays: 0 };

const routes = [];
export function route(pattern, screen, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ pattern, re, keys, screen, ...opts });
}

export const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
export const refresh = () => render({ keepScroll: true });

// ---------- environments (max five bottom-nav destinations each) ----------
export const ENVS = {
  c: { label: 'Customer', roles: ['customer'], nav: [['home', '#/c/home', 'home'], ['consult', '#/c/consult', 'consult'], ['products', '#/c/products', 'leaf'], ['orders', '#/c/orders', 'bag'], ['profile', '#/c/profile', 'user']] },
  p: { label: 'Practitioner', roles: ['practitioner'], nav: [['today', '#/p/today', 'clock'], ['patients', '#/p/patients', 'people'], ['consult', '#/p/consults', 'clip'], ['earnings', '#/p/earnings', 'wallet'], ['profile', '#/p/profile', 'user']] },
  v: { label: 'Clinic & vendor', roles: ['vendor'], nav: [['dashboard', '#/v/dashboard', 'chart'], ['products', '#/v/products', 'box'], ['orders', '#/v/orders', 'truck'], ['payouts', '#/v/payouts', 'wallet'], ['compliance', '#/v/compliance', 'shield']] },
  a: { label: 'PRORESMAT control centre', roles: ['admin', 'finance', 'support'], nav: [['overview', '#/a/overview', 'chart', ['admin', 'finance', 'support']], ['approvals', '#/a/approvals', 'check', ['admin']], ['care', '#/a/care', 'shield', ['admin', 'support']], ['finance', '#/a/finance', 'wallet', ['admin', 'finance']], ['risk', '#/a/risk', 'flag', ['admin']]] },
};
export const envsFor = (user) => Object.entries(ENVS).filter(([, e]) => user?.roles.some((r) => e.roles.includes(r))).map(([k]) => k);
export const homeFor = (user) => { const e = envsFor(user); return e.includes('a') ? '#/a/overview' : e.includes('v') ? '#/v/dashboard' : e.includes('p') ? '#/p/today' : '#/c/home'; };

// ---------- toasts ----------
export function toast(message, tone = 'ok') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, tone === 'bad' ? 6000 : 3500);
}

// ---------- sheets (modal dialogs) ----------
let handlers = { acts: {}, forms: {}, changes: {} };
let sheetStack = [];
export function sheet(title, body, { wide = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = String(html`<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}"><div class="sheet-head"><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div><div class="sheet-body">${body}</div></div>`);
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  const prevFocus = document.activeElement;
  const close = () => {
    wrap.remove();
    sheetStack = sheetStack.filter((s) => s !== api_);
    if (!sheetStack.length) document.body.classList.remove('no-scroll');
    prevFocus?.focus?.();
  };
  const api_ = { el: wrap, close };
  sheetStack.push(api_);
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  setTimeout(() => (wrap.querySelector('input,select,textarea,button:not([data-close])') || wrap.querySelector('.sheet')).focus(), 30);
  return api_;
}
export const closeSheets = () => [...sheetStack].forEach((s) => s.close());

// In-page confirmation (the host frame blocks window.confirm).
export function confirmSheet({ title, body = '', confirmLabel = 'Confirm', danger = false, reason = false, reasonLabel = 'Reason (recorded in the audit log)' }) {
  return new Promise((resolve) => {
    const s = sheet(title, html`<form class="stack" data-inline="confirm">${body ? html`<div class="prose">${body}</div>` : ''}${when(reason, () => html`<label class="field"><span class="lbl">${reasonLabel}</span><textarea name="reason" rows="3" required minlength="3"></textarea><span class="err"></span></label>`)}<div class="row end"><button type="button" class="btn ghost" data-close>Go back</button><button class="btn ${danger ? 'danger' : 'primary'}">${confirmLabel}</button></div></form>`);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    s.el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const r = e.target.reason?.value.trim() || '';
      if (reason && r.length < 3) { e.target.querySelector('.field').classList.add('invalid'); e.target.querySelector('.err').textContent = 'Enter a reason of at least 3 characters.'; return; }
      finish({ ok: true, reason: r });
      s.close();
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(s.el)) { finish({ ok: false }); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  });
}

// ---------- event delegation ----------
function onClick(e) {
  const goEl = e.target.closest('[data-go]');
  if (goEl && !goEl.disabled) { e.preventDefault(); closeSheets(); go(goEl.dataset.go); return; }
  const actEl = e.target.closest('[data-act]');
  if (actEl && !actEl.disabled) {
    const fn = handlers.acts[actEl.dataset.act];
    if (fn) { e.preventDefault(); runGuarded(actEl, () => fn(actEl.dataset, actEl, e)); }
  }
}
function onChange(e) {
  const el = e.target.closest('[data-change]');
  if (el) handlers.changes[el.dataset.change]?.(el.value, el, e);
}
async function onSubmit(e) {
  const form = e.target;
  if (form.dataset.inline) return;
  const fn = handlers.forms[form.dataset.form];
  if (!fn) return;
  e.preventDefault();
  const btn = form.querySelector('button[type=submit],button:not([type])');
  const box = form.querySelector('.form-error');
  if (box) box.hidden = true;
  form.querySelectorAll('.field.invalid').forEach((f) => f.classList.remove('invalid'));
  if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Working…'; }
  try {
    await fn(formData(form), form, e.submitter);
  } catch (err) {
    if (err.status === 401 && err.code === 'UNAUTHENTICATED') return sessionEnded();
    showFieldErrors(form, err);
    if (!form.querySelector('.form-error') && !form.querySelector('.field.invalid')) toast(err.message, 'bad');
  } finally {
    if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = btn.dataset.label; }
  }
}
async function runGuarded(el, fn) {
  if (el.dataset.busy) return;
  el.dataset.busy = '1';
  el.setAttribute('aria-busy', 'true');
  try { await fn(); } catch (err) {
    if (err.status === 401 && err.code === 'UNAUTHENTICATED') return sessionEnded();
    toast(err.message, 'bad');
  } finally { delete el.dataset.busy; el.removeAttribute('aria-busy'); }
}

// ---------- session ----------
export async function loadMe() {
  if (!hasToken()) { S.user = null; return; }
  try {
    const me = await api('auth.me');
    S.user = me.user;
    S.unread = me.unread;
    setLang(S.user.lang);
  } catch (e) {
    if (e.status === 401) { setToken(null); S.user = null; } else throw e;
  }
}
export async function signedIn(res, next) {
  setToken(res.token);
  S.user = res.user;
  setLang(S.user.lang);
  await loadMe();
  go(next && next !== '#/login' ? next : homeFor(S.user));
}
export async function signOut(msg) {
  try { await api('auth.logout'); } catch { /* ignore */ }
  setToken(null);
  S.user = null;
  S.cartCount = 0;
  closeSheets();
  if (msg) toast(msg, 'warn');
  go('#/login');
}
function sessionEnded() {
  setToken(null);
  S.user = null;
  closeSheets();
  toast('Your session ended. Please sign in again.', 'warn');
  go('#/login?next=' + encodeURIComponent(location.hash));
}

// Client-side idle timeout (the server enforces its own).
let lastActive = Date.now();
['click', 'keydown', 'touchstart', 'scroll'].forEach((ev) => window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
setInterval(() => {
  const mins = S.meta?.settings?.sessionIdleMinutes ? Math.min(15, S.meta.settings.sessionIdleMinutes) : 15;
  if (S.user && Date.now() - lastActive > mins * 60000) signOut('You were signed out after 15 minutes without activity.');
}, 30000);

// ---------- render ----------
let seq = 0;
let lastHash = '';
function parse(hash) {
  const h = (hash || '').replace(/^#/, '') || '/c/home';
  const [path, qs] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export async function render({ keepScroll = false } = {}) {
  const my = ++seq;
  const { path, query } = parse(location.hash);
  let match = null;
  let params = {};
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) { match = r; params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); break; }
  }
  const main = document.getElementById('main');
  const navEl = document.getElementById('nav');
  const headEl = document.getElementById('top');
  const envKey = path.split('/')[1];
  const env = ENVS[envKey] ? envKey : null;
  if (!match) { location.hash = S.user ? homeFor(S.user) : '#/c/home'; return; }
  if (match.auth !== false && (match.auth || (env && env !== 'c')) && !S.user) { location.hash = '#/login?next=' + encodeURIComponent(location.hash); return; }
  if (env && S.user && env !== 'c' && !envsFor(S.user).includes(env)) {
    main.innerHTML = String(html`<div class="page">${forbidden()}</div>`);
    return;
  }
  handlers = { acts: {}, forms: {}, changes: {} };
  const afters = [];
  const ctx = {
    params, query, env, title: '', back: null, wide: !!match.wide, hideNav: !!match.hideNav,
    act: (n, fn) => { handlers.acts[n] = fn; }, form: (n, fn) => { handlers.forms[n] = fn; }, change: (n, fn) => { handlers.changes[n] = fn; },
    after: (fn) => afters.push(fn),
  };
  if (!keepScroll || location.hash !== lastHash) main.setAttribute('aria-busy', 'true');
  const loadingTimer = setTimeout(() => { if (my === seq) main.classList.add('loading'); }, 250);
  let body;
  try {
    body = await match.screen(ctx);
  } catch (err) {
    if (err.status === 401 && err.code === 'UNAUTHENTICATED') { clearTimeout(loadingTimer); return sessionEnded(); }
    body = errorView(err);
  }
  clearTimeout(loadingTimer);
  if (my !== seq) return;
  const scrollY = window.scrollY;
  document.title = ctx.title ? `${ctx.title} · PRORESMAT` : 'PRORESMAT Health Connect';
  headEl.innerHTML = String(header(ctx, env));
  main.className = `${ctx.wide ? 'wide' : ''}`;
  main.innerHTML = String(html`<div class="page">${body}</div>`);
  main.removeAttribute('aria-busy');
  navEl.innerHTML = String(env && !ctx.hideNav ? nav(env, path) : '');
  document.body.classList.toggle('has-nav', !!(env && !ctx.hideNav));
  if (keepScroll && location.hash === lastHash) window.scrollTo(0, scrollY); else { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  lastHash = location.hash;
  for (const fn of afters) { try { fn(main); } catch (e) { console.error(e); } }
  updateBadges(env);
}

function header(ctx, env) {
  const backBtn = ctx.back ? html`<button type="button" class="icon-btn" data-go="${ctx.back}" aria-label="Back">${icon('back')}</button>` : html`<span class="brand">${logo(26)}</span>`;
  const bell = S.user ? html`<button type="button" class="icon-btn" data-go="#/notifications" aria-label="${t('notifications')}${S.unread ? `, ${S.unread} unread` : ''}">${icon('bell')}<span class="dot" id="unread" ${S.unread ? '' : raw('hidden')}>${S.unread > 9 ? '9+' : S.unread}</span></button>` : html`<button type="button" class="btn small ghost" data-go="#/login?next=${encodeURIComponent(location.hash)}">${t('signIn')}</button>`;
  const cart = env === 'c' || !env ? html`<button type="button" class="icon-btn" data-go="#/c/cart" aria-label="${t('cart')}">${icon('cart')}<span class="dot" id="cartcount" ${S.cartCount ? '' : raw('hidden')}>${S.cartCount}</span></button>` : '';
  const envTag = env && env !== 'c' ? html`<span class="env-tag">${ENVS[env].label}</span>` : '';
  return html`<div class="top-inner">${backBtn}<div class="top-title"><h1>${ctx.title || 'PRORESMAT'}</h1>${envTag}</div><div class="top-actions">${cart}${bell}</div></div>${when(S.info && S.info.mode === 'local' && !S.info.persistent, () => html`<div class="strip warn">This browser is blocking storage, so test data resets when you reload.</div>`)}`;
}

function nav(env, path) {
  const items = ENVS[env].nav.filter(([, , , roles]) => !roles || S.user?.roles.some((r) => roles.includes(r)));
  return html`<nav class="bottom-nav" aria-label="Main">${items.map(([key, href, ic]) => {
    const on = path.startsWith(href.slice(1)) || (key === 'consult' && env === 'c' && /^\/c\/(practitioner|book|booking)/.test(path)) || (key === 'products' && env === 'c' && /^\/c\/(product|clinic|cart)/.test(path)) || (key === 'orders' && env === 'c' && /^\/c\/(order|rx)/.test(path)) || (key === 'consult' && env === 'p' && /^\/p\/(consult|supervision)/.test(path)) || (key === 'patients' && /^\/p\/patient/.test(path)) || (key === 'orders' && env === 'v' && /^\/v\/(order|rx)/.test(path)) || (key === 'products' && env === 'v' && /^\/v\/product/.test(path)) || (key === 'profile' && env === 'c' && /^\/c\/(careplan|documents|payments|receipt|support|privacy|learn|article|report)/.test(path));
    return html`<a href="${href}" class="${on ? 'on' : ''}" ${on ? raw('aria-current="page"') : ''}>${icon(ic)}<span>${t(key)}</span></a>`;
  })}</nav>`;
}

async function updateBadges(env) {
  if (!S.user) return;
  try {
    const me = await api('auth.me');
    S.unread = me.unread;
    const u = document.getElementById('unread');
    if (u) { u.hidden = !S.unread; u.textContent = S.unread > 9 ? '9+' : S.unread; }
    if ((env === 'c' || !env) && S.user.roles.includes('customer')) {
      const cart = await api('cart.get');
      S.cartCount = cart.count;
      const c = document.getElementById('cartcount');
      if (c) { c.hidden = !S.cartCount; c.textContent = S.cartCount; }
    }
  } catch { /* badges are best effort */ }
}

const forbidden = () => html`<div class="empty">${icon('lock')}<p class="empty-title">This area is not part of your account</p><p class="muted">Switch to a workspace you have access to from your profile.</p><button class="btn primary" data-go="${homeFor(S.user)}">Go to my workspace</button></div>`;
export function errorView(err) {
  const offline = err.code === 'NETWORK';
  return html`<div class="empty">${icon(offline ? 'globe' : 'alert')}<p class="empty-title">${offline ? 'You are offline' : err.status === 404 ? 'Not available' : 'Something went wrong'}</p><p class="muted">${err.message}</p><div class="row center"><button class="btn primary" data-act="__retry">Try again</button><button class="btn ghost" data-go="${S.user ? homeFor(S.user) : '#/c/home'}">Go home</button></div></div>`;
}

export async function start() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetStack.length) sheetStack.at(-1).close(); });
  window.addEventListener('hashchange', () => { closeSheets(); render(); });
  const offline = document.getElementById('offline');
  const setOnline = () => { offline.hidden = navigator.onLine; };
  window.addEventListener('online', () => { setOnline(); toast('Back online.'); });
  window.addEventListener('offline', setOnline);
  setOnline();
  handlers.acts.__retry = () => render();
  document.addEventListener('click', (e) => { if (e.target.closest('[data-act="__retry"]')) render(); });
  try {
    S.info = await apiInfo();
    S.meta = await api('meta.get');
    await loadMe();
  } catch (e) {
    document.getElementById('main').innerHTML = String(errorView(e));
    return;
  }
  document.getElementById('boot')?.remove();
  render();
}

export { api, esc };
