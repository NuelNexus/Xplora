// Clinic / vendor portal: Dashboard • Products • Orders • Payouts • Compliance
import { route, S, go, api, toast, sheet, confirmSheet, refresh, closeSheets, signOut } from '../app.js';
import { ecard, iconTile, pageHead, banner, statTile, pill, html, raw, icon, money, fmtDate, fmtDateTime, cap, words, packArt, status, empty, kv, section, tabs, field, input, textarea, select, check, when } from '../ui.js';
import { earningsView } from './practitioner.js';

async function org() { return api('org.me'); }

const onboarding = (o) => html`
  ${when(o?.status === 'changes_required', () => html`<p class="note warn">${icon('alert')} PRORESMAT asked for changes: ${o?.statusHistory.at(-1)?.reason}</p>`)}
  <p class="muted small">PRORESMAT reviews every clinic and pharmacy before activation. Listings you create stay private until PRORESMAT approves them.</p>
  <form class="card stack" data-form="onboard" novalidate>
    <h3>Organisation</h3>
    ${field('Type', select('type', [['clinic', 'Herbal clinic (sells approved herbal products)'], ['pharmacy', 'Licensed pharmacy partner (validates prescriptions)']], o?.type || 'clinic'))}
    ${field('Registered name', input('name', { value: o?.name || '' }))}
    <div class="grid2">${field('Business registration number', input('businessRegNo', { value: o?.businessRegNo || '' }))}${field('GRA TIN', input('taxId', { value: o?.taxId || '', placeholder: 'C0012345678' }))}</div>
    ${field('Facility address', textarea('address', { value: o?.address || '', rows: 2 }))}
    ${field('Business phone', input('phone', { type: 'tel', value: o?.phone ? o.phone.replace('+233', '0') : '' }))}
    <div class="grid2">${field('Facility licence number', input('facilityLicenceNo', { value: o?.facilityLicenceNo || '' }))}${field('Licence expiry', input('licenceExpiry', { type: 'date', value: o?.licenceExpiry || '' }))}</div>
    ${field('Description (optional)', textarea('description', { value: o?.description || '', rows: 2 }))}
    <fieldset class="card"><legend>Pharmacy only</legend>${field('Superintendent pharmacist', input('superintendentPharmacist', { value: o?.superintendentPharmacist || '' }))}${field('Pharmacy Council licence', input('pharmacyCouncilLicence', { value: o?.pharmacyCouncilLicence || '' }))}</fieldset>
    <h3>Beneficial owner</h3>
    ${field('Name', input('beneficialOwner.name', { value: o?.beneficialOwner?.name || '' }))}
    <div class="grid2">${field('Ghana Card number', input('beneficialOwner.idNumber', { value: o?.beneficialOwner?.idNumber || '', placeholder: 'GHA-123456789-0' }))}${field('Ownership %', input('beneficialOwner.ownershipPct', { type: 'number', value: o?.beneficialOwner?.ownershipPct || 100 }))}</div>
    <h3>Authorised representative</h3>
    <div class="grid2">${field('Name', input('authorisedRep.name', { value: o?.authorisedRep?.name || S.user.name }))}${field('Position', input('authorisedRep.position', { value: o?.authorisedRep?.position || '' }))}</div>
    ${field('Phone', input('authorisedRep.phone', { type: 'tel', value: o?.authorisedRep?.phone ? o.authorisedRep.phone.replace('+233', '0') : '' }))}
    <h3>Settlement & terms</h3>
    ${field('Payout method', select('settlement.method', [['bank', 'Bank account'], ['momo', 'Mobile money']], o?.settlement?.method || 'bank'))}
    ${field('Account name', input('settlement.accountName', { value: o?.settlement?.accountName || '' }))}
    <div class="grid2">${field('Bank name', input('settlement.bankName', { value: o?.settlement?.bankName || '' }))}${field('Account number', input('settlement.accountNumber', { value: o?.settlement?.accountNumber || '' }))}</div>
    <div class="grid2">${field('MoMo network', select('settlement.momoProvider', [['mtn', 'MTN'], ['telecel', 'Telecel'], ['airteltigo', 'AirtelTigo']], o?.settlement?.momoProvider || 'mtn'))}${field('MoMo number', input('settlement.momoNumber', { type: 'tel', value: o?.settlement?.momoNumber ? o.settlement.momoNumber.replace('+233', '0') : '' }))}</div>
    ${field('Refund terms shown to customers', textarea('refundTerms', { value: o?.refundTerms || '', rows: 2 }))}
    ${check('agreement.serviceLevels', 'I accept the seller agreement service levels (accept orders within 24 hours, dispatch within 48 hours).')}
    ${check('agreement.refunds', 'I accept PRORESMAT’s refund, dispute and chargeback rules, including settlement holds.')}
    ${check('agreement.recalls', 'I will act on recalls immediately and keep batch and expiry records.')}
    <p class="form-error" role="alert" hidden></p><button class="btn primary">Submit for PRORESMAT review</button></form>`;

