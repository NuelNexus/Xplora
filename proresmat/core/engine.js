// PRORESMAT domain engine. The single authority for permissions, prices, commissions,
// payment verification, settlement eligibility and audit. The client never decides these.
import {
  AppError, fail, newId, randomToken, randomDigits, clone, DAY, isoDate, addDays, WEEKDAYS,
} from './util.js';
import { registerAuth } from './actions/auth.js';
import { registerCatalog } from './actions/catalog.js';
import { registerCare } from './actions/care.js';
import { registerCommerce } from './actions/commerce.js';
import { registerProviders } from './actions/providers.js';
import { registerAdmin } from './actions/admin.js';
import { seedDatabase } from './seed.js';

export const ROLES = ['customer', 'practitioner', 'supervisor', 'vendor', 'finance', 'support', 'admin'];
export const PRIVILEGED = ['supervisor', 'finance', 'support', 'admin'];
export const STAFF = ['finance', 'support', 'admin'];

export const LISTING_STATES = ['draft', 'submitted', 'under_review', 'changes_required', 'approved', 'suspended', 'expired', 'recalled'];
export const PROVIDER_STATES = ['draft', 'submitted', 'changes_required', 'active', 'suspended', 'deactivated'];

export const DEFAULT_SETTINGS = {
  currency: 'GHS',
  consultationCommissionPct: 15,
  productCommissionPct: 12,
  holdDaysConsultation: 3,
  holdDaysProduct: 7,
  deliveryFee: 2500, // pesewas
  slotHoldMinutes: 15,
  complaintWindowDays: 7,
  plusMonthlyFee: 3000,
  sessionIdleMinutes: 30,
  cancellation: { fullRefundHours: 24, partialRefundHours: 2, partialRefundPct: 50 },
};

export const DEFAULT_FLAGS = {
  conventionalPharmacy: false, // Phase 3: needs formal regulatory authorisation
  subscriptions: false, // premium features follow a clear value proposition
  videoConsultations: true,
  twi: true,
};

const COLLECTIONS = [
  'users', 'sessions', 'mfaChallenges', 'practitioners', 'orgs', 'products', 'bookings', 'payments',
  'ledger', 'earnings', 'refunds', 'disputes', 'payouts', 'orders', 'carts', 'checkouts', 'documents', 'docLinks',
  'carePlans', 'reviews', 'tickets', 'adverseEvents', 'careQueue', 'notifications', 'scheduled', 'outbox',
  'audit', 'loginHistory', 'privacyRequests', 'education', 'rxRequests', 'subscriptions', 'partnerFees',
  'idempotency',
];

export function emptyDb() {
  const db = { meta: { version: 1, clockOffsetMs: 0, seq: 1000, createdAt: Date.now(), lastTick: 0 }, settings: clone(DEFAULT_SETTINGS), flags: clone(DEFAULT_FLAGS) };
  for (const c of COLLECTIONS) db[c] = {};
  return db;
}

/**
 * @param {object} opts
 * @param {{load:()=>Promise<object|null>, save:(db:object)=>Promise<void>}} opts.store
 * @param {{put:(k:string,b:Uint8Array)=>Promise<void>, get:(k:string)=>Promise<Uint8Array|null>, del:(k:string)=>Promise<void>}} opts.blobs
 * @param {object} opts.config  { docKey (hex), demo (bool), paystack: { secretKey, callbackUrl, fetch } }
 */
