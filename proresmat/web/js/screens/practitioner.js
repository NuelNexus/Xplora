// Practitioner workspace: Today • Patients • Consult • Earnings • Profile
import { route, S, go, api, toast, sheet, confirmSheet, refresh, closeSheets } from '../app.js';
import { ecard, iconTile, pageHead, banner, statTile, pill, regLabel, html, raw, icon, money, fmtDate, fmtDay, fmtTime, fmtDateTime, cap, words, avatar, status, classBadge, empty, kv, section, tabs, field, input, textarea, select, check, when, readFileB64 } from '../ui.js';
import { viewDoc } from './customer.js';

const modeIcon = { physical: 'pin', telephone: 'phone', video: 'video' };
const modeLabel = { physical: 'In person', telephone: 'Telephone', video: 'Video' };
const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];

async function me() { return (await api('practitioner.me')).profile; }
const needProfile = () => html`<div class="card stack">${icon('clip', 'big')}<h3>Complete your credentialing</h3><p>Submit your identity, qualification, council registration, facility licence and settlement details. PRORESMAT verifies them before your profile appears to customers.</p><button class="btn primary" data-go="#/p/profile">Start application</button></div>`;

const apptRow = (b) => html`<button type="button" class="list-item" data-go="#/p/consult/${b.id}">${icon(modeIcon[b.mode], 'lead')}<span class="li-main"><strong>${fmtTime(b.start)} · ${b.customerName}</strong><span class="small">${modeLabel[b.mode]} · ${b.code}</span>${when(b.supervisorReview?.status === 'requested', () => html`<span class="small warn-text">Supervisor review requested</span>`)}</span>${status(b.status)}</button>`;

route('/p/today', async (ctx) => {
  ctx.title = 'Today';
  const p = await me();
  if (!p) return html`${pageHead('Welcome', 'Complete credentialing to start receiving bookings')}${needProfile()}`;
  const appts = await api('practitioner.appointments');
  const nowMs = Date.now() + (S.nowOffsetDays || 0) * 86400000;
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const open = appts.filter((b) => ['confirmed', 'in_progress'].includes(b.status));
  const next = open.find((b) => b.status === 'in_progress') || open.find((b) => Date.parse(b.end) > nowMs) || null;
  const todays = appts.filter((b) => b.start.slice(0, 10) === today && !b.status.startsWith('cancelled'));
  const upcoming = open.filter((b) => b !== next).slice(0, 5);
  const toDocument = appts.filter((b) => b.status === 'in_progress' || (b.status === 'completed' && !b.notes?.assessment));
  const reviews = appts.filter((b) => b.supervisorReview?.status === 'changes_advised');
  let supQueue = 0;
  if (S.user.roles.includes('supervisor')) supQueue = (await api('supervisor.queue')).cases.filter((c) => c.supervisorReview.status === 'requested').length;
  const days = Math.round((Date.parse(p.licenceExpiry) - Date.parse(today)) / 86400000);
  const dateLabel = new Date(nowMs).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const statusBanner = p.status !== 'active'
    ? banner('warn', `Profile ${words(p.status)}. ${p.status === 'submitted' ? 'PRORESMAT is verifying your credentials.' : p.status === 'changes_required' ? 'Update your application in Profile.' : 'Contact PRORESMAT.'}`)
    : !p.bookable ? banner('bad', 'Licence expired • hidden from search until renewal is verified')
      : days <= 30 ? banner('warn', `Licence expires in ${days} day${days === 1 ? '' : 's'} • renew in Profile`)
        : banner('', `Licence verified • ${p.providerClass === 'supervised' ? 'Supervision active' : 'Verified independent'}`);
  const tasks = [
    toDocument.length && { go: '#/p/consults', ic: 'clip', title: `${toDocument.length} consultation note${toDocument.length === 1 ? '' : 's'}`, sub: 'Complete before settlement approval', pill: pill('Documentation', 'gold') },
    reviews.length && { go: `#/p/consult/${reviews[0].id}`, ic: 'shield', title: `${reviews.length} supervisor comment${reviews.length === 1 ? '' : 's'}`, sub: 'Changes advised on a case', pill: pill('Supervisory review') },
    supQueue && { go: '#/p/supervision', ic: 'people', title: `${supQueue} case review${supQueue === 1 ? '' : 's'}`, sub: 'Requested by practitioners you supervise', pill: pill('Supervisor') },
    p.status === 'active' && days <= 30 && { go: '#/p/profile', ic: 'alert', title: 'Licence renewal', sub: `${fmtDate(p.licenceExpiry)} • ${Math.max(days, 0)} days remaining`, pill: pill('Renewal required', 'warn'), tone: 'gold' },
  ].filter(Boolean);
  return html`
    ${pageHead("Today’s practice", dateLabel)}
    ${statusBanner}
    ${section('Next consultation', next ? html`<div class="stack">${ecard({ go: `#/p/consult/${next.id}`, lead: iconTile(modeIcon[next.mode]), title: next.customerName, sub: `${fmtDay(next.start)}, ${fmtTime(next.start)} • ${modeLabel[next.mode]} • ${next.code}`, pill: next.status === 'in_progress' ? status('in_progress', 'In progress') : pill(next.consentAt ? 'Consent given' : 'Consent pending') })}<button class="btn primary big block" data-go="#/p/consult/${next.id}">Open consultation record</button></div>` : empty('No upcoming consultations', 'Keep your availability up to date in Profile.'), html`<a href="#/p/consults">View schedule</a>`)}
    <div class="stat-grid">${statTile(todays.length, 'Today', 'consultations')}${statTile(open.length, 'Open', 'confirmed or in progress', 'gold')}</div>
    ${section('Tasks requiring attention', tasks.length ? html`<div class="stack">${tasks.map((t_) => ecard({ go: t_.go, lead: iconTile(t_.ic, t_.tone || ''), title: t_.title, sub: t_.sub, pill: t_.pill }))}</div>` : banner('', 'All caught up'))}
    ${when(upcoming.length, () => section('Coming up', html`<div class="list">${upcoming.map((b) => html`<button type="button" class="list-item" data-go="#/p/consult/${b.id}">${icon(modeIcon[b.mode], 'lead')}<span class="li-main"><strong>${fmtDay(b.start)}, ${fmtTime(b.start)}</strong><span class="small muted">${b.customerName} • ${modeLabel[b.mode]}</span></span>${icon('back', 'flip')}</button>`)}</div>`))}`;
}, { auth: true });

