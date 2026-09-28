// Identity, sessions, MFA, profile, notifications and privacy rights.
import { AppError, str, email, ghPhone, passwordRule, hashPassword, verifyPassword, oneOf, dateStr, randomToken, formatPhone } from '../util.js';
import { PRIVILEGED } from '../engine.js';

export const PRIVACY_VERSION = '2026-08';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export function registerAuth(E) {
  const { fail, newId } = E;
  const persistFail = (code, message, status) => {
    const err = new AppError(code, message, status);
    err.persist = true; // keep side effects (attempt counters) even though the request fails
    throw err;
  };

  async function createSession(user, ctx) {
    const token = randomToken(24);
    const now = E.now();
    E.insert('sessions', { id: token, userId: user.id, createdAt: new Date(now).toISOString(), lastSeen: new Date(now).toISOString(), expiresAt: new Date(now + E.db.settings.sessionIdleMinutes * 60000).toISOString(), device: ctx.device });
    E.insert('loginHistory', { id: newId('lgn'), userId: user.id, at: new Date(now).toISOString(), device: ctx.device, ip: ctx.ip, success: true });
    return { token, user: E.publicUser(user) };
  }

  E.action('auth.register', {
    method: 'POST', path: '/auth/register', auth: false,
    fn: async (p, ctx) => {
      const name = str(p.name, 'Full name', { min: 2, max: 120 });
      const em = email(p.email);
      const phone = ghPhone(p.phone);
      const pw = passwordRule(p.password);
      if (p.consent !== true) fail('CONSENT_REQUIRED', 'Please read the privacy notice and give consent to continue.', 422, { field: 'consent' });
      const lang = p.lang === 'tw' ? 'tw' : 'en';
      if (E.all('users').some((u) => u.email === em)) fail('EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.', 409, { field: 'Email' });
      if (E.all('users').some((u) => u.phone === phone && u.status === 'active')) fail('PHONE_TAKEN', 'This phone number is already registered.', 409, { field: 'Phone' });
      const intent = p.intent || 'customer';
      oneOf(intent, 'Account type', ['customer', 'practitioner', 'vendor']);
      const { salt, hash } = await hashPassword(pw);
      const roles = intent === 'customer' ? ['customer'] : ['customer', intent];
      const user = E.insert('users', {
        id: newId('usr'), name, email: em, phone, roles, lang, status: 'active', salt, hash, createdAt: E.nowIso(),
        consentAt: E.nowIso(), consentVersion: PRIVACY_VERSION, health: { allergies: '', currentMeds: '', conditions: '' }, failed: 0, lockedUntil: null,
      });
      E.audit({ user }, 'user.registered', 'user', user.id, null, { email: em, roles });
      E.notify(user.id, { title: 'Welcome to PRORESMAT', body: 'Your account is ready. Browse verified practitioners and approved herbal products.', link: '#/c/home', kind: 'info' });
      return createSession(user, ctx);
    },
  });

  E.action('auth.login', {
    method: 'POST', path: '/auth/login', auth: false,
    fn: async (p, ctx) => {
      const em = email(p.email);
      const pw = str(p.password, 'Password', { max: 128 });
      const user = E.all('users').find((u) => u.email === em);
      const genericError = () => fail('BAD_CREDENTIALS', 'That email and password do not match. Check them and try again.', 401);
      if (!user || user.status !== 'active') { await hashPassword(pw); genericError(); }
      if (user.lockedUntil && Date.parse(user.lockedUntil) > E.now()) {
        fail('LOCKED', `Too many failed attempts. Try again after ${new Date(user.lockedUntil).toUTCString().slice(17, 22)} GMT, or reset your password.`, 423);
      }
      const ok = await verifyPassword(pw, user.salt, user.hash);
      if (!ok) {
        user.failed = (user.failed || 0) + 1;
        E.insert('loginHistory', { id: newId('lgn'), userId: user.id, at: E.nowIso(), device: ctx.device, ip: ctx.ip, success: false });
        if (user.failed >= MAX_FAILED) {
          user.lockedUntil = new Date(E.now() + LOCK_MINUTES * 60000).toISOString();
          user.failed = 0;
          E.audit(null, 'user.locked', 'user', user.id, null, { until: user.lockedUntil }, 'Repeated failed sign-in attempts');
        }
        // Failed attempts are recorded even though the request fails.
        persistFail('BAD_CREDENTIALS', 'That email and password do not match. Check them and try again.', 401);
      }
      user.failed = 0;
      user.lockedUntil = null;
      if (user.roles.some((r) => PRIVILEGED.includes(r))) {
        const code = E.randomDigits(6);
        const ch = E.insert('mfaChallenges', { id: newId('mfa'), userId: user.id, code, attempts: 0, expiresAt: new Date(E.now() + 5 * 60000).toISOString() });
        E.sendMessage('sms', formatPhone(user.phone), `PRORESMAT sign-in code: ${code}. It expires in 5 minutes. Never share this code.`, user.id);
        return { mfaRequired: true, challengeId: ch.id, sentTo: '••• ••• ' + user.phone.slice(-4), demoCode: E.config.demo ? code : undefined };
      }
      return createSession(user, ctx);
    },
  });

  E.action('auth.verifyMfa', {
    method: 'POST', path: '/auth/mfa', auth: false,
    fn: async (p, ctx) => {
      const ch = E.get('mfaChallenges', p.challengeId);
      if (!ch || Date.parse(ch.expiresAt) < E.now()) fail('MFA_EXPIRED', 'This code has expired. Sign in again to get a new one.', 401);
      if (String(p.code || '').trim() !== ch.code) {
        ch.attempts += 1;
        if (ch.attempts >= 5) E.remove('mfaChallenges', ch.id);
        persistFail('MFA_INVALID', 'That code is not correct. Check the SMS and try again.', 401);
      }
      E.remove('mfaChallenges', ch.id);
      return createSession(E.must('users', ch.userId, 'User'), ctx);
    },
  });

  // Password reset by one-time SMS code. Responses are identical for unknown emails.
  E.action('auth.requestReset', {
    method: 'POST', path: '/auth/reset-request', auth: false,
    fn: (p) => {
      const em = email(p.email);
      const user = E.all('users').find((u) => u.email === em && u.status === 'active');
      const out = { sent: true, message: 'If an account exists for that email, we have sent a 6-digit code by SMS to its phone number.' };
      if (!user) return out;
      const code = E.randomDigits(6);
      user.reset = { code, attempts: 0, expiresAt: new Date(E.now() + 10 * 60000).toISOString() };
      E.sendMessage('sms', formatPhone(user.phone), `PRORESMAT password reset code: ${code}. It expires in 10 minutes. If you did not ask for this, ignore this message.`, user.id);
      E.audit({ user }, 'user.reset_requested', 'user', user.id);
      if (E.config.demo) out.demoCode = code;
      return out;
    },
  });
  E.action('auth.resetPassword', {
    method: 'POST', path: '/auth/reset', auth: false,
    fn: async (p) => {
      const em = email(p.email);
      const user = E.all('users').find((u) => u.email === em && u.status === 'active');
      const r = user?.reset;
      if (!r || Date.parse(r.expiresAt) < E.now() || r.attempts >= 5) fail('RESET_EXPIRED', 'This code has expired. Request a new one.', 400);
      if (String(p.code || '').trim() !== r.code) { r.attempts += 1; persistFail('RESET_INVALID', 'That code is not correct.', 400); }
      const { salt, hash } = await hashPassword(passwordRule(p.password));
      Object.assign(user, { salt, hash, reset: null, failed: 0, lockedUntil: null });
      for (const s of E.all('sessions')) if (s.userId === user.id) E.remove('sessions', s.id);
      E.audit({ user }, 'user.password_reset', 'user', user.id);
      E.notify(user.id, { title: 'Password changed', body: 'Your PRORESMAT password was reset. If this was not you, contact support immediately.', link: '#/c/privacy', kind: 'security' });
      return { ok: true };
    },
  });

  E.action('auth.logout', {
    method: 'POST', path: '/auth/logout', auth: false,
    fn: (p, ctx) => { if (ctx.token) E.remove('sessions', ctx.token); return { ok: true }; },
  });

  E.action('auth.me', { method: 'GET', path: '/me', fn: (p, ctx) => ({ user: E.publicUser(ctx.user), unread: E.all('notifications').filter((n) => n.userId === ctx.user.id && !n.read).length }) });

  E.action('me.update', {
    method: 'PATCH', path: '/me',
    fn: (p, ctx) => {
      const u = ctx.user;
      const before = E.publicUser(u);
      if (p.name !== undefined) u.name = str(p.name, 'Full name', { min: 2, max: 120 });
      if (p.phone !== undefined) u.phone = ghPhone(p.phone);
      if (p.lang !== undefined) u.lang = oneOf(p.lang, 'Language', ['en', 'tw']);
      if (p.address !== undefined) u.address = str(p.address, 'Address', { optional: true, max: 300 });
      if (p.dob !== undefined) u.dob = dateStr(p.dob, 'Date of birth', { optional: true });
      if (p.health) {
        u.health = {
          allergies: str(p.health.allergies, 'Allergies', { optional: true, max: 500 }),
          currentMeds: str(p.health.currentMeds, 'Current medicines', { optional: true, max: 500 }),
          conditions: str(p.health.conditions, 'Conditions', { optional: true, max: 500 }),
        };
      }
      E.audit(ctx, 'user.updated', 'user', u.id, { name: before.name, phone: before.phone, lang: before.lang }, { name: u.name, phone: u.phone, lang: u.lang });
      return { user: E.publicUser(u) };
    },
  });

  E.action('me.changePassword', {
    method: 'POST', path: '/me/password',
    fn: async (p, ctx) => {
      const u = ctx.user;
      if (!(await verifyPassword(str(p.current, 'Current password', { max: 128 }), u.salt, u.hash))) fail('BAD_CREDENTIALS', 'Your current password is not correct.', 422, { field: 'current' });
      const { salt, hash } = await hashPassword(passwordRule(p.next));
      u.salt = salt; u.hash = hash;
      for (const s of E.all('sessions')) if (s.userId === u.id && s.id !== ctx.token) E.remove('sessions', s.id);
      E.audit(ctx, 'user.password_changed', 'user', u.id);
      return { ok: true };
    },
  });

  E.action('security.history', {
    method: 'GET', path: '/security/logins',
    fn: (p, ctx) => ({
      logins: E.all('loginHistory').filter((l) => l.userId === ctx.user.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
      sessions: E.all('sessions').filter((s) => s.userId === ctx.user.id).map((s) => ({ id: s.id.slice(0, 8), device: s.device, createdAt: s.createdAt, lastSeen: s.lastSeen, current: s.id === ctx.token })),
    }),
  });

  E.action('security.signOutOthers', {
    method: 'POST', path: '/security/sign-out-others',
    fn: (p, ctx) => {
      let n = 0;
      for (const s of E.all('sessions')) if (s.userId === ctx.user.id && s.id !== ctx.token) { E.remove('sessions', s.id); n++; }
      return { signedOut: n };
    },
  });

  // ---------- notifications ----------
  E.action('notifications.list', {
    method: 'GET', path: '/notifications',
    fn: (p, ctx) => E.all('notifications').filter((n) => n.userId === ctx.user.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60),
  });
  E.action('notifications.read', {
    method: 'POST', path: '/notifications/read',
    fn: (p, ctx) => {
      for (const n of E.all('notifications')) if (n.userId === ctx.user.id && (!p.id || n.id === p.id)) n.read = true;
      return { ok: true };
    },
  });

  // ---------- privacy rights (Ghana Data Protection Act) ----------
  E.action('privacy.export', {
    method: 'GET', path: '/privacy/export',
    fn: (p, ctx) => {
      const uid = ctx.user.id;
      const mine = (c, f = 'customerId') => E.all(c).filter((r) => r[f] === uid);
      E.audit(ctx, 'privacy.exported', 'user', uid);
      return {
        exportedAt: E.nowIso(), profile: E.publicUser(ctx.user),
        bookings: mine('bookings'), orders: mine('orders'), payments: mine('payments'),
        documents: E.all('documents').filter((d) => d.ownerId === uid && !d.deleted).map(({ blobKey, iv, ...d }) => d),
        carePlans: mine('carePlans'), reviews: mine('reviews', 'authorId'), tickets: mine('tickets', 'userId'),
        loginHistory: mine('loginHistory', 'userId'),
      };
    },
  });
  E.action('privacy.request', {
    method: 'POST', path: '/privacy/requests',
    fn: (p, ctx) => {
      const type = oneOf(p.type, 'Request type', ['correction', 'deletion', 'access_restriction']);
      const details = str(p.details, 'Details', { optional: type === 'deletion', max: 1000 });
      if (E.all('privacyRequests').some((r) => r.userId === ctx.user.id && r.type === type && r.status === 'open')) fail('DUPLICATE', 'You already have an open request of this type.', 409);
      const r = E.insert('privacyRequests', { id: newId('prv'), userId: ctx.user.id, userName: ctx.user.name, type, details, status: 'open', createdAt: E.nowIso(), dueBy: E.addDays(E.today(), 30) });
      E.audit(ctx, 'privacy.requested', 'privacyRequest', r.id, null, { type });
      return r;
    },
  });
  E.action('privacy.list', { method: 'GET', path: '/privacy/requests', fn: (p, ctx) => E.all('privacyRequests').filter((r) => r.userId === ctx.user.id) });
}
