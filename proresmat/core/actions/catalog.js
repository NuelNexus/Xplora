// Public discovery: practitioners, clinics, approved products, education, reviews.
// Only active, verified, in-date providers and approved, in-date products are ever returned.

export const PRACTITIONER_CATEGORIES = {
  traditional: 'Traditional medicine practitioners',
  herbalist: 'Medical herbalists',
  conventional: 'Conventional medical services',
};
export const PRODUCT_CATEGORIES = ['Traditional herbal medicines', 'Nutrition & wellness', 'Teas & infusions', 'Topical preparations'];
export const DOSAGE_FORMS = ['Capsule', 'Tablet', 'Syrup', 'Tea bags', 'Tincture', 'Balm', 'Powder'];
export const MODES = { physical: 'In person', telephone: 'Telephone', video: 'Video' };

export function registerCatalog(E) {
  const { fail } = E;
  const db = () => E.db;

  E.ratingFor = (targetType, targetId) => {
    const rs = E.all('reviews').filter((r) => r.targetType === targetType && r.targetId === targetId && r.status === 'published');
    if (!rs.length) return { avg: null, count: 0 };
    return { avg: Math.round((rs.reduce((s, r) => s + r.rating, 0) / rs.length) * 10) / 10, count: rs.length };
  };

  // Generates bookable slots for a practitioner on a date, excluding taken and past slots.
  E.slotsFor = (p, date) => {
    const now = E.now();
    const day = E.WEEKDAYS[new Date(date + 'T00:00:00Z').getUTCDay()];
    const windows = (p.availability?.weekly?.[day]) || [];
    if ((p.availability?.blockedDates || []).includes(date)) return [];
    const step = (p.availability?.slotMinutes || 30) * 60000;
    const taken = new Set(E.all('bookings')
      .filter((b) => b.practitionerId === p.id && (['confirmed', 'in_progress', 'completed'].includes(b.status) || (b.status === 'pending_payment' && Date.parse(b.holdUntil) > now)))
      .map((b) => b.start));
    const out = [];
    for (const [from, to] of windows) {
      let t = Date.parse(`${date}T${from}:00Z`);
      const end = Date.parse(`${date}T${to}:00Z`);
      for (; t + step <= end; t += step) {
        const iso = new Date(t).toISOString();
        if (t < now + 60 * 60000) continue; // one hour minimum lead time
        out.push({ start: iso, available: !taken.has(iso) });
      }
    }
    return out;
  };

  E.nextAvailable = (p) => {
    for (let i = 0; i < 21; i++) {
      const date = E.addDays(E.today(), i);
      const s = E.slotsFor(p, date).find((x) => x.available);
      if (s) return s.start;
    }
    return null;
  };

  E.practitionerCard = (p) => {
    const org = p.orgId ? db().orgs[p.orgId] : null;
    return {
      id: p.id, fullName: p.fullName, title: p.title, category: p.category, categoryLabel: PRACTITIONER_CATEGORIES[p.category],
      providerClass: p.providerClass, classLabel: E.classLabel(p), practiceArea: p.practiceArea, location: p.location,
      languages: p.languages, modes: p.modes.filter((m) => m !== 'video' || db().flags.videoConsultations), fee: p.fee,
      avatar: p.avatar, rating: E.ratingFor('practitioner', p.id), nextAvailable: E.nextAvailable(p),
      facilityName: p.facility?.name || '', clinicName: org?.name || '',
    };
  };

  E.practitionerProfile = (p) => ({
    ...E.practitionerCard(p),
    qualification: p.qualification, council: p.council, registrationNumber: p.registrationNumber, licenceExpiry: p.licenceExpiry,
    licenceStatus: p.licenceExpiry >= E.today() ? 'Current' : 'Expired', facility: p.facility, bio: p.bio,
    canPrescribe: !!p.canPrescribe, supervisorName: p.supervisorId ? db().practitioners[p.supervisorId]?.fullName : '',
    verification: p.providerClass === 'supervised'
      ? `${p.fullName} practises under PRORESMAT clinical supervision. PRORESMAT checked their identity, qualification, ${p.council} registration and licence, and facility licence, and reviews selected cases.`
      : `${p.fullName} is an independent practitioner. PRORESMAT checked their identity, qualification, ${p.council} registration and current licence, and facility licence. They are not employed by PRORESMAT; PRORESMAT governs conduct on this platform and handles payment.`,
  });

  E.productCard = (p) => ({
    id: p.id, name: p.name, dosageForm: p.dosageForm, packSize: p.packSize, category: p.category, price: p.price,
    stock: p.stock, orgId: p.orgId, seller: E.sellerLabel(p.orgId), sellerIsProresmat: db().orgs[p.orgId]?.type === 'proresmat',
    image: p.image, indication: p.indication, delivery: p.delivery, pickup: p.pickup, rating: E.ratingFor('product', p.id),
    purchasable: E.productPurchasable(p) && p.stock > 0,
  });

  E.productDetail = (p) => ({
    ...E.productCard(p),
    fdaRegNo: p.fdaRegNo, fdaStatus: p.fdaExpiry >= E.today() ? `Registered (valid to ${p.fdaExpiry})` : 'Registration expired',
    fdaExpiry: p.fdaExpiry, manufacturer: p.manufacturer, ingredients: p.ingredients, strength: p.strength,
    directions: p.directions, duration: p.duration, warnings: p.warnings, contraindications: p.contraindications,
    pregnancy: p.pregnancy, interactions: p.interactions, returnEligible: p.returnEligible, returnPolicy: p.returnPolicy,
    status: p.status,
  });

  const visiblePractitioners = () => E.all('practitioners').filter(E.practitionerBookable);
  const visibleProducts = () => E.all('products').filter(E.productPurchasable);
  const match = (q, ...fields) => !q || fields.some((f) => (f || '').toLowerCase().includes(q));

  E.action('meta.get', {
    method: 'GET', path: '/meta', auth: false,
    fn: () => ({
      flags: db().flags,
      settings: {
        currency: db().settings.currency, deliveryFee: db().settings.deliveryFee, cancellation: db().settings.cancellation,
        plusMonthlyFee: db().settings.plusMonthlyFee, holdDaysConsultation: db().settings.holdDaysConsultation,
        sessionIdleMinutes: db().settings.sessionIdleMinutes, slotHoldMinutes: db().settings.slotHoldMinutes,
      },
      practitionerCategories: PRACTITIONER_CATEGORIES, productCategories: PRODUCT_CATEGORIES, dosageForms: DOSAGE_FORMS, modes: MODES,
      sellers: E.all('orgs').filter((o) => E.orgActive(o) && o.type !== 'pharmacy').map((o) => ({ id: o.id, label: E.sellerLabel(o.id) })),
      pharmacies: E.all('orgs').filter((o) => E.orgActive(o) && o.type === 'pharmacy').map((o) => ({ id: o.id, name: o.name, address: o.address })),
      paystackMode: E.config.paystack?.secretKey ? 'live' : 'sandbox',
      demo: !!E.config.demo,
    }),
  });

  E.action('home.get', {
    method: 'GET', path: '/home', auth: false,
    fn: (p, ctx) => {
      const pracs = visiblePractitioners().map(E.practitionerCard).sort((a, b) => (a.nextAvailable || 'z').localeCompare(b.nextAvailable || 'z'));
      const out = {
        practitioners: pracs.slice(0, 6), products: visibleProducts().slice(0, 6).map(E.productCard),
        education: E.all('education').slice(0, 4),
        counts: { practitioners: pracs.length, clinics: E.all('orgs').filter((o) => o.type === 'clinic' && E.orgActive(o)).length, products: visibleProducts().length },
        upcoming: null, activeOrder: null,
      };
      if (ctx.user) {
        const b = E.all('bookings').filter((x) => x.customerId === ctx.user.id && ['confirmed', 'in_progress'].includes(x.status)).sort((a, c) => a.start.localeCompare(c.start))[0];
        if (b) out.upcoming = { id: b.id, start: b.start, mode: b.mode, practitioner: db().practitioners[b.practitionerId]?.fullName, status: b.status };
        const o = E.all('orders').filter((x) => x.customerId === ctx.user.id && !['pending_payment', 'expired', 'cancelled', 'acknowledged', 'refunded'].includes(x.status)).sort((a, c) => c.createdAt.localeCompare(a.createdAt))[0];
        if (o) out.activeOrder = { id: o.id, code: o.code, status: o.status, seller: E.sellerLabel(o.orgId) };
      }
      return out;
    },
  });

  E.action('search.all', {
    method: 'GET', path: '/search', auth: false,
    fn: (p) => {
      const q = String(p.q || '').trim().toLowerCase().slice(0, 80);
      if (!q) return { practitioners: [], clinics: [], products: [] };
      return {
        practitioners: visiblePractitioners().filter((x) => match(q, x.fullName, x.title, x.practiceArea, x.location, x.languages.join(' '))).map(E.practitionerCard),
        clinics: E.all('orgs').filter((o) => o.type === 'clinic' && E.orgActive(o) && match(q, o.name, o.address)).map((o) => ({ id: o.id, name: o.name, address: o.address, rating: E.ratingFor('org', o.id) })),
        products: visibleProducts().filter((x) => match(q, x.name, x.category, x.dosageForm, x.ingredients, E.sellerLabel(x.orgId))).map(E.productCard),
      };
    },
  });

  E.action('practitioners.search', {
    method: 'GET', path: '/practitioners', auth: false,
    fn: (p) => {
      const q = String(p.q || '').trim().toLowerCase();
      return visiblePractitioners()
        .filter((x) => !p.category || x.category === p.category)
        .filter((x) => !p.mode || x.modes.includes(p.mode))
        .filter((x) => !p.providerClass || x.providerClass === p.providerClass)
        .filter((x) => match(q, x.fullName, x.title, x.practiceArea, x.location))
        .map(E.practitionerCard);
    },
  });

  E.action('practitioners.get', {
    method: 'GET', path: '/practitioners/:id', auth: false,
    fn: (p) => {
      const pr = E.get('practitioners', p.id);
      if (!pr || !E.practitionerBookable(pr)) fail('NOT_FOUND', 'This practitioner is not currently available on PRORESMAT.', 404);
      const reviews = E.all('reviews').filter((r) => r.targetType === 'practitioner' && r.targetId === pr.id && r.status === 'published')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10).map((r) => ({ id: r.id, rating: r.rating, text: r.text, authorName: r.authorName, createdAt: r.createdAt }));
      return { ...E.practitionerProfile(pr), reviews };
    },
  });

  E.action('practitioners.slots', {
    method: 'GET', path: '/practitioners/:id/slots', auth: false,
    fn: (p) => {
      const pr = E.get('practitioners', p.id);
      if (!pr || !E.practitionerBookable(pr)) fail('NOT_FOUND', 'This practitioner is not currently available.', 404);
      const from = p.from && /^\d{4}-\d{2}-\d{2}$/.test(p.from) ? p.from : E.today();
      const days = [];
      for (let i = 0; i < 14; i++) {
        const date = E.addDays(from, i);
        days.push({ date, slots: E.slotsFor(pr, date) });
      }
      return { days };
    },
  });

  E.action('products.search', {
    method: 'GET', path: '/products', auth: false,
    fn: (p) => {
      const q = String(p.q || '').trim().toLowerCase();
      return visibleProducts()
        .filter((x) => !p.category || x.category === p.category)
        .filter((x) => !p.seller || x.orgId === p.seller)
        .filter((x) => !p.form || x.dosageForm === p.form)
        .filter((x) => match(q, x.name, x.category, x.ingredients))
        .map(E.productCard);
    },
  });

  E.action('products.get', {
    method: 'GET', path: '/products/:id', auth: false,
    fn: (p) => {
      const pr = E.get('products', p.id);
      if (!pr || !E.productPurchasable(pr)) fail('NOT_FOUND', 'This product is not currently available on PRORESMAT.', 404);
      const reviews = E.all('reviews').filter((r) => r.targetType === 'product' && r.targetId === pr.id && r.status === 'published').slice(0, 10)
        .map((r) => ({ id: r.id, rating: r.rating, text: r.text, authorName: r.authorName, createdAt: r.createdAt }));
      return { ...E.productDetail(pr), reviews };
    },
  });

  E.action('clinics.get', {
    method: 'GET', path: '/clinics/:id', auth: false,
    fn: (p) => {
      const o = E.get('orgs', p.id);
      if (!o || !E.orgActive(o) || o.type === 'pharmacy') fail('NOT_FOUND', 'This clinic is not currently listed.', 404);
      return {
        id: o.id, name: o.name, type: o.type, address: o.address, description: o.description || '', facilityLicenceNo: o.facilityLicenceNo,
        licenceExpiry: o.licenceExpiry, rating: E.ratingFor('org', o.id), seller: E.sellerLabel(o.id),
        products: visibleProducts().filter((x) => x.orgId === o.id).map(E.productCard),
        practitioners: visiblePractitioners().filter((x) => x.orgId === o.id).map(E.practitionerCard),
        reviews: E.all('reviews').filter((r) => r.targetType === 'org' && r.targetId === o.id && r.status === 'published').slice(0, 10).map((r) => ({ id: r.id, rating: r.rating, text: r.text, authorName: r.authorName, createdAt: r.createdAt })),
      };
    },
  });

  E.action('education.list', {
    method: 'GET', path: '/education', auth: false,
    fn: (p) => E.all('education').filter((a) => !p.category || a.category === p.category),
  });
  E.action('education.get', {
    method: 'GET', path: '/education/:id', auth: false,
    fn: (p) => E.must('education', p.id, 'Article'),
  });
}
