// Sign in, registration, one-time code, notifications, payment page, demo tools.
import { route, S, go, api, toast, signedIn, sheet, refresh, homeFor } from '../app.js';
import { html, raw, icon, logo, field, input, check, select, money, fmtDateTime, ago, status, when, emergency, esc } from '../ui.js';

const DEMO = [
  ['akosua@demo.gh', 'Customer', 'Consultations, care plan and orders'],
  ['kojo@demo.gh', 'Customer', 'Consultation soon, open order'],
  ['kwame@demo.gh', 'Practitioner + supervisor', 'Consultation starting soon'],
  ['kofi@demo.gh', 'Conventional practitioner', 'Can issue prescriptions'],
  ['clinic@demo.gh', 'Clinic vendor', 'Orders to fulfil, listings'],
  ['store@demo.gh', 'PRORESMAT dispensary', 'Sold by PRORESMAT orders'],
  ['pharmacy@demo.gh', 'Pharmacy partner', 'Prescription validation'],
  ['adwoa@demo.gh', 'Clinic awaiting approval', 'Onboarding state'],
  ['admin@demo.gh', 'PRORESMAT admin', 'Approvals, care, finance, risk'],
  ['finance@demo.gh', 'Finance officer', 'Ledger, refunds, settlements'],
  ['support@demo.gh', 'Support officer', 'Complaints, care queue'],
];

route('/login', async (ctx) => {
  ctx.title = 'Sign in';
  ctx.back = '#/c/home';
  const next = ctx.query.next || '';
  ctx.form('login', async (v) => {
    const res = await api('auth.login', { email: v.email, password: v.password });
    if (res.mfaRequired) return mfaSheet(res, next);
    await signedIn(res, next);
  });
  ctx.act('demo', (d) => {
    const f = document.querySelector('form[data-form=login]');
    f.email.value = d.email;
    f.password.value = 'Demo@1234';
    f.requestSubmit();
  });
  return html`
    <div class="auth-hero">${logo(44)}<div><p class="eyebrow">PRORESMAT Health Connect</p><h2 class="display">Trusted traditional and integrative care</h2></div></div>
    <form class="card stack" data-form="login" novalidate>
      ${field('Email', input('email', { type: 'email', required: true, attrs: 'autocomplete="username" inputmode="email"' }))}
      ${field('Password', input('password', { type: 'password', required: true, attrs: 'autocomplete="current-password"' }))}
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block">Sign in</button>
      <p class="muted center small"><a href="#/forgot">Forgot password?</a> · New to PRORESMAT? <a href="#/register${next ? '?next=' + encodeURIComponent(next) : ''}">Create an account</a></p>
    </form>
    ${when(S.meta?.demo, () => html`<section class="sec"><div class="sec-head"><h2>Test accounts</h2><span class="muted small">Password: Demo@1234</span></div>
      <p class="muted small">Tap an account to sign in. Staff and supervisor accounts ask for a one-time code; in test mode the code is shown on screen.</p>
      <div class="list">${DEMO.map(([email, role, note]) => html`<button type="button" class="list-item" data-act="demo" data-email="${email}"><span class="li-main"><strong>${role}</strong><span class="muted small">${email} · ${note}</span></span>${icon('back', 'flip')}</button>`)}</div></section>`)}
  `;
}, { auth: false });

function mfaSheet(res, next) {
  const s = sheet('Enter your sign-in code', html`<form class="stack" data-inline="mfa">
    <p>We sent a 6-digit code by SMS to ${res.sentTo}. It expires in 5 minutes.</p>
    ${when(res.demoCode, () => html`<p class="note">${icon('shield')} Test mode: your code is <strong class="mono">${res.demoCode}</strong></p>`)}
    <label class="field"><span class="lbl">Code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required class="otp"><span class="err"></span></label>
    <button class="btn primary block">Verify and sign in</button></form>`);
  const form = s.el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const r = await api('auth.verifyMfa', { challengeId: res.challengeId, code: form.code.value });
      s.close();
      await signedIn(r, next);
    } catch (err) {
      form.querySelector('.field').classList.add('invalid');
      form.querySelector('.err').textContent = err.message;
    } finally { btn.disabled = false; }
  });
}

