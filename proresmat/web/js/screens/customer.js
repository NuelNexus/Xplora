// Customer environment: Home • Consult • Products • Orders • Profile
import { route, S, go, api, toast, sheet, confirmSheet, refresh, closeSheets, envsFor, ENVS, signOut } from '../app.js';
import {
  regLabel, html, raw, icon, money, fmtDate, fmtDay, fmtTime, fmtDateTime, words, cap, avatar, packArt, status, classBadge, sellerBadge, stars,
  empty, kv, section, tabs, emergency, field, input, textarea, select, check, when, readFileB64, idem, phone, esc,
} from '../ui.js';
import { openDocument } from '../api.js';
import { t, setLang } from '../i18n.js';
import { privacyNotice } from './auth.js';

const modeIcon = { physical: 'pin', telephone: 'phone', video: 'video' };
const modeLabel = { physical: 'In person', telephone: 'Telephone', video: 'Video' };

const pracCard = (p) => html`<button type="button" class="card prac" data-go="#/c/practitioner/${p.id}">
  ${avatar(p.avatar, 52, p.fullName)}
  <span class="prac-main"><strong>${p.fullName}</strong><span class="small">${p.title}</span>${classBadge(p.providerClass)}
  <span class="meta small">${icon('pin')}${p.location} · ${p.languages.join(', ')}</span>
  <span class="meta small">${p.modes.map((m) => html`<span title="${modeLabel[m]}">${icon(modeIcon[m])}</span>`)} <b>${money(p.fee)}</b> · ${p.nextAvailable ? html`Next: ${fmtDay(p.nextAvailable)} ${fmtTime(p.nextAvailable)}` : 'No slots in the next 3 weeks'}</span>
  ${stars(p.rating)}</span></button>`;

const productCard = (p) => html`<button type="button" class="card prod" data-go="#/c/product/${p.id}">${packArt(p.image, 64, p.name)}<span class="prod-main"><strong>${p.name}</strong><span class="small muted">${p.dosageForm} · ${p.packSize}</span>${sellerBadge(p.seller, p.sellerIsProresmat)}<span class="row between"><b>${money(p.price)}</b>${p.stock <= 5 ? html`<span class="small warn-text">Only ${p.stock} left</span>` : ''}</span></span></button>`;

const disclaimer = () => html`<p class="muted small">Product information shows the approved indication only. Products support, and do not replace, care from a qualified practitioner.</p>`;

// ---------- Home ----------
route('/c/home', async (ctx) => {
  ctx.title = 'PRORESMAT';
  const h = await api('home.get');
  ctx.form('search', (v) => go('#/c/search?q=' + encodeURIComponent(v.q || '')));
  return html`
    <section class="hero">
      <p class="eyebrow">${S.user ? `${t('greeting')}, ${S.user.name.split(' ')[0]}` : t('greeting')}</p>
      <h2 class="display">${t('promise')}</h2>
      <form class="search" data-form="search" role="search"><label class="sr-only" for="f-q">${t('search')}</label>${icon('search')}<input id="f-q" name="q" type="search" placeholder="${t('search')}" autocomplete="off"><button class="btn small primary">Search</button></form>
    </section>
    ${emergency(true)}
    <div class="quick">
      <button type="button" class="quick-btn primary" data-go="#/c/consult">${icon('consult')}<span><strong>${t('bookConsult')}</strong><span class="small">${h.counts.practitioners} verified practitioners</span></span></button>
      <button type="button" class="quick-btn" data-go="#/c/products">${icon('leaf')}<span><strong>${t('shopProducts')}</strong><span class="small">${h.counts.products} products · ${h.counts.clinics} clinic${h.counts.clinics === 1 ? '' : 's'}</span></span></button>
    </div>
    ${when(h.upcoming || h.activeOrder, () => section(t('upcoming'), html`<div class="list">
      ${h.upcoming ? html`<button type="button" class="list-item" data-go="#/c/booking/${h.upcoming.id}">${icon(modeIcon[h.upcoming.mode], 'lead')}<span class="li-main"><strong>${fmtDay(h.upcoming.start)}, ${fmtTime(h.upcoming.start)} GMT</strong><span class="small">${modeLabel[h.upcoming.mode]} consultation with ${h.upcoming.practitioner}</span></span>${status(h.upcoming.status)}</button>` : ''}
      ${h.activeOrder ? html`<button type="button" class="list-item" data-go="#/c/order/${h.activeOrder.id}">${icon('truck', 'lead')}<span class="li-main"><strong>Order ${h.activeOrder.code}</strong><span class="small">${h.activeOrder.seller}</span></span>${status(h.activeOrder.status)}</button>` : ''}
    </div>`))}
    ${section(t('practitionersNear'), html`<div class="stack">${h.practitioners.slice(0, 4).map(pracCard)}</div>`, html`<a href="#/c/consult" class="small">${t('seeAll')}</a>`)}
    ${section(t('shopProducts'), html`<div class="grid-cards">${h.products.slice(0, 4).map(productCard)}</div>`, html`<a href="#/c/products" class="small">${t('seeAll')}</a>`)}
    ${section(t('learn'), html`<div class="list">${h.education.map((a) => html`<button type="button" class="list-item" data-go="#/c/article/${a.id}">${icon('book', 'lead')}<span class="li-main"><strong>${a.title}</strong><span class="small muted">${cap(a.category)} · ${a.readMinutes} min read</span></span></button>`)}</div>`, html`<a href="#/c/learn" class="small">${t('seeAll')}</a>`)}
    <p class="note">${icon('shield')} Every practitioner, clinic and product here has passed PRORESMAT verification. Profiles show who provides each service and who sells each product.</p>`;
}, { auth: false });

route('/c/search', async (ctx) => {
  ctx.title = 'Search';
  ctx.back = '#/c/home';
  const q = ctx.query.q || '';
  const r = q ? await api('search.all', { q }) : { practitioners: [], clinics: [], products: [] };
  ctx.form('search', (v) => go('#/c/search?q=' + encodeURIComponent(v.q || '')));
  const total = r.practitioners.length + r.clinics.length + r.products.length;
  return html`<form class="search" data-form="search" role="search">${icon('search')}<input name="q" type="search" value="${q}" placeholder="${t('search')}" aria-label="Search"><button class="btn small primary">Search</button></form>
    ${!q ? empty('Search PRORESMAT', 'Try a name, a town, "Twi", "tea" or "skin".') : total === 0 ? empty('No results', 'Only verified practitioners, active clinics and approved products appear. Try another word.') : ''}
    ${when(r.practitioners.length, () => section('Practitioners', html`<div class="stack">${r.practitioners.map(pracCard)}</div>`))}
    ${when(r.clinics.length, () => section('Clinics', html`<div class="list">${r.clinics.map((c) => html`<button type="button" class="list-item" data-go="#/c/clinic/${c.id}">${icon('box', 'lead')}<span class="li-main"><strong>${c.name}</strong><span class="small muted">${c.address}</span></span></button>`)}</div>`))}
    ${when(r.products.length, () => section('Products', html`<div class="grid-cards">${r.products.map(productCard)}</div>`))}`;
}, { auth: false });

// ---------- Consult ----------
route('/c/consult', async (ctx) => {
  ctx.title = t('consult');
  const tab = ctx.query.tab || 'find';
  ctx.act('tab', (d) => go(`#/c/consult?tab=${d.v}`));
  ctx.change('filter', () => {
    const f = document.querySelector('form.filters');
    const q = new URLSearchParams({ tab: 'find', category: f.category.value, mode: f.mode.value, providerClass: f.providerClass.value });
    go('#/c/consult?' + q);
  });
  const head = tabs([['find', 'Find a practitioner'], ['mine', 'My consultations']], tab);
  if (tab === 'mine') {
    if (!S.user) return html`${head}${empty('Sign in to see your consultations', '', html`<button class="btn primary" data-go="#/login?next=%23%2Fc%2Fconsult%3Ftab%3Dmine">Sign in</button>`)}`;
    const list = await api('bookings.list');
    const up = list.filter((b) => ['confirmed', 'in_progress', 'pending_payment'].includes(b.status));
    const past = list.filter((b) => !up.includes(b));
    const row = (b) => html`<button type="button" class="list-item" data-go="#/c/booking/${b.id}">${icon(modeIcon[b.mode], 'lead')}<span class="li-main"><strong>${fmtDay(b.start)}, ${fmtTime(b.start)}</strong><span class="small">${b.practitioner.fullName} · ${modeLabel[b.mode]}</span><span class="muted small">${b.code}</span></span>${status(b.status)}</button>`;
    return html`${head}${section('Upcoming', up.length ? html`<div class="list">${up.map(row)}</div>` : empty('No upcoming consultations', '', html`<button class="btn primary" data-act="tab" data-v="find">Book a consultation</button>`))}${when(past.length, () => section('Past', html`<div class="list">${past.map(row)}</div>`))}`;
  }
  const q = ctx.query;
  const list = await api('practitioners.search', { category: q.category || '', mode: q.mode || '', providerClass: q.providerClass || '' });
  const cats = S.meta.practitionerCategories;
  return html`${head}
    <form class="filters" onsubmit="return false">
      ${select('category', Object.entries(cats), q.category || '', { blank: 'All categories' })}
      ${select('mode', [['physical', 'In person'], ['telephone', 'Telephone'], ...(S.meta.flags.videoConsultations ? [['video', 'Video']] : [])], q.mode || '', { blank: 'Any consultation type' })}
      ${select('providerClass', [['supervised', 'PRORESMAT-supervised'], ['independent', 'Verified independent']], q.providerClass || '', { blank: 'Any provider class' })}
    </form>
    <p class="muted small">${list.length} verified practitioner${list.length === 1 ? '' : 's'}. Profiles with expired licences are hidden automatically.</p>
    <div class="stack">${list.length ? list.map(pracCard) : empty('No practitioners match', 'Clear a filter to see more.')}</div>`;
}, { auth: false });