route('/v/dashboard', async (ctx) => {
  ctx.title = 'Dashboard';
  const r = await org();
  ctx.form('onboard', async (v) => { await api('org.apply', v); toast('Submitted. PRORESMAT will review your organisation.'); refresh(); });
  ctx.act('logout', () => signOut());
  if (!r.org || ['draft', 'changes_required'].includes(r.org.status)) return html`${pageHead('Partner onboarding', 'Register your clinic or pharmacy with PRORESMAT')}${onboarding(r.org)}`;
  const o = r.org;
  const st = r.stats;
  const [c, orders] = await Promise.all([api('vendor.compliance'), api('vendor.orders')]);
  const awaiting = orders.filter((x) => x.status === 'received').length;
  const licDays = c.org.daysLeft;
  const statusBanner = o.status !== 'active' ? banner('warn', o.status === 'submitted' ? 'Under PRORESMAT review • listings publish after approval' : `Organisation ${words(o.status)}`)
    : licDays <= 30 ? banner('warn', `Facility licence expires in ${licDays} days • ${st.approved} approved listings`)
      : banner('', `Facility licence active • ${st.approved} approved listing${st.approved === 1 ? '' : 's'}`);
  const actions = [
    ...c.products.filter((p) => ['approved', 'expired'].includes(p.status) && p.daysLeft <= 60).map((p) => ({ go: '#/v/compliance', ic: 'clock', tone: p.daysLeft < 0 ? 'bad' : 'gold', title: p.daysLeft < 0 ? 'Product registration expired' : 'Product registration expires', sub: `${p.name} • ${p.daysLeft < 0 ? 'sales blocked' : p.daysLeft + ' days remaining'}`, pill: pill('Renewal required', p.daysLeft < 0 ? 'bad' : 'warn') })),
    ...c.products.filter((p) => p.status === 'changes_required').map((p) => ({ go: '#/v/products?tab=review', ic: 'clip', title: 'Changes requested', sub: `${p.name} • ${p.lastReason}`, pill: pill('Edit and resubmit') })),
    ...c.adverse.filter((a2) => ['new', 'under_review'].includes(a2.status)).map((a2) => ({ go: '#/v/compliance', ic: 'alert', tone: 'bad', title: 'Safety report', sub: `${a2.productName} • ${words(a2.kind)}`, pill: pill('Open case', 'bad') })),
    ...(st.rxPending ? [{ go: '#/v/rx', ic: 'doc', title: `${st.rxPending} prescription${st.rxPending === 1 ? '' : 's'} to validate`, sub: 'Pharmacist review required', pill: pill('Validation') }] : []),
  ];
  return html`
    ${pageHead('Partner dashboard', `${o.name} • ${o.type === 'pharmacy' ? 'Licensed pharmacy partner' : o.type === 'proresmat' ? 'PRORESMAT dispensary' : 'Verified seller'}`)}
    ${statusBanner}
    <div class="stat-grid">${statTile(st.openOrders, 'New orders', `${awaiting} awaiting acceptance`, 'green', '#/v/orders')}${statTile(st.lowStock, 'Low-stock products', '5 or fewer left', 'gold', '#/v/products?tab=live')}</div>
    ${section('Action required', actions.length ? html`<div class="stack">${actions.slice(0, 6).map((x) => ecard({ go: x.go, lead: iconTile(x.ic, x.tone || ''), title: x.title, sub: x.sub, pill: x.pill }))}</div>` : banner('', 'Nothing needs your attention'))}
    <button class="btn primary big block" data-go="${o.type === 'pharmacy' ? '#/v/rx' : '#/v/orders'}">${o.type === 'pharmacy' ? 'Review prescriptions' : 'Review orders'}</button>
    <div class="list">
      ${when(o.type !== 'pharmacy', () => html`<button type="button" class="list-item" data-go="#/v/products">${icon('box', 'lead')}<span class="li-main"><strong>Manage listings</strong><span class="small muted">${st.listings} listings • ${st.awaitingReview} awaiting PRORESMAT review</span></span>${icon('back', 'flip')}</button>`)}
      <button type="button" class="list-item" data-go="#/v/payouts">${icon('wallet', 'lead')}<span class="li-main"><strong>Payouts</strong><span class="small muted">Settlement after delivery and hold period</span></span>${icon('back', 'flip')}</button>
      <button type="button" class="list-item" data-act="logout">${icon('logout', 'lead')}<span class="li-main"><strong>Sign out</strong></span></button>
    </div>`;
}, { auth: true });

