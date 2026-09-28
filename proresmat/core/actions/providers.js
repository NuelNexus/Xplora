// Practitioner credentialing, availability and earnings; clinic/vendor onboarding, listings,
// fulfilment, prescription validation and payouts.
import { str, int, oneOf, dateStr, ghPhone, CLAIM_PATTERN } from '../util.js';
import { PRACTITIONER_CATEGORIES, PRODUCT_CATEGORIES, DOSAGE_FORMS } from './catalog.js';

const COUNCILS = { TMPC: 'Traditional Medicine Practice Council', MDC: 'Medical and Dental Council', AHPC: 'Allied Health Professions Council', PC: 'Pharmacy Council' };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function registerProviders(E) {
  const { fail, newId } = E;
  const db = () => E.db;

  const settlementOf = (s = {}) => {
    const method = oneOf(s.method, 'Settlement method', ['bank', 'momo']);
    if (method === 'bank') {
      return { method, bankName: str(s.bankName, 'Bank name', { max: 80 }), accountName: str(s.accountName, 'Account name', { max: 120 }), accountNumber: str(s.accountNumber, 'Account number', { min: 8, max: 20 }).replace(/\s/g, '') };
    }
    return { method, momoProvider: oneOf(s.momoProvider, 'Mobile money network', ['mtn', 'telecel', 'airteltigo']), momoNumber: ghPhone(s.momoNumber, 'Mobile money number'), accountName: str(s.accountName, 'Account name', { max: 120 }) };
  };
  const ghanaCard = (v) => {
    const t = str(v, 'Ghana Card number', { max: 20 }).toUpperCase().replace(/\s/g, '');
    if (!/^GHA-\d{9}-\d$/.test(t)) fail('VALIDATION', 'Enter the Ghana Card number as GHA-123456789-0.', 422, { field: 'idNumber' });
    return t;
  };
  const noClaims = (text, field) => {
    if (CLAIM_PATTERN.test(text || '')) fail('CLAIMS', `${field} contains cure or guarantee language. Use the approved indication or "traditionally used for…" wording.`, 422, { field });
  };

  // ---------- practitioner ----------
  const myPractitioner = (ctx) => E.get('practitioners', ctx.user.practitionerId);

  E.practitionerSelfView = (p) => ({ ...p, bookable: E.practitionerBookable(p), classLabel: E.classLabel(p), supervisorName: p.supervisorId ? db().practitioners[p.supervisorId]?.fullName : '', rating: E.ratingFor('practitioner', p.id) });

  E.action('practitioner.me', {
    method: 'GET', path: '/practitioner/me', roles: ['practitioner'],
    fn: (p, ctx) => {
      const pr = myPractitioner(ctx);
      return { profile: pr ? E.practitionerSelfView(pr) : null, councils: COUNCILS, categories: PRACTITIONER_CATEGORIES };
    },
  });

  E.action('practitioner.apply', {
    method: 'POST', path: '/practitioner/application', roles: ['practitioner'],
    fn: (p, ctx) => {
      const existing = myPractitioner(ctx);
      if (existing && !['draft', 'changes_required'].includes(existing.status)) fail('INVALID_STATE', 'Your application is already with PRORESMAT. Use profile updates or licence renewal instead.', 409);
      const agreements = p.agreements || {};
      if (!agreements.provider || !agreements.confidentiality || !agreements.conduct) fail('CONSENT_REQUIRED', 'Accept the provider agreement, confidentiality commitment and code of conduct.', 422, { field: 'agreements' });
      const licenceExpiry = dateStr(p.licenceExpiry, 'Licence expiry');
      if (licenceExpiry < E.today()) fail('VALIDATION', 'Your licence has expired. Renew it before applying.', 422, { field: 'licenceExpiry' });
      const facility = p.facility || {};
      const rec = {
        fullName: str(p.fullName, 'Full name', { min: 3, max: 120 }),
        title: str(p.title, 'Professional title', { min: 3, max: 120 }),
        category: oneOf(p.category, 'Category', Object.keys(PRACTITIONER_CATEGORIES)),
        practiceArea: str(p.practiceArea, 'Area of practice', { max: 200 }),
        qualification: str(p.qualification, 'Qualification', { max: 200 }),
        council: oneOf(p.council, 'Council', Object.keys(COUNCILS)),
        registrationNumber: str(p.registrationNumber, 'Registration number', { min: 3, max: 40 }),
        licenceExpiry,
        identity: { idType: 'ghana_card', idNumber: ghanaCard(p.idNumber), verified: false },
        facility: {
          name: str(facility.name, 'Facility name', { max: 150 }), licenceNo: str(facility.licenceNo, 'Facility licence number', { max: 40 }),
          licenceExpiry: dateStr(facility.licenceExpiry, 'Facility licence expiry'), address: str(facility.address, 'Facility address', { max: 300 }),
        },
        languages: (Array.isArray(p.languages) ? p.languages : String(p.languages || '').split(',')).map((x) => String(x).trim()).filter(Boolean).slice(0, 8),
        location: str(p.location, 'Location', { max: 120 }),
        modes: (Array.isArray(p.modes) ? p.modes : []).filter((m) => ['physical', 'telephone', 'video'].includes(m)),
        fee: Math.round(Number(p.feeGhs) * 100),
        bio: str(p.bio, 'Short biography', { optional: true, max: 1500 }),
        settlement: settlementOf(p.settlement),
        agreements: { provider: E.nowIso(), confidentiality: E.nowIso(), conduct: E.nowIso() },
        evidenceDocIds: (Array.isArray(p.evidenceDocIds) ? p.evidenceDocIds : []).filter((id) => db().documents[id]?.ownerId === ctx.user.id),
      };
      if (!rec.languages.length) fail('VALIDATION', 'Add at least one language.', 422, { field: 'languages' });
      if (!rec.modes.length) fail('VALIDATION', 'Choose at least one consultation type.', 422, { field: 'modes' });
      if (!Number.isInteger(rec.fee) || rec.fee < 1000 || rec.fee > 500000) fail('VALIDATION', 'Consultation fee must be between GH₵ 10 and GH₵ 5,000.', 422, { field: 'feeGhs' });
      noClaims(rec.bio, 'Biography');
      const submit = p.submit !== false;
      let pr;
      if (existing) {
        pr = Object.assign(existing, rec);
      } else {
        pr = E.insert('practitioners', {
          id: newId('prc'), userId: ctx.user.id, providerClass: 'independent', supervisorId: null, isSupervisor: false, canPrescribe: false, orgId: null,
          avatar: { initials: rec.fullName.split(' ').filter((w) => !/^(dr|mr|mrs|ms|nana|okomfo)\.?$/i.test(w)).map((w) => w[0]).slice(0, 2).join(''), hue: Math.floor(Math.random() * 360) },
          availability: { slotMinutes: 30, weekly: { mon: [['09:00', '13:00']], wed: [['09:00', '13:00']], fri: [['14:00', '17:00']] }, blockedDates: [] },
          statusHistory: [], createdAt: E.nowIso(), ...rec, status: 'draft',
        });
        ctx.user.practitionerId = pr.id;
      }
      if (submit) {
        const before = pr.status;
        pr.status = 'submitted';
        pr.submittedAt = E.nowIso();
        pr.statusHistory.push({ status: 'submitted', at: E.nowIso(), by: ctx.user.name, reason: 'Application submitted' });
        E.audit(ctx, 'practitioner.submitted', 'practitioner', pr.id, { status: before }, { status: 'submitted' });
      }
      return E.practitionerSelfView(pr);
    },
  });

  E.action('practitioner.updateProfile', {
    method: 'PATCH', path: '/practitioner/profile', roles: ['practitioner'],
    fn: (p, ctx) => {
      const pr = myPractitioner(ctx);
      if (!pr) fail('NOT_FOUND', 'Apply first.', 404);
      const before = { fee: pr.fee, modes: pr.modes, languages: pr.languages, bio: pr.bio };
      if (p.feeGhs !== undefined) {
        const fee = Math.round(Number(p.feeGhs) * 100);
        if (!Number.isInteger(fee) || fee < 1000 || fee > 500000) fail('VALIDATION', 'Consultation fee must be between GH₵ 10 and GH₵ 5,000.', 422, { field: 'feeGhs' });
        pr.fee = fee;
      }
      if (p.modes) { const m = p.modes.filter((x) => ['physical', 'telephone', 'video'].includes(x)); if (!m.length) fail('VALIDATION', 'Choose at least one consultation type.', 422); pr.modes = m; }
      if (p.languages) pr.languages = p.languages.map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
      if (p.bio !== undefined) { pr.bio = str(p.bio, 'Biography', { optional: true, max: 1500 }); noClaims(pr.bio, 'Biography'); }
      if (p.settlement) pr.settlement = settlementOf(p.settlement);
      E.audit(ctx, 'practitioner.profile_updated', 'practitioner', pr.id, before, { fee: pr.fee, modes: pr.modes, languages: pr.languages, bio: pr.bio });
      return E.practitionerSelfView(pr);
    },
  });

  E.action('practitioner.renewLicence', {
    method: 'POST', path: '/practitioner/licence-renewal', roles: ['practitioner'],
    fn: (p, ctx) => {
      const pr = myPractitioner(ctx);
      if (!pr) fail('NOT_FOUND', 'Apply first.', 404);
      const licenceExpiry = dateStr(p.licenceExpiry, 'New licence expiry');
      if (licenceExpiry <= (pr.licenceExpiry || '')) fail('VALIDATION', 'The new expiry date must be later than the current one.', 422);
      pr.pendingRenewal = { licenceExpiry, registrationNumber: str(p.registrationNumber || pr.registrationNumber, 'Registration number', { max: 40 }), docId: p.docId && db().documents[p.docId]?.ownerId === ctx.user.id ? p.docId : '', submittedAt: E.nowIso() };
      E.audit(ctx, 'practitioner.renewal_submitted', 'practitioner', pr.id, null, pr.pendingRenewal);
      return E.practitionerSelfView(pr);
    },
  });

  E.action('practitioner.setAvailability', {
    method: 'PUT', path: '/practitioner/availability', roles: ['practitioner'],
    fn: (p, ctx) => {
      const pr = myPractitioner(ctx);
      if (!pr) fail('NOT_FOUND', 'Apply first.', 404);
      const weekly = {};
      for (const d of E.WEEKDAYS) {
        const wins = (p.weekly?.[d] || []).slice(0, 4);
        weekly[d] = wins.map(([a, b]) => {
          if (!TIME.test(a) || !TIME.test(b) || a >= b) fail('VALIDATION', `Check the hours for ${d}: use HH:MM and make the end later than the start.`, 422, { field: d });
          return [a, b];
        });
      }
      const slotMinutes = oneOf(Number(p.slotMinutes || 30), 'Slot length', [15, 20, 30, 45, 60]);
      const blockedDates = (p.blockedDates || []).slice(0, 60).map((x) => dateStr(x, 'Blocked date'));
      const before = E.clone(pr.availability);
      pr.availability = { weekly, slotMinutes, blockedDates };
      E.audit(ctx, 'practitioner.availability_updated', 'practitioner', pr.id, before, pr.availability);
      return pr.availability;
    },
  });

  // ---------- earnings & payouts (practitioners and vendors) ----------
  const beneficiaryOf = (ctx) => {
    if (ctx.user.practitionerId && E.hasRole(ctx.user, 'practitioner') && (!ctx.user.orgId || ctx.params?.as !== 'org')) return { type: 'practitioner', id: ctx.user.practitionerId };
    if (ctx.user.orgId && E.hasRole(ctx.user, 'vendor')) return { type: 'org', id: ctx.user.orgId };
    fail('FORBIDDEN', 'Only practitioners and sellers have earnings.', 403);
  };
  E.earningsSummary = (type, id) => {
    const list = E.all('earnings').filter((e) => e.beneficiaryType === type && e.beneficiaryId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const sum = (f) => list.filter(f).reduce((s, e) => s + E.netOf(e), 0);
    return {
      earnings: list.map((e) => ({ ...e, net: E.netOf(e), payoutRef: e.payoutId ? db().payouts[e.payoutId]?.reference : '' })),
      totals: {
        gross: list.filter((e) => e.status !== 'void').reduce((s, e) => s + e.gross, 0),
        commission: list.filter((e) => e.status !== 'void').reduce((s, e) => s + e.commission, 0),
        adjustments: list.filter((e) => e.status !== 'void').reduce((s, e) => s + e.adjustments, 0),
        pending: sum((e) => e.status === 'pending'), onHold: sum((e) => e.status === 'on_hold'), eligible: sum((e) => e.status === 'eligible'), paid: sum((e) => e.status === 'paid'),
      },
      payouts: E.all('payouts').filter((x) => x.beneficiaryType === type && x.beneficiaryId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  };
  E.action('earnings.mine', {
    method: 'GET', path: '/earnings',
    fn: (p, ctx) => { ctx.params = p; const b = beneficiaryOf(ctx); return { ...E.earningsSummary(b.type, b.id), settings: { consultationCommissionPct: db().settings.consultationCommissionPct, productCommissionPct: db().settings.productCommissionPct, holdDaysConsultation: db().settings.holdDaysConsultation, holdDaysProduct: db().settings.holdDaysProduct } }; },
  });

  // ---------- clinic / vendor onboarding ----------
  const myOrg = (ctx) => {
    E.requireRole(ctx, 'vendor');
    const o = E.get('orgs', ctx.user.orgId);
    if (!o) fail('NOT_FOUND', 'Complete your organisation onboarding first.', 404);
    return o;
  };

  E.action('org.me', {
    method: 'GET', path: '/org/me', roles: ['vendor'],
    fn: (p, ctx) => {
      const o = E.get('orgs', ctx.user.orgId);
      if (!o) return { org: null };
      const products = E.all('products').filter((x) => x.orgId === o.id);
      const orders = E.all('orders').filter((x) => x.orgId === o.id && !['pending_payment', 'expired'].includes(x.status));
      return {
        org: { ...o, active: E.orgActive(o), seller: E.sellerLabel(o.id), rating: E.ratingFor('org', o.id) },
        stats: {
          listings: products.length, approved: products.filter((x) => x.status === 'approved').length, awaitingReview: products.filter((x) => ['submitted', 'under_review'].includes(x.status)).length,
          openOrders: orders.filter((x) => !['delivered', 'acknowledged', 'cancelled', 'refunded'].includes(x.status)).length, lowStock: products.filter((x) => x.status === 'approved' && x.stock <= 5).length,
          rxPending: E.all('rxRequests').filter((r) => r.pharmacyOrgId === o.id && r.status === 'submitted').length,
        },
      };
    },
  });

  E.action('org.apply', {
    method: 'POST', path: '/org/application', roles: ['vendor'],
    fn: (p, ctx) => {
      const existing = E.get('orgs', ctx.user.orgId);
      if (existing && !['draft', 'changes_required'].includes(existing.status)) fail('INVALID_STATE', 'Your organisation is already with PRORESMAT for review or active.', 409);
      const a = p.agreement || {};
      if (!a.serviceLevels || !a.refunds || !a.recalls) fail('CONSENT_REQUIRED', 'Accept the seller agreement terms for service levels, refunds and recalls.', 422, { field: 'agreement' });
      const type = oneOf(p.type, 'Organisation type', ['clinic', 'pharmacy']);
      const tin = str(p.taxId, 'Tax identification number', { max: 20 }).toUpperCase();
      if (!/^[PCGQV]\d{10}$/.test(tin)) fail('VALIDATION', 'Enter the 11-character GRA TIN, e.g. C0012345678.', 422, { field: 'taxId' });
      const licenceExpiry = dateStr(p.licenceExpiry, 'Facility licence expiry');
      if (licenceExpiry < E.today()) fail('VALIDATION', 'The facility licence has expired.', 422, { field: 'licenceExpiry' });
      const bo = p.beneficialOwner || {};
      const rep = p.authorisedRep || {};
      const rec = {
        type, name: str(p.name, 'Organisation name', { min: 3, max: 150 }), businessRegNo: str(p.businessRegNo, 'Business registration number', { max: 40 }),
        beneficialOwner: { name: str(bo.name, 'Beneficial owner name', { max: 120 }), idNumber: ghanaCard(bo.idNumber), ownershipPct: int(Number(bo.ownershipPct), 'Ownership %', { min: 1, max: 100 }) },
        address: str(p.address, 'Facility address', { max: 300 }), phone: ghPhone(p.phone), facilityLicenceNo: str(p.facilityLicenceNo, 'Facility licence number', { max: 40 }), licenceExpiry,
        authorisedRep: { name: str(rep.name, 'Authorised representative', { max: 120 }), position: str(rep.position, 'Position', { max: 80 }), phone: ghPhone(rep.phone, 'Representative phone') },
        settlement: settlementOf(p.settlement), taxId: tin, refundTerms: str(p.refundTerms, 'Refund terms', { min: 10, max: 1000 }),
        description: str(p.description, 'Description', { optional: true, max: 1000 }),
        agreementAcceptedAt: E.nowIso(),
      };
      if (type === 'pharmacy') {
        rec.superintendentPharmacist = str(p.superintendentPharmacist, 'Superintendent pharmacist', { max: 120 });
        rec.pharmacyCouncilLicence = str(p.pharmacyCouncilLicence, 'Pharmacy Council licence number', { max: 40 });
      }
      noClaims(rec.description, 'Description');
      let o;
      if (existing) o = Object.assign(existing, rec);
      else {
        o = E.insert('orgs', { id: newId('org'), ownerId: ctx.user.id, statusHistory: [], createdAt: E.nowIso(), ...rec, status: 'draft' });
        ctx.user.orgId = o.id;
      }
      o.status = 'submitted';
      o.submittedAt = E.nowIso();
      o.statusHistory.push({ status: 'submitted', at: E.nowIso(), by: ctx.user.name, reason: 'Onboarding submitted' });
      E.audit(ctx, 'org.submitted', 'org', o.id, null, { status: 'submitted', type });
      return o;
    },
  });

  E.action('org.renewLicence', {
    method: 'POST', path: '/org/licence-renewal', roles: ['vendor'],
    fn: (p, ctx) => {
      const o = myOrg(ctx);
      const licenceExpiry = dateStr(p.licenceExpiry, 'New licence expiry');
      if (licenceExpiry <= (o.licenceExpiry || '')) fail('VALIDATION', 'The new expiry date must be later than the current one.', 422);
      o.pendingRenewal = { licenceExpiry, submittedAt: E.nowIso() };
      E.audit(ctx, 'org.renewal_submitted', 'org', o.id, null, o.pendingRenewal);
      return o;
    },
  });

  // ---------- listings ----------
  E.action('vendor.products', {
    method: 'GET', path: '/vendor/products', roles: ['vendor'],
    fn: (p, ctx) => {
      const o = myOrg(ctx);
      return { products: E.all('products').filter((x) => x.orgId === o.id).map((x) => ({ ...x, purchasable: E.productPurchasable(x) })), categories: PRODUCT_CATEGORIES, forms: DOSAGE_FORMS };
    },
  });

  E.action('vendor.saveProduct', {
    method: 'POST', path: '/vendor/products', roles: ['vendor'],
    fn: (p, ctx) => {
      const o = myOrg(ctx);
      if (o.type === 'pharmacy') fail('FORBIDDEN', 'Pharmacy partners dispense validated prescriptions; they do not list retail products.', 403);
      let pr = p.id ? E.must('products', p.id, 'Product') : null;
      if (pr && pr.orgId !== o.id) fail('FORBIDDEN', 'This listing belongs to another seller.', 403);
      if (pr && !['draft', 'changes_required', 'expired', 'suspended'].includes(pr.status)) fail('INVALID_STATE', 'This listing is under review or published. Change stock and price from the listing instead.', 409);
      const rec = {
        name: str(p.name, 'Product name', { min: 3, max: 120 }), dosageForm: oneOf(p.dosageForm, 'Dosage form', DOSAGE_FORMS), packSize: str(p.packSize, 'Pack size', { max: 60 }),
        category: oneOf(p.category, 'Category', PRODUCT_CATEGORIES), fdaRegNo: str(p.fdaRegNo, 'FDA registration number', { min: 4, max: 40 }), fdaExpiry: dateStr(p.fdaExpiry, 'FDA registration expiry'),
        manufacturer: str(p.manufacturer, 'Manufacturer', { max: 150 }), ingredients: str(p.ingredients, 'Full ingredient declaration', { min: 3, max: 1500 }), strength: str(p.strength, 'Strength', { optional: true, max: 150 }),
        indication: str(p.indication, 'Approved indication', { min: 5, max: 500 }), directions: str(p.directions, 'Directions', { min: 5, max: 1000 }), duration: str(p.duration, 'Duration', { max: 100 }),
        warnings: str(p.warnings, 'Warnings', { min: 5, max: 1000 }), contraindications: str(p.contraindications, 'Contraindications', { min: 3, max: 1000 }),
        pregnancy: str(p.pregnancy, 'Pregnancy and breastfeeding advice', { min: 5, max: 500 }), interactions: str(p.interactions, 'Interaction warning', { min: 5, max: 500 }),
        price: Math.round(Number(p.priceGhs) * 100), stock: int(Number(p.stock), 'Stock', { min: 0, max: 100000 }),
        delivery: p.delivery !== false, pickup: p.pickup !== false, returnEligible: !!p.returnEligible, returnPolicy: str(p.returnPolicy, 'Return policy', { optional: true, max: 500 }),
      };
      if (!Number.isInteger(rec.price) || rec.price < 100) fail('VALIDATION', 'Enter a price of at least GH₵ 1.00.', 422, { field: 'priceGhs' });
      if (!rec.delivery && !rec.pickup) fail('VALIDATION', 'Offer delivery, pickup or both.', 422);
      for (const [f, label] of [['name', 'Product name'], ['indication', 'Indication'], ['directions', 'Directions']]) noClaims(rec[f], label);
      if (pr) {
        const before = E.clone(pr);
        Object.assign(pr, rec);
        if (pr.status === 'expired' || pr.status === 'suspended') { pr.status = 'draft'; pr.statusHistory.push({ status: 'draft', at: E.nowIso(), by: ctx.user.name, reason: 'Edited for resubmission' }); }
        E.audit(ctx, 'product.edited', 'product', pr.id, { status: before.status, fdaExpiry: before.fdaExpiry }, { status: pr.status, fdaExpiry: pr.fdaExpiry });
      } else {
        pr = E.insert('products', { id: newId('prd'), orgId: o.id, status: 'draft', statusHistory: [{ status: 'draft', at: E.nowIso(), by: ctx.user.name, reason: 'Created' }], batches: [], image: { hue: Math.floor(Math.random() * 360), shape: rec.dosageForm }, createdAt: E.nowIso(), ...rec });
        E.audit(ctx, 'product.created', 'product', pr.id, null, { name: pr.name });
      }
      return pr;
    },
  });

  E.action('vendor.submitProduct', {
    method: 'POST', path: '/vendor/products/:id/submit', roles: ['vendor'],
    fn: (p, ctx) => {
      const o = myOrg(ctx);
      const pr = E.must('products', p.id, 'Product');
      if (pr.orgId !== o.id) fail('FORBIDDEN', 'This listing belongs to another seller.', 403);
      if (!['draft', 'changes_required'].includes(pr.status)) fail('INVALID_STATE', `A listing in state "${pr.status.replace('_', ' ')}" cannot be submitted.`, 409);
      if (pr.fdaExpiry < E.today()) fail('VALIDATION', 'The FDA registration has expired. Update it before submitting.', 422);
      if (!['submitted', 'active'].includes(o.status)) fail('INVALID_STATE', 'Your organisation must be submitted for review before listings can be submitted.', 409);
      const before = pr.status;
      pr.status = 'submitted';
      pr.statusHistory.push({ status: 'submitted', at: E.nowIso(), by: ctx.user.name, reason: 'Submitted for PRORESMAT review' });
      E.audit(ctx, 'product.submitted', 'product', pr.id, { status: before }, { status: 'submitted' });
      return pr;
    },
  });

  E.action('vendor.updateStock', {
    method: 'POST', path: '/vendor/products/:id/stock', roles: ['vendor'],
    fn: (p, ctx) => {
      const o = myOrg(ctx);
      const pr = E.must('products', p.id, 'Product');
      if (pr.orgId !== o.id) fail('FORBIDDEN', 'This listing belongs to another seller.', 403);
      const before = { stock: pr.stock, price: pr.price };
      pr.stock = int(Number(p.stock), 'Stock', { min: 0, max: 100000 });
      if (p.priceGhs !== undefined && p.priceGhs !== '') {
        const price = Math.round(Number(p.priceGhs) * 100);
        if (!Number.isInteger(price) || price < 100) fail('VALIDATION', 'Enter a price of at least GH₵ 1.00.', 422);
        pr.price = price;
      }
      E.audit(ctx, 'product.stock_updated', 'product', pr.id, before, { stock: pr.stock, price: pr.price });
      return pr;
    },
  });

  // ---------- fulfilment ----------
  const FLOW = {
    received: ['accepted'], accepted: ['stock_confirmed'], stock_confirmed: ['prepared'],
    prepared: ['dispatched', 'ready_for_pickup'], dispatched: ['delivered'], ready_for_pickup: ['delivered'],
  };
  const vendorOrder = (ctx, id) => {
    const o = myOrg(ctx);
    const ord = E.must('orders', id, 'Order');
    if (ord.orgId !== o.id) fail('FORBIDDEN', 'This order belongs to another seller.', 403);
    return { org: o, ord };
  };

  E.action('vendor.orders', {
    method: 'GET', path: '/vendor/orders', roles: ['vendor'],
    fn: (p, ctx) => {
      const o = myOrg(ctx);
      return E.all('orders').filter((x) => x.orgId === o.id && !['pending_payment', 'expired'].includes(x.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((x) => E.orderView(x, ctx.user));
    },
  });

  E.action('vendor.advanceOrder', {
    method: 'POST', path: '/vendor/orders/:id/status', roles: ['vendor'],
    fn: (p, ctx) => {
      const { ord } = vendorOrder(ctx, p.id);
      const next = p.status;
      if (!(FLOW[ord.status] || []).includes(next)) fail('INVALID_STATE', `An order that is "${ord.status.replace(/_/g, ' ')}" cannot move to "${String(next).replace(/_/g, ' ')}".`, 409);
      if (next === 'dispatched' && ord.deliveryMethod !== 'delivery') fail('INVALID_STATE', 'This is a pickup order. Mark it ready for pickup.', 409);
      if (next === 'ready_for_pickup' && ord.deliveryMethod !== 'pickup') fail('INVALID_STATE', 'This is a delivery order. Mark it dispatched.', 409);
      if (next === 'prepared') {
        // Batch and expiry captured where relevant.
        const batches = p.batches || {};
        ord.items.forEach((it, idx) => {
          if (it.status !== 'ok') return;
          const b = batches[idx] || {};
          it.batch = str(b.batch, `Batch number for ${it.name}`, { max: 40 });
          it.expiry = dateStr(b.expiry, `Expiry date for ${it.name}`);
          if (it.expiry <= E.today()) fail('VALIDATION', `${it.name}: this batch has expired and cannot be supplied.`, 422);
          if (it.productId) db().products[it.productId].batches.push({ batch: it.batch, expiry: it.expiry, orderId: ord.id, at: E.nowIso() });
        });
      }
      if (next === 'delivered') {
        ord.proofOfDelivery = { receivedBy: str(p.receivedBy, 'Received by', { min: 2, max: 120 }), note: str(p.note, 'Note', { optional: true, max: 300 }), at: E.nowIso(), by: ctx.user.name };
        ord.deliveredAt = E.nowIso();
        // Refill reminders based on product duration.
        for (const it of ord.items) {
          const pr = db().products[it.productId];
          const days = pr && parseInt(String(pr.duration).match(/(\d+)\s*day/i)?.[1] || '0', 10);
          if (days >= 7) E.schedule(ord.customerId, E.now() + (days - 3) * 86400000, { title: 'Refill reminder', body: `Your ${it.name} may run out in about 3 days.`, link: `#/c/product/${it.productId}`, kind: 'reminder' }, `refill:${ord.id}:${it.productId}`);
        }
        E.cancelScheduled(`pickup:${ord.id}`);
      }
      const before = ord.status;
      ord.status = next;
      ord.timeline.push({ status: next, at: E.nowIso(), by: ctx.user.name, note: str(p.note, 'Note', { optional: true, max: 300 }) });
      const titles = { accepted: 'Order accepted', stock_confirmed: 'Order update', prepared: 'Order being prepared', dispatched: 'Order on the way', ready_for_pickup: 'Ready for pickup', delivered: 'Order delivered' };
      E.notify(ord.customerId, { title: titles[next], body: `${ord.code}: ${next.replace(/_/g, ' ')}.${next === 'delivered' ? ' Confirm receipt in the app.' : ''}`, link: '#/c/orders', kind: 'order' });
      if (next === 'ready_for_pickup') E.schedule(ord.customerId, E.now() + 2 * 86400000, { title: 'Pickup reminder', body: `${ord.code} is waiting for you at ${db().orgs[ord.orgId].address}.`, link: '#/c/orders', kind: 'reminder' }, `pickup:${ord.id}`);
      E.audit(ctx, 'order.status', 'order', ord.id, { status: before }, { status: next });
      E.evaluateEarnings();
      return E.orderView(ord, ctx.user);
    },
  });

  E.action('vendor.rejectOrder', {
    method: 'POST', path: '/vendor/orders/:id/reject', roles: ['vendor'],
    fn: (p, ctx) => {
      const { ord } = vendorOrder(ctx, p.id);
      if (ord.status !== 'received') fail('INVALID_STATE', 'Only new orders can be rejected. Mark items unavailable instead.', 409);
      const reason = str(p.reason, 'Reason', { min: 3, max: 300 });
      const amount = ord.total - (ord.refunded || 0);
      E.refundPayment(ctx, { paymentId: ord.paymentId, amount, reason: `Seller could not fulfil ${ord.code}: ${reason}`, rule: 'product_unavailable', target: { orderId: ord.id }, deliveryPortion: ord.deliveryFee });
      ord.refunded = (ord.refunded || 0) + amount;
      ord.status = 'cancelled';
      ord.timeline.push({ status: 'cancelled', at: E.nowIso(), by: ctx.user.name, note: `Rejected: ${reason}. Refunded in full.` });
      E.releaseOrderStock(ord);
      E.voidEarnings('order', ord.id, 'seller rejected order');
      E.audit(ctx, 'order.rejected', 'order', ord.id, { status: 'received' }, { status: 'cancelled' }, reason);
      return E.orderView(ord, ctx.user);
    },
  });

  // Item-level partial refund when some items cannot be supplied.
  E.action('vendor.markUnavailable', {
    method: 'POST', path: '/vendor/orders/:id/unavailable', roles: ['vendor'],
    fn: (p, ctx) => {
      const { ord } = vendorOrder(ctx, p.id);
      if (!['received', 'accepted', 'stock_confirmed'].includes(ord.status)) fail('INVALID_STATE', 'Items can only be marked unavailable before the order is prepared.', 409);
      const idxs = (p.itemIndexes || []).map(Number).filter((i) => ord.items[i] && ord.items[i].status === 'ok');
      if (!idxs.length) fail('VALIDATION', 'Choose at least one item.', 422);
      let amount = idxs.reduce((s, i) => s + ord.items[i].lineTotal, 0);
      const allGone = ord.items.every((it, i) => it.status !== 'ok' || idxs.includes(i));
      const deliveryPortion = allGone ? ord.deliveryFee : 0;
      amount += deliveryPortion;
      E.refundPayment(ctx, { paymentId: ord.paymentId, amount, reason: `${idxs.map((i) => ord.items[i].name).join(', ')} unavailable (${ord.code})`, rule: allGone ? 'product_unavailable' : 'partial_fulfilment', target: { orderId: ord.id }, deliveryPortion });
      for (const i of idxs) ord.items[i].status = 'unavailable';
      ord.refunded = (ord.refunded || 0) + amount;
      ord.timeline.push({ status: ord.status, at: E.nowIso(), by: ctx.user.name, note: `Item(s) unavailable, refunded ${(amount / 100).toFixed(2)} GHS` });
      if (allGone) { ord.status = 'cancelled'; E.voidEarnings('order', ord.id, 'all items unavailable'); }
      E.audit(ctx, 'order.items_unavailable', 'order', ord.id, null, { items: idxs, refund: amount });
      return E.orderView(ord, ctx.user);
    },
  });

  // ---------- prescription validation (pharmacy partners) ----------
  E.action('vendor.rxList', {
    method: 'GET', path: '/vendor/rx-requests', roles: ['vendor'],
    fn: (p, ctx) => {
      const o = myOrg(ctx);
      return E.all('rxRequests').filter((r) => r.pharmacyOrgId === o.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => {
        const c = r.carePlanId ? db().carePlans[r.carePlanId] : null;
        return { ...r, carePlan: c ? { code: c.code, items: c.items, practitioner: db().practitioners[c.practitionerId]?.fullName, issuedAt: c.issuedAt } : null, documentName: r.documentId ? db().documents[r.documentId]?.name : '' };
      });
    },
  });

  E.action('vendor.rxDecide', {
    method: 'POST', path: '/vendor/rx-requests/:id', roles: ['vendor'],
    fn: (p, ctx) => {
      const o = myOrg(ctx);
      const r = E.must('rxRequests', p.id, 'Prescription request');
      if (r.pharmacyOrgId !== o.id) fail('FORBIDDEN', 'This request was sent to another pharmacy.', 403);
      if (r.status !== 'submitted') fail('INVALID_STATE', 'This request has already been decided.', 409);
      const decision = oneOf(p.decision, 'Decision', ['validated', 'rejected']);
      const pharmacist = { name: str(p.pharmacist, 'Pharmacist name', { max: 120 }), regNo: str(p.pharmacistRegNo, 'Pharmacist registration number', { max: 40 }) };
      if (decision === 'rejected') {
        r.status = 'rejected';
        r.decision = { ...pharmacist, reason: str(p.note, 'Reason', { min: 5, max: 500 }), at: E.nowIso() };
        E.notify(r.customerId, { title: 'Prescription update', body: `The pharmacist could not validate ${r.code}. Open it for details.`, link: '#/c/rx', kind: 'order' });
      } else {
        const items = (p.items || []).slice(0, 10).map((i, idx) => {
          const qty = int(Number(i.qty), `Item ${idx + 1} quantity`, { min: 1, max: 100 });
          const unitPrice = Math.round(Number(i.unitPriceGhs) * 100);
          if (!Number.isInteger(unitPrice) || unitPrice < 100) fail('VALIDATION', `Item ${idx + 1}: enter a price of at least GH₵ 1.00.`, 422);
          return { name: str(i.name, `Item ${idx + 1} name`, { max: 150 }), qty, unitPrice, lineTotal: unitPrice * qty };
        });
        if (!items.length) fail('VALIDATION', 'Add the validated items and prices.', 422);
        const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
        const deliveryFee = r.deliveryMethod === 'delivery' ? db().settings.deliveryFee : 0;
        r.quote = { items, subtotal, deliveryFee, total: subtotal + deliveryFee };
        r.status = 'quoted';
        r.decision = { ...pharmacist, note: str(p.note, 'Note', { optional: true, max: 500 }), at: E.nowIso() };
        E.notify(r.customerId, { title: 'Prescription validated', body: `${r.code} was validated by a pharmacist. Review the price and pay to proceed.`, link: '#/c/rx', kind: 'order' });
      }
      E.audit(ctx, 'rx.decided', 'rxRequest', r.id, { status: 'submitted' }, { status: r.status }, r.decision.reason || '');
      return r;
    },
  });

  E.action('vendor.compliance', {
    method: 'GET', path: '/vendor/compliance', roles: ['vendor'],
    fn: (p, ctx) => {
      const o = myOrg(ctx);
      const days = (d) => (d ? Math.round((Date.parse(d) - Date.parse(E.today())) / 86400000) : null);
      return {
        org: { name: o.name, status: o.status, facilityLicenceNo: o.facilityLicenceNo, licenceExpiry: o.licenceExpiry, daysLeft: days(o.licenceExpiry), pendingRenewal: o.pendingRenewal || null, statusHistory: o.statusHistory, taxId: o.taxId, businessRegNo: o.businessRegNo },
        products: E.all('products').filter((x) => x.orgId === o.id).map((x) => ({ id: x.id, name: x.name, status: x.status, fdaRegNo: x.fdaRegNo, fdaExpiry: x.fdaExpiry, daysLeft: days(x.fdaExpiry), lastReason: x.statusHistory.at(-1)?.reason || '' })),
        adverse: E.all('adverseEvents').filter((a) => a.productId && db().products[a.productId]?.orgId === o.id).map((a) => ({ code: a.code, productName: a.productName, kind: a.kind, severity: a.severity, status: a.status, createdAt: a.createdAt })),
      };
    },
  });
}