route('/p/patients', async (ctx) => {
  ctx.title = 'Patients';
  ctx.sub = 'People who have booked with you';
  const p = await me();
  if (!p) return needProfile();
  const list = await api('practitioner.patients');
  return html`<p class="muted small">Only patients who booked with you are listed. Opening a record is logged.</p>${list.length ? html`<div class="list">${list.map((x) => html`<button type="button" class="list-item" data-go="#/p/patient/${x.id}">${icon('user', 'lead')}<span class="li-main"><strong>${x.name}</strong><span class="small muted">${x.visits} consultation(s)${x.lastVisit ? ` · last ${fmtDate(x.lastVisit)}` : ''}${x.nextVisit ? ` · next ${fmtDate(x.nextVisit)}` : ''}</span></span></button>`)}</div>` : empty('No patients yet')}`;
}, { auth: true });

route('/p/patient/:id', async (ctx) => {
  const r = await api('practitioner.patient', { id: ctx.params.id });
  ctx.title = r.name;
  ctx.back = '#/p/patients';
  return html`${kv([['Date of birth', r.dob ? fmtDate(r.dob) : 'Not given'], ['Allergies', r.health.allergies || 'None recorded'], ['Current medicines', r.health.currentMeds || 'None recorded'], ['Conditions', r.health.conditions || 'None recorded']])}
    ${section('Consultations', html`<div class="list">${r.bookings.map((b) => html`<button type="button" class="list-item" data-go="#/p/consult/${b.id}">${icon(modeIcon[b.mode], 'lead')}<span class="li-main"><strong>${fmtDateTime(b.start)}</strong><span class="small">${b.code}${b.notes?.assessment ? ' · ' + b.notes.assessment.slice(0, 60) : ''}</span></span>${status(b.status)}</button>`)}</div>`)}
    ${when(r.carePlans.length, () => section('Care plans issued', html`<div class="list">${r.carePlans.map((c) => html`<div class="list-item"><span class="li-main"><strong>${c.code}</strong><span class="small">${c.items.map((i) => i.name).join(', ') || 'Advice only'}</span></span></div>`)}</div>`))}`;
}, { auth: true });

