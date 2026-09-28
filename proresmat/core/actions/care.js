// Consultations: booking, safety screening, consent, clinical documentation, care plans,
// referrals, supervision, medical documents, reviews, complaints and adverse events.
import { AppError, str, int, oneOf, dateStr, toB64, fromB64, sha256Hex, aesEncrypt, aesDecrypt, CLAIM_PATTERN } from '../util.js';

export const RED_FLAGS = {
  chest_pain: 'Chest pain or pressure',
  breathing: 'Severe difficulty breathing',
  bleeding: 'Heavy bleeding that will not stop',
  stroke: 'Face drooping, arm weakness or slurred speech',
  unconscious: 'Fainting, confusion or loss of consciousness',
  seizure: 'Seizure or convulsions',
  pregnancy: 'Bleeding, severe pain or reduced baby movement in pregnancy',
  child_fever: 'Very high fever, stiff neck or drowsiness in a child',
  poisoning: 'Poisoning, overdose or a severe reaction to a medicine or herb',
  self_harm: 'Thoughts of harming yourself or others',
};

const ALLOWED_MIME = { 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47] };
const MAX_DOC_BYTES = 5 * 1024 * 1024;
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!';

export function registerCare(E) {
  const { fail, newId } = E;
  const db = () => E.db;

  const practitionerOf = (ctx) => {
    E.requireRole(ctx, 'practitioner');
    const p = E.get('practitioners', ctx.user.practitionerId);
    if (!p) fail('NOT_FOUND', 'Complete your practitioner profile first.', 404);
    return p;
  };
  const ownBooking = (ctx, id) => {
    const b = E.must('bookings', id, 'Consultation');
    if (b.customerId !== ctx.user.id) fail('FORBIDDEN', 'This consultation belongs to another account.', 403);
    return b;
  };
  const practitionerBooking = (ctx, id) => {
    const p = practitionerOf(ctx);
    const b = E.must('bookings', id, 'Consultation');
    if (b.practitionerId !== p.id) fail('FORBIDDEN', 'This consultation is assigned to another practitioner.', 403);
    return { p, b };
  };

  // Sensitive fields are included only for the customer, the treating practitioner and their supervisor.
  E.bookingView = (b, viewer) => {
    const pr = db().practitioners[b.practitionerId];
    const customer = db().users[b.customerId];
    const pay = b.paymentId ? db().payments[b.paymentId] : null;
    const view = {
      id: b.id, code: b.code, status: b.status, mode: b.mode, start: b.start, end: b.end, fee: b.fee, createdAt: b.createdAt,
      holdUntil: b.holdUntil, cancelledAt: b.cancelledAt || null, cancelReason: b.cancelReason || '', completedAt: b.completedAt || null,
      practitioner: pr ? { id: pr.id, fullName: pr.fullName, title: pr.title, classLabel: E.classLabel(pr), providerClass: pr.providerClass, location: pr.location, facility: pr.facility?.name, phone: b.status === 'confirmed' || b.status === 'in_progress' ? db().users[pr.userId]?.phone : '' } : null,
      customerName: customer?.name || 'Former customer',
      payment: pay ? { id: pay.id, reference: pay.reference, status: pay.status, amount: pay.amount, refunded: pay.refunded || 0, channel: pay.channel, receiptNo: pay.receiptNo } : null,
      videoLink: ['confirmed', 'in_progress'].includes(b.status) ? b.videoLink : '',
      reviewed: E.all('reviews').some((r) => r.bookingId === b.id),
      carePlanIds: E.all('carePlans').filter((c) => c.bookingId === b.id).map((c) => c.id),
    };
    const isCustomer = viewer.id === b.customerId;
    const isTreating = pr && viewer.practitionerId === pr.id;
    const isSupervisor = pr && viewer.practitionerId && pr.supervisorId === viewer.practitionerId && E.hasRole(viewer, 'supervisor');
    if (isCustomer || isTreating || isSupervisor) {
      Object.assign(view, {
        reason: b.reason, screening: b.screening, consentAt: b.consentAt, notes: b.notes || null, referral: b.referral || null,
        followUpDate: b.followUpDate || '', outcome: b.outcome || '', supervisorReview: b.supervisorReview || null,
        sharedDocs: (b.sharedDocIds || []).map((id) => db().documents[id]).filter((d) => d && !d.deleted).map((d) => ({ id: d.id, name: d.name, kind: d.kind, mime: d.mime, size: d.size, uploadedAt: d.uploadedAt })),
      });
    }
    if (isTreating || isSupervisor) {
      view.customer = customer ? { id: customer.id, name: customer.name, dob: customer.dob || '', health: customer.health || {} } : null;
    }
    return view;
  };

  // ---------- booking payment handler ----------
  E.paymentHandlers.booking = {
    alreadyPaid: (pay) => {
      const b = db().bookings[pay.targetIds[0]];
      return !!(b && b.paymentId && b.paymentId !== pay.id && db().payments[b.paymentId]?.status === 'success');
    },
    onSuccess: (pay) => {
      const b = db().bookings[pay.targetIds[0]];
      const pr = db().practitioners[b.practitionerId];
      const slotTaken = E.all('bookings').some((x) => x.id !== b.id && x.practitionerId === b.practitionerId && x.start === b.start && ['confirmed', 'in_progress', 'completed'].includes(x.status));
      if (!['pending_payment', 'expired'].includes(b.status) || slotTaken) {
        E.receiveAndRefund(pay, 'The time slot was no longer available when payment arrived', 'provider_unavailable');
        b.status = 'cancelled_system';
        b.cancelReason = 'Slot no longer available; payment refunded in full.';
        return;
      }
      const commission = Math.round((pay.amount * db().settings.consultationCommissionPct) / 100);
      const share = pay.amount - commission;
      pay.allocations = [
        { kind: 'provider_share', beneficiary: `practitioner:${pr.id}`, amount: share },
        { kind: 'platform_commission', beneficiary: 'PRORESMAT', amount: commission },
      ];
      E.post({ paymentId: pay.id, bookingId: b.id }, `Consultation ${b.code} payment ${pay.reference}`, [
        { account: 'cash:paystack', debit: pay.amount },
        { account: `payable:practitioner:${pr.id}`, credit: share },
        { account: 'revenue:consultation_commission', credit: commission },
      ]);
      E.createEarning({ beneficiaryType: 'practitioner', beneficiaryId: pr.id, sourceType: 'booking', sourceId: b.id, gross: pay.amount, commission, label: `Consultation ${b.code}` });
      b.status = 'confirmed';
      b.paymentId = pay.id;
      b.confirmedAt = E.nowIso();
      if (b.mode === 'video') b.videoLink = `https://meet.jit.si/proresmat-${b.code.toLowerCase()}-${E.randomToken(4)}`;
      const start = Date.parse(b.start);
      E.schedule(b.customerId, start - 24 * 3600000, { title: 'Appointment reminder', body: `You have a consultation tomorrow at ${b.start.slice(11, 16)} GMT.`, link: `#/c/booking/${b.id}`, kind: 'reminder' }, `bk:${b.id}:24`);
      E.schedule(b.customerId, start - 3600000, { title: 'Appointment in 1 hour', body: `Your consultation starts at ${b.start.slice(11, 16)} GMT.`, link: `#/c/booking/${b.id}`, kind: 'reminder' }, `bk:${b.id}:1`);
      E.schedule(pr.userId, start - 3600000, { title: 'Upcoming consultation', body: `Consultation ${b.code} starts at ${b.start.slice(11, 16)} GMT.`, link: `#/p/consult/${b.id}`, kind: 'reminder' }, `bk:${b.id}:p1`);
      E.notify(b.customerId, { title: 'Booking confirmed', body: `Consultation ${b.code} on ${b.start.slice(0, 10)} at ${b.start.slice(11, 16)} GMT is confirmed. Receipt ${pay.receiptNo}.`, link: `#/c/booking/${b.id}`, kind: 'booking' });
      E.notify(pr.userId, { title: 'New booking', body: `Consultation ${b.code} booked for ${b.start.slice(0, 10)} at ${b.start.slice(11, 16)} GMT.`, link: `#/p/consult/${b.id}`, kind: 'booking' });
    },
    describe: (pay) => {
      const b = db().bookings[pay.targetIds[0]];
      const pr = db().practitioners[b?.practitionerId];
      return { title: `Consultation ${b?.code}`, provider: pr ? `${pr.fullName} (${E.classLabel(pr)})` : '', lines: [{ label: `${pr?.title || 'Consultation'} • ${b?.mode}`, amount: pay.amount }] };
    },
  };

  // ---------- customer: booking ----------
  E.action('bookings.redFlags', { method: 'GET', path: '/bookings/red-flags', auth: false, fn: () => RED_FLAGS });

  E.action('bookings.create', {
    method: 'POST', path: '/bookings', roles: ['customer'],
    fn: (p, ctx) => {
      const pr = E.get('practitioners', p.practitionerId);
      if (!pr || !E.practitionerBookable(pr)) fail('NOT_BOOKABLE', 'This practitioner cannot accept bookings right now. Choose another verified practitioner.', 409);
      if (pr.userId === ctx.user.id) fail('VALIDATION', 'You cannot book a consultation with yourself.', 422);
      const mode = oneOf(p.mode, 'Consultation type', ['physical', 'telephone', 'video']);
      if (!pr.modes.includes(mode) || (mode === 'video' && !db().flags.videoConsultations)) fail('VALIDATION', 'This practitioner does not offer that consultation type.', 422, { field: 'mode' });
      const reason = str(p.reason, 'Reason for consultation', { min: 5, max: 1000 });
      const sc = p.screening || {};
      const flags = Array.isArray(sc.redFlags) ? sc.redFlags.filter((f) => RED_FLAGS[f]) : [];
      if (flags.length) {
        const q = E.insert('careQueue', { id: newId('cq'), type: 'red_flag', status: 'open', createdAt: E.nowIso(), customerId: ctx.user.id, customerName: ctx.user.name, practitionerId: pr.id, summary: `Red-flag screening: ${flags.map((f) => RED_FLAGS[f]).join('; ')}`, priority: 'urgent' });
        E.audit(ctx, 'screening.red_flag', 'careQueue', q.id, null, { flags });
        const err = new AppError('RED_FLAG', 'Your answers suggest you may need emergency care. Call 112 or 193 (National Ambulance Service) now, or go to the nearest hospital emergency unit. Do not wait for an online consultation.', 409, { flags });
        err.persist = true; // keep the follow-up queue entry
        throw err;
      }
      const pregnancy = oneOf(sc.pregnancy || 'not_applicable', 'Pregnancy', ['yes', 'no', 'unsure', 'not_applicable']);
      const breastfeeding = oneOf(sc.breastfeeding || 'not_applicable', 'Breastfeeding', ['yes', 'no', 'not_applicable']);
      const allergies = str(sc.allergies, 'Allergies', { optional: true, max: 500 });
      const currentMeds = str(sc.currentMeds, 'Current medicines', { optional: true, max: 500 });
      if (p.consent !== true) fail('CONSENT_REQUIRED', 'Please give informed consent to continue.', 422, { field: 'consent' });
      if (p.policyAccepted !== true) fail('CONSENT_REQUIRED', 'Please accept the cancellation policy and privacy notice.', 422, { field: 'policy' });
      let start;
      if (ctx.internal && p.start) start = new Date(p.start).toISOString();
      else {
        start = new Date(str(p.start, 'Time slot', { max: 40 })).toISOString();
        const date = start.slice(0, 10);
        const slot = E.slotsFor(pr, date).find((s) => s.start === start);
        if (!slot) fail('SLOT_UNAVAILABLE', 'That time is outside the practitioner’s availability. Pick another slot.', 409);
        if (!slot.available) fail('SLOT_TAKEN', 'Someone has just booked that time. Pick another slot.', 409);
      }
      const docIds = Array.isArray(p.docIds) ? p.docIds.filter((id) => db().documents[id]?.ownerId === ctx.user.id) : [];
      const minutes = pr.availability?.slotMinutes || 30;
      let fee = pr.fee;
      const b = E.insert('bookings', {
        id: newId('bkg'), code: E.code('CN'), customerId: ctx.user.id, practitionerId: pr.id, mode, start,
        end: new Date(Date.parse(start) + minutes * 60000).toISOString(), reason,
        screening: { redFlags: [], pregnancy, breastfeeding, allergies, currentMeds },
        consentAt: E.nowIso(), policyAcceptedAt: E.nowIso(), fee, status: 'pending_payment',
        holdUntil: new Date(E.now() + db().settings.slotHoldMinutes * 60000).toISOString(), createdAt: E.nowIso(), sharedDocIds: docIds,
      });
      // Keep the health profile current for future consultations.
      if (allergies || currentMeds) ctx.user.health = { ...(ctx.user.health || {}), allergies: allergies || ctx.user.health?.allergies || '', currentMeds: currentMeds || ctx.user.health?.currentMeds || '' };
      E.audit(ctx, 'booking.created', 'booking', b.id, null, { practitionerId: pr.id, start, mode, fee });
      return E.bookingView(b, ctx.user);
    },
  });

  E.action('bookings.list', {
    method: 'GET', path: '/bookings',
    fn: (p, ctx) => E.all('bookings').filter((b) => b.customerId === ctx.user.id && b.status !== 'expired')
      .sort((a, c) => c.start.localeCompare(a.start)).map((b) => E.bookingView(b, ctx.user)),
  });

  E.action('bookings.get', {
    method: 'GET', path: '/bookings/:id',
    fn: (p, ctx) => {
      const b = E.must('bookings', p.id, 'Consultation');
      const pr = db().practitioners[b.practitionerId];
      const allowed = b.customerId === ctx.user.id || ctx.user.practitionerId === b.practitionerId
        || (E.hasRole(ctx.user, 'supervisor') && pr?.supervisorId === ctx.user.practitionerId) || E.hasRole(ctx.user, 'admin', 'support', 'finance');
      if (!allowed) fail('FORBIDDEN', 'You do not have access to this consultation.', 403);
      return E.bookingView(b, ctx.user);
    },
  });

  E.cancellationQuote = (b) => {
    const hours = (Date.parse(b.start) - E.now()) / 3600000;
    const c = db().settings.cancellation;
    const paid = b.paymentId ? db().payments[b.paymentId] : null;
    const paidAmount = paid?.status === 'success' ? paid.amount - (paid.refunded || 0) : 0;
    let pct = 0;
    let rule = 'no_refund_late';
    if (hours >= c.fullRefundHours) { pct = 100; rule = 'customer_cancel_full'; } else if (hours >= c.partialRefundHours) { pct = c.partialRefundPct; rule = 'customer_cancel_partial'; }
    return { hoursBefore: Math.max(0, Math.round(hours * 10) / 10), pct, refund: Math.round((paidAmount * pct) / 100), paidAmount, rule };
  };

  E.action('bookings.cancelQuote', {
    method: 'GET', path: '/bookings/:id/cancel-quote',
    fn: (p, ctx) => E.cancellationQuote(ownBooking(ctx, p.id)),
  });

  E.action('bookings.cancel', {
    method: 'POST', path: '/bookings/:id/cancel',
    fn: (p, ctx) => {
      const b = ownBooking(ctx, p.id);
      if (b.status === 'pending_payment') {
        b.status = 'cancelled_customer'; b.cancelledAt = E.nowIso(); b.cancelReason = 'Cancelled before payment';
        E.audit(ctx, 'booking.cancelled', 'booking', b.id, { status: 'pending_payment' }, { status: b.status });
        return E.bookingView(b, ctx.user);
      }
      if (b.status !== 'confirmed') fail('INVALID_STATE', 'Only upcoming consultations can be cancelled.', 409);
      if (Date.parse(b.start) <= E.now()) fail('INVALID_STATE', 'This consultation has already started. Contact support instead.', 409);
      const q = E.cancellationQuote(b);
      const before = { status: b.status };
      if (q.refund > 0) E.refundPayment(ctx, { paymentId: b.paymentId, amount: q.refund, reason: `Customer cancelled ${q.hoursBefore}h before start`, rule: q.rule, target: { bookingId: b.id } });
      E.voidEarnings('booking', b.id, 'customer cancellation');
      b.status = 'cancelled_customer'; b.cancelledAt = E.nowIso(); b.cancelReason = str(p.reason, 'Reason', { optional: true, max: 300 }) || 'Cancelled by customer';
      E.cancelScheduled(`bk:${b.id}`);
      E.notify(db().practitioners[b.practitionerId].userId, { title: 'Booking cancelled', body: `Consultation ${b.code} on ${b.start.slice(0, 10)} was cancelled by the customer.`, link: '#/p/today', kind: 'booking' });
      E.audit(ctx, 'booking.cancelled', 'booking', b.id, before, { status: b.status, refund: q.refund }, b.cancelReason);
      return { booking: E.bookingView(b, ctx.user), refund: q.refund };
    },
  });

  E.action('bookings.shareDocuments', {
    method: 'POST', path: '/bookings/:id/documents',
    fn: (p, ctx) => {
      const b = ownBooking(ctx, p.id);
      if (!['pending_payment', 'confirmed', 'in_progress', 'completed'].includes(b.status)) fail('INVALID_STATE', 'Documents can only be shared with an active consultation.', 409);
      const ids = (Array.isArray(p.docIds) ? p.docIds : []).filter((id) => db().documents[id]?.ownerId === ctx.user.id && !db().documents[id].deleted);
      const before = [...(b.sharedDocIds || [])];
      b.sharedDocIds = p.replace ? ids : [...new Set([...(b.sharedDocIds || []), ...ids])];
      E.audit(ctx, 'booking.documents_shared', 'booking', b.id, before, b.sharedDocIds);
      return E.bookingView(b, ctx.user);
    },
  });

  // ---------- medical documents ----------
  const docAccess = (user, d) => {
    if (d.deleted) return false;
    if (d.ownerId === user.id) return true;
    if (user.practitionerId) {
      const shared = E.all('bookings').filter((b) => (b.sharedDocIds || []).includes(d.id) && !b.status.startsWith('cancelled') && b.status !== 'expired');
      for (const b of shared) {
        if (b.practitionerId === user.practitionerId) return true;
        const pr = db().practitioners[b.practitionerId];
        if (E.hasRole(user, 'supervisor') && pr?.supervisorId === user.practitionerId && b.supervisorReview) return true;
      }
    }
    if (user.orgId && E.hasRole(user, 'vendor')) {
      if (E.all('rxRequests').some((r) => r.documentId === d.id && r.pharmacyOrgId === user.orgId && r.status !== 'cancelled')) return true;
    }
    return false;
  };
  E.docAccess = docAccess;

  E.action('documents.upload', {
    method: 'POST', path: '/documents',
    fn: async (p, ctx) => {
      const name = str(p.name, 'File name', { max: 150 }).replace(/[^\w.\- ()]/g, '_');
      const mime = oneOf(p.mime, 'File type', Object.keys(ALLOWED_MIME));
      const kind = oneOf(p.kind || 'record', 'Document type', ['lab', 'scan', 'record', 'prescription']);
      if (typeof p.dataB64 !== 'string' || p.dataB64.length > Math.ceil(MAX_DOC_BYTES * 1.37) + 16) fail('FILE_TOO_LARGE', 'Files must be 5 MB or smaller.', 413);
      let bytes;
      try { bytes = fromB64(p.dataB64); } catch { fail('VALIDATION', 'The file could not be read. Try uploading it again.', 422); }
      if (!bytes.length) fail('VALIDATION', 'The file is empty.', 422);
      if (bytes.length > MAX_DOC_BYTES) fail('FILE_TOO_LARGE', 'Files must be 5 MB or smaller.', 413);
      const magic = ALLOWED_MIME[mime];
      if (!magic.every((b, i) => bytes[i] === b)) fail('FILE_TYPE_MISMATCH', 'The file content does not match its type. Upload a real PDF, JPEG or PNG.', 422);
      // Malware screen: reject executables and the EICAR test signature. Production adds a full AV engine.
      const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
      if (head.includes(EICAR) || head.includes('\x7fELF') || (mime === 'application/pdf' && /\/JavaScript|\/Launch/.test(head))) fail('FILE_REJECTED', 'This file failed the security scan and was not stored.', 422);
      const sha256 = await sha256Hex(bytes);
      const { iv, data } = await aesEncrypt(E.config.docKey, bytes);
      const blobKey = E.randomToken(16);
      await E.blobs.put(blobKey, data);
      const d = E.insert('documents', { id: newId('doc'), ownerId: ctx.user.id, name, mime, kind, size: bytes.length, sha256, blobKey, iv, uploadedAt: E.nowIso(), deleted: false });
      E.audit(ctx, 'document.uploaded', 'document', d.id, null, { name, kind, size: d.size });
      if (p.bookingId) {
        const b = ownBooking(ctx, p.bookingId);
        b.sharedDocIds = [...new Set([...(b.sharedDocIds || []), d.id])];
      }
      return { id: d.id, name, mime, kind, size: d.size, uploadedAt: d.uploadedAt };
    },
  });

  E.action('documents.list', {
    method: 'GET', path: '/documents',
    fn: (p, ctx) => E.all('documents').filter((d) => d.ownerId === ctx.user.id && !d.deleted).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
      .map((d) => ({ id: d.id, name: d.name, mime: d.mime, kind: d.kind, size: d.size, uploadedAt: d.uploadedAt, sharedWith: E.all('bookings').filter((b) => (b.sharedDocIds || []).includes(d.id)).map((b) => ({ id: b.id, code: b.code, practitioner: db().practitioners[b.practitionerId]?.fullName })) })),
  });

  E.action('documents.link', {
    method: 'POST', path: '/documents/:id/link',
    fn: (p, ctx) => {
      const d = E.must('documents', p.id, 'Document');
      if (!docAccess(ctx.user, d)) {
        E.audit(ctx, 'document.access_denied', 'document', d.id);
        const err = new AppError('FORBIDDEN', 'You are not authorised to view this document.', 403);
        err.persist = true; // keep the denied-access audit entry
        throw err;
      }
      const token = E.randomToken(20);
      const l = E.insert('docLinks', { id: token, docId: d.id, userId: ctx.user.id, expiresAt: new Date(E.now() + 5 * 60000).toISOString() });
      E.audit(ctx, 'document.link_issued', 'document', d.id, null, { expiresAt: l.expiresAt });
      return { token, url: `/api/v1/files/${token}`, expiresAt: l.expiresAt, name: d.name, mime: d.mime };
    },
  });

  // Streams a decrypted document for a valid short-lived link. The HTTP layer sends the bytes.
  E.action('documents.fetch', {
    method: 'GET', path: '/files/:token', auth: false, raw: true, mutates: true,
    fn: async (p) => {
      const l = E.get('docLinks', p.token);
      if (!l || Date.parse(l.expiresAt) < E.now()) fail('LINK_EXPIRED', 'This document link has expired. Open the document again from the app.', 410);
      const d = E.must('documents', l.docId, 'Document');
      const user = db().users[l.userId];
      if (!user || !docAccess(user, d)) fail('FORBIDDEN', 'Access to this document has been withdrawn.', 403);
      const enc = await E.blobs.get(d.blobKey);
      if (!enc) fail('NOT_FOUND', 'The file is missing from storage.', 404);
      const bytes = await aesDecrypt(E.config.docKey, d.iv, enc);
      E.audit({ user }, 'document.accessed', 'document', d.id, null, { via: 'link' });
      return { name: d.name, mime: d.mime, dataB64: toB64(bytes) };
    },
  });

  E.action('documents.delete', {
    method: 'DELETE', path: '/documents/:id',
    fn: async (p, ctx) => {
      const d = E.must('documents', p.id, 'Document');
      if (d.ownerId !== ctx.user.id) fail('FORBIDDEN', 'Only the owner can delete this document.', 403);
      d.deleted = true;
      d.deletedAt = E.nowIso();
      await E.blobs.del(d.blobKey);
      for (const b of E.all('bookings')) if (b.sharedDocIds?.includes(d.id)) b.sharedDocIds = b.sharedDocIds.filter((x) => x !== d.id);
      E.audit(ctx, 'document.deleted', 'document', d.id);
      return { ok: true };
    },
  });

  // ---------- care plans / prescriptions ----------
  const carePlanView = (c) => {
    const pr = db().practitioners[c.practitionerId];
    return {
      ...c, practitionerName: pr?.fullName, practitionerTitle: pr?.title, classLabel: pr ? E.classLabel(pr) : '',
      items: c.items.map((i) => ({ ...i, purchasable: i.productId ? E.productPurchasable(db().products[i.productId]) : false, seller: i.productId ? E.sellerLabel(db().products[i.productId]?.orgId) : '' })),
    };
  };
  E.action('carePlans.list', {
    method: 'GET', path: '/care-plans',
    fn: (p, ctx) => E.all('carePlans').filter((c) => c.customerId === ctx.user.id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).map(carePlanView),
  });
  E.action('carePlans.get', {
    method: 'GET', path: '/care-plans/:id',
    fn: (p, ctx) => {
      const c = E.must('carePlans', p.id, 'Care plan');
      if (c.customerId !== ctx.user.id && c.practitionerId !== ctx.user.practitionerId) fail('FORBIDDEN', 'You do not have access to this care plan.', 403);
      return carePlanView(c);
    },
  });

  // ---------- practitioner: clinical workspace ----------
  E.action('practitioner.appointments', {
    method: 'GET', path: '/practitioner/appointments', roles: ['practitioner'],
    fn: (p, ctx) => {
      const pr = practitionerOf(ctx);
      return E.all('bookings').filter((b) => b.practitionerId === pr.id && !['pending_payment', 'expired'].includes(b.status))
        .sort((a, b) => a.start.localeCompare(b.start)).map((b) => E.bookingView(b, ctx.user));
    },
  });

  E.action('practitioner.patients', {
    method: 'GET', path: '/practitioner/patients', roles: ['practitioner'],
    fn: (p, ctx) => {
      const pr = practitionerOf(ctx);
      const map = {};
      for (const b of E.all('bookings')) {
        if (b.practitionerId !== pr.id || ['pending_payment', 'expired', 'cancelled_system'].includes(b.status)) continue;
        const u = db().users[b.customerId];
        const m = map[b.customerId] || (map[b.customerId] = { id: b.customerId, name: u?.name || 'Former customer', visits: 0, lastVisit: '', nextVisit: '' });
        m.visits++;
        if (b.status === 'completed' && b.start > m.lastVisit) m.lastVisit = b.start;
        if (['confirmed', 'in_progress'].includes(b.status) && (!m.nextVisit || b.start < m.nextVisit)) m.nextVisit = b.start;
      }
      return Object.values(map);
    },
  });

  E.action('practitioner.patient', {
    method: 'GET', path: '/practitioner/patients/:id', roles: ['practitioner'],
    fn: (p, ctx) => {
      const pr = practitionerOf(ctx);
      const bookings = E.all('bookings').filter((b) => b.practitionerId === pr.id && b.customerId === p.id && !['pending_payment', 'expired'].includes(b.status));
      if (!bookings.length) fail('FORBIDDEN', 'You can only view patients who have booked with you.', 403);
      const u = E.must('users', p.id, 'Patient');
      E.audit(ctx, 'patient.record_viewed', 'user', u.id);
      return {
        id: u.id, name: u.name, dob: u.dob || '', health: u.health || {},
        bookings: bookings.sort((a, b) => b.start.localeCompare(a.start)).map((b) => E.bookingView(b, ctx.user)),
        carePlans: E.all('carePlans').filter((c) => c.customerId === u.id && c.practitionerId === pr.id).map(carePlanView),
      };
    },
  });

  E.action('consult.start', {
    method: 'POST', path: '/consult/:id/start', roles: ['practitioner'],
    fn: (p, ctx) => {
      const { b } = practitionerBooking(ctx, p.id);
      if (b.status !== 'confirmed') fail('INVALID_STATE', 'Only confirmed consultations can be started.', 409);
      if (E.now() < Date.parse(b.start) - 30 * 60000) fail('TOO_EARLY', 'You can start a consultation from 30 minutes before its scheduled time.', 409);
      b.status = 'in_progress';
      b.attendedAt = E.nowIso();
      E.audit(ctx, 'consult.started', 'booking', b.id, { status: 'confirmed' }, { status: 'in_progress' });
      return E.bookingView(b, ctx.user);
    },
  });

  E.action('consult.document', {
    method: 'POST', path: '/consult/:id/notes', roles: ['practitioner'],
    fn: (p, ctx) => {
      const { p: pr, b } = practitionerBooking(ctx, p.id);
      if (!['in_progress', 'completed'].includes(b.status)) fail('INVALID_STATE', 'Start the consultation before documenting it.', 409);
      const before = E.clone(b.notes || null);
      b.notes = {
        presentingConcern: str(p.presentingConcern, 'Presenting concern', { optional: true, max: 2000 }),
        history: str(p.history, 'History', { optional: true, max: 4000 }),
        assessment: str(p.assessment, 'Assessment', { min: 3, max: 4000 }),
        plan: str(p.plan, 'Plan', { optional: true, max: 4000 }),
        recommendation: str(p.recommendation, 'Recommended treatment', { optional: true, max: 2000 }),
        rationale: str(p.rationale, 'Rationale', { optional: true, max: 2000 }),
        updatedAt: E.nowIso(), updatedBy: ctx.user.name,
      };
      if (p.followUpDate) b.followUpDate = dateStr(p.followUpDate, 'Follow-up date');
      if (p.outcome !== undefined) b.outcome = str(p.outcome, 'Outcome', { optional: true, max: 1000 });
      if (p.referral && p.referral.to) {
        const urgency = oneOf(p.referral.urgency || 'routine', 'Referral urgency', ['routine', 'urgent', 'emergency']);
        b.referral = { to: str(p.referral.to, 'Referral facility', { max: 200 }), reason: str(p.referral.reason, 'Referral reason', { max: 1000 }), urgency, at: E.nowIso() };
        if (!E.all('careQueue').some((q) => q.bookingId === b.id && q.type === 'referral')) {
          E.insert('careQueue', { id: newId('cq'), type: 'referral', status: 'open', priority: urgency === 'routine' ? 'normal' : 'urgent', createdAt: E.nowIso(), bookingId: b.id, customerId: b.customerId, customerName: db().users[b.customerId]?.name, practitionerId: pr.id, summary: `${urgency} referral to ${b.referral.to}` });
        }
        E.notify(b.customerId, { title: 'Referral issued', body: `Your practitioner has referred you to ${b.referral.to}. Open the consultation for details.`, link: `#/c/booking/${b.id}`, kind: 'care' });
        if (pr.providerClass === 'supervised' && pr.supervisorId && !b.supervisorReview) b.supervisorReview = { status: 'requested', requestedAt: E.nowIso(), reason: 'Automatic: referral by supervised practitioner' };
      }
      if (p.escalate) {
        E.insert('careQueue', { id: newId('cq'), type: 'emergency', status: 'open', priority: 'urgent', createdAt: E.nowIso(), bookingId: b.id, customerId: b.customerId, customerName: db().users[b.customerId]?.name, practitionerId: pr.id, summary: str(p.escalate, 'Escalation note', { max: 1000 }) });
      }
      E.audit(ctx, 'consult.documented', 'booking', b.id, before, b.notes);
      return E.bookingView(b, ctx.user);
    },
  });

  E.action('consult.carePlan', {
    method: 'POST', path: '/consult/:id/care-plan', roles: ['practitioner'],
    fn: (p, ctx) => {
      const { p: pr, b } = practitionerBooking(ctx, p.id);
      if (!['in_progress', 'completed'].includes(b.status)) fail('INVALID_STATE', 'Start the consultation before issuing a care plan.', 409);
      const type = oneOf(p.type || 'care_plan', 'Type', ['care_plan', 'prescription']);
      // Professional-scope control: only authorised professionals may issue prescriptions.
      if (type === 'prescription' && !pr.canPrescribe) fail('SCOPE', 'Your registered scope does not include prescriptions. Issue a treatment recommendation / care plan instead.', 403);
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 12).map((i, idx) => {
        const productId = i.productId || '';
        if (productId && !E.productPurchasable(db().products[productId])) fail('VALIDATION', `Item ${idx + 1}: that product is not an approved, in-date listing.`, 422);
        return {
          productId, name: productId ? db().products[productId].name : str(i.name, `Item ${idx + 1} name`, { max: 150 }),
          dosage: str(i.dosage, `Item ${idx + 1} dosage`, { max: 150 }), frequency: str(i.frequency, `Item ${idx + 1} frequency`, { optional: true, max: 150 }),
          duration: str(i.duration, `Item ${idx + 1} duration`, { optional: true, max: 100 }), rationale: str(i.rationale, `Item ${idx + 1} rationale`, { optional: true, max: 500 }),
        };
      });
      const advice = str(p.advice, 'Advice', { optional: true, max: 3000 });
      if (!items.length && !advice) fail('VALIDATION', 'Add at least one item or written advice.', 422);
      const c = E.insert('carePlans', {
        id: newId('cp'), code: E.code(type === 'prescription' ? 'RX' : 'CP'), bookingId: b.id, practitionerId: pr.id, customerId: b.customerId, type,
        items, advice, followUpDate: p.followUpDate ? dateStr(p.followUpDate, 'Follow-up date') : (b.followUpDate || ''),
        refills: type === 'prescription' ? int(p.refills ?? 0, 'Refills', { min: 0, max: 5 }) : 0, issuedAt: E.nowIso(),
      });
      E.notify(b.customerId, { title: type === 'prescription' ? 'New prescription' : 'New care plan', body: `${pr.fullName} issued ${c.code}. Open it in your dashboard.`, link: `#/c/careplan/${c.id}`, kind: 'care' });
      if (c.followUpDate) E.schedule(b.customerId, Date.parse(c.followUpDate + 'T08:00:00Z') - 86400000, { title: 'Follow-up reminder', body: `Your follow-up with ${pr.fullName} is due on ${c.followUpDate}.`, link: `#/c/careplan/${c.id}`, kind: 'reminder' }, `fu:${c.id}`);
      if (c.refills > 0) E.schedule(b.customerId, E.now() + 25 * 86400000, { title: 'Refill reminder', body: `You have ${c.refills} refill(s) left on ${c.code}.`, link: `#/c/careplan/${c.id}`, kind: 'reminder' }, `rf:${c.id}`);
      E.audit(ctx, 'careplan.issued', 'carePlan', c.id, null, { type, items: items.length });
      return carePlanView(c);
    },
  });

  E.action('consult.complete', {
    method: 'POST', path: '/consult/:id/complete', roles: ['practitioner'],
    fn: (p, ctx) => {
      const { b } = practitionerBooking(ctx, p.id);
      if (b.status !== 'in_progress') fail('INVALID_STATE', 'Only a consultation in progress can be completed.', 409);
      if (!b.notes?.assessment) fail('DOCUMENTATION_REQUIRED', 'Record your assessment before completing the consultation.', 422);
      b.status = 'completed';
      b.completedAt = E.nowIso();
      b.complaintWindowUntil = new Date(E.now() + db().settings.complaintWindowDays * 86400000).toISOString();
      E.notify(b.customerId, { title: 'Consultation completed', body: `Consultation ${b.code} is complete. View your care plan and receipt, and rate your experience.`, link: `#/c/booking/${b.id}`, kind: 'care' });
      E.audit(ctx, 'consult.completed', 'booking', b.id, { status: 'in_progress' }, { status: 'completed' });
      E.evaluateEarnings();
      return E.bookingView(b, ctx.user);
    },
  });

  E.action('consult.noShow', {
    method: 'POST', path: '/consult/:id/no-show', roles: ['practitioner'],
    fn: (p, ctx) => {
      const { b } = practitionerBooking(ctx, p.id);
      if (b.status !== 'confirmed') fail('INVALID_STATE', 'Only confirmed consultations can be marked as missed.', 409);
      if (E.now() < Date.parse(b.start) + 15 * 60000) fail('TOO_EARLY', 'Wait at least 15 minutes after the start time before marking a no-show.', 409);
      b.status = 'no_show';
      b.completedAt = E.nowIso();
      b.notes = { assessment: 'Customer did not attend the scheduled consultation.', updatedAt: E.nowIso(), updatedBy: ctx.user.name };
      b.complaintWindowUntil = new Date(E.now() + db().settings.complaintWindowDays * 86400000).toISOString();
      E.notify(b.customerId, { title: 'Missed consultation', body: `You were marked as not attending consultation ${b.code}. Contact support if this is wrong.`, link: `#/c/booking/${b.id}`, kind: 'booking' });
      E.audit(ctx, 'consult.no_show', 'booking', b.id, { status: 'confirmed' }, { status: 'no_show' });
      return E.bookingView(b, ctx.user);
    },
  });

  E.action('consult.providerCancel', {
    method: 'POST', path: '/consult/:id/cancel', roles: ['practitioner'],
    fn: (p, ctx) => {
      const { b } = practitionerBooking(ctx, p.id);
      if (b.status !== 'confirmed') fail('INVALID_STATE', 'Only confirmed consultations can be cancelled.', 409);
      const reason = str(p.reason, 'Reason', { min: 3, max: 300 });
      const pay = db().payments[b.paymentId];
      const refundable = pay.amount - (pay.refunded || 0);
      // Provider cancels before service: full refund.
      if (refundable > 0) E.refundPayment(ctx, { paymentId: pay.id, amount: refundable, reason: `Provider cancelled: ${reason}`, rule: 'provider_cancel_full', target: { bookingId: b.id } });
      E.voidEarnings('booking', b.id, 'provider cancellation');
      b.status = 'cancelled_provider'; b.cancelledAt = E.nowIso(); b.cancelReason = reason;
      E.cancelScheduled(`bk:${b.id}`);
      E.notify(b.customerId, { title: 'Consultation cancelled', body: `Your practitioner cancelled consultation ${b.code}. You have been refunded in full. You can book another time.`, link: `#/c/booking/${b.id}`, kind: 'booking' });
      E.audit(ctx, 'booking.provider_cancelled', 'booking', b.id, { status: 'confirmed' }, { status: b.status }, reason);
      return E.bookingView(b, ctx.user);
    },
  });

  E.action('consult.requestReview', {
    method: 'POST', path: '/consult/:id/supervisor-review', roles: ['practitioner'],
    fn: (p, ctx) => {
      const { p: pr, b } = practitionerBooking(ctx, p.id);
      if (!pr.supervisorId) fail('VALIDATION', 'You do not have an assigned supervisor.', 422);
      b.supervisorReview = { status: 'requested', requestedAt: E.nowIso(), reason: str(p.reason, 'Reason', { optional: true, max: 500 }) || 'Requested by practitioner' };
      const sup = db().practitioners[pr.supervisorId];
      if (sup) E.notify(sup.userId, { title: 'Case review requested', body: `${pr.fullName} requested review of ${b.code}.`, link: '#/p/supervision', kind: 'care' });
      E.audit(ctx, 'supervision.requested', 'booking', b.id);
      return E.bookingView(b, ctx.user);
    },
  });

  E.action('supervisor.queue', {
    method: 'GET', path: '/supervisor/queue', roles: ['supervisor'],
    fn: (p, ctx) => {
      const me = ctx.user.practitionerId;
      const supervisees = E.all('practitioners').filter((x) => x.supervisorId === me);
      const ids = new Set(supervisees.map((x) => x.id));
      return {
        supervisees: supervisees.map((x) => ({ id: x.id, fullName: x.fullName, title: x.title, status: x.status, licenceExpiry: x.licenceExpiry, completed: E.all('bookings').filter((b) => b.practitionerId === x.id && b.status === 'completed').length })),
        cases: E.all('bookings').filter((b) => ids.has(b.practitionerId) && b.supervisorReview).sort((a, b) => (a.supervisorReview.status === 'requested' ? -1 : 1) - (b.supervisorReview.status === 'requested' ? -1 : 1)).map((b) => E.bookingView(b, ctx.user)),
      };
    },
  });

  E.action('supervisor.decide', {
    method: 'POST', path: '/supervisor/reviews/:id', roles: ['supervisor'],
    fn: (p, ctx) => {
      const b = E.must('bookings', p.id, 'Consultation');
      const pr = db().practitioners[b.practitionerId];
      if (pr.supervisorId !== ctx.user.practitionerId) fail('FORBIDDEN', 'This case belongs to another supervisor.', 403);
      if (!b.supervisorReview) fail('INVALID_STATE', 'No review was requested for this case.', 409);
      const decision = oneOf(p.decision, 'Decision', ['endorsed', 'changes_advised']);
      const before = E.clone(b.supervisorReview);
      b.supervisorReview = { ...b.supervisorReview, status: decision, comments: str(p.comments, 'Comments', { optional: decision === 'endorsed', max: 2000 }), reviewedAt: E.nowIso(), reviewer: ctx.user.name };
      E.notify(pr.userId, { title: 'Supervisor feedback', body: `Your supervisor reviewed ${b.code}: ${decision === 'endorsed' ? 'endorsed' : 'changes advised'}.`, link: `#/p/consult/${b.id}`, kind: 'care' });
      E.audit(ctx, 'supervision.decided', 'booking', b.id, before, b.supervisorReview);
      return E.bookingView(b, ctx.user);
    },
  });

  // ---------- reviews (moderated; efficacy claims flagged) ----------
  E.action('reviews.create', {
    method: 'POST', path: '/reviews', roles: ['customer'],
    fn: (p, ctx) => {
      const targetType = oneOf(p.targetType, 'Review target', ['practitioner', 'org', 'product']);
      const rating = int(p.rating, 'Rating', { min: 1, max: 5 });
      const text = str(p.text, 'Review', { min: 3, max: 1000 });
      let targetId = p.targetId;
      let source;
      if (targetType === 'practitioner') {
        const b = ownBooking(ctx, p.bookingId);
        if (b.status !== 'completed') fail('NOT_ELIGIBLE', 'You can review a practitioner after a completed consultation.', 409);
        targetId = b.practitionerId; source = { bookingId: b.id };
      } else {
        const o = E.must('orders', p.orderId, 'Order');
        if (o.customerId !== ctx.user.id) fail('FORBIDDEN', 'This order belongs to another account.', 403);
        if (!['delivered', 'acknowledged'].includes(o.status)) fail('NOT_ELIGIBLE', 'You can review after your order is delivered.', 409);
        if (targetType === 'org') targetId = o.orgId;
        else if (!o.items.some((i) => i.productId === targetId)) fail('NOT_ELIGIBLE', 'You can only review products you received.', 409);
        source = { orderId: o.id };
      }
      if (E.all('reviews').some((r) => r.authorId === ctx.user.id && r.targetType === targetType && r.targetId === targetId && (r.bookingId || r.orderId) === (source.bookingId || source.orderId))) fail('DUPLICATE', 'You have already reviewed this.', 409);
      const flags = CLAIM_PATTERN.test(text) ? ['efficacy_claim'] : [];
      const r = E.insert('reviews', { id: newId('rev'), authorId: ctx.user.id, authorName: ctx.user.name.split(' ')[0] + ' ' + (ctx.user.name.split(' ')[1]?.[0] || '') + '.', targetType, targetId, ...source, rating, text, flags, status: 'pending', createdAt: E.nowIso() });
      E.audit(ctx, 'review.submitted', 'review', r.id, null, { targetType, targetId, rating, flags });
      return { ...r, message: flags.length ? 'Thanks. Reviews describe your experience of the service; claims that a treatment cured a condition cannot be published. A moderator will check your review.' : 'Thanks. Your review will appear after moderation.' };
    },
  });

  E.action('reviews.mine', { method: 'GET', path: '/reviews/mine', fn: (p, ctx) => E.all('reviews').filter((r) => r.authorId === ctx.user.id) });

  // ---------- complaints and support ----------
  E.action('tickets.create', {
    method: 'POST', path: '/tickets',
    fn: (p, ctx) => {
      const kind = oneOf(p.kind || 'support', 'Type', ['support', 'complaint']);
      const category = oneOf(p.category || 'general', 'Category', ['general', 'payment', 'booking', 'order', 'delivery', 'clinical_outcome', 'practitioner_conduct', 'product_quality', 'privacy']);
      const subject = str(p.subject, 'Subject', { min: 3, max: 150 });
      const message = str(p.message, 'Message', { min: 5, max: 3000 });
      const ref = {};
      if (p.bookingId) {
        const b = E.must('bookings', p.bookingId, 'Consultation');
        if (b.customerId !== ctx.user.id) fail('FORBIDDEN', 'This consultation belongs to another account.', 403);
        ref.bookingId = b.id;
      }
      if (p.orderId) {
        const o = E.must('orders', p.orderId, 'Order');
        if (o.customerId !== ctx.user.id) fail('FORBIDDEN', 'This order belongs to another account.', 403);
        ref.orderId = o.id;
      }
      const severity = ['clinical_outcome', 'practitioner_conduct', 'product_quality'].includes(category) ? 'high' : 'normal';
      const t = E.insert('tickets', { id: newId('tkt'), code: E.code('SUP'), userId: ctx.user.id, userName: ctx.user.name, kind, category, subject, severity, status: 'open', ...ref, createdAt: E.nowIso(), thread: [{ by: ctx.user.name, role: 'customer', at: E.nowIso(), text: message }] });
      // A complaint places the related provider settlement on hold until it is resolved.
      if (kind === 'complaint') {
        if (ref.bookingId) E.addHold('booking', ref.bookingId, `complaint:${t.id}`);
        if (ref.orderId) E.addHold('order', ref.orderId, `complaint:${t.id}`);
        t.holdApplied = !!(ref.bookingId || ref.orderId);
        if (category === 'clinical_outcome') t.thread.push({ by: 'PRORESMAT', role: 'system', at: E.nowIso(), text: 'Clinical-outcome complaints are reviewed by a clinician. They do not trigger an automatic refund; we will contact you with the outcome of the review.' });
      }
      E.audit(ctx, 'ticket.created', 'ticket', t.id, null, { kind, category, severity });
      return t;
    },
  });
  E.action('tickets.list', { method: 'GET', path: '/tickets', fn: (p, ctx) => E.all('tickets').filter((t) => t.userId === ctx.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  E.action('tickets.reply', {
    method: 'POST', path: '/tickets/:id/messages',
    fn: (p, ctx) => {
      const t = E.must('tickets', p.id, 'Ticket');
      const staff = E.hasRole(ctx.user, 'support', 'admin');
      if (t.userId !== ctx.user.id && !staff) fail('FORBIDDEN', 'You do not have access to this ticket.', 403);
      if (t.status === 'closed') fail('INVALID_STATE', 'This ticket is closed. Open a new one if you need more help.', 409);
      t.thread.push({ by: ctx.user.name, role: staff && t.userId !== ctx.user.id ? 'support' : 'customer', at: E.nowIso(), text: str(p.text, 'Message', { max: 3000 }) });
      if (staff && t.userId !== ctx.user.id) E.notify(t.userId, { title: 'Support replied', body: `New reply on ${t.code}.`, link: '#/c/support', kind: 'support' });
      return t;
    },
  });

  // ---------- adverse events & product problems ----------
  E.action('adverse.create', {
    method: 'POST', path: '/adverse-events',
    fn: (p, ctx) => {
      const kind = oneOf(p.kind || 'adverse_reaction', 'Report type', ['adverse_reaction', 'quality', 'interaction']);
      const severity = oneOf(p.severity || 'mild', 'Severity', ['mild', 'moderate', 'severe']);
      const description = str(p.description, 'Description', { min: 10, max: 3000 });
      const rec = { id: newId('ae'), code: E.code('AE'), reporterId: ctx.user.id, reporterName: ctx.user.name, reporterRole: ctx.user.practitionerId && p.bookingId ? 'practitioner' : 'customer', kind, severity, description, status: 'new', createdAt: E.nowIso(), onsetDate: p.onsetDate ? dateStr(p.onsetDate, 'Onset date') : '', otherMedicines: str(p.otherMedicines, 'Other medicines', { optional: true, max: 500 }), actions: [] };
      if (p.productId) { E.must('products', p.productId, 'Product'); rec.productId = p.productId; rec.productName = db().products[p.productId].name; }
      if (p.orderId) {
        const o = E.must('orders', p.orderId, 'Order');
        if (o.customerId !== ctx.user.id) fail('FORBIDDEN', 'This order belongs to another account.', 403);
        rec.orderId = o.id;
        E.addHold('order', o.id, `adverse:${rec.id}`);
      }
      if (p.bookingId) {
        const b = E.must('bookings', p.bookingId, 'Consultation');
        if (b.customerId !== ctx.user.id && b.practitionerId !== ctx.user.practitionerId) fail('FORBIDDEN', 'You do not have access to this consultation.', 403);
        rec.bookingId = b.id;
      }
      E.insert('adverseEvents', rec);
      if (severity === 'severe') E.insert('careQueue', { id: newId('cq'), type: 'adverse_event', status: 'open', priority: 'urgent', createdAt: E.nowIso(), adverseId: rec.id, customerId: ctx.user.id, customerName: ctx.user.name, summary: `Severe ${kind.replace('_', ' ')}${rec.productName ? ' – ' + rec.productName : ''}` });
      E.audit(ctx, 'adverse.reported', 'adverseEvent', rec.id, null, { kind, severity, productId: rec.productId || null });
      return { ...rec, message: severity === 'severe' ? 'Report received. If symptoms are severe or getting worse, stop the product and go to the nearest emergency unit or call 112 now.' : 'Report received. The PRORESMAT safety team will review it and may contact you.' };
    },
  });
  E.action('adverse.mine', { method: 'GET', path: '/adverse-events/mine', fn: (p, ctx) => E.all('adverseEvents').filter((a) => a.reporterId === ctx.user.id) });
}