const PRODUCT_FIELDS = (p = {}, cats = [], forms = []) => html`
  ${field('Product name', input('name', { value: p.name || '' }), 'No cure or guarantee words')}
  <div class="grid2">${field('Dosage form', select('dosageForm', forms.map((f) => [f, f]), p.dosageForm || forms[0]))}${field('Pack size', input('packSize', { value: p.packSize || '' }))}</div>
  ${field('Category', select('category', cats.map((c) => [c, c]), p.category || cats[0]))}
  <div class="grid2">${field('FDA registration number', input('fdaRegNo', { value: p.fdaRegNo || '' }))}${field('FDA registration expiry', input('fdaExpiry', { type: 'date', value: p.fdaExpiry || '' }))}</div>
  ${field('Manufacturer', input('manufacturer', { value: p.manufacturer || '' }))}
  ${field('Full ingredient declaration', textarea('ingredients', { value: p.ingredients || '', rows: 2 }))}
  ${field('Strength (if applicable)', input('strength', { value: p.strength || '' }))}
  ${field('Approved indication', textarea('indication', { value: p.indication || '', rows: 2 }), 'Use "Traditionally used for…" wording as registered')}
  ${field('Directions', textarea('directions', { value: p.directions || '', rows: 2 }))}
  ${field('Duration', input('duration', { value: p.duration || '', placeholder: 'e.g. 30 days' }))}
  ${field('Warnings', textarea('warnings', { value: p.warnings || '', rows: 2 }))}
  ${field('Contraindications', textarea('contraindications', { value: p.contraindications || '', rows: 2 }))}
  ${field('Pregnancy & breastfeeding advice', textarea('pregnancy', { value: p.pregnancy || '', rows: 2 }))}
  ${field('Interaction warning', textarea('interactions', { value: p.interactions || '', rows: 2 }))}
  <div class="grid2">${field('Price (GH₵)', input('priceGhs', { type: 'number', value: p.price ? p.price / 100 : '', attrs: 'min="1" step="0.5"' }))}${field('Stock', input('stock', { type: 'number', value: p.stock ?? 0, attrs: 'min="0"' }))}</div>
  <fieldset><legend>Fulfilment</legend>${check('delivery', 'Home delivery', p.delivery !== false)}${check('pickup', 'Pickup from clinic', p.pickup !== false)}${check('returnEligible', 'Eligible for return', !!p.returnEligible)}</fieldset>
  ${field('Return policy', input('returnPolicy', { value: p.returnPolicy || '' }))}`;