export async function createEngine({ store, blobs, config = {} }) {
  let db = (await store.load()) || null;
  const E = { config, blobs, get db() { return db; } };
  const actions = {};

  // ---------- registry ----------
  E.action = (name, def) => {
    if (actions[name]) throw new Error('duplicate action ' + name);
    actions[name] = { name, auth: true, mutates: def.method !== 'GET', ...def };
  };

  // ---------- clock ----------
  E.now = () => Date.now() + (db?.meta.clockOffsetMs || 0);
  E.today = () => isoDate(E.now());
  E.nowIso = () => new Date(E.now()).toISOString();

  // ---------- collections ----------
  E.all = (c) => Object.values(db[c]);
  E.get = (c, id) => (id ? db[c][id] : undefined);
  E.must = (c, id, label = 'Record') => {
    const r = db[c][id];
    if (!r) fail('NOT_FOUND', `${label} not found.`, 404);
    return r;
  };
  E.insert = (c, rec) => { db[c][rec.id] = rec; return rec; };
  E.remove = (c, id) => { delete db[c][id]; };
  E.code = (prefix) => `${prefix}-${++db.meta.seq}`;

  // ---------- audit ----------
  E.audit = (ctx, action, entity, entityId, before, after, reason) => {
    const rec = {
      id: newId('aud'), at: E.nowIso(), actorId: ctx?.user?.id || 'system', actorName: ctx?.user?.name || 'System',
      actorRoles: ctx?.user?.roles || ['system'], action, entity, entityId,
      before: before === undefined ? null : clone(before), after: after === undefined ? null : clone(after), reason: reason || '',
    };
    E.insert('audit', rec);
    return rec;
  };

  // ---------- roles ----------
  E.hasRole = (user, ...roles) => !!user && roles.some((r) => user.roles.includes(r));
  E.requireRole = (ctx, ...roles) => {
    if (!ctx.user) fail('UNAUTHENTICATED', 'Please sign in to continue.', 401);
    if (!E.hasRole(ctx.user, ...roles)) fail('FORBIDDEN', 'Your account does not have permission for this action.', 403);
    return ctx.user;
  };

  // ---------- notifications (lock-screen safe: titles never contain health details) ----------
  E.notify = (userId, { title, body, link = '', kind = 'info' }) => {
    if (!userId) return;
    E.insert('notifications', { id: newId('ntf'), userId, title, body, link, kind, at: E.nowIso(), read: false });
    const u = db.users[userId];
    if (u) E.insert('outbox', { id: newId('msg'), at: E.nowIso(), channel: 'push', to: u.phone || u.email, userId, text: title });
  };
  E.schedule = (userId, dueAtMs, payload, key) => {
    if (dueAtMs < E.now() - 60000) return; // never send reminders for moments already passed
    if (key && E.all('scheduled').some((s) => s.key === key)) return;
    E.insert('scheduled', { id: newId('sch'), userId, dueAt: new Date(dueAtMs).toISOString(), sent: false, key: key || '', ...payload });
  };
  E.cancelScheduled = (keyPrefix) => {
    for (const s of E.all('scheduled')) if (!s.sent && s.key.startsWith(keyPrefix)) E.remove('scheduled', s.id);
  };
  E.sendMessage = (channel, to, text, userId) => E.insert('outbox', { id: newId('msg'), at: E.nowIso(), channel, to, text, userId: userId || '' });

  // ---------- double-entry ledger ----------
  // lines: [{account, debit, credit, memo}] - must balance.
  E.post = (ref, memo, lines) => {
    const dr = lines.reduce((s, l) => s + (l.debit || 0), 0);
    const cr = lines.reduce((s, l) => s + (l.credit || 0), 0);
    if (dr !== cr) throw new Error(`Unbalanced ledger posting ${memo}: ${dr} != ${cr}`);
    const txnId = newId('txn');
    const at = E.nowIso();
    for (const l of lines) {
      if (!l.debit && !l.credit) continue;
      E.insert('ledger', { id: newId('led'), txnId, at, account: l.account, debit: l.debit || 0, credit: l.credit || 0, memo: l.memo || memo, ref: clone(ref) });
    }
    return txnId;
  };
  E.providerAccount = (earning) => `payable:${earning.beneficiaryType}:${earning.beneficiaryId}`;

  // ---------- users ----------
  E.publicUser = (u) => u && ({
    id: u.id, name: u.name, email: u.email, phone: u.phone, roles: u.roles, lang: u.lang, status: u.status,
    practitionerId: u.practitionerId || null, orgId: u.orgId || null, health: u.health || {}, address: u.address || '',
    dob: u.dob || '', createdAt: u.createdAt, consentAt: u.consentAt, plusUntil: u.plusUntil || null,
    isPlus: !!(u.plusUntil && Date.parse(u.plusUntil) > E.now()),
  });

  // ---------- practitioner & product visibility (acceptance criteria 1 & 2) ----------
  E.practitionerBookable = (p) => {
    if (!p || p.status !== 'active') return false;
    if (!p.licenceExpiry || p.licenceExpiry < E.today()) return false;
    if (p.facility?.licenceExpiry && p.facility.licenceExpiry < E.today()) return false;
    const u = db.users[p.userId];
    return !!u && u.status === 'active';
  };
  E.orgActive = (o) => !!o && o.status === 'active' && (!o.licenceExpiry || o.licenceExpiry >= E.today());
  E.productPurchasable = (p) => {
    if (!p || p.status !== 'approved') return false;
    if (!p.fdaExpiry || p.fdaExpiry < E.today()) return false;
    return E.orgActive(db.orgs[p.orgId]);
  };
  E.sellerLabel = (orgId) => {
    const o = db.orgs[orgId];
    if (!o) return 'Unknown seller';
    return o.type === 'proresmat' ? 'Sold by PRORESMAT' : `Sold by ${o.name}`;
  };
  E.classLabel = (p) => (p.providerClass === 'supervised' ? 'PRORESMAT-supervised' : 'Verified independent');

  // ---------- earnings & settlement eligibility ----------
  E.createEarning = (fields) => E.insert('earnings', {
    id: newId('ern'), status: 'pending', holds: [], adjustments: 0, createdAt: E.nowIso(), eligibleAt: null, payoutId: null, ...fields,
  });
  E.earningsFor = (sourceType, sourceId) => E.all('earnings').filter((e) => e.sourceType === sourceType && e.sourceId === sourceId);
  E.addHold = (sourceType, sourceId, hold) => {
    for (const e of E.earningsFor(sourceType, sourceId)) {
      if (e.status === 'paid' || e.status === 'void') continue;
      if (!e.holds.includes(hold)) e.holds.push(hold);
      e.status = 'on_hold';
    }
  };
  E.releaseHold = (sourceType, sourceId, hold) => {
    for (const e of E.earningsFor(sourceType, sourceId)) {
      e.holds = e.holds.filter((h) => h !== hold);
      if (e.status === 'on_hold' && e.holds.length === 0) e.status = 'pending';
    }
  };
  E.netOf = (e) => e.gross - e.commission + e.adjustments;

  // A provider is never paid for a cancelled transaction: any provider share still owed moves to the platform.
  E.voidEarnings = (sourceType, sourceId, reason) => {
    for (const e of E.earningsFor(sourceType, sourceId)) {
      if (e.status === 'paid' || e.status === 'void') continue;
      const remaining = E.netOf(e);
      if (remaining > 0) {
        E.post({ earningId: e.id, [sourceType + 'Id']: sourceId }, `Provider share released: ${reason}`, [
          { account: E.providerAccount(e), debit: remaining }, { account: 'revenue:cancellation_fees', credit: remaining },
        ]);
        e.adjustments -= remaining;
      }
      e.status = 'void';
      e.voidReason = reason;
    }
  };

  // Re-evaluates whether each unpaid earning is eligible for payout.
  E.evaluateEarnings = () => {
    const now = E.now();
    const s = db.settings;
    for (const e of E.all('earnings')) {
      if (e.status === 'paid' || e.status === 'void') continue;
      if (e.sourceType !== 'adjustment' && E.netOf(e) <= 0) { e.status = 'void'; continue; }
      if (e.holds.length) { e.status = 'on_hold'; continue; }
      let ready = false;
      if (e.sourceType === 'booking') {
        const b = db.bookings[e.sourceId];
        const documented = !!(b?.notes && b.notes.assessment);
        // A documented no-show is payable too: the slot was reserved and the late-cancellation policy applies.
        if (b && ['completed', 'no_show'].includes(b.status) && documented && b.completedAt) {
          const due = Date.parse(b.completedAt) + s.holdDaysConsultation * DAY;
          e.eligibleAt = new Date(due).toISOString();
          ready = now >= due;
        }
      } else if (e.sourceType === 'order') {
        const o = db.orders[e.sourceId];
        const deliveredAt = o && (o.acknowledgedAt || o.deliveredAt);
        if (deliveredAt && o.status !== 'cancelled') {
          const due = Date.parse(deliveredAt) + s.holdDaysProduct * DAY;
          e.eligibleAt = new Date(due).toISOString();
          ready = now >= due;
        }
      } else {
        ready = true; // carried-forward negative adjustments net against the next payout
      }
      e.status = ready ? 'eligible' : 'pending';
    }
  };

  // Reduce provider earnings when money goes back to a customer. Returns {providerPortion, platformPortion}.
  E.applyRefundToEarnings = (sourceType, sourceId, refundAmount, gross, refundId) => {
    const earnings = E.earningsFor(sourceType, sourceId);
    if (!earnings.length || !gross) return { providerPortion: 0, platformPortion: refundAmount };
    const e = earnings[0];
    const providerShare = e.gross - e.commission;
    let providerPortion = Math.round((refundAmount * providerShare) / gross);
    if (e.status === 'void') providerPortion = 0; // already released to the platform on cancellation
    else if (e.status !== 'paid') providerPortion = Math.min(providerPortion, Math.max(0, E.netOf(e)));
    if (providerPortion === 0) return { providerPortion: 0, platformPortion: refundAmount };
    if (e.status === 'paid') {
      // Already paid out: carry a negative adjustment into the next settlement.
      E.createEarning({ beneficiaryType: e.beneficiaryType, beneficiaryId: e.beneficiaryId, sourceType: 'adjustment', sourceId: refundId, gross: 0, commission: 0, adjustments: -providerPortion, label: `Refund adjustment for ${e.label}`, status: 'eligible' });
    } else {
      e.adjustments -= providerPortion;
      e.adjustmentLog = e.adjustmentLog || [];
      e.adjustmentLog.push({ at: E.nowIso(), amount: -providerPortion, reason: 'refund', refundId });
    }
    return { providerPortion, platformPortion: refundAmount - providerPortion };
  };

  // ---------- payments: server-side finalisation (idempotent) ----------
  E.paymentHandlers = {}; // purpose -> { onSuccess(payment, ctx), describe(payment) }
  E.finalizePayment = async (reference, gateway) => {
    const pay = E.all('payments').find((p) => p.reference === reference);
    if (!pay) fail('NOT_FOUND', 'Payment reference not recognised.', 404);
    if (pay.status === 'success' || pay.status === 'duplicate_refunded') return pay; // idempotent
    pay.gateway = { ...(pay.gateway || {}), ...clone(gateway) };
    if (gateway.status !== 'success') {
      pay.status = 'failed';
      pay.failedAt = E.nowIso();
      pay.failureReason = gateway.gateway_response || 'Payment was not completed.';
      E.audit(null, 'payment.failed', 'payment', pay.id, null, { reference, reason: pay.failureReason });
      return pay;
    }
    if (gateway.amount !== pay.amount || (gateway.currency || 'GHS') !== pay.currency) {
      pay.status = 'failed';
      pay.failureReason = 'Amount or currency mismatch. Flagged for reconciliation.';
      E.insert('careQueue', { id: newId('cq'), type: 'payment_mismatch', status: 'open', createdAt: E.nowIso(), paymentId: pay.id, summary: `Paystack amount ${gateway.amount} does not match expected ${pay.amount}` });
      E.audit(null, 'payment.mismatch', 'payment', pay.id, null, { reference, gatewayAmount: gateway.amount });
      return pay;
    }
    const handler = E.paymentHandlers[pay.purpose];
    // Duplicate payment: the target was already paid through another reference.
    if (handler.alreadyPaid(pay)) {
      E.receiveAndRefund(pay, 'Duplicate payment detected automatically', 'duplicate_payment');
      pay.status = 'duplicate_refunded';
      E.audit(null, 'payment.duplicate_refunded', 'payment', pay.id, null, { reference }, 'Duplicate payment');
      return pay;
    }
    pay.status = 'success';
    pay.paidAt = E.nowIso();
    pay.channel = gateway.channel || pay.channel;
    pay.receiptNo = E.code('RCT');
    await handler.onSuccess(pay);
    E.audit(null, 'payment.success', 'payment', pay.id, null, { reference, amount: pay.amount, allocations: pay.allocations });
    return pay;
  };

  // ---------- periodic jobs (licence expiry, reminders, slot holds, settlement eligibility) ----------
  E.tick = () => {
    const today = E.today();
    const now = E.now();
    // Expired regulatory evidence automatically blocks sales.
    for (const p of E.all('products')) {
      if (p.status === 'approved' && p.fdaExpiry && p.fdaExpiry < today) {
        const before = { status: p.status };
        p.status = 'expired';
        p.statusHistory.push({ status: 'expired', at: E.nowIso(), by: 'system', reason: 'FDA registration expired' });
        E.audit(null, 'product.expired', 'product', p.id, before, { status: 'expired' }, 'FDA registration expired');
        const o = db.orgs[p.orgId];
        if (o?.ownerId) E.notify(o.ownerId, { title: 'Listing blocked', body: `${p.name} is no longer on sale because its FDA registration expired on ${p.fdaExpiry}. Upload renewed evidence and resubmit.`, link: '#/v/products', kind: 'compliance' });
      }
    }
    // Licence reminders 30 days ahead; practitioners with expired licences drop out of search via practitionerBookable.
    for (const p of E.all('practitioners')) {
      if (p.status !== 'active' || !p.licenceExpiry) continue;
      const days = Math.round((Date.parse(p.licenceExpiry) - Date.parse(today)) / DAY);
      if (days <= 30 && days >= 0) E.schedule(p.userId, now, { title: 'Licence renewal reminder', body: `Your registration licence expires on ${p.licenceExpiry}. Renew it to keep receiving bookings.`, link: '#/p/profile', kind: 'compliance' }, `lic:${p.id}:${p.licenceExpiry}`);
      if (days < 0) E.schedule(p.userId, now, { title: 'Profile hidden', body: 'Your licence has expired, so your profile is hidden from search and new bookings are blocked until PRORESMAT verifies a renewal.', link: '#/p/profile', kind: 'compliance' }, `licx:${p.id}:${p.licenceExpiry}`);
    }
    for (const o of E.all('orgs')) {
      if (o.status !== 'active' || !o.licenceExpiry || !o.ownerId) continue;
      const days = Math.round((Date.parse(o.licenceExpiry) - Date.parse(today)) / DAY);
      if (days <= 30 && days >= 0) E.schedule(o.ownerId, now, { title: 'Facility licence reminder', body: `Your facility licence expires on ${o.licenceExpiry}.`, link: '#/v/compliance', kind: 'compliance' }, `olic:${o.id}:${o.licenceExpiry}`);
    }
    // Release unpaid slot holds.
    for (const b of E.all('bookings')) {
      if (b.status === 'pending_payment' && Date.parse(b.holdUntil) < now) {
        b.status = 'expired';
        E.cancelScheduled(`bk:${b.id}`);
      }
    }
    for (const o of E.all('orders')) {
      if (o.status === 'pending_payment' && Date.parse(o.holdUntil) < now) { o.status = 'expired'; E.releaseOrderStock(o); }
    }
    // Deliver due reminders.
    for (const s of E.all('scheduled')) {
      if (!s.sent && Date.parse(s.dueAt) <= now) {
        s.sent = true;
        E.notify(s.userId, { title: s.title, body: s.body, link: s.link, kind: s.kind || 'reminder' });
      }
    }
    // Expire subscriptions.
    for (const u of E.all('users')) if (u.plusUntil && Date.parse(u.plusUntil) <= now) u.plusUntil = null;
    // Clean up expired sessions, links and challenges.
    for (const s of E.all('sessions')) if (Date.parse(s.expiresAt) < now) E.remove('sessions', s.id);
    for (const l of E.all('docLinks')) if (Date.parse(l.expiresAt) < now) E.remove('docLinks', l.id);
    for (const c of E.all('mfaChallenges')) if (Date.parse(c.expiresAt) < now) E.remove('mfaChallenges', c.id);
    E.evaluateEarnings();
    db.meta.lastTick = now;
  };

  // ---------- session resolution ----------
  E.resolveSession = (token) => {
    if (!token) return null;
    const s = db.sessions[token];
    if (!s) return null;
    const now = E.now();
    if (Date.parse(s.expiresAt) < now) { E.remove('sessions', token); return null; }
    const u = db.users[s.userId];
    if (!u || u.status !== 'active') return null;
    s.lastSeen = new Date(now).toISOString();
    s.expiresAt = new Date(now + db.settings.sessionIdleMinutes * 60000).toISOString();
    return { session: s, user: u };
  };

  // helpers reused by action modules
  Object.assign(E, { fail, newId, randomToken, randomDigits, clone, DAY, isoDate, addDays, WEEKDAYS });

  registerAuth(E);
  registerCatalog(E);
  registerCare(E);
  registerCommerce(E);
  registerProviders(E);
  registerAdmin(E);

  E.action('meta.routes', { method: 'GET', path: '/routes', auth: false, fn: () => Object.fromEntries(Object.values(actions).filter((a) => !a.raw || a.name === 'documents.fetch').map((a) => [a.name, [a.method, a.path]])) });

  // demo / environment utilities
  E.action('demo.status', { method: 'GET', path: '/demo', auth: false, fn: () => ({ demo: !!config.demo, clockOffsetDays: Math.round(db.meta.clockOffsetMs / DAY), now: E.nowIso() }) });
  E.action('demo.advanceClock', {
    method: 'POST', path: '/demo/clock', auth: false,
    fn: (p) => {
      if (!config.demo) fail('FORBIDDEN', 'Clock control is only available in demo mode.', 403);
      const days = Number(p.days);
      if (!Number.isFinite(days) || days < 0 || days > 60) fail('VALIDATION', 'Days must be between 0 and 60.', 422);
      db.meta.clockOffsetMs += Math.round(days * DAY);
      E.tick();
      return { now: E.nowIso(), clockOffsetDays: +(db.meta.clockOffsetMs / DAY).toFixed(2) };
    },
  });
  E.action('demo.outbox', {
    method: 'GET', path: '/demo/outbox', auth: false,
    fn: () => {
      if (!config.demo) fail('FORBIDDEN', 'The message outbox is only visible in demo mode.', 403);
      return E.all('outbox').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
    },
  });
  E.action('demo.reset', {
    method: 'POST', path: '/demo/reset', auth: false,
    fn: async () => {
      if (!config.demo) fail('FORBIDDEN', 'Reset is only available in demo mode.', 403);
      await reseed();
      return { ok: true };
    },
  });

  // Direct invocation for seeding (bypasses the queue, role gate and persistence).
  E.invoke = async (name, params, user) => actions[name].fn(params || {}, { user, session: null, token: '', ip: '', device: 'Seed', internal: true });

  async function reseed() {
    db = emptyDb();
    await seedDatabase(E);
    db.meta.clockOffsetMs = 0;
    E.tick();
    await store.save(db);
  }

  // ---------- dispatch (serialised so async crypto never interleaves writes) ----------
  let queue = Promise.resolve();
  async function run(name, params, meta) {
    const def = actions[name];
    if (!def) fail('NOT_FOUND', `Unknown action ${name}.`, 404);
    let ticked = false;
    if (db.meta.lastTick < E.now() - 60000) { E.tick(); ticked = true; }
    const resolved = E.resolveSession(meta.token);
    const ctx = { user: resolved?.user || null, session: resolved?.session || null, token: meta.token, ip: meta.ip || '', device: meta.device || 'Unknown device', internal: !!meta.internal };
    if (def.auth && !ctx.user) fail('UNAUTHENTICATED', 'Your session has ended. Please sign in again.', 401);
    if (def.roles && !meta.internal) E.requireRole(ctx, ...def.roles);
    const snapshot = def.mutates ? JSON.stringify(db) : null;
    try {
      const result = await def.fn(params || {}, ctx);
      if (def.mutates || ticked) await store.save(db);
      return result === undefined ? { ok: true } : clone(result);
    } catch (err) {
      // Roll back partial writes so a failed request never leaves half-applied state.
      if (err.persist) await store.save(db);
      else if (snapshot) db = JSON.parse(snapshot);
      throw err;
    }
  }
  function call(name, params = {}, meta = {}) {
    const p = queue.then(() => run(name, params, meta));
    queue = p.catch(() => {});
    return p;
  }

  if (!db) await reseed();
  else E.tick();

  return {
    call,
    actions: () => Object.values(actions).map(({ name, method, path, auth }) => ({ name, method, path, auth })),
    routeTable: () => Object.values(actions).map(({ name, method, path, raw }) => ({ name, method, path, raw: !!raw })),
    internals: E, // for tests and the HTTP layer (file streaming, webhooks)
    get db() { return db; },
  };
}

export { AppError };