route('/register', async (ctx) => {
  ctx.title = 'Create account';
  ctx.back = '#/login';
  const next = ctx.query.next || '';
  ctx.form('register', async (v) => {
    const res = await api('auth.register', { ...v, consent: v.consent === true });
    toast('Account created. Akwaaba!');
    await signedIn(res, next || (v.intent === 'practitioner' ? '#/p/profile' : v.intent === 'vendor' ? '#/v/dashboard' : '#/c/home'));
  });
  ctx.act('privacy', () => sheet('Privacy notice', privacyNotice()));
  return html`<form class="card stack" data-form="register" novalidate>
    ${field('Full name', input('name', { required: true, attrs: 'autocomplete="name"' }))}
    ${field('Email', input('email', { type: 'email', required: true, attrs: 'autocomplete="email" inputmode="email"' }))}
    ${field('Phone', input('phone', { type: 'tel', required: true, placeholder: '024 123 4567', attrs: 'autocomplete="tel" inputmode="tel"' }), 'Ghana number, used for appointment and delivery updates')}
    ${field('Password', input('password', { type: 'password', required: true, attrs: 'autocomplete="new-password" minlength="8"' }), 'At least 8 characters with letters and numbers')}
    ${field('I am joining as', select('intent', [['customer', 'A customer looking for care or products'], ['practitioner', 'A practitioner applying to be listed'], ['vendor', 'A herbal clinic or pharmacy partner']], 'customer'))}
    ${field('Language', select('lang', [['en', 'English'], ['tw', 'Twi']], 'en'))}
    <div class="consent">${check('consent', raw('I have read the <a href="#" data-act="privacy">privacy notice</a> and consent to PRORESMAT processing my personal and health information to provide care, payments and support.'))}</div>
    <p class="form-error" role="alert" hidden></p>
    <button class="btn primary block">Create account</button>
  </form>`;
}, { auth: false });

route('/forgot', async (ctx) => {
  ctx.title = 'Reset password';
  ctx.back = '#/login';
  const st = (ctx.query.email && sessionState.resetEmail === ctx.query.email) ? sessionState : {};
  ctx.form('req', async (v) => {
    const r = await api('auth.requestReset', { email: v.email });
    sessionState.resetEmail = v.email.trim().toLowerCase();
    sessionState.demoCode = r.demoCode || '';
    toast(r.message);
    go('#/forgot?email=' + encodeURIComponent(sessionState.resetEmail));
  });
  ctx.form('reset', async (v) => {
    await api('auth.resetPassword', { email: ctx.query.email, code: v.code, password: v.password });
    toast('Password changed. Sign in with your new password.');
    go('#/login');
  });
  if (!ctx.query.email) {
    return html`<form class="card stack" data-form="req" novalidate><p>Enter your account email. We will send a 6-digit code by SMS to the phone number on your account.</p>${field('Email', input('email', { type: 'email', attrs: 'autocomplete="username"' }))}<p class="form-error" role="alert" hidden></p><button class="btn primary block">Send code</button></form>`;
  }
  return html`<form class="card stack" data-form="reset" novalidate><p>Enter the code sent by SMS for <strong>${ctx.query.email}</strong> and choose a new password.</p>
    ${when(st.demoCode, () => html`<p class="note">${icon('shield')} Test mode: your code is <strong class="mono">${st.demoCode}</strong></p>`)}
    ${field('Code', input('code', { attrs: 'inputmode="numeric" autocomplete="one-time-code" maxlength="6"' }))}
    ${field('New password', input('password', { type: 'password', attrs: 'autocomplete="new-password"' }), 'At least 8 characters with letters and numbers')}
    <p class="form-error" role="alert" hidden></p><button class="btn primary block">Change password</button>
    <p class="small center"><a href="#/forgot">Send a new code</a></p></form>`;
}, { auth: false });
const sessionState = {};