route('/v/products', async (ctx) => {
  ctx.title = 'Products';
  ctx.sub = 'Listings, approval status and stock';
  const r = await api('vendor.products');
  const tab = ctx.query.tab || 'all';
  ctx.act('tab', (d) => go('#/v/products?tab=' + d.v));
  ctx.act('new', () => sheet('New listing', html`<form class="stack" data-form="save">${PRODUCT_FIELDS({}, r.categories, r.forms)}<p class="form-error" role="alert" hidden></p><button class="btn primary">Save draft</button></form>`, { wide: true }));
  ctx.act('edit', (d) => { const p = r.products.find((x) => x.id === d.id); sheet(`Edit ${p.name}`, html`<form class="stack" data-form="save"><input type="hidden" name="id" value="${p.id}">${PRODUCT_FIELDS(p, r.categories, r.forms)}<p class="form-error" role="alert" hidden></p><button class="btn primary">Save</button></form>`, { wide: true }); });
  ctx.form('save', async (v) => { await api('vendor.saveProduct', v); closeSheets(); toast('Saved as draft. Submit it when ready for review.'); refresh(); });
  ctx.act('submit', async (d) => { await api('vendor.submitProduct', { id: d.id }); toast('Submitted for PRORESMAT review.'); refresh(); });
  ctx.act('stock', (d) => { const p = r.products.find((x) => x.id === d.id); sheet(`Stock & price: ${p.name}`, html`<form class="stack" data-form="stock"><input type="hidden" name="id" value="${p.id}">${field('Stock', input('stock', { type: 'number', value: p.stock, attrs: 'min="0"' }))}${field('Price (GH₵)', input('priceGhs', { type: 'number', value: p.price / 100, attrs: 'min="1" step="0.5"' }))}<p class="form-error" role="alert" hidden></p><button class="btn primary">Update</button></form>`); });
  ctx.form('stock', async (v) => { await api('vendor.updateStock', v); closeSheets(); toast('Updated.'); refresh(); });
  const filt = { all: () => true, live: (p) => p.status === 'approved', review: (p) => ['draft', 'submitted', 'under_review', 'changes_required'].includes(p.status), blocked: (p) => ['suspended', 'expired', 'recalled'].includes(p.status) };
  const list = r.products.filter(filt[tab]);
  return html`<button class="btn primary" data-act="new">${icon('plus')} New listing</button>
    <p class="muted small">States: Draft → Submitted → Under review → Approved (or Changes required). Only PRORESMAT can publish. Expired FDA registration blocks sales automatically.</p>
    ${tabs([['all', 'All'], ['live', 'Live'], ['review', 'In progress'], ['blocked', 'Blocked']], tab)}
    ${list.length ? html`<div class="stack">${list.map((p) => html`<div class="card vp">${packArt(p.image, 56, p.name)}<div class="grow"><div class="row between"><strong>${p.name}</strong>${status(p.status)}</div><p class="small muted">${p.dosageForm} · ${p.packSize} · ${money(p.price)} · stock ${p.stock}</p><p class="small muted">FDA ${p.fdaRegNo} · to ${fmtDate(p.fdaExpiry)}</p>${when(['changes_required', 'suspended', 'recalled', 'expired'].includes(p.status), () => html`<p class="small warn-text">${p.statusHistory.at(-1)?.reason}</p>`)}
      <div class="row wrap">${when(['draft', 'changes_required', 'expired', 'suspended'].includes(p.status), () => html`<button class="btn small ghost" data-act="edit" data-id="${p.id}">Edit</button>`)}${when(['draft', 'changes_required'].includes(p.status), () => html`<button class="btn small primary" data-act="submit" data-id="${p.id}">Submit for review</button>`)}${when(p.status === 'approved', () => html`<button class="btn small ghost" data-act="stock" data-id="${p.id}">Stock & price</button>`)}</div></div></div>`)}</div>` : empty('No listings here')}`;
}, { auth: true });

route('/v/orders', async (ctx) => {
  ctx.title = 'Orders';
  ctx.sub = 'Accept, prepare and deliver';
  const tab = ctx.query.tab || 'open';
  ctx.act('tab', (d) => go('#/v/orders?tab=' + d.v));
  const list = await api('vendor.orders');
  const open = list.filter((o) => !['delivered', 'acknowledged', 'cancelled', 'refunded'].includes(o.status));
  const done = list.filter((o) => !open.includes(o));
  const rows = (arr) => (arr.length ? html`<div class="list">${arr.map((o) => html`<button type="button" class="list-item" data-go="#/v/order/${o.id}">${icon(o.deliveryMethod === 'delivery' ? 'truck' : 'pin', 'lead')}<span class="li-main"><strong>${o.code} · ${money(o.subtotal)}</strong><span class="small">${o.customerName} · ${o.items.length} item(s) · ${o.deliveryMethod}</span><span class="small muted">${fmtDateTime(o.createdAt)}</span></span>${status(o.status)}</button>`)}</div>` : empty('No orders here'));
  return html`${tabs([['open', 'Open', open.length], ['done', 'Completed']], tab)}${rows(tab === 'open' ? open : done)}`;
}, { auth: true });