route('/p/consults', async (ctx) => {
  ctx.title = 'Consultations';
  ctx.sub = 'Your schedule and clinical records';
  const p = await me();
  if (!p) return needProfile();
  const tab = ctx.query.tab || 'open';
  ctx.act('tab', (d) => go('#/p/consults?tab=' + d.v));
  const all = await api('practitioner.appointments');
  const groups = {
    open: all.filter((b) => ['confirmed', 'in_progress'].includes(b.status)),
    done: all.filter((b) => ['completed', 'no_show'].includes(b.status)).reverse(),
    cancelled: all.filter((b) => b.status.startsWith('cancelled')).reverse(),
  };
  return html`${tabs([['open', 'Open', groups.open.length], ['done', 'Completed'], ['cancelled', 'Cancelled']], tab)}
    ${when(S.user.roles.includes('supervisor'), () => html`<button class="btn ghost small" data-go="#/p/supervision">${icon('shield')} Supervision queue</button>`)}
    ${groups[tab].length ? html`<div class="list">${groups[tab].map((b) => html`<button type="button" class="list-item" data-go="#/p/consult/${b.id}">${icon(modeIcon[b.mode], 'lead')}<span class="li-main"><strong>${fmtDay(b.start)}, ${fmtTime(b.start)} · ${b.customerName}</strong><span class="small muted">${b.code}</span></span>${status(b.status)}</button>`)}</div>` : empty('Nothing here')}`;
}, { auth: true });