export const privacyNotice = () => html`<div class="prose">
  <p><strong>Who we are.</strong> PRORESMAT operates this app and is the data controller for your account, bookings, orders and payments. Practitioners you consult also keep clinical records of their care.</p>
  <p><strong>What we collect.</strong> Your contact details, the reason for each consultation, safety-screening answers, health documents you choose to upload, care plans, orders and payment references. We never store full card numbers; Paystack processes cards and mobile money.</p>
  <p><strong>Who can see your health information.</strong> Only you and the practitioners caring for you (and their clinical supervisor when a case is reviewed). Clinics and pharmacies see only what they need to fulfil an order. Finance and support staff do not see your clinical notes or documents.</p>
  <p><strong>Your rights.</strong> Under Ghana's Data Protection Act, 2012 (Act 843) you can access, download and correct your data, restrict processing, or ask us to delete your account. Use Profile → Privacy & security. We respond within 30 days.</p>
  <p><strong>Security.</strong> Documents are encrypted at rest and opened only through short-lived links, and every access is logged. Notifications on your lock screen never include health details.</p>
  <p><strong>Retention.</strong> Clinical and financial records are kept for the periods required by law, then deleted or anonymised.</p></div>`;

// ---------- notifications ----------
route('/notifications', async (ctx) => {
  ctx.title = 'Notifications';
  ctx.back = S.user ? homeFor(S.user) : '#/c/home';
  const list = await api('notifications.list');
  const demo = S.meta?.demo;
  const now = Date.now() + (S.nowOffsetDays || 0) * 86400000;
  ctx.act('readAll', async () => { await api('notifications.read'); S.unread = 0; refresh(); });
  ctx.act('open', async (d) => { await api('notifications.read', { id: d.id }); go(d.link || homeFor(S.user)); });
  return html`
    <div class="row between"><p class="muted small">Messages on your lock screen show only the title.</p>${when(list.some((n) => !n.read), () => html`<button class="btn small ghost" data-act="readAll">Mark all read</button>`)}</div>
    ${list.length ? html`<div class="list">${list.map((n) => html`<button type="button" class="list-item ${n.read ? '' : 'unread'}" data-act="open" data-id="${n.id}" data-link="${n.link}"><span class="li-main"><strong>${n.title}</strong><span class="small">${n.body}</span><span class="muted small">${ago(n.at, now)}</span></span></button>`)}</div>` : html`<div class="empty">${icon('bell')}<p class="empty-title">No notifications yet</p></div>`}
    ${when(demo, () => html`<p class="muted small center"><a href="#/demo">Open test tools and message outbox</a></p>`)}`;
}, { auth: true });

// ---------- payment page (Paystack hosted page in live mode; sandbox checkout otherwise) ----------
route('/pay/:reference', async (ctx) => {
  ctx.title = 'Payment';
  ctx.hideNav = true;
  let pay = await api(S.meta.paystackMode === 'live' ? 'payments.verify' : 'payments.get', { reference: ctx.params.reference });
  const doneLink = pay.purpose === 'booking' ? `#/c/booking/${pay.targetIds[0]}` : pay.purpose === 'subscription' ? '#/c/profile' : pay.purpose === 'rx' ? '#/c/rx' : '#/c/orders';
  ctx.back = pay.status === 'initialized' || pay.status === 'failed' ? (pay.purpose === 'booking' ? `#/c/booking/${pay.targetIds[0]}` : pay.purpose === 'checkout' ? '#/c/cart' : doneLink) : doneLink;
  ctx.form('sandbox', async (v, form, submitter) => {
    const outcome = submitter?.value === 'failed' ? 'failed' : 'success';
    const res = await api('payments.sandboxComplete', { reference: pay.reference, outcome, card: v.card, provider: v.provider, phone: v.phone });
    if (res.status === 'success') toast('Payment successful. Receipt ' + res.receiptNo);
    else if (res.status === 'failed') toast(res.failureReason || 'Payment failed.', 'bad');
    refresh();
  });
  ctx.act('verify', async () => { await api('payments.verify', { reference: pay.reference }); refresh(); });
  const summary = html`<div class="card"><p class="eyebrow">${pay.title || pay.description}</p><p class="amount">${money(pay.amount)}</p>${when(pay.provider, () => html`<p class="small">${pay.provider}</p>`)}<p class="muted small">Reference <span class="mono">${pay.reference}</span> · collected by PRORESMAT through Paystack</p></div>`;
  if (pay.status === 'success' || pay.status === 'duplicate_refunded') {
    return html`${summary}<div class="card success-card">${icon('check', 'big')}<h2>Payment received</h2><p>Receipt <strong>${pay.receiptNo}</strong> · ${pay.channel === 'mobile_money' ? 'Mobile Money Payment' : 'Card'}</p>${when(pay.status === 'duplicate_refunded', () => html`<p class="note warn">This was a duplicate payment and has been refunded automatically.</p>`)}<div class="row center"><button class="btn primary" data-go="${doneLink}">Continue</button><button class="btn ghost" data-go="#/c/receipt/${pay.reference}">View receipt</button></div></div>`;
  }
  if (S.meta.paystackMode === 'live' && pay.status === 'initialized') {
    return html`${summary}<div class="card stack"><p>Waiting for confirmation from Paystack. If you completed payment, tap check status.</p><button class="btn primary" data-act="verify">Check payment status</button></div>`;
  }
  const failed = pay.status === 'failed';
  return html`${summary}
    ${when(failed, () => html`<p class="note bad">${icon('alert')} ${pay.failureReason || 'The payment did not go through.'} You can try again.</p>`)}
    <form class="card stack" data-form="sandbox" novalidate>
      <p class="note">${icon('shield')} Paystack test checkout. No real money moves. Live keys switch this page to Paystack's secure hosted checkout.</p>
      ${pay.channel === 'mobile_money' ? html`
        <h3>Mobile Money Payment</h3>
        ${field('Network', select('provider', [['mtn', 'MTN Mobile Money'], ['telecel', 'Telecel Cash'], ['airteltigo', 'AirtelTigo Money']], 'mtn'))}
        ${field('Mobile money number', input('phone', { type: 'tel', value: S.user.phone.replace('+233', '0'), attrs: 'inputmode="tel"' }), 'You would approve the prompt on your phone')}` : html`
        <h3>Card</h3>
        ${field('Card number', input('card', { value: '4084 0840 8408 4081', attrs: 'inputmode="numeric" autocomplete="cc-number"' }), 'Paystack test card')}
        <div class="grid2">${field('Expiry', input('exp', { value: '12/30', attrs: 'autocomplete="cc-exp"' }))}${field('CVV', input('cvv', { value: '408', attrs: 'inputmode="numeric" autocomplete="cc-csc"' }))}</div>`}
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block" name="outcome" value="success">Pay ${money(pay.amount)}</button>
      <button class="btn ghost block" name="outcome" value="failed" type="submit">Simulate a declined payment</button>
    </form>`;
}, { auth: true });