const NEXT = { received: [['accepted', 'Accept order']], accepted: [['stock_confirmed', 'Confirm stock']], stock_confirmed: [['prepared', 'Record batches & mark prepared']], prepared: [['dispatched', 'Mark dispatched'], ['ready_for_pickup', 'Mark ready for pickup']], dispatched: [['delivered', 'Record delivery']], ready_for_pickup: [['delivered', 'Record collection']] };
route('/v/order/:id', async (ctx) => {
  const o = await api('orders.get', { id: ctx.params.id });
  ctx.title = `Order ${o.code}`;
  ctx.back = '#/v/orders';
  ctx.act('next', async (d) => {
    if (d.v === 'prepared') {
      return sheet('Batch and expiry', html`<form class="stack" data-form="advance"><input type="hidden" name="status" value="prepared">${o.items.map((it, i) => it.status === 'ok' ? html`<fieldset class="card"><legend>${it.name} × ${it.qty}</legend><div class="grid2">${field('Batch number', input(`batches.${i}.batch`))}${field('Expiry date', input(`batches.${i}.expiry`, { type: 'date' }))}</div></fieldset>` : '')}<p class="form-error" role="alert" hidden></p><button class="btn primary">Mark prepared</button></form>`);
    }
    if (d.v === 'delivered') {
      return sheet(o.deliveryMethod === 'delivery' ? 'Proof of delivery' : 'Record collection', html`<form class="stack" data-form="advance"><input type="hidden" name="status" value="delivered">${field('Received by (name)', input('receivedBy', { value: o.customerName }))}${field('Note', input('note', { placeholder: 'e.g. ID checked, left with security' }))}<p class="form-error" role="alert" hidden></p><button class="btn primary">Confirm</button></form>`);
    }
    await api('vendor.advanceOrder', { id: o.id, status: d.v }); toast(`Marked ${words(d.v)}.`); refresh();
  });
  ctx.form('advance', async (v) => { await api('vendor.advanceOrder', { id: o.id, ...v }); closeSheets(); toast('Updated.'); refresh(); });
  ctx.act('unavailable', () => sheet('Items you cannot supply', html`<form class="stack" data-form="unavail">${o.items.map((it, i) => (it.status === 'ok' ? check('itemIndexes[]', `${it.name} × ${it.qty} (${money(it.lineTotal)})`, false, String(i)) : ''))}<p class="muted small">The customer is refunded for these items automatically and your settlement is adjusted.</p><p class="form-error" role="alert" hidden></p><button class="btn danger">Refund selected items</button></form>`));
  ctx.form('unavail', async (v) => { await api('vendor.markUnavailable', { id: o.id, itemIndexes: v.itemIndexes || [] }); closeSheets(); toast('Items refunded.'); refresh(); });
  ctx.act('reject', async () => { const r = await confirmSheet({ title: 'Reject this order?', body: 'The customer is refunded in full.', confirmLabel: 'Reject and refund', danger: true, reason: true }); if (!r.ok) return; await api('vendor.rejectOrder', { id: o.id, reason: r.reason }); toast('Order rejected and refunded.'); refresh(); });
  const next = (NEXT[o.status] || []).filter(([s]) => !(s === 'dispatched' && o.deliveryMethod === 'pickup') && !(s === 'ready_for_pickup' && o.deliveryMethod === 'delivery'));
  return html`
    <div class="card"><div class="row between"><div><p class="eyebrow">${o.deliveryMethod === 'delivery' ? 'Home delivery' : 'Pickup'}</p><h2>${money(o.subtotal)}</h2></div>${status(o.status)}</div>
      ${kv([['Customer', o.customerName], ['Phone', o.phone ? o.phone.replace('+233', '0') : ''], o.deliveryMethod === 'delivery' && ['Address', o.address], ['Paid', o.payment ? `${o.payment.receiptNo} · ${o.payment.reference}` : ''], o.rxRequestId && ['Prescription', 'Validated prescription order']])}</div>
    ${section('Items', html`<div class="list">${o.items.map((i) => html`<div class="list-item"><span class="li-main"><strong>${i.name} × ${i.qty}</strong>${i.batch ? html`<span class="small muted">Batch ${i.batch} · exp ${fmtDate(i.expiry)}</span>` : ''}${i.status === 'unavailable' ? html`<span class="small bad-text">Unavailable – refunded</span>` : ''}</span><b>${money(i.lineTotal)}</b></div>`)}</div>`)}
    ${when(next.length, () => html`<div class="stack">${next.map(([s, l]) => html`<button class="btn primary" data-act="next" data-v="${s}">${l}</button>`)}</div>`)}
    ${when(['received', 'accepted', 'stock_confirmed'].includes(o.status), () => html`<button class="btn ghost" data-act="unavailable">Some items unavailable</button>`)}
    ${when(o.status === 'received', () => html`<button class="btn ghost" data-act="reject">Reject order</button>`)}
    ${section('Timeline', html`<ol class="timeline">${o.timeline.map((e) => html`<li class="done"><span class="tl-dot" aria-hidden="true"></span><span><strong>${cap(e.status)}</strong> <span class="small muted">${fmtDateTime(e.at)} · ${e.by}</span>${e.note ? html`<br><span class="small">${e.note}</span>` : ''}</span></li>`)}</ol>`)}`;
}, { auth: true });