route('/c/practitioner/:id', async (ctx) => {
  const p = await api('practitioners.get', { id: ctx.params.id });
  ctx.title = p.fullName;
  ctx.back = '#/c/consult';
  return html`
    <div class="profile-head">${avatar(p.avatar, 76, p.fullName)}<div><h2>${p.fullName}</h2><p>${p.title}</p>${classBadge(p.providerClass)} ${stars(p.rating)}</div></div>
    <div class="card verify">${icon('shield', 'lead')}<div><strong>${p.providerClass === 'supervised' ? 'PRORESMAT-supervised practitioner' : 'Verified independent practitioner'}</strong><p class="small">${p.verification}</p>${when(p.supervisorName, () => html`<p class="small">Clinical supervisor: ${p.supervisorName}</p>`)}</div></div>
    ${kv([
      ['Qualification', p.qualification], ['Registration', regLabel(p.council, p.registrationNumber)], ['Licence status', html`${status(p.licenceStatus === 'Current' ? 'active' : 'expired', p.licenceStatus)} <span class="small muted">valid to ${fmtDate(p.licenceExpiry)}</span>`],
      ['Category', p.categoryLabel], ['Area of practice', p.practiceArea], ['Facility', html`${p.facility.name}<br><span class="small muted">${p.facility.address}</span>`], ['Location', p.location], ['Languages', p.languages.join(', ')],
      ['Consultation types', p.modes.map((m) => modeLabel[m]).join(', ')], ['Fee', html`<b>${money(p.fee)}</b> per consultation`], ['Next available', p.nextAvailable ? fmtDateTime(p.nextAvailable) + ' GMT' : 'No slots in the next 3 weeks'],
      p.canPrescribe ? ['Prescriptions', 'Registered scope includes prescriptions'] : ['Treatment', 'Issues treatment recommendations and care plans'],
    ])}
    ${when(p.bio, () => section('About', html`<p>${p.bio}</p>`))}
    ${section('Reviews', p.reviews.length ? html`<div class="list">${p.reviews.map((r) => html`<div class="list-item"><span class="li-main"><span>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} <span class="muted small">${r.authorName} · ${fmtDate(r.createdAt)}</span></span><span class="small">${r.text}</span></span></div>`)}</div><p class="muted small">Reviews describe the service experience and are moderated. They are not evidence that a treatment works.</p>` : html`<p class="muted">No reviews yet.</p>`)}
    <div class="sticky-cta"><button class="btn primary block" data-go="#/c/book/${p.id}" ${p.nextAvailable ? '' : raw('disabled')}>Book a consultation · ${money(p.fee)}</button></div>`;
}, { auth: false });

// ---------- Booking wizard ----------
const draft = {};
route('/c/book/:id', async (ctx) => {
  const id = ctx.params.id;
  const d = draft[id] ||= { step: 1 };
  const p = await api('practitioners.get', { id });
  ctx.title = 'Book consultation';
  ctx.back = `#/c/practitioner/${id}`;
  ctx.hideNav = true;
  const step = d.step;
  const steps = ['Type', 'Time', 'Screening', 'Review', 'Pay'];
  const bar = html`<ol class="steps" aria-label="Booking steps">${steps.map((s, i) => html`<li class="${i + 1 < step ? 'done' : i + 1 === step ? 'on' : ''}" ${i + 1 === step ? raw('aria-current="step"') : ''}>${s}</li>`)}</ol>
    <div class="mini-prac">${avatar(p.avatar, 36, p.fullName)}<span><strong>${p.fullName}</strong><span class="small"> · ${p.title}</span><br>${classBadge(p.providerClass)}</span></div>`;
  ctx.act('back', () => { d.step = Math.max(1, d.step - 1); refresh(); });

  if (step === 1) {
    ctx.act('mode', (x) => { d.mode = x.v; d.step = 2; refresh(); });
    return html`${bar}<h3>How would you like to consult?</h3><div class="stack">${p.modes.map((m) => html`<button type="button" class="card choice ${d.mode === m ? 'on' : ''}" data-act="mode" data-v="${m}">${icon(modeIcon[m], 'lead')}<span><strong>${modeLabel[m]}</strong><span class="small muted">${m === 'physical' ? `At ${p.facility.name}, ${p.facility.address}` : m === 'telephone' ? 'The practitioner calls your registered number' : 'A secure video link appears in your booking once paid'}</span></span></button>`)}</div>`;
  }
  if (step === 2) {
    const { days } = await api('practitioners.slots', { id });
    const withSlots = days.filter((x) => x.slots.some((s) => s.available));
    d.date = d.date && withSlots.some((x) => x.date === d.date) ? d.date : withSlots[0]?.date;
    ctx.act('date', (x) => { d.date = x.v; d.start = null; refresh(); });
    ctx.act('slot', (x) => { d.start = x.v; d.step = 3; refresh(); });
    const day = days.find((x) => x.date === d.date);
    return html`${bar}<h3>Choose a date and time</h3><p class="muted small">Times are Ghana time (GMT).</p>
      <div class="date-strip" role="listbox" aria-label="Dates">${days.map((x) => { const n = x.slots.filter((s) => s.available).length; return html`<button type="button" class="date ${x.date === d.date ? 'on' : ''}" data-act="date" data-v="${x.date}" ${n ? '' : raw('disabled')} aria-label="${fmtDay(x.date)}, ${n} slots"><span class="small">${fmtDay(x.date).split(' ')[0]}</span><strong>${x.date.slice(8)}</strong><span class="small">${n || '–'}</span></button>`; })}</div>
      ${day ? html`<div class="slots">${day.slots.map((s) => html`<button type="button" class="slot ${d.start === s.start ? 'on' : ''}" data-act="slot" data-v="${s.start}" ${s.available ? '' : raw('disabled aria-label="Taken"')}>${fmtTime(s.start)}</button>`)}</div>` : empty('No free slots in the next two weeks')}
      <button class="btn ghost" data-act="back">Back</button>`;
  }
  if (step === 3) {
    const flags = await api('bookings.redFlags');
    const hp = S.user.health || {};
    ctx.form('screen', async (v) => {
      d.reason = v.reason; d.screening = { redFlags: v.redFlags || [], pregnancy: v.pregnancy, breastfeeding: v.breastfeeding, allergies: v.allergies, currentMeds: v.currentMeds };
      if ((v.redFlags || []).length) {
        // Server records the red flag for follow-up and blocks the booking.
        try { await api('bookings.create', { practitionerId: id, mode: d.mode, start: d.start, reason: v.reason || 'Red-flag screening', screening: d.screening, consent: true, policyAccepted: true }); } catch (e) { if (e.code !== 'RED_FLAG') throw e; }
        d.step = 1;
        sheet('Get emergency care now', html`<div class="stack">${emergency()}<p>Your answers suggest a problem that needs urgent, in-person medical care. Please do not wait for a consultation on PRORESMAT.</p><p class="small muted">We have logged this for a PRORESMAT care officer to follow up. Your booking has not been made and you have not been charged.</p><button class="btn primary" data-close>I understand</button></div>`);
        return;
      }
      if (!v.reason || v.reason.trim().length < 5) { const e = new Error('Describe the reason for your consultation (at least 5 characters).'); e.details = { field: 'reason' }; throw e; }
      d.step = 4; refresh();
    });
    return html`${bar}<form class="stack" data-form="screen" novalidate>
      ${field('Reason for consultation', textarea('reason', { value: d.reason || '', placeholder: 'What would you like help with? How long has it been going on?', rows: 4 }), 'Visible only to your practitioner and their clinical supervisor', 'reason')}
      <fieldset class="card"><legend>${icon('alert')} Safety check: do you have any of these right now?</legend>
        ${Object.entries(flags).map(([k, l]) => check('redFlags[]', l, (d.screening?.redFlags || []).includes(k), k))}
        <p class="muted small">If you tick any of these we will direct you to emergency care instead of booking.</p></fieldset>
      ${field('Allergies (medicines, herbs, foods)', input('allergies', { value: d.screening?.allergies ?? hp.allergies ?? '', placeholder: 'e.g. penicillin, none' }))}
      ${field('Current medicines and herbal products', textarea('currentMeds', { value: d.screening?.currentMeds ?? hp.currentMeds ?? '', placeholder: 'Include hospital medicines, teas, tonics and supplements', rows: 2 }), 'Some herbs interact with medicines, so list everything you take')}
      <div class="grid2">${field('Pregnant?', select('pregnancy', [['not_applicable', 'Not applicable'], ['no', 'No'], ['yes', 'Yes'], ['unsure', 'Not sure']], d.screening?.pregnancy || 'not_applicable'))}${field('Breastfeeding?', select('breastfeeding', [['not_applicable', 'Not applicable'], ['no', 'No'], ['yes', 'Yes']], d.screening?.breastfeeding || 'not_applicable'))}</div>
      <p class="form-error" role="alert" hidden></p>
      <div class="row between"><button type="button" class="btn ghost" data-act="back">Back</button><button class="btn primary">Continue</button></div></form>`;
  }
  if (step === 4) {
    const c = S.meta.settings.cancellation;
    const docs = await api('documents.list');
    ctx.act('privacy', () => sheet('Privacy notice', privacyNotice()));
    ctx.form('confirm', async (v) => {
      const b = await api('bookings.create', { practitionerId: id, mode: d.mode, start: d.start, reason: d.reason, screening: d.screening, consent: v.consent === true, policyAccepted: v.policy === true, docIds: v.docIds || [] });
      d.bookingId = b.id; d.step = 5; refresh();
    });
    return html`${bar}<h3>Review your booking</h3>
      ${kv([['Practitioner', html`${p.fullName}<br><span class="small">${p.title}</span>`], ['Provider', html`${classBadge(p.providerClass)}<br><span class="small muted">${p.providerClass === 'supervised' ? 'Provided under PRORESMAT clinical supervision' : 'Independent practitioner; not employed by PRORESMAT. PRORESMAT verifies eligibility, governs platform conduct and handles payment.'}</span>`], ['Type', modeLabel[d.mode]], ['When', `${fmtDateTime(d.start)} GMT`], ['Where', d.mode === 'physical' ? `${p.facility.name}, ${p.facility.address}` : d.mode === 'telephone' ? `We will share the number once paid; the practitioner may call ${phone(S.user.phone)}` : 'Video link shown after payment'], ['Fee', html`<b>${money(p.fee)}</b>, paid to PRORESMAT`]])}
      <div class="card small"><strong>Cancellation policy</strong><p>Cancel ${c.fullRefundHours}+ hours before: full refund. ${c.partialRefundHours}–${c.fullRefundHours} hours before: ${c.partialRefundPct}% refund. Less than ${c.partialRefundHours} hours: no refund. If the practitioner cancels you get a full refund or can rebook.</p><p>Your slot is held for ${S.meta.settings.slotHoldMinutes} minutes while you pay.</p></div>
      <form class="stack" data-form="confirm" novalidate>
        ${when(docs.length, () => html`<fieldset class="card"><legend>Share documents with this practitioner (optional)</legend>${docs.map((x) => check('docIds[]', `${x.name} (${cap(x.kind)})`, false, x.id))}<p class="muted small">Only this practitioner and their supervisor can open shared documents.</p></fieldset>`)}
        <div class="consent">${check('consent', 'I consent to this consultation. I understand the practitioner will record notes about my care, and that PRORESMAT does not replace emergency or hospital care.')}</div>
        <div class="consent">${check('policy', raw('I accept the cancellation policy and have read the <a href="#" data-act="privacy">privacy notice</a>.'))}</div>
        <p class="form-error" role="alert" hidden></p>
        <div class="row between"><button type="button" class="btn ghost" data-act="back">Back</button><button class="btn primary">Continue to payment</button></div>
      </form>`;
  }
  // step 5: payment
  ctx.form('pay', async (v) => {
    const r = await api('payments.initialize', { purpose: 'booking', targetId: d.bookingId, channel: v.channel, idempotencyKey: d.key ||= idem() });
    delete draft[id];
    if (r.mode === 'live') location.href = r.authorizationUrl; else go(r.authorizationUrl);
  });
  return html`${bar}<h3>Pay ${money(p.fee)}</h3><p class="muted small">PRORESMAT collects the full payment through Paystack and pays the practitioner after your consultation.</p>
    <form class="stack" data-form="pay">${payChannels()}<p class="form-error" role="alert" hidden></p><button class="btn primary block">Pay ${money(p.fee)}</button></form>`;
}, { auth: true });