// ---------- consultation workspace ----------
route('/p/consult/:id', async (ctx) => {
  const b = await api('bookings.get', { id: ctx.params.id });
  const p = await me();
  ctx.title = `${b.code} · ${b.customerName}`;
  ctx.back = '#/p/consults';
  const n = b.notes || {};
  ctx.act('start', async () => { await api('consult.start', { id: b.id }); toast('Consultation started. Record your notes as you go.'); refresh(); });
  ctx.form('notes', async (v) => {
    const payload = { id: b.id, ...v };
    if (!v.referral?.to) delete payload.referral;
    if (!v.escalate) delete payload.escalate; else payload.escalate = v.escalate;
    await api('consult.document', payload);
    toast('Notes saved.'); refresh();
  });
  ctx.act('complete', async () => {
    const r = await confirmSheet({ title: 'Complete this consultation?', body: 'The customer is notified and can view the care plan and receipt. Your payment becomes eligible after the settlement hold period if there are no complaints.', confirmLabel: 'Mark completed' });
    if (!r.ok) return;
    await api('consult.complete', { id: b.id }); toast('Consultation completed.'); refresh();
  });
  ctx.act('noshow', async () => { const r = await confirmSheet({ title: 'Mark as missed?', body: 'Use this only if the customer did not attend or answer.', confirmLabel: 'Mark missed', danger: true }); if (!r.ok) return; await api('consult.noShow', { id: b.id }); refresh(); });
  ctx.act('cancel', async () => {
    const r = await confirmSheet({ title: 'Cancel this consultation?', body: 'The customer receives a full refund and can rebook. Provider cancellations are tracked in your quality metrics.', confirmLabel: 'Cancel and refund', danger: true, reason: true, reasonLabel: 'Reason shared with the customer' });
    if (!r.ok) return;
    await api('consult.providerCancel', { id: b.id, reason: r.reason }); toast('Cancelled; customer refunded in full.'); refresh();
  });
  ctx.act('review', async () => { const r = await confirmSheet({ title: 'Request supervisor review', body: 'Your supervisor will see the case notes and give feedback.', confirmLabel: 'Request review', reason: true, reasonLabel: 'What would you like reviewed?' }); if (!r.ok) return; await api('consult.requestReview', { id: b.id, reason: r.reason }); toast('Review requested.'); refresh(); });
  ctx.act('doc', (d) => viewDoc(d.id));
  ctx.act('plan', async () => {
    const products = await api('products.search', {});
    const row = (i) => html`<fieldset class="card plan-item"><legend>Item ${i + 1}</legend>
      ${field('Approved product (optional)', select(`items.${i}.productId`, products.map((x) => [x.id, `${x.name} – ${x.seller}`]), '', { blank: 'None / other advice' }))}
      ${field('Or name (if not a listed product)', input(`items.${i}.name`))}
      <div class="grid2">${field('Dose', input(`items.${i}.dosage`, { placeholder: 'e.g. 2 capsules' }))}${field('How often', input(`items.${i}.frequency`, { placeholder: 'e.g. twice daily' }))}</div>
      <div class="grid2">${field('Duration', input(`items.${i}.duration`, { placeholder: 'e.g. 30 days' }))}${field('Rationale', input(`items.${i}.rationale`))}</div></fieldset>`;
    sheet('Issue a care plan', html`<form class="stack" data-form="plan">
      ${field('Type', select('type', p.canPrescribe ? [['care_plan', 'Treatment recommendation / care plan'], ['prescription', 'Prescription']] : [['care_plan', 'Treatment recommendation / care plan']]), p.canPrescribe ? 'Your registered scope includes prescriptions.' : 'Your registered scope covers treatment recommendations and care plans. Prescriptions are restricted to authorised professionals.')}
      ${row(0)}${row(1)}${row(2)}
      ${field('Advice for the customer', textarea('advice', { rows: 4, placeholder: 'Diet, lifestyle, what to watch for, when to seek urgent care' }))}
      <div class="grid2">${field('Follow-up date', input('followUpDate', { type: 'date', value: b.followUpDate || '' }))}${p.canPrescribe ? field('Refills (prescriptions)', input('refills', { type: 'number', value: '0', attrs: 'min="0" max="5"' })) : ''}</div>
      <p class="muted small">Do not describe any product as a cure. Use the approved indication.</p>
      <p class="form-error" role="alert" hidden></p><button class="btn primary">Issue to customer</button></form>`, { wide: true });
  });
  ctx.form('plan', async (v) => {
    const items = Object.values(v.items || {}).filter((i) => i.productId || i.name).map((i) => ({ ...i }));
    await api('consult.carePlan', { id: b.id, type: v.type, items, advice: v.advice, followUpDate: v.followUpDate, refills: Number(v.refills || 0) });
    closeSheets(); toast('Care plan issued.'); refresh();
  });
  ctx.act('ae', () => sheet('Report adverse event or interaction', html`<form class="stack" data-form="ae">
    ${field('Type', select('kind', [['adverse_reaction', 'Adverse reaction'], ['interaction', 'Suspected herb–drug interaction'], ['quality', 'Product quality problem']]))}
    ${field('Severity', select('severity', [['mild', 'Mild'], ['moderate', 'Moderate'], ['severe', 'Severe']]))}
    ${field('Description', textarea('description', { rows: 4, placeholder: 'Products and medicines involved, timing, symptoms, action taken' }))}
    ${field('Other medicines involved', input('otherMedicines'))}
    <p class="form-error" role="alert" hidden></p><button class="btn primary">Submit report</button></form>`));
  ctx.form('ae', async (v) => { const r = await api('adverse.create', { ...v, bookingId: b.id }); closeSheets(); toast(`Report ${r.code} sent to the PRORESMAT safety team.`); });

  const editable = ['in_progress', 'completed'].includes(b.status);
  const canStart = b.status === 'confirmed';
  const sc = b.screening || {};
  return html`
    <div class="card"><div class="row between"><div><p class="eyebrow">${modeLabel[b.mode]}</p><h2>${fmtDay(b.start)}, ${fmtTime(b.start)} GMT</h2></div>${status(b.status)}</div>
      ${when(b.videoLink, () => html`<p class="small">${icon('video')} <a href="${b.videoLink}" target="_blank" rel="noopener">Join video room</a></p>`)}
      ${when(b.mode === 'telephone' && b.customer, () => html`<p class="small">${icon('phone')} Call the customer on their registered number from the customer record.</p>`)}
      ${when(canStart, () => html`<div class="row wrap"><button class="btn primary" data-act="start">Start consultation</button><button class="btn ghost" data-act="noshow">Customer did not attend</button><button class="btn ghost" data-act="cancel">Cancel</button></div><p class="muted small">You can start from 30 minutes before the scheduled time.</p>`)}
    </div>
    ${section('Patient', kv([['Name', b.customer?.name], ['Date of birth', b.customer?.dob ? fmtDate(b.customer.dob) : 'Not given'], ['Consent', b.consentAt ? `Given ${fmtDateTime(b.consentAt)}` : 'Missing'], ['Presenting concern', b.reason], ['Allergies', sc.allergies || 'None reported'], ['Current medicines', sc.currentMeds || 'None reported'], ['Pregnancy / breastfeeding', `${words(sc.pregnancy)} / ${words(sc.breastfeeding)}`], ['Conditions', b.customer?.health?.conditions || '—']]))}
    ${section('Shared documents', (b.sharedDocs || []).length ? html`<div class="list">${b.sharedDocs.map((d) => html`<button type="button" class="list-item" data-act="doc" data-id="${d.id}">${icon('doc', 'lead')}<span class="li-main"><strong>${d.name}</strong><span class="small muted">${cap(d.kind)} · opening is logged</span></span></button>`)}</div>` : html`<p class="muted small">The customer has not shared any documents.</p>`)}
    ${when(b.supervisorReview, () => html`<div class="card ${b.supervisorReview?.status === 'changes_advised' ? 'alert-card' : ''}"><strong>Supervisor review: ${status(b.supervisorReview?.status)}</strong><p class="small">${b.supervisorReview?.reason}</p>${when(b.supervisorReview?.comments, () => html`<p class="small"><b>${b.supervisorReview?.reviewer}:</b> ${b.supervisorReview?.comments}</p>`)}</div>`)}
    ${editable ? html`<form class="card stack" data-form="notes" novalidate><h3>Consultation notes</h3>
      ${field('Presenting concern', textarea('presentingConcern', { value: n.presentingConcern || b.reason, rows: 2 }))}
      ${field('History', textarea('history', { value: n.history || '', rows: 3 }))}
      ${field('Assessment', textarea('assessment', { value: n.assessment || '', rows: 3 }), 'Required before completing')}
      ${field('Plan', textarea('plan', { value: n.plan || '', rows: 3 }))}
      <div class="grid2">${field('Recommended treatment or product', input('recommendation', { value: n.recommendation || '' }))}${field('Rationale', input('rationale', { value: n.rationale || '' }))}</div>
      <div class="grid2">${field('Follow-up date', input('followUpDate', { type: 'date', value: b.followUpDate || '' }))}${field('Outcome', input('outcome', { value: b.outcome || '' }))}</div>
      <fieldset class="card"><legend>Referral (optional)</legend>${field('Refer to facility', input('referral.to', { value: b.referral?.to || '', placeholder: 'e.g. Komfo Anokye Teaching Hospital' }))}${field('Reason', input('referral.reason', { value: b.referral?.reason || '' }))}${field('Urgency', select('referral.urgency', [['routine', 'Routine'], ['urgent', 'Urgent (within 24 h)'], ['emergency', 'Emergency (now)']], b.referral?.urgency || 'routine'))}</fieldset>
      ${field('Urgent escalation to PRORESMAT care team (optional)', textarea('escalate', { rows: 2, placeholder: 'Describe the red flag or concern that needs immediate follow-up' }))}
      <p class="form-error" role="alert" hidden></p><button class="btn primary">Save notes</button></form>
      <div class="stack">
        <button class="btn ghost" data-act="plan">${icon('clip')} Issue care plan${p.canPrescribe ? ' / prescription' : ''}</button>
        ${when(b.carePlanIds.length, () => html`<p class="small muted">${b.carePlanIds.length} care plan(s) issued for this consultation.</p>`)}
        ${when(p.supervisorId && !b.supervisorReview, () => html`<button class="btn ghost" data-act="review">${icon('shield')} Request supervisor review</button>`)}
        <button class="btn ghost" data-act="ae">${icon('alert')} Report adverse event / interaction</button>
        ${when(b.status === 'in_progress', () => html`<button class="btn primary" data-act="complete">Complete consultation</button>`)}
      </div>` : when(b.notes, () => section('Notes', kv([['Assessment', n.assessment], ['Plan', n.plan]])))}`;
}, { auth: true });