route('/v/rx', async (ctx) => {
  ctx.title = 'Prescriptions';
  ctx.back = '#/v/orders';
  const list = await api('vendor.rxList');
  ctx.act('doc', async (d) => { const { viewDoc } = await import('./customer.js'); viewDoc(d.id); });
  ctx.act('decide', (d) => {
    const r = list.find((x) => x.id === d.id);
    const prefill = r.carePlan?.items || [{ name: '' }];
    sheet(`Validate ${r.code}`, html`<form class="stack" data-form="rxd"><input type="hidden" name="id" value="${r.id}">
      ${field('Decision', select('decision', [['validated', 'Valid – price and dispense'], ['rejected', 'Cannot validate']]))}
      <div class="grid2">${field('Pharmacist name', input('pharmacist', { value: S.user.name }))}${field('Pharmacist registration no.', input('pharmacistRegNo'))}</div>
      ${[0, 1, 2].map((i) => html`<fieldset class="card"><legend>Item ${i + 1}</legend>${field('Medicine & strength', input(`items.${i}.name`, { value: prefill[i]?.name ? `${prefill[i].name} ${prefill[i].dosage || ''}`.trim() : '' }))}<div class="grid2">${field('Quantity', input(`items.${i}.qty`, { type: 'number', value: prefill[i] ? 1 : '' }))}${field('Unit price (GH₵)', input(`items.${i}.unitPriceGhs`, { type: 'number', attrs: 'step="0.5"' }))}</div></fieldset>`)}
      ${field('Note to customer (reason if rejecting)', textarea('note', { rows: 2 }))}<p class="form-error" role="alert" hidden></p><button class="btn primary">Send decision</button></form>`, { wide: true });
  });
  ctx.form('rxd', async (v) => { const items = Object.values(v.items || {}).filter((i) => i.name); await api('vendor.rxDecide', { ...v, items }); closeSheets(); toast('Decision sent to the customer.'); refresh(); });
  return list.length ? html`<div class="stack">${list.map((r) => html`<div class="card stack"><div class="row between"><strong>${r.code} · ${r.customerName}</strong>${status(r.status)}</div><p class="small muted">${fmtDateTime(r.createdAt)} · ${r.deliveryMethod}</p>
    ${r.carePlan ? html`<p class="small">E-prescription ${r.carePlan.code} from ${r.carePlan.practitioner}: ${r.carePlan.items.map((i) => `${i.name} ${i.dosage}`).join('; ')}</p>` : html`<button class="btn small ghost" data-act="doc" data-id="${r.documentId}">${icon('doc')} View uploaded prescription</button>`}
    ${when(r.notes, () => html`<p class="small">Customer note: ${r.notes}</p>`)}
    ${when(r.status === 'submitted', () => html`<button class="btn primary" data-act="decide" data-id="${r.id}">Validate</button>`)}
    ${when(r.quote, () => html`<p class="small">Quoted ${money(r.quote?.total)}</p>`)}</div>`)}</div>` : empty('No prescription requests', S.meta.flags.conventionalPharmacy ? '' : 'Prescription services are switched off until regulatory approval.');
}, { auth: true });