export const payChannels = (v = 'mobile_money') => html`<div class="choices" role="radiogroup" aria-label="Payment method">
  <label class="card choice"><input type="radio" name="channel" value="mobile_money" ${v === 'mobile_money' ? raw('checked') : ''}>${icon('momo', 'lead')}<span><strong>Mobile Money Payment</strong><span class="small muted">MTN, Telecel, AirtelTigo</span></span></label>
  <label class="card choice"><input type="radio" name="channel" value="card" ${v === 'card' ? raw('checked') : ''}>${icon('card', 'lead')}<span><strong>Debit or credit card</strong><span class="small muted">Visa, Mastercard, Verve</span></span></label></div>`;

// ---------- Booking detail ----------
route('/c/booking/:id', async (ctx) => {
  const b = await api('bookings.get', { id: ctx.params.id });
  ctx.title = `Consultation ${b.code}`;
  ctx.back = '#/c/consult?tab=mine';
  const plans = b.carePlanIds.length ? await api('carePlans.list') : [];
  const myPlans = plans.filter((c) => c.bookingId === b.id);
  ctx.act('pay', async () => {
    const r = await api('payments.initialize', { purpose: 'booking', targetId: b.id, channel: 'mobile_money', idempotencyKey: idem() });
    if (r.mode === 'live') location.href = r.authorizationUrl; else go(r.authorizationUrl);
  });
  ctx.act('cancel', async () => {
    const q = b.status === 'pending_payment' ? { refund: 0, pct: 0 } : await api('bookings.cancelQuote', { id: b.id });
    const r = await confirmSheet({ title: 'Cancel this consultation?', body: b.status === 'pending_payment' ? 'You have not paid yet, so nothing will be charged.' : html`You are cancelling ${q.hoursBefore} hours before the start. Under the policy you will receive <b>${money(q.refund)}</b> (${q.pct}% of ${money(q.paidAmount)}).`, confirmLabel: 'Cancel consultation', danger: true });
    if (!r.ok) return;
    await api('bookings.cancel', { id: b.id });
    toast(q.refund ? `Cancelled. ${money(q.refund)} refund issued.` : 'Consultation cancelled.');
    refresh();
  });
  ctx.act('share', async () => {
    const docs = await api('documents.list');
    const s = sheet('Share documents', docs.length ? html`<form class="stack" data-form="shareDocs">${docs.map((x) => check('docIds[]', `${x.name} (${cap(x.kind)})`, (b.sharedDocs || []).some((y) => y.id === x.id), x.id))}<p class="muted small">Unticking a document withdraws access.</p><button class="btn primary">Save</button></form>` : html`<p>You have no documents yet.</p><button class="btn primary" data-go="#/c/documents">Upload a document</button>`);
    void s;
  });
  ctx.form('shareDocs', async (v) => { await api('bookings.shareDocuments', { id: b.id, docIds: v.docIds || [], replace: true }); closeSheets(); toast('Sharing updated.'); refresh(); });
  ctx.act('doc', async (x) => viewDoc(x.id));
  ctx.act('review', () => sheet('Rate your experience', reviewForm()));
  ctx.form('review', async (v) => { const r = await api('reviews.create', { targetType: 'practitioner', bookingId: b.id, rating: Number(v.rating), text: v.text }); closeSheets(); toast(r.message); refresh(); });
  ctx.act('complain', () => complaintSheet({ bookingId: b.id, subject: `Consultation ${b.code}` }));
  ctx.form('ticket', submitTicket);
  const canCancel = ['confirmed', 'pending_payment'].includes(b.status) && Date.parse(b.start) > Date.now();
  return html`
    <div class="card"><div class="row between"><div><p class="eyebrow">${modeLabel[b.mode]} consultation</p><h2>${fmtDay(b.start)}, ${fmtTime(b.start)} GMT</h2></div>${status(b.status)}</div>
      <div class="mini-prac">${icon('user', 'lead')}<span><strong>${b.practitioner.fullName}</strong> · ${b.practitioner.title}<br>${classBadge(b.practitioner.providerClass)}</span></div>
      ${when(b.status === 'pending_payment', () => html`<p class="note warn">${icon('clock')} Slot held until ${fmtTime(b.holdUntil)} GMT. Pay to confirm.</p><button class="btn primary block" data-act="pay">Pay ${money(b.fee)}</button>`)}
      ${when(b.videoLink, () => html`<p class="note">${icon('video')} Video link: <a href="${b.videoLink}" target="_blank" rel="noopener">${b.videoLink}</a></p>`)}
      ${when(b.mode === 'telephone' && b.practitioner.phone, () => html`<p class="note">${icon('phone')} The practitioner will call you from <span class="mono">${phone(b.practitioner.phone)}</span>.</p>`)}
      ${when(b.mode === 'physical' && ['confirmed', 'in_progress'].includes(b.status), () => html`<p class="note">${icon('pin')} ${b.practitioner.facility}</p>`)}
      ${when(b.cancelReason, () => html`<p class="small muted">${b.cancelReason}</p>`)}
    </div>
    ${when(b.referral, () => html`<div class="card alert-card">${icon('flag', 'lead')}<div><strong>Referral: ${b.referral.to}</strong><p class="small">${b.referral.reason}</p><p class="small">Urgency: ${cap(b.referral.urgency)}</p></div></div>`)}
    ${when(myPlans.length, () => section('Care plan', html`<div class="list">${myPlans.map((c) => html`<button type="button" class="list-item" data-go="#/c/careplan/${c.id}">${icon('clip', 'lead')}<span class="li-main"><strong>${c.type === 'prescription' ? 'Prescription' : 'Care plan'} ${c.code}</strong><span class="small muted">${c.items.length} item(s)${c.followUpDate ? ` · follow-up ${fmtDate(c.followUpDate)}` : ''}</span></span></button>`)}</div>`))}
    ${when(b.followUpDate && !myPlans.length, () => html`<p class="note">${icon('clock')} Follow-up due ${fmtDate(b.followUpDate)}</p>`)}
    ${section('Your details for this consultation', kv([['Reason', b.reason], ['Allergies', b.screening?.allergies || 'None recorded'], ['Current medicines', b.screening?.currentMeds || 'None recorded'], ['Pregnancy', words(b.screening?.pregnancy)], ['Consent given', fmtDateTime(b.consentAt)]]))}
    ${section('Shared documents', html`${(b.sharedDocs || []).length ? html`<div class="list">${b.sharedDocs.map((x) => html`<button type="button" class="list-item" data-act="doc" data-id="${x.id}">${icon('doc', 'lead')}<span class="li-main"><strong>${x.name}</strong><span class="small muted">${cap(x.kind)}</span></span></button>`)}</div>` : html`<p class="muted small">No documents shared.</p>`}${when(!['cancelled_customer', 'cancelled_provider', 'cancelled_system'].includes(b.status), () => html`<button class="btn ghost small" data-act="share">${icon('upload')} Share documents</button>`)}`)}
    ${when(b.payment, () => section('Payment', kv([['Amount', money(b.payment?.amount)], ['Status', status(b.payment?.status)], ['Refunded', b.payment?.refunded ? money(b.payment.refunded) : ''], ['Receipt', b.payment?.receiptNo ? html`<a href="#/c/receipt/${b.payment.reference}">${b.payment.receiptNo}</a>` : '']])))}
    <div class="stack">
      ${when(b.status === 'completed' && !b.reviewed, () => html`<button class="btn primary" data-act="review">${icon('star')} Rate your experience</button>`)}
      ${when(canCancel, () => html`<button class="btn ghost" data-act="cancel">Cancel consultation</button>`)}
      ${when(['completed', 'no_show', 'confirmed', 'in_progress'].includes(b.status), () => html`<button class="btn ghost" data-act="complain">Raise a complaint</button>`)}
      ${when(['completed'].includes(b.status), () => html`<button class="btn ghost" data-go="#/c/report?bookingId=${b.id}">Report a side effect or reaction</button>`)}
    </div>`;
}, { auth: true });