// ---------- supervision ----------
route('/p/supervision', async (ctx) => {
  ctx.title = 'Supervision';
  ctx.back = '#/p/consults';
  const q = await api('supervisor.queue');
  ctx.act('decide', (d) => sheet('Supervisor decision', html`<form class="stack" data-form="decide"><input type="hidden" name="id" value="${d.id}">${field('Decision', select('decision', [['endorsed', 'Endorse care as documented'], ['changes_advised', 'Advise changes']]))}${field('Comments', textarea('comments', { rows: 4 }))}<p class="form-error" role="alert" hidden></p><button class="btn primary">Send feedback</button></form>`));
  ctx.form('decide', async (v) => { await api('supervisor.decide', v); closeSheets(); toast('Feedback sent.'); refresh(); });
  return html`${section('Supervised practitioners', html`<div class="list">${q.supervisees.map((s) => html`<div class="list-item"><span class="li-main"><strong>${s.fullName}</strong><span class="small muted">${s.title} · ${s.completed} completed · licence to ${fmtDate(s.licenceExpiry)}</span></span>${status(s.status)}</div>`)}</div>`)}
    ${section('Case reviews', q.cases.length ? html`<div class="stack">${q.cases.map((b) => html`<div class="card stack"><div class="row between"><strong>${b.code} · ${b.practitioner.fullName}</strong>${status(b.supervisorReview.status)}</div><p class="small muted">${fmtDateTime(b.start)} · ${b.supervisorReview.reason}</p>${kv([['Concern', b.reason], ['Assessment', b.notes?.assessment || 'Not yet documented'], ['Plan', b.notes?.plan || ''], ['Referral', b.referral ? `${b.referral.to} (${b.referral.urgency})` : '']])}${when(b.supervisorReview.status === 'requested', () => html`<button class="btn primary" data-act="decide" data-id="${b.id}">Review case</button>`, () => html`<p class="small">${b.supervisorReview.comments || ''}</p>`)}</div>`)}</div>` : empty('No cases to review'))}`;
}, { auth: true });