// ---------- demo tools ----------
route('/demo', async (ctx) => {
  ctx.title = 'Test tools';
  ctx.back = S.user ? homeFor(S.user) : '#/login';
  const st = await api('demo.status');
  const outbox = st.demo ? await api('demo.outbox') : [];
  ctx.act('advance', async (d) => {
    const r = await api('demo.advanceClock', { days: Number(d.days) });
    S.nowOffsetDays = r.clockOffsetDays;
    toast(`Clock moved forward. Test time is now ${fmtDateTime(r.now)} GMT.`);
    refresh();
  });
  ctx.act('reset', async () => {
    await api('demo.reset');
    S.nowOffsetDays = 0;
    toast('Test data reset.');
    go('#/login');
  });
  S.nowOffsetDays = st.clockOffsetDays;
  return html`
    <div class="card stack"><h3>Test clock</h3><p class="muted small">Move time forward to see reminders fire, settlement hold periods end and licences or product registrations expire. Current test time: <strong>${fmtDateTime(st.now)} GMT</strong>${st.clockOffsetDays ? ` (+${st.clockOffsetDays} days)` : ''}.</p>
      <div class="row wrap">${[['0.05', '+1 hour'], ['1', '+1 day'], ['3', '+3 days'], ['7', '+7 days'], ['30', '+30 days']].map(([d, l]) => html`<button class="btn small ghost" data-act="advance" data-days="${d}">${l}</button>`)}</div></div>
    <div class="card stack"><h3>Reset</h3><p class="muted small">Restores the original test accounts and data.</p><button class="btn danger" data-act="reset">Reset test data</button></div>
    <section class="sec"><div class="sec-head"><h2>Message outbox</h2><span class="muted small">SMS and push messages the app would send</span></div>
      ${outbox.length ? html`<div class="list">${outbox.map((m) => html`<div class="list-item"><span class="li-main"><span class="small"><span class="badge line">${m.channel.toUpperCase()}</span> to ${m.to}</span><span>${m.text}</span><span class="muted small">${fmtDateTime(m.at)}</span></span></div>`)}</div>` : html`<p class="muted">No messages yet.</p>`}</section>`;
}, { auth: false });

export { emergency, status, esc };