export async function viewDoc(id) {
  const d = await openDocument(id);
  const s = sheet(d.name, html`<div class="stack">${d.mime.startsWith('image/') ? html`<img src="${d.url}" alt="${d.name}" class="doc-img">` : html`<p class="muted">PDF document.</p>`}<a class="btn primary" href="${d.url}" target="_blank" rel="noopener">Open in a new tab</a><p class="muted small">This link expires in 5 minutes and this access has been logged.</p></div>`, { wide: true });
  s.el.addEventListener('click', () => {}, { once: true });
  const obs = new MutationObserver(() => { if (!document.body.contains(s.el)) { d.revoke(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}

const reviewForm = () => html`<form class="stack" data-form="review">
  <fieldset class="rating"><legend>Your rating</legend>${[5, 4, 3, 2, 1].map((n) => html`<label><input type="radio" name="rating" value="${n}" ${n === 5 ? raw('checked') : ''}><span>${'★'.repeat(n)}</span></label>`)}</fieldset>
  ${field('Your review', textarea('text', { rows: 4, placeholder: 'How was the service: communication, punctuality, clarity, delivery?' }))}
  <p class="muted small">Describe your experience of the service. Reviews that claim a product or treatment cured a condition cannot be published.</p>
  <p class="form-error" role="alert" hidden></p><button class="btn primary">Submit for moderation</button></form>`;

function complaintSheet(ref) {
  sheet('Raise a complaint', html`<form class="stack" data-form="ticket">
    <input type="hidden" name="kind" value="complaint">${ref.bookingId ? html`<input type="hidden" name="bookingId" value="${ref.bookingId}">` : ''}${ref.orderId ? html`<input type="hidden" name="orderId" value="${ref.orderId}">` : ''}
    ${field('Category', select('category', ref.orderId ? [['delivery', 'Delivery'], ['product_quality', 'Product quality'], ['payment', 'Payment'], ['general', 'Something else']] : [['practitioner_conduct', 'Practitioner conduct'], ['clinical_outcome', 'Outcome of care'], ['booking', 'Booking or attendance'], ['payment', 'Payment'], ['general', 'Something else']]))}
    ${field('Subject', input('subject', { value: ref.subject || '' }))}
    ${field('What happened?', textarea('message', { rows: 5 }))}
    <p class="muted small">Complaints are reviewed by PRORESMAT. Related provider payments are held until the complaint is resolved. Complaints about the outcome of care are reviewed by a clinician and do not trigger an automatic refund.</p>
    <p class="form-error" role="alert" hidden></p><button class="btn primary">Submit complaint</button></form>`);
}
async function submitTicket(v) {
  const t_ = await api('tickets.create', v);
  closeSheets();
  toast(`${t_.kind === 'complaint' ? 'Complaint' : 'Request'} ${t_.code} received.`);
  go('#/c/support');
}

// ---------- Products ----------
route('/c/products', async (ctx) => {
  ctx.title = t('products');
  const q = ctx.query;
  const list = await api('products.search', { category: q.category || '', seller: q.seller || '', form: q.form || '', q: q.q || '' });
  ctx.change('filter', () => {
    const f = document.querySelector('form.filters');
    go('#/c/products?' + new URLSearchParams({ category: f.category.value, seller: f.seller.value, form: f.form.value }));
  });
  return html`
    <form class="filters" onsubmit="return false">
      ${select('category', S.meta.productCategories.map((c) => [c, c]), q.category || '', { blank: 'All categories' })}
      ${select('seller', S.meta.sellers.map((s) => [s.id, s.label]), q.seller || '', { blank: 'All sellers' })}
      ${select('form', S.meta.dosageForms.map((c) => [c, c]), q.form || '', { blank: 'All dosage forms' })}
    </form>
    ${when(S.meta.flags.conventionalPharmacy, () => html`<button type="button" class="card choice" data-go="#/c/rx">${icon('doc', 'lead')}<span><strong>Prescription medicines</strong><span class="small muted">Upload a prescription for validation by a licensed partner pharmacy</span></span></button>`, () => html`<p class="note">${icon('shield')} Prescription-only medicines are not sold in the app. They will be added through licensed partner pharmacies after regulatory approval.</p>`)}
    <p class="muted small">${list.length} approved product${list.length === 1 ? '' : 's'}</p>
    <div class="grid-cards">${list.length ? list.map(productCard) : empty('No products match', 'Clear a filter to see more.')}</div>
    ${disclaimer()}`;
}, { auth: false });

route('/c/product/:id', async (ctx) => {
  const p = await api('products.get', { id: ctx.params.id });
  ctx.title = p.name;
  ctx.back = '#/c/products';
  ctx.form('add', async (v) => {
    if (!S.user) return go('#/login?next=' + encodeURIComponent(location.hash));
    const cart = await api('cart.get');
    const existing = cart.groups.flatMap((g) => g.lines).find((l) => l.productId === p.id);
    await api('cart.setItem', { productId: p.id, qty: Math.min(10, (existing?.qty || 0) + Number(v.qty)) });
    toast(`Added to cart. ${p.seller}.`);
    refresh();
  });
  return html`
    <div class="product-head">${packArt(p.image, 120, p.name)}<div><h2>${p.name}</h2><p class="muted">${p.dosageForm} · ${p.packSize}</p>${sellerBadge(p.seller, p.sellerIsProresmat)}<p class="amount">${money(p.price)}</p>${stars(p.rating)}</div></div>
    <div class="card verify">${icon('shield', 'lead')}<div><strong>Approved product</strong><p class="small">PRORESMAT checked the FDA registration, full ingredient declaration and label claims before publishing. ${p.sellerIsProresmat ? 'PRORESMAT is the seller and handles fulfilment and refunds.' : `${p.seller.replace('Sold by ', '')} fulfils this order. PRORESMAT approved the listing, collects your payment and handles disputes.`}</p></div></div>
    ${section('Identity & registration', kv([['Seller', p.seller], ['FDA registration', html`<span class="mono">${p.fdaRegNo}</span>`], ['Status', p.fdaStatus], ['Manufacturer', p.manufacturer]]))}
    ${section('Composition', kv([['Ingredients', p.ingredients], p.strength && ['Strength', p.strength]]))}
    ${section('Use', kv([['Approved indication', p.indication], ['Directions', p.directions], ['Duration', p.duration]]))}
    ${section('Safety', html`<div class="safety">${kv([['Warnings', p.warnings], ['Do not use if', p.contraindications], ['Pregnancy & breastfeeding', p.pregnancy], ['Interactions', p.interactions]])}</div>`)}
    ${section('Delivery & returns', kv([['Options', [p.delivery && 'Home delivery', p.pickup && 'Pickup from seller'].filter(Boolean).join(' · ')], ['Stock', p.stock > 0 ? `${p.stock} available` : 'Out of stock'], ['Returns', p.returnEligible ? p.returnPolicy || 'Eligible for return' : 'Not returnable once opened'], ['Receipt', 'Issued by PRORESMAT on payment']]))}
    <p class="small"><a href="#/c/report?productId=${p.id}">Report a problem or suspected reaction</a></p>
    ${disclaimer()}
    <form class="sticky-cta row" data-form="add">${select('qty', [1, 2, 3, 4, 5].filter((n) => n <= p.stock).map((n) => [n, `Qty ${n}`]), 1)}<button class="btn primary grow" ${p.purchasable ? '' : raw('disabled')}>${p.purchasable ? t('addToCart') : 'Unavailable'}</button></form>`;
}, { auth: false });

route('/c/clinic/:id', async (ctx) => {
  const c = await api('clinics.get', { id: ctx.params.id });
  ctx.title = c.name;
  ctx.back = '#/c/products';
  return html`<div class="card"><h2>${c.name}</h2><p class="small">${c.address}</p>${sellerBadge('Verified clinic')} ${stars(c.rating)}<p class="small muted">Facility licence ${c.facilityLicenceNo} · valid to ${fmtDate(c.licenceExpiry)}</p>${when(c.description, () => html`<p>${c.description}</p>`)}</div>
    ${when(c.practitioners.length, () => section('Practitioners', html`<div class="stack">${c.practitioners.map(pracCard)}</div>`))}
    ${section('Products', c.products.length ? html`<div class="grid-cards">${c.products.map(productCard)}</div>` : html`<p class="muted">No products listed.</p>`)}`;
}, { auth: false });

// ---------- Cart & checkout ----------
route('/c/cart', async (ctx) => {
  ctx.title = t('cart');
  ctx.back = '#/c/products';
  const cart = await api('cart.get');
  ctx.change('qty', async (value, el) => { await api('cart.setItem', { productId: el.dataset.id, qty: Number(value) }); refresh(); });
  ctx.act('remove', async (d) => { await api('cart.setItem', { productId: d.id, qty: 0 }); refresh(); });
  ctx.change('method', (v) => { document.querySelector('[data-field="address"]').hidden = v !== 'delivery'; updateTotal(); });
  const nSellers = cart.groups.length;
  const updateTotal = () => {
    const m = document.querySelector('[name=deliveryMethod]:checked')?.value;
    const fee = m === 'delivery' ? cart.deliveryFeePerSeller * nSellers : 0;
    document.getElementById('del').textContent = money(fee).replace(' ', ' ');
    document.getElementById('tot').textContent = money(cart.subtotal + fee).replace(' ', ' ');
  };
  ctx.form('checkout', async (v) => {
    const c = await api('checkout.create', { deliveryMethod: v.deliveryMethod, address: v.address, phone: v.phone, termsAccepted: v.terms === true });
    const r = await api('payments.initialize', { purpose: 'checkout', targetId: c.checkoutId, channel: v.channel, idempotencyKey: idem() });
    if (r.mode === 'live') location.href = r.authorizationUrl; else go(r.authorizationUrl);
  });
  if (!cart.groups.length) return empty('Your cart is empty', 'Browse approved herbal products.', html`<button class="btn primary" data-go="#/c/products">Browse products</button>`);
  const canDeliver = cart.groups.every((g) => g.delivery);
  const canPickup = cart.groups.every((g) => g.pickup);
  const defaultMethod = canDeliver ? 'delivery' : 'pickup';
  ctx.after(() => updateTotal());
  return html`
    ${cart.groups.map((g) => html`<section class="card seller-group"><div class="row between"><strong>${g.seller}</strong><span class="small muted">${g.lines.length} item(s)</span></div>
      ${g.lines.map((l) => html`<div class="cart-line">${packArt(l.image, 48, l.name)}<div class="grow"><strong>${l.name}</strong><span class="small muted"> ${l.packSize}</span>${when(!l.available, () => html`<p class="small bad-text">No longer available in this quantity</p>`)}<div class="row"><label class="sr-only" for="q-${l.productId}">Quantity</label><select id="q-${l.productId}" data-change="qty" data-id="${l.productId}">${Array.from({ length: Math.min(10, Math.max(l.stock, l.qty)) }, (_, i) => i + 1).map((n) => html`<option ${n === l.qty ? raw('selected') : ''}>${n}</option>`)}</select><button class="btn small ghost" data-act="remove" data-id="${l.productId}">Remove</button></div></div><b>${money(l.lineTotal)}</b></div>`)}
      <p class="small muted">Refund terms: ${g.refundTerms}</p><p class="small muted">Pickup address: ${g.pickupAddress}</p></section>`)}
    <form class="card stack" data-form="checkout" novalidate>
      <fieldset><legend>Delivery</legend><div class="choices">
        <label class="card choice"><input type="radio" name="deliveryMethod" value="delivery" data-change="method" ${defaultMethod === 'delivery' ? raw('checked') : ''} ${canDeliver ? '' : raw('disabled')}>${icon('truck', 'lead')}<span><strong>Home delivery</strong><span class="small muted">${cart.plus ? 'Free with PRORESMAT Plus' : `${money(cart.deliveryFeePerSeller)} per seller`}</span></span></label>
        <label class="card choice"><input type="radio" name="deliveryMethod" value="pickup" data-change="method" ${defaultMethod === 'pickup' ? raw('checked') : ''} ${canPickup ? '' : raw('disabled')}>${icon('pin', 'lead')}<span><strong>Pickup</strong><span class="small muted">Collect from each seller</span></span></label></div></fieldset>
      <div data-field="address" ${defaultMethod === 'delivery' ? '' : raw('hidden')}>${field('Delivery address', textarea('address', { value: S.user.address || '', rows: 2, placeholder: 'House number, street, area, town, landmark' }), '', 'address')}</div>
      ${field('Phone for delivery updates', input('phone', { type: 'tel', value: phone(S.user.phone) }))}
      <fieldset><legend>Payment</legend>${payChannels()}</fieldset>
      ${kv([['Items', money(cart.subtotal)], ['Delivery', raw('<span id="del"></span>')], ['Total', raw('<b id="tot"></b>')]])}
      <div class="consent">${check('terms', `I have checked the sellers (${cart.groups.map((g) => g.seller.replace('Sold by ', '')).join(', ')}) and their refund terms. PRORESMAT collects the full payment and issues the receipt.`)}</div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block">Place order and pay</button>
    </form>${disclaimer()}`;
}, { auth: true });

// ---------- Orders ----------
route('/c/orders', async (ctx) => {
  ctx.title = t('orders');
  const tab = ctx.query.tab || 'orders';
  ctx.act('tab', (d) => go('#/c/orders?tab=' + d.v));
  const head = S.meta.flags.conventionalPharmacy ? tabs([['orders', 'Orders'], ['rx', 'Prescriptions']], tab) : '';
  if (tab === 'rx') return html`${head}${await rxList()}`;
  const list = await api('orders.list');
  return html`${head}${list.length ? html`<div class="list">${list.map((o) => html`<button type="button" class="list-item" data-go="#/c/order/${o.id}">${icon('bag', 'lead')}<span class="li-main"><strong>${o.code} · ${money(o.total)}</strong><span class="small">${o.seller}</span><span class="small muted">${fmtDate(o.createdAt)} · ${o.items.length} item(s) · ${o.deliveryMethod === 'delivery' ? 'Delivery' : 'Pickup'}</span></span>${status(o.status)}</button>`)}</div>` : empty('No orders yet', '', html`<button class="btn primary" data-go="#/c/products">Browse products</button>`)}`;
}, { auth: true });

const ORDER_STEPS = ['received', 'accepted', 'stock_confirmed', 'prepared', 'dispatched|ready_for_pickup', 'delivered', 'acknowledged'];
route('/c/order/:id', async (ctx) => {
  const o = await api('orders.get', { id: ctx.params.id });
  ctx.title = `Order ${o.code}`;
  ctx.back = '#/c/orders';
  ctx.act('ack', async () => { await api('orders.acknowledge', { id: o.id }); toast('Thanks for confirming.'); refresh(); });
  ctx.act('cancel', async () => {
    const r = await confirmSheet({ title: 'Cancel this order?', body: html`The seller has not accepted it yet. You will be refunded <b>${money(o.total - o.refunded)}</b> in full.`, confirmLabel: 'Cancel order', danger: true });
    if (!r.ok) return;
    await api('orders.cancel', { id: o.id }); toast('Order cancelled and refunded.'); refresh();
  });
  ctx.act('pay', async () => { go(`#/c/cart`); });
  ctx.act('reviewSeller', () => sheet(`Rate ${o.seller.replace('Sold by ', '')}`, reviewForm()));
  ctx.form('review', async (v) => { const r = await api('reviews.create', { targetType: 'org', orderId: o.id, rating: Number(v.rating), text: v.text }); closeSheets(); toast(r.message); refresh(); });
  ctx.act('complain', () => complaintSheet({ orderId: o.id, subject: `Order ${o.code}` }));
  ctx.form('ticket', submitTicket);
  const reached = new Set(o.timeline.map((x) => x.status));
  const stepsHtml = html`<ol class="timeline">${ORDER_STEPS.filter((s) => !(s.includes('|') && false)).map((s) => {
    const opts = s.split('|');
    const key = opts.find((x) => reached.has(x)) || (o.deliveryMethod === 'pickup' ? opts.at(-1) : opts[0]);
    const ev = o.timeline.find((x) => x.status === key);
    return html`<li class="${ev ? 'done' : ''}"><span class="tl-dot" aria-hidden="true"></span><span><strong>${cap(key)}</strong>${ev ? html`<span class="small muted"> · ${fmtDateTime(ev.at)}</span>${ev.note ? html`<br><span class="small">${ev.note}</span>` : ''}` : ''}</span></li>`;
  })}</ol>`;
  const canReviewSeller = ['delivered', 'acknowledged'].includes(o.status) && o.sellerType === 'clinic' && !o.reviewed.includes('org:' + o.orgId);
  return html`
    <div class="card"><div class="row between"><div><p class="eyebrow">${o.seller}</p><h2>${money(o.total)}</h2></div>${status(o.status)}</div>
      <p class="small muted">${o.deliveryMethod === 'delivery' ? `Delivery to ${o.address}` : `Pickup from ${o.pickupAddress}`}</p>
      ${when(o.payment, () => html`<p class="small">Receipt <a href="#/c/receipt/${o.payment?.reference}">${o.payment?.receiptNo}</a> · ${o.payment?.channel === 'mobile_money' ? 'Mobile Money Payment' : 'Card'}</p>`)}
      ${when(o.refunded, () => html`<p class="note">${icon('refresh')} ${money(o.refunded)} refunded</p>`)}
    </div>
    ${section('Items', html`<div class="list">${o.items.map((i) => html`<div class="list-item"><span class="li-main"><strong>${i.name} × ${i.qty}</strong>${i.batch ? html`<span class="small muted">Batch ${i.batch} · expires ${fmtDate(i.expiry)}</span>` : ''}${i.status === 'unavailable' ? html`<span class="small bad-text">Unavailable – refunded</span>` : ''}</span><b>${money(i.lineTotal)}</b></div>`)}${o.deliveryFee ? html`<div class="list-item"><span class="li-main">Delivery</span><b>${money(o.deliveryFee)}</b></div>` : ''}</div>`)}
    ${when(o.status !== 'cancelled' && o.status !== 'pending_payment', () => section('Progress', stepsHtml))}
    ${when(o.proofOfDelivery, () => html`<p class="note">${icon('check')} Received by ${o.proofOfDelivery?.receivedBy} on ${fmtDateTime(o.proofOfDelivery?.at)}</p>`)}
    <div class="stack">
      ${when(o.status === 'delivered', () => html`<button class="btn primary" data-act="ack">Confirm I received this order</button>`)}
      ${when(o.status === 'received', () => html`<button class="btn ghost" data-act="cancel">Cancel order</button>`)}
      ${when(canReviewSeller, () => html`<button class="btn ghost" data-act="reviewSeller">${icon('star')} Rate this seller</button>`)}
      ${when(!['pending_payment', 'expired'].includes(o.status), () => html`<button class="btn ghost" data-act="complain">Raise a complaint or return request</button><button class="btn ghost" data-go="#/c/report?orderId=${o.id}${o.items[0]?.productId ? '&productId=' + o.items[0].productId : ''}">Report a problem or reaction</button>`)}
    </div>`;
}, { auth: true });

// ---------- Prescriptions (regulated phase) ----------
async function rxList() {
  const list = await api('rx.list');
  return html`<button class="btn primary" data-go="#/c/rx">${icon('plus')} Submit a prescription</button>
    ${list.length ? html`<div class="list">${list.map((r) => html`<button type="button" class="list-item" data-go="#/c/rx">${icon('doc', 'lead')}<span class="li-main"><strong>${r.code}</strong><span class="small">${r.pharmacyName}</span></span>${status(r.status)}</button>`)}</div>` : ''}`;
}
route('/c/rx', async (ctx) => {
  ctx.title = 'Prescription medicines';
  ctx.back = '#/c/orders';
  if (!S.meta.flags.conventionalPharmacy) return html`<div class="card stack">${icon('lock')}<h3>Not available yet</h3><p>Prescription medicines will be offered through licensed partner pharmacies once PRORESMAT has formal regulatory authorisation. Approved herbal products are available now.</p><button class="btn primary" data-go="#/c/products">Browse herbal products</button></div>`;
  const [list, docs, plans] = await Promise.all([api('rx.list'), api('documents.list'), api('carePlans.list')]);
  const rxPlans = plans.filter((p) => p.type === 'prescription');
  ctx.form('rx', async (v) => {
    const [kind, id] = (v.source || '').split(':');
    await api('rx.create', { pharmacyOrgId: v.pharmacyOrgId, documentId: kind === 'doc' ? id : '', carePlanId: kind === 'cp' ? id : '', deliveryMethod: v.deliveryMethod, address: v.address, notes: v.notes });
    toast('Sent to the pharmacist for validation.'); refresh();
  });
  ctx.act('payrx', async (d) => { const r = await api('payments.initialize', { purpose: 'rx', targetId: d.id, channel: 'mobile_money', idempotencyKey: idem() }); if (r.mode === 'live') location.href = r.authorizationUrl; else go(r.authorizationUrl); });
  return html`<p class="note">${icon('shield')} Prescription validation required. A licensed pharmacist checks every prescription before anything is priced or dispensed. There is no direct cart for prescription-only medicines.</p>
    ${list.map((r) => html`<div class="card stack"><div class="row between"><strong>${r.code} · ${r.pharmacyName}</strong>${status(r.status)}</div>
      ${when(r.quote, () => html`${kv(r.quote?.items.map((i) => [`${i.name} × ${i.qty}`, money(i.lineTotal)]).concat(r.quote?.deliveryFee ? [['Delivery', money(r.quote.deliveryFee)]] : [], [['Total', html`<b>${money(r.quote?.total)}</b>`]]) || [])}<p class="small muted">Validated by ${r.decision?.name} (${r.decision?.regNo})</p>`)}
      ${when(r.status === 'rejected', () => html`<p class="small bad-text">${r.decision?.reason}</p>`)}
      ${when(r.status === 'quoted', () => html`<button class="btn primary" data-act="payrx" data-id="${r.id}">Pay ${money(r.quote?.total)}</button>`)}
      ${when(r.orderId, () => html`<button class="btn ghost" data-go="#/c/order/${r.orderId}">Track order</button>`)}</div>`)}
    <form class="card stack" data-form="rx" novalidate><h3>Submit a prescription</h3>
      ${field('Prescription', select('source', [...rxPlans.map((p) => [`cp:${p.id}`, `${p.code} from ${p.practitionerName}`]), ...docs.filter((d) => ['prescription', 'record'].includes(d.kind)).map((d) => [`doc:${d.id}`, `Uploaded: ${d.name}`])], '', { blank: 'Choose a prescription' }), html`Upload a photo of a paper prescription in <a href="#/c/documents">Documents</a> first.`)}
      ${field('Partner pharmacy', select('pharmacyOrgId', S.meta.pharmacies.map((p) => [p.id, `${p.name}, ${p.address}`])))}
      ${field('Collection', select('deliveryMethod', [['pickup', 'Pickup from pharmacy'], ['delivery', 'Home delivery']]))}
      ${field('Delivery address (if delivery)', textarea('address', { value: S.user.address || '', rows: 2 }))}
      ${field('Notes for the pharmacist', textarea('notes', { rows: 2 }))}
      <p class="form-error" role="alert" hidden></p><button class="btn primary">Send for validation</button></form>`;
}, { auth: true });

// ---------- Profile & integrated dashboard ----------
route('/c/profile', async (ctx) => {
  ctx.title = t('profile');
  if (!S.user) return html`<div class="card stack center">${icon('user', 'big')}<p>Sign in to manage consultations, orders, documents and payments.</p><button class="btn primary" data-go="#/login">Sign in</button><button class="btn ghost" data-go="#/register">Create account</button></div>`;
  const u = S.user;
  const [bookings, orders, plans, pays, tickets] = await Promise.all([api('bookings.list'), api('orders.list'), api('carePlans.list'), api('payments.list'), api('tickets.list')]);
  const envs = envsFor(u).filter((e) => e !== 'c');
  ctx.act('lang', async (d) => { await api('me.update', { lang: d.v }); S.user.lang = d.v; setLang(d.v); refresh(); });
  ctx.act('logout', () => signOut());
  ctx.act('plus', async () => {
    const r = await confirmSheet({ title: 'Join PRORESMAT Plus', body: html`Free delivery on every order for 30 days. ${money(S.meta.settings.plusMonthlyFee)} per month, sold by PRORESMAT. Cancel any time; it simply won't renew.`, confirmLabel: `Pay ${money(S.meta.settings.plusMonthlyFee)}` });
    if (!r.ok) return;
    const p = await api('payments.initialize', { purpose: 'subscription', targetId: u.id, channel: 'mobile_money', idempotencyKey: idem() });
    if (p.mode === 'live') location.href = p.authorizationUrl; else go(p.authorizationUrl);
  });
  const tile = (href, ic, label, count, sub) => html`<button type="button" class="tile" data-go="${href}">${icon(ic)}<strong>${label}</strong><span class="small muted">${count}${sub ? ' ' + sub : ''}</span></button>`;
  return html`
    <div class="card row"><span class="avatar" style="--h:150;width:52px;height:52px;font-size:19px">${u.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span><div class="grow"><strong>${u.name}</strong><p class="small muted">${u.email} · ${phone(u.phone)}</p>${when(u.isPlus, () => html`<span class="badge gold">PRORESMAT Plus to ${fmtDate(u.plusUntil)}</span>`)}</div></div>
    ${section('My health dashboard', html`<div class="tiles">
      ${tile('#/c/consult?tab=mine', 'consult', 'Consultations', bookings.filter((b) => ['confirmed', 'in_progress'].includes(b.status)).length, 'upcoming')}
      ${tile('#/c/careplans', 'clip', 'Care plans & prescriptions', plans.length, '')}
      ${tile('#/c/orders', 'bag', 'Orders', orders.filter((o) => !['acknowledged', 'cancelled', 'refunded', 'delivered'].includes(o.status)).length, 'active')}
      ${tile('#/c/documents', 'doc', 'Medical documents', '', 'Lab results, scans')}
      ${tile('#/c/payments', 'card', 'Payments & refunds', pays.length, 'receipts')}
      ${tile('#/c/support', 'people', 'Support & complaints', tickets.filter((x) => !['resolved', 'closed'].includes(x.status)).length, 'open')}
    </div>`)}
    ${section('Account', html`<div class="list">
      <button type="button" class="list-item" data-go="#/c/details">${icon('user', 'lead')}<span class="li-main"><strong>Personal & health details</strong><span class="small muted">Address, allergies, current medicines</span></span></button>
      <button type="button" class="list-item" data-go="#/c/privacy">${icon('lock', 'lead')}<span class="li-main"><strong>Privacy & security</strong><span class="small muted">Download your data, login history, deletion</span></span></button>
      <button type="button" class="list-item" data-go="#/c/learn">${icon('book', 'lead')}<span class="li-main"><strong>Health information</strong><span class="small muted">Tips, medicines, traditional medicine</span></span></button>
      <div class="list-item">${icon('globe', 'lead')}<span class="li-main"><strong>Language</strong></span><span class="seg"><button class="btn small ${u.lang === 'en' ? 'primary' : 'ghost'}" data-act="lang" data-v="en">English</button>${when(S.meta.flags.twi, () => html`<button class="btn small ${u.lang === 'tw' ? 'primary' : 'ghost'}" data-act="lang" data-v="tw">Twi</button>`)}</span></div>
    </div>`)}
    ${when(S.meta.flags.subscriptions && !u.isPlus, () => html`<div class="card plus"><strong>PRORESMAT Plus</strong><p class="small">Free delivery on all orders for ${money(S.meta.settings.plusMonthlyFee)} a month.</p><button class="btn gold" data-act="plus">Join Plus</button></div>`)}
    ${when(envs.length, () => section('Workspaces', html`<div class="list">${envs.map((e) => html`<button type="button" class="list-item" data-go="${ENVS[e].nav[0][1]}">${icon('chart', 'lead')}<span class="li-main"><strong>${ENVS[e].label}</strong></span></button>`)}</div>`))}
    <div class="stack">${when(S.meta.demo, () => html`<button class="btn ghost" data-go="#/demo">Test tools (clock, messages, reset)</button>`)}<button class="btn ghost" data-act="logout">${icon('logout')} ${t('signOut')}</button></div>`;
}, { auth: false });

route('/c/details', async (ctx) => {
  ctx.title = 'Personal & health details';
  ctx.back = '#/c/profile';
  const u = S.user;
  ctx.form('me', async (v) => { const r = await api('me.update', v); S.user = r.user; toast('Saved.'); go('#/c/profile'); });
  ctx.form('pw', async (v, form) => { await api('me.changePassword', v); form.reset(); toast('Password changed. Other devices were signed out.'); });
  return html`<form class="card stack" data-form="me" novalidate>
      ${field('Full name', input('name', { value: u.name }))}${field('Phone', input('phone', { type: 'tel', value: phone(u.phone) }))}
      ${field('Date of birth', input('dob', { type: 'date', value: u.dob }))}${field('Address', textarea('address', { value: u.address, rows: 2 }))}
      <h3>Health profile</h3><p class="muted small">Shared only with practitioners you book.</p>
      ${field('Allergies', input('health.allergies', { value: u.health?.allergies || '' }))}${field('Current medicines & herbal products', textarea('health.currentMeds', { value: u.health?.currentMeds || '', rows: 2 }))}${field('Long-term conditions', textarea('health.conditions', { value: u.health?.conditions || '', rows: 2 }))}
      <p class="form-error" role="alert" hidden></p><button class="btn primary">Save</button></form>
    <form class="card stack" data-form="pw" novalidate><h3>Change password</h3>${field('Current password', input('current', { type: 'password', attrs: 'autocomplete="current-password"' }))}${field('New password', input('next', { type: 'password', attrs: 'autocomplete="new-password"' }))}<p class="form-error" role="alert" hidden></p><button class="btn ghost">Change password</button></form>`;
}, { auth: true });

route('/c/careplans', async (ctx) => {
  ctx.title = 'Care plans & prescriptions';
  ctx.back = '#/c/profile';
  const plans = await api('carePlans.list');
  return plans.length ? html`<div class="list">${plans.map((c) => html`<button type="button" class="list-item" data-go="#/c/careplan/${c.id}">${icon('clip', 'lead')}<span class="li-main"><strong>${c.type === 'prescription' ? 'Prescription' : 'Care plan'} ${c.code}</strong><span class="small">${c.practitionerName}</span><span class="small muted">${fmtDate(c.issuedAt)}</span></span></button>`)}</div>` : empty('No care plans yet', 'After a consultation, your practitioner’s care plan appears here.');
}, { auth: true });

route('/c/careplan/:id', async (ctx) => {
  const c = await api('carePlans.get', { id: ctx.params.id });
  ctx.title = `${c.type === 'prescription' ? 'Prescription' : 'Care plan'} ${c.code}`;
  ctx.back = '#/c/careplans';
  ctx.act('addAll', async () => {
    let n = 0;
    for (const i of c.items) if (i.productId && i.purchasable) { await api('cart.setItem', { productId: i.productId, qty: 1 }); n++; }
    toast(`${n} product(s) added to your cart.`); go('#/c/cart');
  });
  const buyable = c.items.filter((i) => i.purchasable).length;
  return html`<div class="card"><p class="eyebrow">${c.type === 'prescription' ? 'Prescription' : 'Treatment recommendation / care plan'}</p><h2>${c.practitionerName}</h2><p class="small">${c.practitionerTitle} · ${c.classLabel}</p><p class="small muted">Issued ${fmtDateTime(c.issuedAt)}${c.followUpDate ? ` · follow-up ${fmtDate(c.followUpDate)}` : ''}${c.refills ? ` · ${c.refills} refill(s)` : ''}</p></div>
    ${when(c.items.length, () => section('Recommended', html`<div class="list">${c.items.map((i) => html`<div class="list-item"><span class="li-main"><strong>${i.name}</strong><span class="small">${i.dosage}${i.frequency ? ', ' + i.frequency : ''}${i.duration ? ', for ' + i.duration : ''}</span>${i.rationale ? html`<span class="small muted">Why: ${i.rationale}</span>` : ''}${i.productId ? html`<span class="small">${i.seller}${i.purchasable ? '' : ' · currently unavailable'}</span>` : ''}</span>${i.productId ? html`<button class="btn small ghost" data-go="#/c/product/${i.productId}">View</button>` : ''}</div>`)}</div>`))}
    ${when(c.advice, () => section('Advice', html`<p class="prose">${c.advice}</p>`))}
    ${when(buyable, () => html`<button class="btn primary block" data-act="addAll">Add ${buyable} recommended product(s) to cart</button>`)}
    ${when(c.type === 'prescription' && S.meta.flags.conventionalPharmacy, () => html`<button class="btn ghost block" data-go="#/c/rx">Send to a partner pharmacy</button>`)}
    <p class="muted small">Take products only as directed. Contact your practitioner, or call 112 in an emergency, if you feel worse.</p>`;
}, { auth: true });

route('/c/documents', async (ctx) => {
  ctx.title = 'Medical documents';
  ctx.back = '#/c/profile';
  const docs = await api('documents.list');
  ctx.form('upload', async (v, form) => {
    const file = form.file.files[0];
    if (!file) { const e = new Error('Choose a file to upload.'); e.details = { field: 'file' }; throw e; }
    if (file.size > 5 * 1024 * 1024) { const e = new Error('Files must be 5 MB or smaller.'); e.details = { field: 'file' }; throw e; }
    const dataB64 = await readFileB64(file);
    await api('documents.upload', { name: file.name, mime: file.type, kind: v.kind, dataB64 });
    toast('Uploaded and encrypted.'); refresh();
  });
  ctx.act('view', (d) => viewDoc(d.id));
  ctx.act('del', async (d) => {
    const r = await confirmSheet({ title: 'Delete this document?', body: 'It will be removed from any consultation you shared it with.', confirmLabel: 'Delete', danger: true });
    if (!r.ok) return;
    await api('documents.delete', { id: d.id }); toast('Deleted.'); refresh();
  });
  return html`<form class="card stack" data-form="upload" novalidate>
      <p class="small">Upload lab results, scans or records as PDF, JPEG or PNG (max 5 MB). Files are scanned, encrypted and visible only to you and practitioners you share them with.</p>
      <label class="field" data-field="file"><span class="lbl">File</span><input type="file" name="file" accept="application/pdf,image/jpeg,image/png"><span class="err"></span></label>
      ${field('Type', select('kind', [['lab', 'Lab result'], ['scan', 'Scan or imaging'], ['prescription', 'Prescription'], ['record', 'Other medical record']]))}
      <p class="form-error" role="alert" hidden></p><button class="btn primary">${icon('upload')} Upload</button></form>
    ${docs.length ? html`<div class="list">${docs.map((d) => html`<div class="list-item">${icon('doc', 'lead')}<span class="li-main"><strong>${d.name}</strong><span class="small muted">${cap(d.kind)} · ${(d.size / 1024).toFixed(0)} KB · ${fmtDate(d.uploadedAt)}</span><span class="small">${d.sharedWith.length ? 'Shared with ' + d.sharedWith.map((s) => `${s.practitioner} (${s.code})`).join(', ') : 'Not shared'}</span></span><span class="row"><button class="btn small ghost" data-act="view" data-id="${d.id}">Open</button><button class="btn small ghost" data-act="del" data-id="${d.id}" aria-label="Delete ${d.name}">${icon('x')}</button></span></div>`)}</div>` : empty('No documents yet')}`;
}, { auth: true });

route('/c/payments', async (ctx) => {
  ctx.title = 'Payments & refunds';
  ctx.back = '#/c/profile';
  const pays = await api('payments.list');
  return pays.length ? html`<div class="list">${pays.map((p) => html`<button type="button" class="list-item" data-go="#/c/receipt/${p.reference}">${icon(p.channel === 'mobile_money' ? 'momo' : 'card', 'lead')}<span class="li-main"><strong>${p.title || p.description}</strong><span class="small">${money(p.amount)}${p.refunded ? ` · ${money(p.refunded)} refunded` : ''}</span><span class="small muted">${fmtDateTime(p.paidAt || p.createdAt)} · ${p.reference}</span></span>${status(p.status)}</button>`)}</div>` : empty('No payments yet');
}, { auth: true });

route('/c/receipt/:reference', async (ctx) => {
  const p = await api('payments.get', { reference: ctx.params.reference });
  ctx.title = p.receiptNo ? `Receipt ${p.receiptNo}` : 'Payment';
  ctx.back = '#/c/payments';
  return html`<article class="card receipt"><div class="row between">${raw('<span></span>')}<span class="muted small">PRORESMAT</span></div>
    <h2>${p.receiptNo ? 'Receipt ' + p.receiptNo : 'Payment ' + p.reference}</h2>
    ${kv([['Date', fmtDateTime(p.paidAt || p.createdAt)], ['Payer', S.user.name], ['Service / seller', p.provider], ['Collected by', 'PRORESMAT, via Paystack'], ['Method', p.channel === 'mobile_money' ? `Mobile Money Payment${p.gateway?.provider ? ' (' + p.gateway.provider.toUpperCase() + ')' : ''}` : `Card${p.gateway?.last4 ? ' ••' + p.gateway.last4 : ''}`], ['Paystack reference', html`<span class="mono">${p.reference}</span>`], ['Status', status(p.status)]])}
    <table class="tbl"><tbody>${(p.lines || []).map((l) => html`<tr><td>${l.label}</td><td class="num">${money(l.amount)}</td></tr>`)}<tr class="total"><td>Total paid</td><td class="num">${money(p.amount)}</td></tr>${p.refunds.map((r) => html`<tr><td>Refund ${r.code} · ${fmtDate(r.at)}<br><span class="small muted">${r.reason}</span></td><td class="num">−${money(r.amount)}</td></tr>`)}</tbody></table>
    <p class="muted small">Keep this receipt for your records. For questions, raise a request in Support quoting ${p.reference}.</p></article>`;
}, { auth: true });

route('/c/support', async (ctx) => {
  ctx.title = 'Support & complaints';
  ctx.back = '#/c/profile';
  const list = await api('tickets.list');
  ctx.act('new', () => sheet('Contact support', html`<form class="stack" data-form="ticket"><input type="hidden" name="kind" value="support">${field('Topic', select('category', [['general', 'General question'], ['payment', 'Payment or refund'], ['booking', 'Consultation booking'], ['order', 'Order'], ['delivery', 'Delivery'], ['privacy', 'Privacy']]))}${field('Subject', input('subject'))}${field('Message', textarea('message', { rows: 5 }))}<p class="form-error" role="alert" hidden></p><button class="btn primary">Send</button></form>`));
  ctx.form('ticket', submitTicket);
  ctx.act('open', (d) => {
    const tk = list.find((x) => x.id === d.id);
    sheet(`${tk.code}: ${tk.subject}`, html`<div class="stack"><p>${status(tk.status)} ${tk.kind === 'complaint' ? html`<span class="badge line">Complaint</span>` : ''}</p><div class="thread">${tk.thread.map((m) => html`<div class="msg ${m.role}"><span class="small muted">${m.by} · ${fmtDateTime(m.at)}</span><p>${m.text}</p></div>`)}</div>${when(tk.status !== 'closed', () => html`<form class="stack" data-form="reply"><input type="hidden" name="id" value="${tk.id}">${field('Reply', textarea('text', { rows: 3 }))}<button class="btn primary">Send reply</button></form>`)}</div>`);
  });
  ctx.form('reply', async (v) => { await api('tickets.reply', v); closeSheets(); toast('Reply sent.'); refresh(); });
  return html`<button class="btn primary" data-act="new">${icon('plus')} New request</button>
    ${list.length ? html`<div class="list">${list.map((tk) => html`<button type="button" class="list-item" data-act="open" data-id="${tk.id}">${icon(tk.kind === 'complaint' ? 'flag' : 'people', 'lead')}<span class="li-main"><strong>${tk.subject}</strong><span class="small muted">${tk.code} · ${cap(tk.category)} · ${fmtDate(tk.createdAt)}</span></span>${status(tk.status)}</button>`)}</div>` : empty('No requests yet')}
    <p class="muted small">Urgent medical problem? Call 112 or 193. Support is not an emergency service.</p>`;
}, { auth: true });

route('/c/report', async (ctx) => {
  ctx.title = 'Report a problem';
  ctx.back = ctx.query.orderId ? `#/c/order/${ctx.query.orderId}` : ctx.query.productId ? `#/c/product/${ctx.query.productId}` : ctx.query.bookingId ? `#/c/booking/${ctx.query.bookingId}` : '#/c/profile';
  ctx.form('ae', async (v) => {
    const r = await api('adverse.create', { ...v, productId: ctx.query.productId || '', orderId: ctx.query.orderId || '', bookingId: ctx.query.bookingId || '' });
    sheet('Report received', html`<div class="stack"><p>${r.message}</p><p class="small muted">Reference ${r.code}. PRORESMAT reports serious suspected reactions to FDA Ghana.</p><button class="btn primary" data-go="#/c/profile">Done</button></div>`);
  });
  return html`${emergency(true)}<form class="card stack" data-form="ae" novalidate>
    ${field('What kind of problem?', select('kind', [['adverse_reaction', 'Suspected side effect or reaction'], ['interaction', 'Possible interaction with another medicine'], ['quality', 'Product quality (damaged, wrong, looks or smells different)']]))}
    ${field('How serious?', select('severity', [['mild', 'Mild – no treatment needed'], ['moderate', 'Moderate – needed treatment or stopped the product'], ['severe', 'Severe – hospital care or still getting worse']]))}
    ${field('When did it start?', input('onsetDate', { type: 'date' }))}
    ${field('What happened?', textarea('description', { rows: 5, placeholder: 'Describe symptoms, when you took the product, and what you did.' }))}
    ${field('Other medicines or herbs you were taking', textarea('otherMedicines', { rows: 2 }))}
    <p class="form-error" role="alert" hidden></p><button class="btn primary">Send report</button></form>`;
}, { auth: true });

route('/c/privacy', async (ctx) => {
  ctx.title = 'Privacy & security';
  ctx.back = '#/c/profile';
  const [sec, reqs] = await Promise.all([api('security.history'), api('privacy.list')]);
  ctx.act('export', async () => {
    const data = await api('privacy.export');
    const json = JSON.stringify(data, null, 2);
    sheet('Your data', html`<div class="stack"><p class="small">This is a copy of the personal data PRORESMAT holds about you (${(json.length / 1024).toFixed(1)} KB). Select all and copy to keep it.</p><textarea class="mono" rows="14" readonly id="f-export">${json}</textarea><button class="btn primary" data-act="copyExport">Copy to clipboard</button></div>`, { wide: true });
  });
  ctx.act('copyExport', async () => {
    const ta = document.getElementById('f-export');
    try { await navigator.clipboard.writeText(ta.value); toast('Copied.'); } catch { ta.select(); toast('Press Ctrl+C / long-press to copy.', 'warn'); }
  });
  ctx.act('others', async () => { const r = await api('security.signOutOthers'); toast(`Signed out ${r.signedOut} other session(s).`); refresh(); });
  ctx.act('request', (d) => sheet(d.v === 'deletion' ? 'Delete my account' : 'Correct my data', html`<form class="stack" data-form="privacyReq"><input type="hidden" name="type" value="${d.v}">${d.v === 'deletion' ? html`<p>We will delete or anonymise your personal data within 30 days. Records we must keep by law (payments, clinical notes) are retained in pseudonymised form. Active consultations and orders must be completed first.</p>` : ''}${field(d.v === 'deletion' ? 'Anything we should know? (optional)' : 'What needs correcting?', textarea('details', { rows: 3 }))}<p class="form-error" role="alert" hidden></p><button class="btn ${d.v === 'deletion' ? 'danger' : 'primary'}">Submit request</button></form>`));
  ctx.form('privacyReq', async (v) => { await api('privacy.request', v); closeSheets(); toast('Request received. We respond within 30 days.'); refresh(); });
  ctx.act('notice', () => sheet('Privacy notice', privacyNotice()));
  return html`
    <div class="list">
      <button type="button" class="list-item" data-act="notice">${icon('shield', 'lead')}<span class="li-main"><strong>Privacy notice</strong><span class="small muted">You consented on ${fmtDate(S.user.consentAt)}</span></span></button>
      <button type="button" class="list-item" data-act="export">${icon('upload', 'lead')}<span class="li-main"><strong>Download my data</strong><span class="small muted">Profile, consultations, orders, payments</span></span></button>
      <button type="button" class="list-item" data-act="request" data-v="correction">${icon('clip', 'lead')}<span class="li-main"><strong>Ask for a correction</strong></span></button>
      <button type="button" class="list-item" data-act="request" data-v="deletion">${icon('x', 'lead')}<span class="li-main"><strong>Delete my account</strong></span></button>
    </div>
    ${when(reqs.length, () => section('Your requests', html`<div class="list">${reqs.map((r) => html`<div class="list-item"><span class="li-main"><strong>${cap(r.type)}</strong><span class="small muted">${fmtDate(r.createdAt)} · respond by ${fmtDate(r.dueBy)}</span>${r.resolution ? html`<span class="small">${r.resolution.note}</span>` : ''}</span>${status(r.status)}</div>`)}</div>`))}
    ${section('Active sessions', html`<div class="list">${sec.sessions.map((s) => html`<div class="list-item">${icon('lock', 'lead')}<span class="li-main"><strong>${s.device}${s.current ? ' (this device)' : ''}</strong><span class="small muted">Signed in ${fmtDateTime(s.createdAt)} · last active ${fmtDateTime(s.lastSeen)}</span></span></div>`)}</div>${when(sec.sessions.length > 1, () => html`<button class="btn ghost small" data-act="others">Sign out other sessions</button>`)}`)}
    ${section('Sign-in history', html`<div class="list">${sec.logins.map((l) => html`<div class="list-item"><span class="li-main"><span>${l.device}</span><span class="small muted">${fmtDateTime(l.at)}</span></span>${status(l.success ? 'success' : 'failed', l.success ? 'Signed in' : 'Failed')}</div>`)}</div>`)}`;
}, { auth: true });

route('/c/learn', async (ctx) => {
  ctx.title = 'Health information';
  ctx.back = '#/c/home';
  const list = await api('education.list');
  const groups = { tip: 'Health tips', medicine: 'About medicines', traditional: 'Traditional medicine' };
  return html`${Object.entries(groups).map(([k, label]) => section(label, html`<div class="list">${list.filter((a) => a.category === k).map((a) => html`<button type="button" class="list-item" data-go="#/c/article/${a.id}">${icon('book', 'lead')}<span class="li-main"><strong>${a.title}</strong><span class="small muted">${a.readMinutes} min read</span></span></button>`)}</div>`))}`;
}, { auth: false });

route('/c/article/:id', async (ctx) => {
  const a = await api('education.get', { id: ctx.params.id });
  ctx.title = cap(a.category);
  ctx.back = '#/c/learn';
  return html`<article class="card prose"><p class="eyebrow">${cap(a.category)}</p><h2>${a.title}</h2><p>${a.body}</p><p class="muted small">Published ${fmtDate(a.publishedAt)} by the PRORESMAT clinical team. General information only; speak to a practitioner about your own situation.</p></article>`;
}, { auth: false });

export { esc, words };
