// Engine tests: the acceptance criteria from the reconciled report (section 12.1) plus core workflows.
// Run with: node --test test/
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../core/engine.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let eng;
const tokens = {};

async function fresh() {
  const blobs = new Map();
  eng = await createEngine({
    store: { load: async () => null, save: async () => {} },
    blobs: { put: async (k, b) => blobs.set(k, b), get: async (k) => blobs.get(k) || null, del: async (k) => blobs.delete(k) },
    config: { demo: true, docKey: 'ab'.repeat(32) },
  });
  for (const k of Object.keys(tokens)) delete tokens[k];
}
async function as(email) {
  if (tokens[email]) return tokens[email];
  let r = await eng.call('auth.login', { email, password: 'Demo@1234' });
  if (r.mfaRequired) r = await eng.call('auth.verifyMfa', { challengeId: r.challengeId, code: r.demoCode });
  tokens[email] = r.token;
  return r.token;
}
const call = async (email, name, params = {}) => eng.call(name, params, { token: email ? await as(email) : undefined });
const rejects = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`); return true; });
const E = () => eng.internals;
const slotFor = async (pracId) => {
  const { days } = await call(null, 'practitioners.slots', { id: pracId });
  for (const d of days) for (const s of d.slots) if (s.available) return s.start;
  throw new Error('no slot');
};
async function bookAndPay(email, pracId, mode = 'telephone') {
  const b = await call(email, 'bookings.create', { practitionerId: pracId, mode, start: await slotFor(pracId), reason: 'Headaches for two weeks', screening: { redFlags: [] }, consent: true, policyAccepted: true });
  const init = await call(email, 'payments.initialize', { purpose: 'booking', targetId: b.id, channel: 'card' });
  const pay = await call(email, 'payments.sandboxComplete', { reference: init.reference, outcome: 'success', card: '4084084084084081' });
  return { booking: b, pay, init };
}
const reconcileOk = async () => {
  const r = await call('finance@demo.gh', 'admin.reconcile');
  assert.deepEqual(r.issues.filter((i) => i.severity !== 'info'), [], JSON.stringify(r.issues));
};

before(fresh);

test('seed data reconciles: ledger balanced and payables equal unpaid earnings', async () => {
  await reconcileOk();
});

test('AC1: unverified or expired practitioners are hidden and cannot be booked', async () => {
  const list = await call(null, 'practitioners.search');
  const ids = list.map((p) => p.id);
  assert.ok(!ids.includes('prc_yaw'), 'expired licence hidden');
  assert.ok(!ids.includes('prc_abena'), 'submitted (unverified) hidden');
  assert.ok(ids.includes('prc_kwame'));
  await rejects(call(null, 'practitioners.get', { id: 'prc_yaw' }), 'NOT_FOUND');
  await rejects(call('akosua@demo.gh', 'bookings.create', { practitionerId: 'prc_yaw', mode: 'telephone', start: new Date(Date.now() + 86400000).toISOString(), reason: 'Test reason', consent: true, policyAccepted: true }), 'NOT_BOOKABLE');
  // Suspending a practitioner removes them immediately.
  await call('admin@demo.gh', 'admin.setPractitionerStatus', { id: 'prc_efua', action: 'suspend', reason: 'Investigation' });
  assert.ok(!(await call(null, 'practitioners.search')).some((p) => p.id === 'prc_efua'));
  await call('admin@demo.gh', 'admin.setPractitionerStatus', { id: 'prc_efua', action: 'reactivate', reason: 'Cleared' });
  assert.ok((await call(null, 'practitioners.search')).some((p) => p.id === 'prc_efua'));
});

test('AC2: unapproved, expired, suspended or recalled products cannot be purchased', async () => {
  for (const id of ['prd_garlic', 'prd_sleep', 'prd_bitter', 'prd_jointrub']) {
    await rejects(call('akosua@demo.gh', 'cart.setItem', { productId: id, qty: 1 }), 'NOT_PURCHASABLE');
  }
  assert.equal(E().db.products.prd_bitter.status, 'expired', 'expired FDA registration auto-expires listing');
  // A product in the cart that gets suspended is blocked at checkout.
  await call('kojo@demo.gh', 'cart.setItem', { productId: 'prd_ginger', qty: 1 });
  await call('admin@demo.gh', 'admin.setProductStatus', { id: 'prd_ginger', action: 'suspend', reason: 'Label check' });
  const cart = await call('kojo@demo.gh', 'cart.get');
  assert.ok(!cart.groups.some((g) => g.lines.some((l) => l.productId === 'prd_ginger')), 'removed from carts');
  await call('admin@demo.gh', 'admin.setProductStatus', { id: 'prd_ginger', action: 'reinstate', reason: 'Label fixed' });
});

test('AC3 + AC4: checkout identifies seller; each payment has a unique record and reference', async () => {
  await call('akosua@demo.gh', 'cart.setItem', { productId: 'prd_cryptolepis', qty: 1 });
  await call('akosua@demo.gh', 'cart.setItem', { productId: 'prd_neem', qty: 1 });
  const cart = await call('akosua@demo.gh', 'cart.get');
  assert.deepEqual(cart.groups.map((g) => g.seller).sort(), ['Sold by Nkabom Herbal Clinic', 'Sold by PRORESMAT']);
  const chk = await call('akosua@demo.gh', 'checkout.create', { deliveryMethod: 'delivery', address: 'House 14, Abelemkpe Road, Accra', termsAccepted: true });
  assert.equal(chk.orders.length, 2, 'one order per seller');
  assert.ok(chk.orders.every((o) => /^Sold by /.test(o.seller)));
  const init = await call('akosua@demo.gh', 'payments.initialize', { purpose: 'checkout', targetId: chk.checkoutId, channel: 'mobile_money' });
  const paid = await call('akosua@demo.gh', 'payments.sandboxComplete', { reference: init.reference, outcome: 'success', provider: 'mtn', phone: '0244123456' });
  assert.equal(paid.status, 'success');
  assert.ok(paid.receiptNo);
  assert.match(paid.provider, /Nkabom/);
  const refs = Object.values(E().db.payments).map((p) => p.reference);
  assert.equal(new Set(refs).size, refs.length, 'references unique');
  // Idempotent finalisation: a repeated webhook/verify does not double-post.
  const ledgerBefore = Object.keys(E().db.ledger).length;
  await E().finalizePayment(init.reference, { status: 'success', amount: chk.total, currency: 'GHS', channel: 'mobile_money' });
  assert.equal(Object.keys(E().db.ledger).length, ledgerBefore);
  // Same idempotency key returns the same initialisation.
  const b = await call('kojo@demo.gh', 'bookings.create', { practitionerId: 'prc_kofi', mode: 'video', start: await slotFor('prc_kofi'), reason: 'Blood pressure review', consent: true, policyAccepted: true });
  const a1 = await call('kojo@demo.gh', 'payments.initialize', { purpose: 'booking', targetId: b.id, idempotencyKey: 'k-1' });
  const a2 = await call('kojo@demo.gh', 'payments.initialize', { purpose: 'booking', targetId: b.id, idempotencyKey: 'k-1' });
  assert.equal(a1.reference, a2.reference);
  await reconcileOk();
});

test('duplicate payment for the same booking is refunded automatically', async () => {
  const b = await call('akosua@demo.gh', 'bookings.create', { practitionerId: 'prc_ama', mode: 'telephone', start: await slotFor('prc_ama'), reason: 'Sleep problems', consent: true, policyAccepted: true });
  const i1 = await call('akosua@demo.gh', 'payments.initialize', { purpose: 'booking', targetId: b.id });
  const i2 = await call('akosua@demo.gh', 'payments.initialize', { purpose: 'booking', targetId: b.id });
  await call('akosua@demo.gh', 'payments.sandboxComplete', { reference: i1.reference, card: '4084084084084081' });
  const dup = await call('akosua@demo.gh', 'payments.sandboxComplete', { reference: i2.reference, card: '4084084084084081' });
  assert.equal(dup.status, 'duplicate_refunded');
  assert.equal(dup.refunded, dup.amount);
  await reconcileOk();
});

test('AC5 + AC6: refunds adjust settlement; cancelled/refunded/disputed items are never paid', async () => {
  // Customer cancels ≥24h ahead: full refund, provider earning voided.
  const { booking } = await bookAndPay('kojo@demo.gh', 'prc_efua');
  const q = await call('kojo@demo.gh', 'bookings.cancelQuote', { id: booking.id });
  const res = await call('kojo@demo.gh', 'bookings.cancel', { id: booking.id });
  const earning = E().earningsFor('booking', booking.id)[0];
  assert.equal(earning.status, 'void');
  assert.equal(res.refund, q.refund);
  // Provider cancellation: full refund.
  const { booking: b2 } = await bookAndPay('akosua@demo.gh', 'prc_efua');
  await call('efua@demo.gh', 'consult.providerCancel', { id: b2.id, reason: 'Family emergency' });
  const p2 = E().db.payments[E().db.bookings[b2.id].paymentId];
  assert.equal(p2.refunded, p2.amount);
  assert.equal(E().earningsFor('booking', b2.id)[0].status, 'void');
  // Partial refund on the seeded eligible consultation reduces the provider net.
  const ern = Object.values(E().db.earnings).find((e) => e.status === 'eligible' && e.sourceType === 'booking');
  const before = E().netOf(ern);
  const payId = E().db.bookings[ern.sourceId].paymentId;
  await call('finance@demo.gh', 'admin.refund', { paymentId: payId, amountGhs: '20', rule: 'service_recovery', reason: 'Call started late' });
  assert.equal(E().netOf(ern), before - Math.round(2000 * (ern.gross - ern.commission) / ern.gross));
  // Chargeback freezes the settlement.
  const orderErn = Object.values(E().db.earnings).find((e) => e.status === 'eligible' && e.sourceType === 'order');
  const orderPay = E().db.orders[orderErn.sourceId].paymentId;
  const d = await call('finance@demo.gh', 'admin.openDispute', { paymentId: orderPay, reason: 'Customer bank dispute' });
  assert.equal(E().db.earnings[orderErn.id].status, 'on_hold');
  const run = await call('finance@demo.gh', 'admin.runSettlement');
  assert.ok(!run.payouts.some((p) => p.earningIds.includes(orderErn.id)), 'held earning not paid');
  assert.ok(run.payouts.some((p) => p.earningIds.includes(ern.id)), 'eligible earning paid');
  assert.ok(!run.payouts.some((p) => p.earningIds.some((id) => E().db.earnings[id].status === 'void')));
  await call('finance@demo.gh', 'admin.resolveDispute', { id: d.id, outcome: 'lost', reason: 'Issuer ruled for customer' });
  assert.equal(E().db.earnings[orderErn.id].status, 'void');
  await reconcileOk();
});

test('refund after payout carries a negative adjustment into the next settlement', async () => {
  const paid = Object.values(E().db.earnings).find((e) => e.status === 'paid' && e.sourceType === 'booking');
  const payId = E().db.bookings[paid.sourceId].paymentId;
  await call('finance@demo.gh', 'admin.refund', { paymentId: payId, amountGhs: '10', reason: 'Goodwill' });
  const adj = Object.values(E().db.earnings).find((e) => e.sourceType === 'adjustment' && e.beneficiaryId === paid.beneficiaryId);
  assert.ok(adj && adj.adjustments < 0);
  await reconcileOk();
});

test('AC7: customers can access receipts, history and support', async () => {
  const pays = await call('akosua@demo.gh', 'payments.list');
  assert.ok(pays.length > 0 && pays.every((p) => p.reference));
  const rec = await call('akosua@demo.gh', 'payments.get', { reference: pays[0].reference });
  assert.ok(rec.lines.length && rec.provider);
  assert.ok((await call('akosua@demo.gh', 'bookings.list')).length);
  assert.ok((await call('akosua@demo.gh', 'orders.list')).length);
  const t = await call('akosua@demo.gh', 'tickets.create', { kind: 'support', category: 'payment', subject: 'Receipt question', message: 'Please explain the delivery fee.' });
  assert.equal(t.status, 'open');
  await rejects(call('kojo@demo.gh', 'payments.get', { reference: pays[0].reference }), 'NOT_FOUND');
});

test('AC8: practitioner documents consultation, referral, follow-up and adverse events', async () => {
  const b = Object.values(E().db.bookings).find((x) => x.practitionerId === 'prc_kwame' && x.status === 'confirmed' && Date.parse(x.start) - Date.now() < 30 * 60000);
  assert.ok(b, 'seeded consultation starting soon');
  await call('kwame@demo.gh', 'consult.start', { id: b.id });
  await rejects(call('kwame@demo.gh', 'consult.complete', { id: b.id }), 'DOCUMENTATION_REQUIRED');
  await call('kwame@demo.gh', 'consult.document', { id: b.id, assessment: 'Morning stiffness, improving', plan: 'Continue exercises', followUpDate: '2026-12-01', referral: { to: 'Komfo Anokye Teaching Hospital', reason: 'Knee X-ray', urgency: 'urgent' } });
  await call('kwame@demo.gh', 'consult.carePlan', { id: b.id, items: [{ productId: 'prd_ginger', dosage: '1 cup', frequency: 'daily' }], advice: 'Keep walking daily.' });
  await call('kwame@demo.gh', 'adverse.create', { bookingId: b.id, kind: 'interaction', severity: 'moderate', description: 'Possible interaction between ginger tea and aspirin.' });
  await call('kwame@demo.gh', 'consult.complete', { id: b.id });
  assert.equal(E().db.bookings[b.id].status, 'completed');
  assert.ok(Object.values(E().db.careQueue).some((q) => q.bookingId === b.id && q.type === 'referral'));
  // Traditional practitioner cannot issue a prescription (professional-scope control).
  await rejects(call('kwame@demo.gh', 'consult.carePlan', { id: b.id, type: 'prescription', advice: 'x' }), 'SCOPE');
});

test('red-flag screening blocks booking and queues follow-up', async () => {
  const n = Object.values(E().db.careQueue).length;
  await rejects(call('akosua@demo.gh', 'bookings.create', { practitionerId: 'prc_ama', mode: 'telephone', start: await slotFor('prc_ama'), reason: 'Chest pain', screening: { redFlags: ['chest_pain'] }, consent: true, policyAccepted: true }), 'RED_FLAG');
  assert.equal(Object.values(E().db.careQueue).length, n + 1);
});

test('AC9: approvals, suspensions, refunds and settlements are audited', async () => {
  await call('admin@demo.gh', 'admin.setPractitionerStatus', { id: 'prc_abena', action: 'approve', providerClass: 'independent', reason: 'Credentials verified' });
  await call('admin@demo.gh', 'admin.setOrgStatus', { id: 'org_adwoa', action: 'approve', reason: 'Licence verified' });
  await call('admin@demo.gh', 'admin.setProductStatus', { id: 'prd_garlic', action: 'approve', reason: 'Label and FDA entry verified' });
  const actions = Object.values(E().db.audit).map((a) => a.action);
  for (const a of ['practitioner.approve', 'org.approve', 'product.approve', 'practitioner.suspend', 'product.suspend', 'refund.processed', 'settlement.created', 'dispute.opened']) assert.ok(actions.includes(a), a);
  const rec = Object.values(E().db.audit).find((a) => a.action === 'practitioner.approve');
  assert.ok(rec.actorName && rec.at && rec.reason && rec.before && rec.after);
  assert.ok((await call(null, 'practitioners.search')).some((p) => p.id === 'prc_abena'), 'approved practitioner now visible');
  // Approval without a reason is rejected.
  await rejects(call('admin@demo.gh', 'admin.setProductStatus', { id: 'prd_moringa', action: 'suspend' }), 'VALIDATION');
});

test('AC10: sensitive health information is visible only to authorised roles', async () => {
  const b = Object.values(E().db.bookings).find((x) => x.customerId === 'usr_akosua' && x.practitionerId === 'prc_ama' && x.status === 'completed');
  const doc = await call('akosua@demo.gh', 'documents.upload', { name: 'lab.png', mime: 'image/png', kind: 'lab', dataB64: PNG });
  await call('akosua@demo.gh', 'bookings.shareDocuments', { id: b.id, docIds: [doc.id] });
  const link = await call('ama@demo.gh', 'documents.link', { id: doc.id });
  const file = await eng.call('documents.fetch', { token: link.token });
  assert.equal(file.dataB64, PNG, 'decrypts to the original');
  for (const who of ['kofi@demo.gh', 'finance@demo.gh', 'admin@demo.gh', 'clinic@demo.gh']) await rejects(call(who, 'documents.link', { id: doc.id }), 'FORBIDDEN');
  const asOther = await call('kofi@demo.gh', 'bookings.get', { id: b.id }).catch((e) => e);
  assert.equal(asOther.code, 'FORBIDDEN');
  const asFinance = await call('finance@demo.gh', 'bookings.get', { id: b.id });
  assert.equal(asFinance.notes, undefined, 'finance cannot see clinical notes');
  assert.equal(asFinance.reason, undefined);
  assert.ok((await call('kofi@demo.gh', 'practitioner.patient', { id: 'usr_akosua' })).name, 'treating practitioner can open the record');
  await rejects(call('ama@demo.gh', 'practitioner.patient', { id: 'usr_kojo' }), 'FORBIDDEN');
  // Wrong content type is rejected; EICAR test signature is rejected.
  await rejects(call('akosua@demo.gh', 'documents.upload', { name: 'x.pdf', mime: 'application/pdf', dataB64: PNG }), 'FILE_TYPE_MISMATCH');
  const eicar = btoa('%PDF-1.4 X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
  await rejects(call('akosua@demo.gh', 'documents.upload', { name: 'x.pdf', mime: 'application/pdf', dataB64: eicar }), 'FILE_REJECTED');
  // Role gates.
  await rejects(call('akosua@demo.gh', 'admin.finance'), 'FORBIDDEN');
  await rejects(call('support@demo.gh', 'admin.finance'), 'FORBIDDEN');
  await rejects(call('finance@demo.gh', 'admin.approvals'), 'FORBIDDEN');
  await rejects(call('clinic@demo.gh', 'vendor.advanceOrder', { id: Object.values(E().db.orders).find((o) => o.orgId === 'org_proresmat').id, status: 'accepted' }), 'FORBIDDEN');
});

test('vendor fulfilment workflow, partial refund and settlement after hold period', async () => {
  await call('kojo@demo.gh', 'cart.setItem', { productId: 'prd_prekese', qty: 2 });
  await call('kojo@demo.gh', 'cart.setItem', { productId: 'prd_neem', qty: 1 });
  const chk = await call('kojo@demo.gh', 'checkout.create', { deliveryMethod: 'pickup', termsAccepted: true });
  const init = await call('kojo@demo.gh', 'payments.initialize', { purpose: 'checkout', targetId: chk.checkoutId, channel: 'mobile_money' });
  await call('kojo@demo.gh', 'payments.sandboxComplete', { reference: init.reference, provider: 'mtn', phone: '0201987654' });
  const o = chk.orders[0];
  await call('clinic@demo.gh', 'vendor.advanceOrder', { id: o.id, status: 'accepted' });
  await rejects(call('clinic@demo.gh', 'vendor.advanceOrder', { id: o.id, status: 'dispatched' }), 'INVALID_STATE');
  const neemIdx = E().db.orders[o.id].items.findIndex((i) => i.productId === 'prd_neem');
  await call('clinic@demo.gh', 'vendor.markUnavailable', { id: o.id, itemIndexes: [neemIdx] });
  assert.equal(E().db.orders[o.id].refunded, 3500);
  await call('clinic@demo.gh', 'vendor.advanceOrder', { id: o.id, status: 'stock_confirmed' });
  const okIdx = E().db.orders[o.id].items.findIndex((i) => i.status === 'ok');
  await rejects(call('clinic@demo.gh', 'vendor.advanceOrder', { id: o.id, status: 'prepared', batches: {} }), 'VALIDATION');
  await call('clinic@demo.gh', 'vendor.advanceOrder', { id: o.id, status: 'prepared', batches: { [okIdx]: { batch: 'PK-77', expiry: '2027-12-31' } } });
  await call('clinic@demo.gh', 'vendor.advanceOrder', { id: o.id, status: 'ready_for_pickup' });
  await call('clinic@demo.gh', 'vendor.advanceOrder', { id: o.id, status: 'delivered', receivedBy: 'Kojo Antwi' });
  await call('kojo@demo.gh', 'orders.acknowledge', { id: o.id });
  const ern = E().earningsFor('order', o.id)[0];
  assert.equal(ern.status, 'pending');
  assert.equal(E().netOf(ern), 11000 - Math.round(11000 * 0.12));
  await eng.call('demo.advanceClock', { days: 8 });
  for (const k of Object.keys(tokens)) delete tokens[k]; // idle sessions expired while the clock moved
  assert.equal(E().db.earnings[ern.id].status, 'eligible');
  const run = await call('finance@demo.gh', 'admin.runSettlement');
  assert.ok(run.payouts.some((p) => p.earningIds.includes(ern.id)));
  await reconcileOk();
});

test('recall notifies affected customers and holds settlement', async () => {
  await fresh();
  const affected = Object.values(E().db.orders).filter((o) => o.items.some((i) => i.productId === 'prd_prekese') && o.status !== 'pending_payment');
  const r = await call('admin@demo.gh', 'admin.setProductStatus', { id: 'prd_prekese', action: 'recall', reason: 'Contamination in batch PRE-2601' });
  assert.equal(r.notifiedCustomers, affected.length);
  for (const o of affected) {
    assert.ok(Object.values(E().db.notifications).some((n) => n.userId === o.customerId && n.title === 'Important safety notice'));
    assert.ok(E().earningsFor('order', o.id).every((e) => e.status === 'on_hold' || e.status === 'paid'));
  }
  await rejects(call('kojo@demo.gh', 'cart.setItem', { productId: 'prd_prekese', qty: 1 }), 'NOT_PURCHASABLE');
});

test('lock-screen notifications never contain health details', async () => {
  const bad = /(pain|headache|fatigue|pregnan|allerg|diagnos|moringa|referr(al)? to|knee)/i;
  const titles = Object.values(E().db.notifications).map((n) => n.title);
  assert.ok(titles.length > 5);
  for (const t of titles) assert.ok(!bad.test(t), `notification title leaks detail: ${t}`);
});

test('licence expiry hides practitioner automatically; renewal restores', async () => {
  await fresh();
  await eng.call('demo.advanceClock', { days: 26 });
  assert.ok(!(await call(null, 'practitioners.search')).some((p) => p.id === 'prc_ama'), 'Ama licence expired after 25 days');
  const next = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
  await call('ama@demo.gh', 'practitioner.renewLicence', { licenceExpiry: next, registrationNumber: 'TMPC/MH/1177' });
  await call('admin@demo.gh', 'admin.setPractitionerStatus', { id: 'prc_ama', action: 'approve_renewal', reason: 'TMPC renewal verified' });
  assert.ok((await call(null, 'practitioners.search')).some((p) => p.id === 'prc_ama'));
});

test('security: lockout after repeated failures, MFA for staff, claims blocked', async () => {
  await fresh();
  for (let i = 0; i < 5; i++) await rejects(eng.call('auth.login', { email: 'kojo@demo.gh', password: 'wrong-pass1' }), 'BAD_CREDENTIALS');
  await rejects(eng.call('auth.login', { email: 'kojo@demo.gh', password: 'Demo@1234' }), 'LOCKED');
  const r = await eng.call('auth.login', { email: 'admin@demo.gh', password: 'Demo@1234' });
  assert.equal(r.mfaRequired, true);
  assert.equal(r.token, undefined);
  await rejects(eng.call('auth.verifyMfa', { challengeId: r.challengeId, code: '000000' }), 'MFA_INVALID');
  await rejects(call('clinic@demo.gh', 'vendor.saveProduct', { name: 'Miracle Sugar Cure Tea', dosageForm: 'Tea bags', packSize: '20', category: 'Teas & infusions', fdaRegNo: 'FDA/1234', fdaExpiry: '2028-01-01', manufacturer: 'X', ingredients: 'Leaves', indication: 'Cures diabetes', directions: 'Drink daily', duration: '30 days', warnings: 'None known', contraindications: 'None', pregnancy: 'Seek advice', interactions: 'None known', priceGhs: 20, stock: 5 }), 'CLAIMS');
  const rev = await call('akosua@demo.gh', 'reviews.mine');
  const flagged = rev.find((x) => x.flags.includes('efficacy_claim'));
  await rejects(call('admin@demo.gh', 'admin.moderateReview', { id: flagged.id, status: 'published' }), 'CLAIMS');
  await rejects(eng.call('auth.register', { name: 'Test', email: 'new@demo.gh', phone: '12345', password: 'abcdefgh1', consent: true }), 'VALIDATION');
  await rejects(eng.call('auth.register', { name: 'Test User', email: 'new@demo.gh', phone: '0241112222', password: 'abcdefgh1', consent: false }), 'CONSENT_REQUIRED');
  const ok = await eng.call('auth.register', { name: 'Test User', email: 'new@demo.gh', phone: '+233 24 111 2222', password: 'abcdefgh1', consent: true });
  assert.equal(ok.user.phone, '+233241112222');
});

test('conventional pharmacy is gated, then works end to end when enabled', async () => {
  await rejects(call('akosua@demo.gh', 'rx.create', { pharmacyOrgId: 'org_carerx' }), 'FEATURE_OFF');
  await call('admin@demo.gh', 'admin.setFlags', { conventionalPharmacy: true, reason: 'Regulatory approval received' });
  const doc = await call('akosua@demo.gh', 'documents.upload', { name: 'rx.png', mime: 'image/png', kind: 'prescription', dataB64: PNG });
  const rx = await call('akosua@demo.gh', 'rx.create', { pharmacyOrgId: 'org_carerx', documentId: doc.id, deliveryMethod: 'pickup' });
  await call('pharmacy@demo.gh', 'documents.link', { id: doc.id });
  await rejects(call('akosua@demo.gh', 'payments.initialize', { purpose: 'rx', targetId: rx.id }), 'INVALID_STATE');
  await call('pharmacy@demo.gh', 'vendor.rxDecide', { id: rx.id, decision: 'validated', pharmacist: 'Kwesi Appiah', pharmacistRegNo: 'PC/PH/5521', items: [{ name: 'Amlodipine 5 mg tablets', qty: 30, unitPriceGhs: 1.5 }] });
  const init = await call('akosua@demo.gh', 'payments.initialize', { purpose: 'rx', targetId: rx.id, channel: 'card' });
  await call('akosua@demo.gh', 'payments.sandboxComplete', { reference: init.reference, card: '4084084084084081' });
  assert.equal(E().db.rxRequests[rx.id].status, 'paid');
  assert.ok(E().db.orders[E().db.rxRequests[rx.id].orderId]);
  await reconcileOk();
});

test('privacy: export and deletion anonymise the account', async () => {
  await fresh();
  const exp = await call('kojo@demo.gh', 'privacy.export');
  assert.ok(exp.profile && exp.bookings.length);
  const req = await call('kojo@demo.gh', 'privacy.request', { type: 'deletion' });
  // Active consultations block deletion.
  await rejects(call('admin@demo.gh', 'admin.processPrivacy', { id: req.id, decision: 'completed', note: 'Processed' }), 'INVALID_STATE');
  const del = await call('akosua@demo.gh', 'privacy.request', { type: 'deletion' });
  for (const b of Object.values(E().db.bookings)) if (b.customerId === 'usr_akosua' && b.status === 'confirmed') await call('akosua@demo.gh', 'bookings.cancel', { id: b.id });
  await call('admin@demo.gh', 'admin.processPrivacy', { id: del.id, decision: 'completed', note: 'Account anonymised' });
  const u = E().db.users.usr_akosua;
  assert.equal(u.status, 'deleted');
  assert.equal(u.name, 'Deleted user');
  assert.equal(u.phone, '');
  await rejects(eng.call('auth.login', { email: 'akosua@demo.gh', password: 'Demo@1234' }), 'BAD_CREDENTIALS');
  await reconcileOk();
});

test('password reset with a one-time code', async () => {
  const r = await eng.call('auth.requestReset', { email: 'kojo@demo.gh' });
  assert.ok(r.sent);
  await rejects(eng.call('auth.resetPassword', { email: 'kojo@demo.gh', code: '000000', password: 'NewPass123' }), 'RESET_INVALID');
  await eng.call('auth.resetPassword', { email: 'kojo@demo.gh', code: r.demoCode, password: 'NewPass123' });
  const ok = await eng.call('auth.login', { email: 'kojo@demo.gh', password: 'NewPass123' });
  assert.ok(ok.token);
  // Unknown emails get the same response (no account enumeration).
  const unknown = await eng.call('auth.requestReset', { email: 'nobody@demo.gh' });
  assert.equal(unknown.sent, true);
});
