// PRORESMAT control centre: approvals, clinical & marketplace oversight, finance, risk.
import { str, int, oneOf, dateStr } from '../util.js';
import { LISTING_STATES } from '../engine.js';

export function registerAdmin(E) {
  const { fail, newId } = E;
  const db = () => E.db;
  const reasonOf = (p, required = true) => str(p.reason, 'Reason', { min: required ? 3 : 0, optional: !required, max: 500 });

  // ---------- overview ----------
  E.action('admin.overview', {
    method: 'GET', path: '/admin/overview', roles: ['admin', 'finance', 'support'],
    fn: () => {
      const today = E.today();
      const in30 = E.addDays(today, 30);
      const pays = E.all('payments').filter((p) => p.status === 'success' || p.status === 'duplicate_refunded');
      const bal = (prefix) => E.all('ledger').filter((l) => l.account.startsWith(prefix)).reduce((s, l) => s + l.credit - l.debit, 0);
      return {
        approvals: {
          practitioners: E.all('practitioners').filter((p) => p.status === 'submitted' || p.pendingRenewal).length,
          orgs: E.all('orgs').filter((o) => o.status === 'submitted' || o.pendingRenewal).length,
          products: E.all('products').filter((p) => ['submitted', 'under_review'].includes(p.status)).length,
          reviews: E.all('reviews').filter((r) => r.status === 'pending').length,
        },
        care: {
          urgent: E.all('careQueue').filter((q) => q.status === 'open' && q.priority === 'urgent').length,
          open: E.all('careQueue').filter((q) => q.status === 'open').length,
          adverse: E.all('adverseEvents').filter((a) => ['new', 'under_review'].includes(a.status)).length,
          complaints: E.all('tickets').filter((t) => t.kind === 'complaint' && !['resolved', 'closed'].includes(t.status)).length,
          privacy: E.all('privacyRequests').filter((r) => r.status === 'open').length,
        },
        finance: {
          collected: pays.reduce((s, p) => s + p.amount, 0), refunded: E.all('refunds').reduce((s, r) => s + r.amount, 0),
          revenue: bal('revenue:'), payable: bal('payable:'), eligible: E.all('earnings').filter((e) => e.status === 'eligible').reduce((s, e) => s + E.netOf(e), 0),
          onHold: E.all('earnings').filter((e) => e.status === 'on_hold').reduce((s, e) => s + E.netOf(e), 0),
          disputes: E.all('disputes').filter((d) => d.status === 'open').length, payments: pays.length,
        },
        risk: {
          expiringPractitioners: E.all('practitioners').filter((p) => p.status === 'active' && p.licenceExpiry <= in30).length,
          expiringProducts: E.all('products').filter((p) => p.status === 'approved' && p.fdaExpiry <= in30).length,
          failedLogins24h: E.all('loginHistory').filter((l) => !l.success && Date.parse(l.at) > E.now() - 86400000).length,
        },
        activity: E.all('audit').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8),
        counts: { customers: E.all('users').filter((u) => u.roles.includes('customer') && u.status === 'active').length, activePractitioners: E.all('practitioners').filter(E.practitionerBookable).length, liveProducts: E.all('products').filter(E.productPurchasable).length, bookings: E.all('bookings').filter((b) => !['pending_payment', 'expired'].includes(b.status)).length, orders: E.all('orders').filter((o) => !['pending_payment', 'expired'].includes(o.status)).length },
      };
    },
  });

  // ---------- approvals ----------
  E.action('admin.approvals', {
    method: 'GET', path: '/admin/approvals', roles: ['admin'],
    fn: () => ({
      practitioners: E.all('practitioners').sort((a, b) => (a.status === 'submitted' ? -1 : 1) - (b.status === 'submitted' ? -1 : 1)).map((p) => ({ ...E.practitionerSelfView(p), email: db().users[p.userId]?.email, evidence: (p.evidenceDocIds || []).length })),
      orgs: E.all('orgs').filter((o) => o.type !== 'proresmat').map((o) => ({ ...o, active: E.orgActive(o) })),
      products: E.all('products').map((p) => ({ ...p, seller: E.sellerLabel(p.orgId), orgStatus: db().orgs[p.orgId]?.status, purchasable: E.productPurchasable(p) })),
      supervisors: E.all('practitioners').filter((p) => p.isSupervisor && p.status === 'active').map((p) => ({ id: p.id, fullName: p.fullName })),
    }),
  });

  E.action('admin.setPractitionerStatus', {
    method: 'POST', path: '/admin/practitioners/:id/status', roles: ['admin'],
    fn: (p, ctx) => {
      const pr = E.must('practitioners', p.id, 'Practitioner');
      const action = oneOf(p.action, 'Action', ['approve', 'request_changes', 'suspend', 'deactivate', 'reactivate', 'approve_renewal', 'reject_renewal', 'update_supervision']);
      const reason = reasonOf(p);
      const before = { status: pr.status, providerClass: pr.providerClass, supervisorId: pr.supervisorId, licenceExpiry: pr.licenceExpiry, canPrescribe: pr.canPrescribe };
      const u = db().users[pr.userId];
      const setClass = () => {
        if (p.providerClass) pr.providerClass = oneOf(p.providerClass, 'Provider class', ['supervised', 'independent']);
        if (pr.providerClass === 'supervised') {
          const sup = E.get('practitioners', p.supervisorId || pr.supervisorId);
          if (!sup || !sup.isSupervisor || sup.id === pr.id) fail('VALIDATION', 'Assign an active PRORESMAT supervisor for supervised practitioners.', 422, { field: 'supervisorId' });
          pr.supervisorId = sup.id;
        } else pr.supervisorId = null;
        if (p.canPrescribe !== undefined) pr.canPrescribe = !!p.canPrescribe && ['MDC', 'PC'].includes(pr.council);
      };
      if (action === 'approve') {
        if (!['submitted', 'changes_required'].includes(pr.status)) fail('INVALID_STATE', 'Only submitted applications can be approved.', 409);
        if (pr.licenceExpiry < E.today()) fail('VALIDATION', 'The licence has expired; request changes instead.', 422);
        setClass();
        pr.status = 'active';
        pr.identity.verified = true;
        pr.approvedAt = E.nowIso();
        E.notify(pr.userId, { title: 'Application approved', body: `You are now listed as a ${E.classLabel(pr)} practitioner. Set your availability to start receiving bookings.`, link: '#/p/profile', kind: 'compliance' });
      } else if (action === 'request_changes') {
        if (!['submitted', 'active', 'suspended'].includes(pr.status)) fail('INVALID_STATE', 'Changes can only be requested on a submitted, active or suspended profile.', 409);
        pr.status = 'changes_required';
        E.notify(pr.userId, { title: 'Changes requested', body: `PRORESMAT needs changes to your application: ${reason}`, link: '#/p/profile', kind: 'compliance' });
      } else if (action === 'suspend') {
        if (pr.status !== 'active') fail('INVALID_STATE', 'Only active practitioners can be suspended.', 409);
        pr.status = 'suspended';
        E.notify(pr.userId, { title: 'Profile suspended', body: `Your profile is suspended: ${reason}. Existing bookings remain; contact PRORESMAT.`, link: '#/p/profile', kind: 'compliance' });
      } else if (action === 'deactivate') {
        pr.status = 'deactivated';
        E.notify(pr.userId, { title: 'Profile deactivated', body: reason, link: '#/p/profile', kind: 'compliance' });
      } else if (action === 'reactivate') {
        if (pr.status !== 'suspended') fail('INVALID_STATE', 'Only suspended practitioners can be reactivated.', 409);
        pr.status = 'active';
        E.notify(pr.userId, { title: 'Profile reactivated', body: reason, link: '#/p/profile', kind: 'compliance' });
      } else if (action === 'approve_renewal' || action === 'reject_renewal') {
        if (!pr.pendingRenewal) fail('INVALID_STATE', 'There is no pending licence renewal.', 409);
        if (action === 'approve_renewal') { pr.licenceExpiry = pr.pendingRenewal.licenceExpiry; pr.registrationNumber = pr.pendingRenewal.registrationNumber; }
        E.notify(pr.userId, { title: action === 'approve_renewal' ? 'Licence renewal verified' : 'Licence renewal not accepted', body: reason, link: '#/p/profile', kind: 'compliance' });
        pr.pendingRenewal = null;
      } else if (action === 'update_supervision') {
        setClass();
        if (p.isSupervisor !== undefined) {
          pr.isSupervisor = !!p.isSupervisor;
          if (u) u.roles = pr.isSupervisor ? [...new Set([...u.roles, 'supervisor'])] : u.roles.filter((r) => r !== 'supervisor');
        }
      }
      pr.statusHistory.push({ status: pr.status, action, at: E.nowIso(), by: ctx.user.name, reason });
      E.audit(ctx, `practitioner.${action}`, 'practitioner', pr.id, before, { status: pr.status, providerClass: pr.providerClass, supervisorId: pr.supervisorId, licenceExpiry: pr.licenceExpiry, canPrescribe: pr.canPrescribe }, reason);
      return E.practitionerSelfView(pr);
    },
  });

  E.action('admin.setOrgStatus', {
    method: 'POST', path: '/admin/orgs/:id/status', roles: ['admin'],
    fn: (p, ctx) => {
      const o = E.must('orgs', p.id, 'Organisation');
      if (o.type === 'proresmat') fail('FORBIDDEN', 'The PRORESMAT organisation cannot be changed here.', 403);
      const action = oneOf(p.action, 'Action', ['approve', 'request_changes', 'suspend', 'deactivate', 'reactivate', 'approve_renewal', 'reject_renewal']);
      const reason = reasonOf(p);
      const before = { status: o.status, licenceExpiry: o.licenceExpiry };
      if (action === 'approve') {
        if (!['submitted', 'changes_required'].includes(o.status)) fail('INVALID_STATE', 'Only submitted organisations can be approved.', 409);
        if (o.licenceExpiry < E.today()) fail('VALIDATION', 'The facility licence has expired; request changes instead.', 422);
        o.status = 'active';
      } else if (action === 'request_changes') o.status = 'changes_required';
      else if (action === 'suspend') { if (o.status !== 'active') fail('INVALID_STATE', 'Only active organisations can be suspended.', 409); o.status = 'suspended'; }
      else if (action === 'deactivate') o.status = 'deactivated';
      else if (action === 'reactivate') { if (o.status !== 'suspended') fail('INVALID_STATE', 'Only suspended organisations can be reactivated.', 409); o.status = 'active'; }
      else {
        if (!o.pendingRenewal) fail('INVALID_STATE', 'There is no pending licence renewal.', 409);
        if (action === 'approve_renewal') o.licenceExpiry = o.pendingRenewal.licenceExpiry;
        o.pendingRenewal = null;
      }
      o.statusHistory.push({ status: o.status, action, at: E.nowIso(), by: ctx.user.name, reason });
      if (o.ownerId) E.notify(o.ownerId, { title: 'Organisation status update', body: `${o.name}: ${action.replace(/_/g, ' ')}. ${reason}`, link: '#/v/compliance', kind: 'compliance' });
      E.audit(ctx, `org.${action}`, 'org', o.id, before, { status: o.status, licenceExpiry: o.licenceExpiry }, reason);
      return o;
    },
  });

  // Listing workflow: only PRORESMAT can publish.
  const PRODUCT_TRANSITIONS = {
    start_review: [['submitted'], 'under_review'],
    approve: [['submitted', 'under_review'], 'approved'],
    request_changes: [['submitted', 'under_review', 'approved', 'suspended'], 'changes_required'],
    suspend: [['approved'], 'suspended'],
    reinstate: [['suspended'], 'approved'],
    recall: [['approved', 'suspended', 'expired'], 'recalled'],
  };
  E.action('admin.setProductStatus', {
    method: 'POST', path: '/admin/products/:id/status', roles: ['admin'],
    fn: (p, ctx) => {
      const pr = E.must('products', p.id, 'Product');
      const action = oneOf(p.action, 'Action', Object.keys(PRODUCT_TRANSITIONS));
      const [from, to] = PRODUCT_TRANSITIONS[action];
      if (!from.includes(pr.status)) fail('INVALID_STATE', `A listing that is "${pr.status.replace('_', ' ')}" cannot be moved to "${to.replace('_', ' ')}".`, 409);
      const reason = reasonOf(p, action !== 'start_review');
      if ((to === 'approved') && (pr.fdaExpiry < E.today())) fail('VALIDATION', 'The FDA registration has expired. Request changes instead.', 422);
      if (to === 'approved' && !E.orgActive(db().orgs[pr.orgId])) fail('VALIDATION', 'The seller organisation must be active before its products can be published.', 422);
      if (!LISTING_STATES.includes(to)) throw new Error('bad state');
      const before = { status: pr.status };
      pr.status = to;
      pr.statusHistory.push({ status: to, at: E.nowIso(), by: ctx.user.name, reason });
      if (to === 'approved') pr.approvedAt = E.nowIso();
      const org = db().orgs[pr.orgId];
      if (org?.ownerId) E.notify(org.ownerId, { title: 'Listing update', body: `${pr.name} is now "${to.replace('_', ' ')}". ${reason}`, link: '#/v/products', kind: 'compliance' });
      if (to === 'recalled' || to === 'suspended') {
        // Remove from carts, hold related settlements, and notify affected customers of a recall.
        for (const c of E.all('carts')) c.items = c.items.filter((i) => i.productId !== pr.id);
        const affected = E.all('orders').filter((o) => o.items.some((i) => i.productId === pr.id) && !['pending_payment', 'expired', 'cancelled'].includes(o.status));
        for (const o of affected) {
          if (to === 'recalled') {
            E.addHold('order', o.id, `recall:${pr.id}`);
            const batches = o.items.filter((i) => i.productId === pr.id && i.batch).map((i) => i.batch).join(', ');
            E.notify(o.customerId, { title: 'Important safety notice', body: `${pr.name}${batches ? ` (batch ${batches})` : ''} from order ${o.code} has been recalled: ${reason}. Stop using it and contact support for a refund or return.`, link: '#/c/orders', kind: 'safety' });
          }
        }
        pr.recall = to === 'recalled' ? { at: E.nowIso(), reason, notified: affected.length } : pr.recall;
      }
      E.audit(ctx, `product.${action}`, 'product', pr.id, before, { status: to }, reason);
      return { ...pr, notifiedCustomers: pr.recall?.notified || 0 };
    },
  });

  // ---------- care & marketplace oversight ----------
  E.action('admin.care', {
    method: 'GET', path: '/admin/care', roles: ['admin', 'support'],
    fn: () => {
      const practitioners = E.all('practitioners').filter((p) => p.status !== 'draft');
      return {
        queue: E.all('careQueue').sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (a.priority === 'urgent' ? -1 : 1) - (b.priority === 'urgent' ? -1 : 1) || b.createdAt.localeCompare(a.createdAt)).map((q) => ({ ...q, practitionerName: q.practitionerId ? db().practitioners[q.practitionerId]?.fullName : '', bookingCode: q.bookingId ? db().bookings[q.bookingId]?.code : '' })),
        adverse: E.all('adverseEvents').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((a) => ({ ...a, productStatus: a.productId ? db().products[a.productId]?.status : '' })),
        tickets: E.all('tickets').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        reviews: E.all('reviews').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => ({ ...r, targetName: r.targetType === 'practitioner' ? db().practitioners[r.targetId]?.fullName : r.targetType === 'org' ? db().orgs[r.targetId]?.name : db().products[r.targetId]?.name })),
        privacy: E.all('privacyRequests').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        quality: practitioners.map((p) => {
          const bs = E.all('bookings').filter((b) => b.practitionerId === p.id);
          return {
            id: p.id, fullName: p.fullName, classLabel: E.classLabel(p), status: p.status, completed: bs.filter((b) => b.status === 'completed').length,
            providerCancellations: bs.filter((b) => b.status === 'cancelled_provider').length, complaints: E.all('tickets').filter((t) => t.kind === 'complaint' && t.bookingId && db().bookings[t.bookingId]?.practitionerId === p.id).length,
            adverse: E.all('adverseEvents').filter((a) => a.bookingId && db().bookings[a.bookingId]?.practitionerId === p.id).length, referrals: bs.filter((b) => b.referral).length, rating: E.ratingFor('practitioner', p.id),
          };
        }),
      };
    },
  });

  E.action('admin.updateCareItem', {
    method: 'POST', path: '/admin/care/:id', roles: ['admin', 'support'],
    fn: (p, ctx) => {
      const q = E.must('careQueue', p.id, 'Queue item');
      const status = oneOf(p.status, 'Status', ['open', 'followed_up', 'closed']);
      const before = { status: q.status };
      q.status = status;
      q.notes = [...(q.notes || []), { at: E.nowIso(), by: ctx.user.name, text: str(p.note, 'Follow-up note', { min: 3, max: 1000 }) }];
      E.audit(ctx, 'care.updated', 'careQueue', q.id, before, { status }, p.note);
      return q;
    },
  });

  E.action('admin.updateAdverse', {
    method: 'POST', path: '/admin/adverse/:id', roles: ['admin'],
    fn: (p, ctx) => {
      const a = E.must('adverseEvents', p.id, 'Report');
      const status = oneOf(p.status, 'Status', ['new', 'under_review', 'referred_fda', 'closed']);
      const note = str(p.note, 'Action note', { min: 3, max: 1000 });
      const before = { status: a.status };
      a.status = status;
      a.actions.push({ at: E.nowIso(), by: ctx.user.name, text: note, status });
      // Quarantine: suspend the product while the report is investigated.
      if (p.quarantine && a.productId && db().products[a.productId]?.status === 'approved') {
        const pr = db().products[a.productId];
        pr.status = 'suspended';
        pr.statusHistory.push({ status: 'suspended', at: E.nowIso(), by: ctx.user.name, reason: `Quarantined pending safety review (${a.code})` });
        for (const c of E.all('carts')) c.items = c.items.filter((i) => i.productId !== pr.id);
        E.audit(ctx, 'product.quarantined', 'product', pr.id, { status: 'approved' }, { status: 'suspended' }, a.code);
      }
      if (status === 'closed' && a.orderId) E.releaseHold('order', a.orderId, `adverse:${a.id}`);
      E.audit(ctx, 'adverse.updated', 'adverseEvent', a.id, before, { status }, note);
      E.evaluateEarnings();
      return a;
    },
  });

  E.action('admin.updateTicket', {
    method: 'POST', path: '/admin/tickets/:id', roles: ['admin', 'support'],
    fn: (p, ctx) => {
      const t = E.must('tickets', p.id, 'Ticket');
      const status = oneOf(p.status, 'Status', ['open', 'investigating', 'resolved', 'closed']);
      const before = { status: t.status };
      t.status = status;
      if (p.reply) {
        t.thread.push({ by: ctx.user.name, role: 'support', at: E.nowIso(), text: str(p.reply, 'Reply', { max: 3000 }) });
        E.notify(t.userId, { title: 'Support replied', body: `New reply on ${t.code}.`, link: '#/c/support', kind: 'support' });
      }
      if (['resolved', 'closed'].includes(status) && t.holdApplied) {
        if (t.bookingId) E.releaseHold('booking', t.bookingId, `complaint:${t.id}`);
        if (t.orderId) E.releaseHold('order', t.orderId, `complaint:${t.id}`);
        t.holdApplied = false;
      }
      E.audit(ctx, 'ticket.updated', 'ticket', t.id, before, { status });
      E.evaluateEarnings();
      return t;
    },
  });

  E.action('admin.moderateReview', {
    method: 'POST', path: '/admin/reviews/:id', roles: ['admin', 'support'],
    fn: (p, ctx) => {
      const r = E.must('reviews', p.id, 'Review');
      const status = oneOf(p.status, 'Decision', ['published', 'rejected']);
      if (status === 'published' && r.flags.includes('efficacy_claim') && !p.override) fail('CLAIMS', 'This review contains a cure or efficacy claim and cannot be published. Reject it or confirm it has been edited.', 422);
      const before = { status: r.status };
      r.status = status;
      r.moderatedBy = ctx.user.name;
      r.moderationReason = str(p.reason, 'Reason', { optional: true, max: 300 });
      E.audit(ctx, `review.${status}`, 'review', r.id, before, { status }, r.moderationReason);
      return r;
    },
  });

  E.action('admin.processPrivacy', {
    method: 'POST', path: '/admin/privacy/:id', roles: ['admin'],
    fn: (p, ctx) => {
      const r = E.must('privacyRequests', p.id, 'Request');
      if (r.status !== 'open') fail('INVALID_STATE', 'This request has already been processed.', 409);
      const decision = oneOf(p.decision, 'Decision', ['completed', 'declined']);
      const note = str(p.note, 'Note', { min: 3, max: 1000 });
      if (decision === 'completed' && r.type === 'deletion') {
        const u = E.must('users', r.userId, 'User');
        const open = E.all('bookings').some((b) => b.customerId === u.id && ['confirmed', 'in_progress'].includes(b.status)) || E.all('orders').some((o) => o.customerId === u.id && !['acknowledged', 'delivered', 'cancelled', 'expired', 'pending_payment', 'refunded'].includes(o.status));
        if (open) fail('INVALID_STATE', 'The customer has active consultations or orders. Complete or cancel them first.', 409);
        // Anonymise personal data; retain financial and clinical records required by law in pseudonymised form.
        u.name = 'Deleted user'; u.email = `deleted+${u.id}@proresmat.invalid`; u.phone = ''; u.address = ''; u.dob = ''; u.health = {}; u.status = 'deleted';
        for (const d of E.all('documents')) if (d.ownerId === u.id && !d.deleted) { d.deleted = true; E.blobs.del(d.blobKey); }
        for (const s of E.all('sessions')) if (s.userId === u.id) E.remove('sessions', s.id);
        for (const o of E.all('orders')) if (o.customerId === u.id) { o.customerName = 'Deleted user'; o.address = ''; o.phone = ''; }
      }
      r.status = decision;
      r.resolution = { at: E.nowIso(), by: ctx.user.name, note };
      if (r.type !== 'deletion' || decision === 'declined') E.notify(r.userId, { title: 'Privacy request update', body: `Your ${r.type.replace('_', ' ')} request was ${decision}. ${note}`, link: '#/c/privacy', kind: 'info' });
      E.audit(ctx, `privacy.${decision}`, 'privacyRequest', r.id, { status: 'open' }, { status: decision }, note);
      return r;
    },
  });

  // ---------- finance ----------
  E.action('admin.finance', {
    method: 'GET', path: '/admin/finance', roles: ['admin', 'finance'],
    fn: () => {
      const accounts = {};
      for (const l of E.all('ledger')) {
        const a = accounts[l.account] || (accounts[l.account] = { account: l.account, debit: 0, credit: 0 });
        a.debit += l.debit; a.credit += l.credit;
      }
      const label = (acc) => {
        const m = acc.match(/^payable:(practitioner|org):(.+)$/);
        if (!m) return acc;
        return `Payable to ${m[1] === 'practitioner' ? db().practitioners[m[2]]?.fullName : db().orgs[m[2]]?.name}`;
      };
      return {
        payments: E.all('payments').filter((p) => p.status !== 'initialized').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => ({ ...E.paymentView(p), customerName: p.customerName, allocations: p.allocations })),
        refunds: E.all('refunds').sort((a, b) => b.at.localeCompare(a.at)),
        disputes: E.all('disputes').sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
        accounts: Object.values(accounts).map((a) => ({ ...a, label: label(a.account), balance: a.debit - a.credit })).sort((a, b) => a.account.localeCompare(b.account)),
        ledger: E.all('ledger').sort((a, b) => b.at.localeCompare(a.at) || a.txnId.localeCompare(b.txnId)).slice(0, 300),
        earnings: E.all('earnings').map((e) => ({ ...e, net: E.netOf(e), beneficiary: e.beneficiaryType === 'practitioner' ? db().practitioners[e.beneficiaryId]?.fullName : db().orgs[e.beneficiaryId]?.name })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        payouts: E.all('payouts').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        partnerFees: E.all('partnerFees').map((f) => ({ ...f, orgName: db().orgs[f.orgId]?.name })),
        orgs: E.all('orgs').filter((o) => o.type !== 'proresmat').map((o) => ({ id: o.id, name: o.name })),
        settings: db().settings,
      };
    },
  });

  E.action('admin.refund', {
    method: 'POST', path: '/admin/refunds', roles: ['admin', 'finance'],
    fn: (p, ctx) => {
      const pay = E.must('payments', p.paymentId, 'Payment');
      const reason = reasonOf(p);
      const rule = oneOf(p.rule || 'manual', 'Refund rule', ['manual', 'customer_cancel_full', 'customer_cancel_partial', 'provider_cancel_full', 'product_unavailable', 'partial_fulfilment', 'duplicate_payment', 'service_recovery']);
      const amount = Math.round(Number(p.amountGhs) * 100);
      let target = {};
      let deliveryPortion = 0;
      if (pay.purpose === 'booking') target = { bookingId: pay.targetIds[0] };
      if (pay.purpose === 'checkout' || pay.purpose === 'rx') {
        const orderId = p.orderId || (pay.purpose === 'rx' ? db().rxRequests[pay.targetIds[0]]?.orderId : db().checkouts[pay.targetIds[0]]?.orderIds[0]);
        const o = E.must('orders', orderId, 'Order');
        if (o.paymentId !== pay.id) fail('VALIDATION', 'That order was not paid with this payment.', 422);
        const remaining = o.total - (o.refunded || 0);
        if (amount > remaining) fail('VALIDATION', `This order has only ${(remaining / 100).toFixed(2)} GHS left to refund.`, 422);
        deliveryPortion = p.includeDelivery ? Math.min(o.deliveryFee, amount) : 0;
        target = { orderId: o.id };
        o.refunded = (o.refunded || 0) + amount;
        if (o.refunded >= o.total) { o.status = 'refunded'; o.timeline.push({ status: 'refunded', at: E.nowIso(), by: ctx.user.name, note: reason }); }
      }
      const r = E.refundPayment(ctx, { paymentId: pay.id, amount, reason, rule, target, deliveryPortion });
      return r;
    },
  });

  // Chargebacks and disputes freeze related provider settlement until resolved.
  E.openDispute = (ctx, pay, kind, reason) => {
    const d = E.insert('disputes', { id: newId('dsp'), code: E.code('DP'), paymentId: pay.id, reference: pay.reference, kind, reason, amount: pay.amount, status: 'open', openedAt: E.nowIso(), openedBy: ctx?.user?.name || 'Paystack' });
    const targets = pay.purpose === 'booking' ? [['booking', pay.targetIds[0]]] : pay.purpose === 'checkout' ? db().checkouts[pay.targetIds[0]].orderIds.map((id) => ['order', id]) : pay.purpose === 'rx' ? [['order', db().rxRequests[pay.targetIds[0]].orderId]] : [];
    for (const [t, id] of targets) E.addHold(t, id, `dispute:${d.id}`);
    d.targets = targets;
    E.audit(ctx, 'dispute.opened', 'dispute', d.id, null, { kind, paymentId: pay.id }, reason);
    return d;
  };

  E.action('admin.openDispute', {
    method: 'POST', path: '/admin/disputes', roles: ['admin', 'finance'],
    fn: (p, ctx) => {
      const pay = E.must('payments', p.paymentId, 'Payment');
      if (pay.status !== 'success') fail('INVALID_STATE', 'Only successful payments can be disputed.', 409);
      if (E.all('disputes').some((d) => d.paymentId === pay.id && d.status === 'open')) fail('DUPLICATE', 'This payment already has an open dispute.', 409);
      return E.openDispute(ctx, pay, oneOf(p.kind || 'chargeback', 'Type', ['chargeback', 'dispute']), reasonOf(p));
    },
  });

  E.action('admin.resolveDispute', {
    method: 'POST', path: '/admin/disputes/:id', roles: ['admin', 'finance'],
    fn: (p, ctx) => {
      const d = E.must('disputes', p.id, 'Dispute');
      if (d.status !== 'open') fail('INVALID_STATE', 'This dispute is already resolved.', 409);
      const outcome = oneOf(p.outcome, 'Outcome', ['won', 'lost']);
      const reason = reasonOf(p);
      const pay = db().payments[d.paymentId];
      if (outcome === 'lost') {
        // Funds returned to the customer by the card network: record as a refund and void provider shares.
        const remaining = pay.amount - (pay.refunded || 0);
        if (remaining > 0) {
          for (const [t, id] of d.targets) {
            const src = t === 'booking' ? { bookingId: id } : { orderId: id };
            const o = t === 'order' ? db().orders[id] : null;
            const part = o ? Math.min(o.total - (o.refunded || 0), pay.amount - (pay.refunded || 0)) : remaining;
            if (part > 0) {
              E.refundPayment(ctx, { paymentId: pay.id, amount: part, reason: `Chargeback lost (${d.code})`, rule: 'chargeback', target: src, deliveryPortion: o ? Math.min(o.deliveryFee, part) : 0 });
              if (o) o.refunded = (o.refunded || 0) + part;
            }
          }
        }
        for (const [t, id] of d.targets) { E.releaseHold(t, id, `dispute:${d.id}`); E.voidEarnings(t, id, 'chargeback lost'); }
      } else {
        for (const [t, id] of d.targets) E.releaseHold(t, id, `dispute:${d.id}`);
      }
      d.status = outcome;
      d.resolvedAt = E.nowIso();
      d.resolution = reason;
      E.audit(ctx, `dispute.${outcome}`, 'dispute', d.id, { status: 'open' }, { status: outcome }, reason);
      E.evaluateEarnings();
      return d;
    },
  });

  // Settlement run: pays eligible, un-held earnings net of refunds and adjustments.
  E.action('admin.runSettlement', {
    method: 'POST', path: '/admin/settlements', roles: ['admin', 'finance'],
    fn: (p, ctx) => {
      E.evaluateEarnings();
      const groups = {};
      for (const e of E.all('earnings')) {
        if (e.status !== 'eligible') continue;
        const k = `${e.beneficiaryType}:${e.beneficiaryId}`;
        (groups[k] || (groups[k] = [])).push(e);
      }
      const created = [];
      for (const [k, list] of Object.entries(groups)) {
        const amount = list.reduce((s, e) => s + E.netOf(e), 0);
        if (amount <= 0) continue; // negative balances carry forward
        const [type, id] = k.split(':');
        const who = type === 'practitioner' ? db().practitioners[id] : db().orgs[id];
        const reference = `PO-${E.randomToken(5).toUpperCase()}`;
        const po = E.insert('payouts', {
          id: newId('po'), reference, beneficiaryType: type, beneficiaryId: id, beneficiaryName: who?.fullName || who?.name, amount,
          destination: who?.settlement ? (who.settlement.method === 'bank' ? `${who.settlement.bankName} ••${who.settlement.accountNumber.slice(-4)}` : `${who.settlement.momoProvider.toUpperCase()} MoMo ••${who.settlement.momoNumber.slice(-4)}`) : 'Not set',
          earningIds: list.map((e) => e.id), lines: list.map((e) => ({ label: e.label, gross: e.gross, commission: e.commission, adjustments: e.adjustments, net: E.netOf(e) })),
          status: 'processing', createdAt: E.nowIso(), createdBy: ctx.user.name,
        });
        for (const e of list) { e.status = 'paid'; e.payoutId = po.id; }
        E.post({ payoutId: po.id }, `Settlement ${reference} to ${po.beneficiaryName}`, [{ account: `payable:${type}:${id}`, debit: amount }, { account: 'cash:paystack', credit: amount }]);
        const uid = type === 'practitioner' ? who.userId : who.ownerId;
        E.notify(uid, { title: 'Payout sent', body: `${(amount / 100).toFixed(2)} GHS settlement ${reference} is on its way to ${po.destination}.`, link: type === 'practitioner' ? '#/p/earnings' : '#/v/payouts', kind: 'payment' });
        E.audit(ctx, 'settlement.created', 'payout', po.id, null, { amount, earnings: po.earningIds.length });
        created.push(po);
      }
      return { payouts: created, total: created.reduce((s, x) => s + x.amount, 0) };
    },
  });

  E.action('admin.markPayout', {
    method: 'POST', path: '/admin/payouts/:id', roles: ['admin', 'finance'],
    fn: (p, ctx) => {
      const po = E.must('payouts', p.id, 'Payout');
      if (po.status !== 'processing') fail('INVALID_STATE', 'Only processing payouts can be updated.', 409);
      const status = oneOf(p.status, 'Status', ['paid', 'failed']);
      po.status = status;
      po.transferRef = str(p.transferRef, 'Transfer reference', { optional: status === 'failed', max: 60 });
      po.updatedAt = E.nowIso();
      if (status === 'failed') {
        // Reverse: money stays payable and earnings return to eligible for the next run.
        E.post({ payoutId: po.id }, `Payout ${po.reference} failed – reversed`, [{ account: 'cash:paystack', debit: po.amount }, { account: `payable:${po.beneficiaryType}:${po.beneficiaryId}`, credit: po.amount }]);
        for (const id of po.earningIds) { const e = db().earnings[id]; e.status = 'eligible'; e.payoutId = null; }
      }
      E.audit(ctx, `payout.${status}`, 'payout', po.id, { status: 'processing' }, { status }, po.transferRef);
      return po;
    },
  });

  E.action('admin.reconcile', {
    method: 'GET', path: '/admin/reconcile', roles: ['admin', 'finance'],
    fn: () => {
      const issues = [];
      const byTxn = {};
      for (const l of E.all('ledger')) { const t = byTxn[l.txnId] || (byTxn[l.txnId] = { d: 0, c: 0 }); t.d += l.debit; t.c += l.credit; }
      for (const [id, t] of Object.entries(byTxn)) if (t.d !== t.c) issues.push({ type: 'unbalanced', ref: id, detail: `Debits ${t.d} ≠ credits ${t.c}` });
      const refs = new Set();
      for (const p of E.all('payments')) {
        if (refs.has(p.reference)) issues.push({ type: 'duplicate_reference', ref: p.reference, detail: 'Reference used twice' });
        refs.add(p.reference);
        if (p.status === 'success' || p.status === 'duplicate_refunded') {
          const cashIn = E.all('ledger').filter((l) => l.ref?.paymentId === p.id && l.account === 'cash:paystack').reduce((s, l) => s + l.debit, 0);
          if (cashIn !== p.amount) issues.push({ type: 'cash_mismatch', ref: p.reference, detail: `Ledger shows ${cashIn}, payment ${p.amount}` });
        }
        if (p.status === 'initialized' && Date.parse(p.createdAt) < E.now() - 3600000) issues.push({ type: 'stale_initialized', ref: p.reference, detail: 'Initialised over an hour ago without a result; verify with Paystack', severity: 'info' });
      }
      // Each provider payable balance must equal the unpaid net earnings.
      const payable = {};
      for (const l of E.all('ledger')) if (l.account.startsWith('payable:')) payable[l.account] = (payable[l.account] || 0) + l.credit - l.debit;
      const owed = {};
      for (const e of E.all('earnings')) if (!['paid', 'void'].includes(e.status)) { const k = E.providerAccount(e); owed[k] = (owed[k] || 0) + E.netOf(e); }
      for (const k of new Set([...Object.keys(payable), ...Object.keys(owed)])) if ((payable[k] || 0) !== (owed[k] || 0)) issues.push({ type: 'payable_mismatch', ref: k, detail: `Ledger ${payable[k] || 0} vs unpaid earnings ${owed[k] || 0}` });
      const totalDr = E.all('ledger').reduce((s, l) => s + l.debit, 0);
      const totalCr = E.all('ledger').reduce((s, l) => s + l.credit, 0);
      return { checkedAt: E.nowIso(), transactions: Object.keys(byTxn).length, payments: E.all('payments').length, totalDebit: totalDr, totalCredit: totalCr, issues, ok: issues.filter((i) => i.severity !== 'info').length === 0 };
    },
  });

  E.action('admin.partnerFee', {
    method: 'POST', path: '/admin/partner-fees', roles: ['admin', 'finance'],
    fn: (p, ctx) => {
      if (p.id) {
        const f = E.must('partnerFees', p.id, 'Partner fee');
        if (f.status !== 'invoiced') fail('INVALID_STATE', 'This fee is already settled.', 409);
        f.status = 'paid'; f.paidAt = E.nowIso();
        E.post({ partnerFeeId: f.id }, `Partner fee ${f.code} received`, [{ account: 'cash:paystack', debit: f.amount }, { account: `receivable:partner:${f.orgId}`, credit: f.amount }]);
        E.audit(ctx, 'partner_fee.paid', 'partnerFee', f.id, { status: 'invoiced' }, { status: 'paid' });
        return f;
      }
      const o = E.must('orgs', p.orgId, 'Partner');
      const amount = Math.round(Number(p.amountGhs) * 100);
      if (!Number.isInteger(amount) || amount <= 0) fail('VALIDATION', 'Enter a fee amount.', 422);
      const f = E.insert('partnerFees', { id: newId('pf'), code: E.code('PF'), orgId: o.id, amount, period: str(p.period, 'Period', { max: 40 }), status: 'invoiced', createdAt: E.nowIso() });
      E.post({ partnerFeeId: f.id }, `Partner fee ${f.code} invoiced to ${o.name}`, [{ account: `receivable:partner:${o.id}`, debit: amount }, { account: 'revenue:partner_fees', credit: amount }]);
      E.audit(ctx, 'partner_fee.invoiced', 'partnerFee', f.id, null, { amount, orgId: o.id });
      return f;
    },
  });

  E.action('admin.updateSettings', {
    method: 'PUT', path: '/admin/settings', roles: ['admin'],
    fn: (p, ctx) => {
      const s = db().settings;
      const before = E.clone(s);
      if (p.consultationCommissionPct !== undefined) s.consultationCommissionPct = int(Number(p.consultationCommissionPct), 'Consultation commission %', { min: 0, max: 50 });
      if (p.productCommissionPct !== undefined) s.productCommissionPct = int(Number(p.productCommissionPct), 'Product commission %', { min: 0, max: 50 });
      if (p.holdDaysConsultation !== undefined) s.holdDaysConsultation = int(Number(p.holdDaysConsultation), 'Consultation hold days', { min: 0, max: 60 });
      if (p.holdDaysProduct !== undefined) s.holdDaysProduct = int(Number(p.holdDaysProduct), 'Product hold days', { min: 0, max: 60 });
      if (p.deliveryFeeGhs !== undefined) s.deliveryFee = Math.round(Number(p.deliveryFeeGhs) * 100);
      if (p.plusMonthlyFeeGhs !== undefined) s.plusMonthlyFee = Math.round(Number(p.plusMonthlyFeeGhs) * 100);
      if (!Number.isInteger(s.deliveryFee) || s.deliveryFee < 0 || !Number.isInteger(s.plusMonthlyFee) || s.plusMonthlyFee < 0) { Object.assign(s, before); fail('VALIDATION', 'Fees must be zero or more.', 422); }
      E.audit(ctx, 'settings.updated', 'settings', 'settings', before, s, str(p.reason, 'Reason', { min: 3, max: 300 }));
      return s;
    },
  });

  E.action('admin.setFlags', {
    method: 'PUT', path: '/admin/flags', roles: ['admin'],
    fn: (p, ctx) => {
      const before = E.clone(db().flags);
      for (const k of Object.keys(db().flags)) if (typeof p[k] === 'boolean') db().flags[k] = p[k];
      E.audit(ctx, 'flags.updated', 'flags', 'flags', before, db().flags, str(p.reason, 'Reason', { min: 3, max: 300 }));
      return db().flags;
    },
  });

  // ---------- risk ----------
  E.action('admin.risk', {
    method: 'GET', path: '/admin/risk', roles: ['admin'],
    fn: (p) => {
      const today = E.today();
      const days = (d) => Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
      const q = String(p.q || '').toLowerCase();
      return {
        audit: E.all('audit').filter((a) => !q || `${a.action} ${a.actorName} ${a.entity} ${a.entityId} ${a.reason}`.toLowerCase().includes(q)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200),
        expiring: [
          ...E.all('practitioners').filter((x) => ['active', 'suspended'].includes(x.status) && days(x.licenceExpiry) <= 60).map((x) => ({ kind: 'Practitioner licence', name: x.fullName, expiry: x.licenceExpiry, daysLeft: days(x.licenceExpiry), id: x.id })),
          ...E.all('practitioners').filter((x) => x.status === 'active' && x.facility?.licenceExpiry && days(x.facility.licenceExpiry) <= 60).map((x) => ({ kind: 'Facility licence', name: `${x.facility.name} (${x.fullName})`, expiry: x.facility.licenceExpiry, daysLeft: days(x.facility.licenceExpiry), id: x.id })),
          ...E.all('orgs').filter((x) => x.status === 'active' && x.licenceExpiry && days(x.licenceExpiry) <= 60).map((x) => ({ kind: 'Clinic licence', name: x.name, expiry: x.licenceExpiry, daysLeft: days(x.licenceExpiry), id: x.id })),
          ...E.all('products').filter((x) => ['approved', 'expired'].includes(x.status) && days(x.fdaExpiry) <= 60).map((x) => ({ kind: 'FDA registration', name: x.name, expiry: x.fdaExpiry, daysLeft: days(x.fdaExpiry), id: x.id })),
        ].sort((a, b) => a.daysLeft - b.daysLeft),
        failedLogins: E.all('loginHistory').filter((l) => !l.success).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30).map((l) => ({ ...l, email: db().users[l.userId]?.email })),
        lockedAccounts: E.all('users').filter((u) => u.lockedUntil && Date.parse(u.lockedUntil) > E.now()).map((u) => ({ id: u.id, email: u.email, until: u.lockedUntil })),
        flags: db().flags, settings: db().settings,
        roles: E.all('users').filter((u) => u.status === 'active' && u.roles.some((r) => r !== 'customer')).map((u) => ({ id: u.id, name: u.name, email: u.email, roles: u.roles })),
      };
    },
  });

  E.action('admin.unlockUser', {
    method: 'POST', path: '/admin/users/:id/unlock', roles: ['admin'],
    fn: (p, ctx) => {
      const u = E.must('users', p.id, 'User');
      u.lockedUntil = null; u.failed = 0;
      E.audit(ctx, 'user.unlocked', 'user', u.id, null, null, reasonOf(p));
      return { ok: true };
    },
  });

  // Data used by admin screens to reference a practitioner's licence date etc.
  E.action('admin.setLicenceDate', {
    method: 'POST', path: '/admin/practitioners/:id/licence', roles: ['admin'],
    fn: (p, ctx) => {
      const pr = E.must('practitioners', p.id, 'Practitioner');
      const before = { licenceExpiry: pr.licenceExpiry };
      pr.licenceExpiry = dateStr(p.licenceExpiry, 'Licence expiry');
      E.audit(ctx, 'practitioner.licence_corrected', 'practitioner', pr.id, before, { licenceExpiry: pr.licenceExpiry }, reasonOf(p));
      return E.practitionerSelfView(pr);
    },
  });
}