route('/v/payouts', async (ctx) => {
  ctx.title = 'Payouts';
  ctx.sub = 'Your share after commission and holds';
  const r = await org();
  if (!r.org) return empty('Complete onboarding first', '', html`<button class="btn primary" data-go="#/v/dashboard">Start onboarding</button>`);
  if (r.org.type === 'proresmat') return html`<p class="note">${icon('shield')} Products sold by PRORESMAT are recorded as PRORESMAT revenue; there are no third-party payouts for this store.</p>`;
  return earningsView(await api('earnings.mine', { as: 'org' }), 'product');
}, { auth: true });

route('/v/compliance', async (ctx) => {
  ctx.title = 'Compliance';
  ctx.sub = 'Licences, registrations and safety reports';
  const r = await org();
  ctx.act('logout', () => signOut());
  if (!r.org) return empty('Complete onboarding first', '', html`<button class="btn primary" data-go="#/v/dashboard">Start onboarding</button>`);
  const c = await api('vendor.compliance');
  ctx.form('renew', async (v) => { await api('org.renewLicence', v); toast('Renewal submitted.'); refresh(); });
  const tone = (d) => (d === null ? '' : d < 0 ? 'bad-text' : d <= 30 ? 'warn-text' : '');
  return html`
    ${section('Organisation', kv([['Status', status(c.org.status)], ['Facility licence', html`${c.org.facilityLicenceNo} · <span class="${tone(c.org.daysLeft)}">to ${fmtDate(c.org.licenceExpiry)} (${c.org.daysLeft} days)</span>`], ['Business registration', c.org.businessRegNo], ['TIN', c.org.taxId]]))}
    ${c.org.pendingRenewal ? html`<p class="note">${icon('clock')} Renewal to ${fmtDate(c.org.pendingRenewal.licenceExpiry)} awaiting verification.</p>` : html`<form class="card stack" data-form="renew" novalidate><h3>Renew facility licence</h3>${field('New expiry date', input('licenceExpiry', { type: 'date' }))}<p class="form-error" role="alert" hidden></p><button class="btn ghost">Submit renewal</button></form>`}
    ${section('Product registrations', c.products.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Product</th><th>FDA no.</th><th>Expiry</th><th>Status</th></tr></thead><tbody>${c.products.map((p) => html`<tr><td>${p.name}</td><td class="mono">${p.fdaRegNo}</td><td class="${tone(p.daysLeft)}">${fmtDate(p.fdaExpiry)}<br><span class="small">${p.daysLeft} days</span></td><td>${status(p.status)}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">No listings.</p>`)}
    ${section('Safety reports on your products', c.adverse.length ? html`<div class="list">${c.adverse.map((a) => html`<div class="list-item"><span class="li-main"><strong>${a.code} · ${a.productName}</strong><span class="small muted">${cap(a.kind)} · ${a.severity} · ${fmtDate(a.createdAt)}</span></span>${status(a.status)}</div>`)}</div>` : html`<p class="muted">None.</p>`)}
    ${section('Status history', html`<ol class="timeline">${c.org.statusHistory.map((h) => html`<li class="done"><span class="tl-dot" aria-hidden="true"></span><span><strong>${cap(h.status)}</strong> <span class="small muted">${fmtDateTime(h.at)} · ${h.by}</span><br><span class="small">${h.reason}</span></span></li>`)}</ol>`)}
    <button class="btn ghost" data-act="logout">${icon('logout')} Sign out</button>`;
}, { auth: true });

export { raw };