// ---------- earnings ----------
route('/p/earnings', async (ctx) => {
  ctx.title = 'Earnings';
  ctx.sub = 'Fees, commission and settlement status';
  const p = await me();
  if (!p) return needProfile();
  return earningsView(await api('earnings.mine', { as: 'practitioner' }), 'consultation');
}, { auth: true });

export function earningsView(e, kind) {
  const t = e.totals;
  return html`
    <div class="stats"><div><strong>${money(t.eligible)}</strong><span>ready for next payout</span></div><div><strong>${money(t.pending)}</strong><span>pending</span></div><div><strong>${money(t.onHold)}</strong><span>on hold</span></div></div>
    ${kv([['Gross', money(t.gross)], ['PRORESMAT commission', `−${money(t.commission)} (${kind === 'consultation' ? e.settings.consultationCommissionPct : e.settings.productCommissionPct}%)`], ['Adjustments (refunds)', money(t.adjustments)], ['Paid out', money(t.paid)]])}
    <p class="muted small">${kind === 'consultation' ? `A consultation becomes payable when it is completed and documented, there is no refund, complaint or dispute hold, and ${e.settings.holdDaysConsultation} days have passed.` : `An order becomes payable ${e.settings.holdDaysProduct} days after delivery if there is no complaint, recall, adverse event or dispute.`}</p>
    ${section('Transactions', e.earnings.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="num">Gross</th><th class="num">Fee</th><th class="num">Adj.</th><th class="num">Net</th><th>Status</th></tr></thead><tbody>${e.earnings.map((x) => html`<tr><td>${x.label}${x.holds.length ? html`<br><span class="small warn-text">Held: ${x.holds.map((h) => h.split(':')[0]).join(', ')}</span>` : ''}${x.eligibleAt && x.status === 'pending' ? html`<br><span class="small muted">Eligible ${fmtDate(x.eligibleAt)}</span>` : ''}${x.payoutRef ? html`<br><span class="small muted">${x.payoutRef}</span>` : ''}</td><td class="num">${money(x.gross)}</td><td class="num">${money(x.commission)}</td><td class="num">${money(x.adjustments)}</td><td class="num"><b>${money(x.net)}</b></td><td>${status(x.status)}</td></tr>`)}</tbody></table></div>` : empty('No earnings yet'))}
    ${section('Payouts', e.payouts.length ? html`<div class="list">${e.payouts.map((po) => html`<div class="list-item">${icon('wallet', 'lead')}<span class="li-main"><strong>${money(po.amount)} · ${po.reference}</strong><span class="small muted">${fmtDate(po.createdAt)} to ${po.destination}</span></span>${status(po.status)}</div>`)}</div>` : html`<p class="muted">No payouts yet.</p>`)}`;
}

// ---------- profile / credentialing / availability ----------
route('/p/profile', async (ctx) => {
  ctx.title = 'Profile';
  ctx.sub = 'Credentials, availability and public profile';
  const { profile: p, councils, categories } = await api('practitioner.me');
  const editable = !p || ['draft', 'changes_required'].includes(p.status);
  ctx.form('apply', async (v) => {
    await api('practitioner.apply', { ...v, modes: v.modes || [], agreements: { provider: v.agree_provider === true, confidentiality: v.agree_conf === true, conduct: v.agree_conduct === true }, evidenceDocIds: v.evidenceDocIds || [] });
    toast('Application submitted to PRORESMAT for verification.'); refresh();
  });
  ctx.form('avail', async (v) => {
    const weekly = {};
    for (const [d] of DAYS) weekly[d] = v[d + '_on'] ? [[v[d + '_from'], v[d + '_to']], ...(v[d + '_from2'] && v[d + '_to2'] ? [[v[d + '_from2'], v[d + '_to2']]] : [])] : [];
    await api('practitioner.setAvailability', { weekly, slotMinutes: Number(v.slotMinutes), blockedDates: (v.blocked || '').split(',').map((x) => x.trim()).filter(Boolean) });
    toast('Availability saved.'); refresh();
  });
  ctx.form('prof', async (v) => { await api('practitioner.updateProfile', { feeGhs: v.feeGhs, modes: v.modes || [], languages: v.languages.split(','), bio: v.bio }); toast('Profile updated.'); refresh(); });
  ctx.form('renew', async (v) => { await api('practitioner.renewLicence', v); toast('Renewal submitted for verification.'); refresh(); });
  ctx.form('evidence', async (v, form) => {
    const file = form.file.files[0];
    if (!file) throw Object.assign(new Error('Choose a file.'), { details: { field: 'file' } });
    await api('documents.upload', { name: file.name, mime: file.type, kind: 'record', dataB64: await readFileB64(file) });
    toast('Evidence uploaded. Tick it in the application to attach it.'); refresh();
  });
  if (editable) {
    const docs = await api('documents.list');
    const v = p || { modes: ['physical', 'telephone'], languages: ['English', 'Twi'], facility: {}, settlement: { method: 'momo' } };
    return html`
      ${when(p?.status === 'changes_required', () => html`<p class="note warn">${icon('alert')} PRORESMAT asked for changes: ${p?.statusHistory.at(-1)?.reason}</p>`)}
      <p class="muted small">PRORESMAT verifies every item before your profile is published. Use your lawful professional title as registered.</p>
      <form class="card stack" data-form="evidence" novalidate><h3>Upload evidence</h3><p class="small muted">Licence, certificates, Ghana Card and facility licence (PDF/JPEG/PNG).</p><label class="field" data-field="file"><span class="lbl">File</span><input type="file" name="file" accept="application/pdf,image/jpeg,image/png"><span class="err"></span></label><p class="form-error" role="alert" hidden></p><button class="btn ghost">${icon('upload')} Upload</button></form>
      <form class="card stack" data-form="apply" novalidate>
        <h3>Identity</h3>
        ${field('Full name', input('fullName', { value: v.fullName || S.user.name }))}
        ${field('Ghana Card number', input('idNumber', { value: v.identity?.idNumber || '', placeholder: 'GHA-123456789-0' }))}
        <h3>Professional details</h3>
        ${field('Professional title (as registered)', input('title', { value: v.title || '', placeholder: 'e.g. Traditional Medicine Practitioner, Medical Herbalist' }))}
        ${field('Category', select('category', Object.entries(categories), v.category || 'traditional'))}
        ${field('Area of practice', input('practiceArea', { value: v.practiceArea || '' }))}
        ${field('Qualification', input('qualification', { value: v.qualification || '' }))}
        <div class="grid2">${field('Council', select('council', Object.entries(councils).map(([k, l]) => [k, `${k} – ${l}`]), v.council || 'TMPC'))}${field('Registration number', input('registrationNumber', { value: v.registrationNumber || '' }))}</div>
        ${field('Licence expiry', input('licenceExpiry', { type: 'date', value: v.licenceExpiry || '' }))}
        <h3>Facility</h3>
        ${field('Facility name', input('facility.name', { value: v.facility?.name || '' }))}
        <div class="grid2">${field('Facility licence number', input('facility.licenceNo', { value: v.facility?.licenceNo || '' }))}${field('Facility licence expiry', input('facility.licenceExpiry', { type: 'date', value: v.facility?.licenceExpiry || '' }))}</div>
        ${field('Facility address', input('facility.address', { value: v.facility?.address || '' }))}
        <h3>Consultations</h3>
        ${field('Location (town)', input('location', { value: v.location || '' }))}
        ${field('Languages (comma separated)', input('languages', { value: (v.languages || []).join(', ') }))}
        <fieldset><legend>Consultation types</legend>${[['physical', 'In person'], ['telephone', 'Telephone'], ['video', 'Video']].map(([k, l]) => check('modes[]', l, (v.modes || []).includes(k), k))}</fieldset>
        ${field('Fee (GH₵)', input('feeGhs', { type: 'number', value: v.fee ? v.fee / 100 : 100, attrs: 'min="10" max="5000" step="1"' }))}
        ${field('Short biography', textarea('bio', { value: v.bio || '', rows: 3 }), 'No cure claims.')}
        <h3>Settlement</h3>
        ${field('Payout method', select('settlement.method', [['momo', 'Mobile money'], ['bank', 'Bank account']], v.settlement?.method || 'momo'))}
        ${field('Account name', input('settlement.accountName', { value: v.settlement?.accountName || '' }))}
        <div class="grid2">${field('Mobile money network', select('settlement.momoProvider', [['mtn', 'MTN'], ['telecel', 'Telecel'], ['airteltigo', 'AirtelTigo']], v.settlement?.momoProvider || 'mtn'))}${field('Mobile money number', input('settlement.momoNumber', { type: 'tel', value: v.settlement?.momoNumber ? v.settlement.momoNumber.replace('+233', '0') : '' }))}</div>
        <div class="grid2">${field('Bank name', input('settlement.bankName', { value: v.settlement?.bankName || '' }))}${field('Account number', input('settlement.accountNumber', { value: v.settlement?.accountNumber || '' }))}</div>
        ${when(docs.length, () => html`<fieldset><legend>Attach evidence</legend>${docs.map((d) => check('evidenceDocIds[]', d.name, (v.evidenceDocIds || []).includes(d.id), d.id))}</fieldset>`)}
        <h3>Agreements</h3>
        ${check('agree_provider', 'I accept the PRORESMAT provider agreement, including fees, commission and settlement terms.')}
        ${check('agree_conf', 'I commit to keep patient information confidential and use it only for their care.')}
        ${check('agree_conduct', 'I accept the platform code of conduct: lawful titles only, no cure claims, and referral when care is beyond my scope.')}
        <p class="form-error" role="alert" hidden></p>
        <button class="btn primary">Submit for verification</button></form>`;
  }
  const w = p.availability.weekly;
  return html`
    <div class="card row">${avatar(p.avatar, 56, p.fullName)}<div class="grow"><strong>${p.fullName}</strong><p class="small">${p.title}</p>${classBadge(p.providerClass, p.classLabel)}</div>${status(p.status)}</div>
    ${when(p.status === 'submitted', () => html`<p class="note">${icon('clock')} Submitted ${fmtDate(p.submittedAt)}. PRORESMAT is verifying your credentials.</p>`)}
    ${section('Credentials', kv([['Registration', regLabel(p.council, p.registrationNumber)], ['Licence expiry', html`${fmtDate(p.licenceExpiry)} ${p.bookable ? '' : status('expired', 'Hidden from search')}`], ['Facility', `${p.facility.name} (licence ${p.facility.licenceNo}, to ${fmtDate(p.facility.licenceExpiry)})`], ['Supervisor', p.supervisorName || '—'], ['Prescribing scope', p.canPrescribe ? 'Prescriptions allowed' : 'Care plans and recommendations'], ['Settlement', p.settlement.method === 'bank' ? `${p.settlement.bankName} ••${p.settlement.accountNumber.slice(-4)}` : `${p.settlement.momoProvider.toUpperCase()} MoMo ••${p.settlement.momoNumber.slice(-4)}`]]))}
    ${p.pendingRenewal ? html`<p class="note">${icon('clock')} Licence renewal to ${fmtDate(p.pendingRenewal.licenceExpiry)} is awaiting verification.</p>` : html`<form class="card stack" data-form="renew" novalidate><h3>Licence renewal</h3><div class="grid2">${field('New licence expiry', input('licenceExpiry', { type: 'date' }))}${field('Registration number', input('registrationNumber', { value: p.registrationNumber }))}</div><p class="form-error" role="alert" hidden></p><button class="btn ghost">Submit renewal</button></form>`}
    <form class="card stack" data-form="avail" novalidate><h3>Availability (Ghana time)</h3>
      ${DAYS.map(([d, label]) => { const win = w[d] || []; return html`<div class="avail-row"><label class="check"><input type="checkbox" name="${d}_on" ${win.length ? raw('checked') : ''}><span>${label}</span></label><input type="time" name="${d}_from" value="${win[0]?.[0] || '09:00'}" aria-label="${label} from"><input type="time" name="${d}_to" value="${win[0]?.[1] || '13:00'}" aria-label="${label} to"><input type="time" name="${d}_from2" value="${win[1]?.[0] || ''}" aria-label="${label} second session from"><input type="time" name="${d}_to2" value="${win[1]?.[1] || ''}" aria-label="${label} second session to"></div>`; })}
      <div class="grid2">${field('Slot length', select('slotMinutes', [[15, '15 minutes'], [20, '20 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '60 minutes']], p.availability.slotMinutes))}${field('Days off (YYYY-MM-DD, comma separated)', input('blocked', { value: (p.availability.blockedDates || []).join(', ') }))}</div>
      <p class="form-error" role="alert" hidden></p><button class="btn primary">Save availability</button></form>
    <form class="card stack" data-form="prof" novalidate><h3>Public profile</h3>
      ${field('Fee (GH₵)', input('feeGhs', { type: 'number', value: p.fee / 100, attrs: 'min="10" max="5000"' }))}
      <fieldset><legend>Consultation types</legend>${[['physical', 'In person'], ['telephone', 'Telephone'], ['video', 'Video']].map(([k, l]) => check('modes[]', l, p.modes.includes(k), k))}</fieldset>
      ${field('Languages', input('languages', { value: p.languages.join(', ') }))}${field('Biography', textarea('bio', { value: p.bio, rows: 3 }))}
      <p class="form-error" role="alert" hidden></p><button class="btn ghost">Save profile</button></form>
    <div class="stack"><button class="btn ghost" data-go="#/c/profile">${icon('user')} My customer account & sign out</button></div>`;
}, { auth: true });

export { fmtTime };
