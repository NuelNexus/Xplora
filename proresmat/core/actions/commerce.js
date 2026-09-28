// Payments (Paystack), refunds, cart, checkout, orders, prescription requests and subscriptions.
import { str, int, oneOf, ghPhone, hmacSha512Hex } from '../util.js';

const PAYSTACK = 'https://api.paystack.co';

export function registerCommerce(E) {
  const { fail, newId } = E;
  const db = () => E.db;
  const live = () => !!E.config.paystack?.secretKey;

  async function paystack(method, path, body) {
    const f = E.config.paystack.fetch || globalThis.fetch;
    const res = await f(PAYSTACK + path, { method, headers: { Authorization: `Bearer ${E.config.paystack.secretKey}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status === false) fail('GATEWAY_ERROR', `Paystack: ${json.message || 'request failed'}. Try again shortly.`, 502);
    return json.data;
  }

  // ---------- refunds (every refund adjusts provider settlement automatically) ----------
  E.refundPayment = (ctx, { paymentId, amount, reason, rule, target = {}, deliveryPortion = 0 }) => {
    const pay = E.must('payments', paymentId, 'Payment');
    if (pay.status !== 'success') fail('INVALID_STATE', 'Only successful payments can be refunded.', 409);
    const refundable = pay.amount - (pay.refunded || 0);
    if (!Number.isInteger(amount) || amount <= 0) fail('VALIDATION', 'Refund amount must be greater than zero.', 422);
    if (amount > refundable) fail('VALIDATION', `Refund cannot exceed the remaining ${refundable / 100} GHS.`, 422);
    const refund = E.insert('refunds', { id: newId('rfd'), code: E.code('RF'), paymentId, amount, reason, rule, target, by: ctx?.user?.name || 'System', byId: ctx?.user?.id || 'system', at: E.nowIso(), status: live() ? 'pending_gateway' : 'processed' });
    const lines = [{ account: 'cash:paystack', credit: amount }];
    const productPortion = amount - deliveryPortion;
    if (deliveryPortion) lines.push({ account: 'revenue:delivery', debit: deliveryPortion });
    if (target.bookingId) {
      const { providerPortion, platformPortion } = E.applyRefundToEarnings('booking', target.bookingId, productPortion, pay.amount, refund.id);
      const pr = db().bookings[target.bookingId].practitionerId;
      if (providerPortion) lines.push({ account: `payable:practitioner:${pr}`, debit: providerPortion });
      if (platformPortion) lines.push({ account: 'revenue:consultation_commission', debit: platformPortion });
      refund.providerPortion = providerPortion;
    } else if (target.orderId) {
      const o = db().orders[target.orderId];
      const org = db().orgs[o.orgId];
      if (org.type === 'proresmat') lines.push({ account: 'revenue:product_sales', debit: productPortion });
      else {
        const { providerPortion, platformPortion } = E.applyRefundToEarnings('order', o.id, productPortion, o.subtotal, refund.id);
        if (providerPortion) lines.push({ account: `payable:org:${org.id}`, debit: providerPortion });
        if (platformPortion) lines.push({ account: 'revenue:product_commission', debit: platformPortion });
        refund.providerPortion = providerPortion;
      }
    } else if (pay.purpose === 'subscription') {
      lines.push({ account: 'revenue:subscription', debit: productPortion });
    } else {
      lines.push({ account: 'liability:customer_refunds', debit: productPortion });
    }
    E.post({ paymentId, refundId: refund.id, ...target }, `Refund ${refund.code}: ${reason}`, lines);
    pay.refunded = (pay.refunded || 0) + amount;
    if (live()) {
      paystack('POST', '/refund', { transaction: pay.reference, amount }).then(() => { refund.status = 'processed'; }).catch((e) => { refund.status = 'gateway_failed'; refund.gatewayError = e.message; });
    }
    E.notify(pay.customerId, { title: 'Refund issued', body: `${(amount / 100).toFixed(2)} GHS is being returned to your ${pay.channel === 'mobile_money' ? 'mobile money account' : 'card'} (ref ${refund.code}). ${reason}.`, link: '#/c/payments', kind: 'payment' });
    E.audit(ctx, 'refund.processed', 'payment', paymentId, { refunded: pay.refunded - amount }, { refunded: pay.refunded, refundId: refund.id, amount, rule }, reason);
    E.evaluateEarnings();
    return refund;
  };

  // Money arrived for something that can no longer be provided: record it, then return it in full.
  E.receiveAndRefund = (pay, reason, rule) => {
    pay.status = 'success';
    pay.paidAt = E.nowIso();
    E.post({ paymentId: pay.id }, `Payment ${pay.reference} held for refund`, [
      { account: 'cash:paystack', debit: pay.amount }, { account: 'liability:customer_refunds', credit: pay.amount },
    ]);
    return E.refundPayment(null, { paymentId: pay.id, amount: pay.amount, reason, rule });
  };

  // ---------- payment lifecycle ----------
  const expected = (purpose, targetId, ctx) => {
    if (purpose === 'booking') {
      const b = E.must('bookings', targetId, 'Consultation');
      if (b.customerId !== ctx.user.id) fail('FORBIDDEN', 'This consultation belongs to another account.', 403);
      if (b.status !== 'pending_payment') fail('INVALID_STATE', b.status === 'expired' ? 'Your slot hold expired. Choose a time again.' : 'This consultation is already paid or closed.', 409);
      if (Date.parse(b.holdUntil) < E.now()) fail('HOLD_EXPIRED', 'Your slot hold expired. Choose a time again.', 409);
      if (!E.practitionerBookable(db().practitioners[b.practitionerId])) fail('NOT_BOOKABLE', 'This practitioner can no longer accept bookings.', 409);
      return { amount: b.fee, targetIds: [b.id], description: `Consultation ${b.code}` };
    }
    if (purpose === 'checkout') {
      const c = E.must('checkouts', targetId, 'Checkout');
      if (c.customerId !== ctx.user.id) fail('FORBIDDEN', 'This checkout belongs to another account.', 403);
      if (c.paymentId && db().payments[c.paymentId]?.status === 'success') fail('INVALID_STATE', 'This checkout is already paid.', 409);
      if (c.orderIds.some((id) => db().orders[id].status !== 'pending_payment')) fail('HOLD_EXPIRED', 'Your checkout expired. Review your cart and check out again.', 409);
      return { amount: c.total, targetIds: [c.id], description: `Order ${c.orderIds.map((id) => db().orders[id].code).join(', ')}` };
    }
    if (purpose === 'rx') {
      const r = E.must('rxRequests', targetId, 'Prescription request');
      if (r.customerId !== ctx.user.id) fail('FORBIDDEN', 'This request belongs to another account.', 403);
      if (r.status !== 'quoted') fail('INVALID_STATE', 'This prescription has not been validated and priced yet.', 409);
      return { amount: r.quote.total, targetIds: [r.id], description: `Prescription ${r.code}` };
    }
    if (purpose === 'subscription') {
      if (!db().flags.subscriptions) fail('FEATURE_OFF', 'PRORESMAT Plus is not available yet.', 409);
      return { amount: db().settings.plusMonthlyFee, targetIds: [ctx.user.id], description: 'PRORESMAT Plus (30 days)' };
    }
    fail('VALIDATION', 'Unknown payment purpose.', 422);
  };

  E.action('payments.initialize', {
    method: 'POST', path: '/payments', roles: ['customer'],
    fn: async (p, ctx) => {
      const purpose = oneOf(p.purpose, 'Purpose', ['booking', 'checkout', 'rx', 'subscription']);
      const channel = oneOf(p.channel || 'card', 'Payment method', ['card', 'mobile_money']);
      const key = p.idempotencyKey ? str(p.idempotencyKey, 'Idempotency key', { max: 80 }) : '';
      if (key) {
        const prior = db().idempotency[`${ctx.user.id}:${key}`];
        if (prior) return prior.result;
      }
      const exp = expected(purpose, p.targetId, ctx);
      const reference = `PRM-${E.randomToken(6).toUpperCase()}`;
      const pay = E.insert('payments', {
        id: newId('pay'), reference, purpose, targetIds: exp.targetIds, customerId: ctx.user.id, customerName: ctx.user.name,
        amount: exp.amount, currency: 'GHS', channel, status: 'initialized', createdAt: E.nowIso(), description: exp.description,
        mode: live() ? 'live' : 'sandbox', allocations: [], refunded: 0,
      });
      if (purpose === 'booking') db().bookings[exp.targetIds[0]].pendingPaymentId = pay.id;
      if (purpose === 'checkout') db().checkouts[exp.targetIds[0]].pendingPaymentId = pay.id;
      let authorizationUrl = `#/pay/${reference}`;
      if (live()) {
        const data = await paystack('POST', '/transaction/initialize', {
          email: ctx.user.email, amount: pay.amount, currency: 'GHS', reference, channels: channel === 'mobile_money' ? ['mobile_money'] : ['card'],
          callback_url: E.config.paystack.callbackUrl, metadata: { purpose, targetIds: pay.targetIds, paymentId: pay.id },
        });
        authorizationUrl = data.authorization_url;
        pay.accessCode = data.access_code;
      }
      const result = { paymentId: pay.id, reference, amount: pay.amount, currency: 'GHS', mode: pay.mode, authorizationUrl, description: exp.description };
      if (key) db().idempotency[`${ctx.user.id}:${key}`] = { id: `${ctx.user.id}:${key}`, at: E.nowIso(), result };
      E.audit(ctx, 'payment.initialized', 'payment', pay.id, null, { reference, amount: pay.amount, purpose });
      return result;
    },
  });

  // Sandbox checkout: stands in for the Paystack hosted page when no secret key is configured.
  E.action('payments.sandboxComplete', {
    method: 'POST', path: '/payments/:reference/sandbox', roles: ['customer'],
    fn: async (p, ctx) => {
      if (live()) fail('FORBIDDEN', 'Sandbox payments are disabled when live Paystack keys are configured.', 403);
      const pay = E.all('payments').find((x) => x.reference === p.reference);
      if (!pay || pay.customerId !== ctx.user.id) fail('NOT_FOUND', 'Payment not found.', 404);
      const outcome = oneOf(p.outcome || 'success', 'Outcome', ['success', 'failed']);
      let channelInfo = {};
      if (pay.channel === 'mobile_money') {
        channelInfo = { provider: oneOf(p.provider || 'mtn', 'Network', ['mtn', 'telecel', 'airteltigo']), phone: ghPhone(p.phone || ctx.user.phone) };
      } else if (outcome === 'success') {
        const card = String(p.card || '').replace(/\s/g, '');
        if (!/^\d{16}$/.test(card)) fail('VALIDATION', 'Enter the 16-digit test card number.', 422, { field: 'card' });
        channelInfo = { last4: card.slice(-4), brand: card.startsWith('4') ? 'visa' : 'mastercard' };
      }
      await E.finalizePayment(pay.reference, { status: outcome, amount: pay.amount, currency: 'GHS', channel: pay.channel, gateway_response: outcome === 'success' ? 'Approved' : 'Declined by issuer (sandbox)', ...channelInfo });
      return E.paymentView(pay);
    },
  });

  E.action('payments.verify', {
    method: 'GET', path: '/payments/:reference/verify', mutates: true,
    fn: async (p, ctx) => {
      const pay = E.all('payments').find((x) => x.reference === p.reference);
      if (!pay || (pay.customerId !== ctx.user.id && !E.hasRole(ctx.user, 'finance', 'admin'))) fail('NOT_FOUND', 'Payment not found.', 404);
      if (live() && pay.status === 'initialized') {
        const data = await paystack('GET', `/transaction/verify/${encodeURIComponent(pay.reference)}`);
        if (data.status === 'success' || data.status === 'failed' || data.status === 'abandoned') {
          await E.finalizePayment(pay.reference, { status: data.status === 'success' ? 'success' : 'failed', amount: data.amount, currency: data.currency, channel: data.channel, gateway_response: data.gateway_response, paystackId: data.id });
        }
      }
      return E.paymentView(pay);
    },
  });

  // Paystack webhook: signature-verified and idempotent.
  E.action('payments.webhook', {
    method: 'POST', path: '/paystack/webhook', auth: false, raw: true,
    fn: async (p) => {
      if (!live()) fail('FORBIDDEN', 'Webhooks require live Paystack configuration.', 403);
      const sig = await hmacSha512Hex(E.config.paystack.secretKey, p.rawBody || '');
      if (sig !== p.signature) fail('BAD_SIGNATURE', 'Invalid webhook signature.', 401);
      let evt;
      try { evt = JSON.parse(p.rawBody); } catch { fail('VALIDATION', 'Invalid JSON.', 400); }
      if (evt.event === 'charge.success' && evt.data?.reference) {
        const known = E.all('payments').find((x) => x.reference === evt.data.reference);
        if (known) await E.finalizePayment(evt.data.reference, { status: 'success', amount: evt.data.amount, currency: evt.data.currency, channel: evt.data.channel, gateway_response: evt.data.gateway_response, paystackId: evt.data.id });
      }
      if (evt.event === 'charge.dispute.create' && evt.data?.transaction?.reference) {
        const pay = E.all('payments').find((x) => x.reference === evt.data.transaction.reference);
        if (pay) E.openDispute(null, pay, 'chargeback', `Paystack dispute ${evt.data.id || ''}`.trim());
      }
      return { received: true };
    },
  });

  E.paymentView = (pay) => {
    const h = E.paymentHandlers[pay.purpose];
    const d = h?.describe ? h.describe(pay) : {};
    return {
      id: pay.id, reference: pay.reference, receiptNo: pay.receiptNo || '', purpose: pay.purpose, status: pay.status, amount: pay.amount, refunded: pay.refunded || 0,
      currency: pay.currency, channel: pay.channel, createdAt: pay.createdAt, paidAt: pay.paidAt || null, failureReason: pay.failureReason || '', mode: pay.mode,
      description: pay.description, targetIds: pay.targetIds, gateway: pay.gateway ? { last4: pay.gateway.last4, brand: pay.gateway.brand, provider: pay.gateway.provider, phone: pay.gateway.phone } : null,
      refunds: E.all('refunds').filter((r) => r.paymentId === pay.id).map((r) => ({ code: r.code, amount: r.amount, reason: r.reason, at: r.at, status: r.status })),
      ...d,
    };
  };

  E.action('payments.get', {
    method: 'GET', path: '/payments/:reference',
    fn: (p, ctx) => {
      const pay = E.all('payments').find((x) => x.reference === p.reference);
      if (!pay || (pay.customerId !== ctx.user.id && !E.hasRole(ctx.user, 'finance', 'admin'))) fail('NOT_FOUND', 'Payment not found.', 404);
      return E.paymentView(pay);
    },
  });

  E.action('payments.list', {
    method: 'GET', path: '/me/payments',
    fn: (p, ctx) => E.all('payments').filter((x) => x.customerId === ctx.user.id && x.status !== 'initialized').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(E.paymentView),
  });

  // ---------- cart ----------
  const cartOf = (uid) => db().carts[uid] || (db().carts[uid] = { id: uid, items: [] });
  const deliveryFeeFor = (user) => (user.plusUntil && Date.parse(user.plusUntil) > E.now() ? 0 : db().settings.deliveryFee);

  E.cartView = (user) => {
    const cart = cartOf(user.id);
    const groups = {};
    for (const it of cart.items) {
      const pr = db().products[it.productId];
      if (!pr) continue;
      const g = groups[pr.orgId] || (groups[pr.orgId] = { orgId: pr.orgId, seller: E.sellerLabel(pr.orgId), refundTerms: db().orgs[pr.orgId]?.refundTerms || '', lines: [], subtotal: 0, delivery: true, pickup: true, pickupAddress: db().orgs[pr.orgId]?.address || '' });
      const ok = E.productPurchasable(pr) && pr.stock >= it.qty;
      g.lines.push({ productId: pr.id, name: pr.name, packSize: pr.packSize, image: pr.image, qty: it.qty, unitPrice: pr.price, lineTotal: pr.price * it.qty, available: ok, stock: pr.stock, returnEligible: pr.returnEligible });
      if (ok) g.subtotal += pr.price * it.qty;
      g.delivery = g.delivery && pr.delivery;
      g.pickup = g.pickup && pr.pickup;
    }
    const list = Object.values(groups);
    const fee = deliveryFeeFor(user);
    return { groups: list, count: cart.items.reduce((s, i) => s + i.qty, 0), subtotal: list.reduce((s, g) => s + g.subtotal, 0), deliveryFeePerSeller: fee, plus: fee === 0 };
  };

  E.action('cart.get', { method: 'GET', path: '/cart', roles: ['customer'], fn: (p, ctx) => E.cartView(ctx.user) });

  E.action('cart.setItem', {
    method: 'PUT', path: '/cart/items', roles: ['customer'],
    fn: (p, ctx) => {
      const qty = int(p.qty, 'Quantity', { min: 0, max: 10 });
      const pr = E.get('products', p.productId);
      const cart = cartOf(ctx.user.id);
      if (qty === 0) { cart.items = cart.items.filter((i) => i.productId !== p.productId); return E.cartView(ctx.user); }
      // Acceptance criterion: unapproved, expired, suspended or recalled products cannot be purchased.
      if (!pr || !E.productPurchasable(pr)) fail('NOT_PURCHASABLE', 'This product is not available for purchase.', 409);
      if (pr.stock < qty) fail('OUT_OF_STOCK', `Only ${pr.stock} left in stock.`, 409);
      const line = cart.items.find((i) => i.productId === pr.id);
      if (line) line.qty = qty; else cart.items.push({ productId: pr.id, qty });
      return E.cartView(ctx.user);
    },
  });

  // ---------- checkout & orders ----------
  E.action('checkout.create', {
    method: 'POST', path: '/checkout', roles: ['customer'],
    fn: (p, ctx) => {
      const method = oneOf(p.deliveryMethod, 'Delivery option', ['delivery', 'pickup']);
      const address = method === 'delivery' ? str(p.address, 'Delivery address', { min: 5, max: 300 }) : '';
      const phone = ghPhone(p.phone || ctx.user.phone);
      if (p.termsAccepted !== true) fail('CONSENT_REQUIRED', 'Please confirm you have read the seller and refund terms.', 422, { field: 'terms' });
      const view = E.cartView(ctx.user);
      if (!view.groups.length) fail('VALIDATION', 'Your cart is empty.', 422);
      for (const g of view.groups) {
        for (const l of g.lines) if (!l.available) fail('NOT_PURCHASABLE', `${l.name} is no longer available in that quantity. Update your cart.`, 409);
        if (method === 'delivery' && !g.delivery) fail('VALIDATION', `${g.seller} offers pickup only for some items. Choose pickup or remove them.`, 422);
        if (method === 'pickup' && !g.pickup) fail('VALIDATION', `${g.seller} offers delivery only for some items. Choose delivery or remove them.`, 422);
      }
      const holdUntil = new Date(E.now() + 30 * 60000).toISOString();
      const checkout = E.insert('checkouts', { id: newId('chk'), customerId: ctx.user.id, orderIds: [], total: 0, createdAt: E.nowIso() });
      for (const g of view.groups) {
        const deliveryFee = method === 'delivery' ? view.deliveryFeePerSeller : 0;
        const items = g.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, status: 'ok' }));
        for (const it of items) db().products[it.productId].stock -= it.qty; // reserve
        const o = E.insert('orders', {
          id: newId('ord'), code: E.code('OR'), checkoutId: checkout.id, customerId: ctx.user.id, customerName: ctx.user.name, orgId: g.orgId,
          items, subtotal: g.subtotal, deliveryMethod: method, deliveryFee, address, phone, total: g.subtotal + deliveryFee,
          status: 'pending_payment', holdUntil, createdAt: E.nowIso(), timeline: [], refunded: 0,
        });
        checkout.orderIds.push(o.id);
        checkout.total += o.total;
      }
      E.audit(ctx, 'checkout.created', 'checkout', checkout.id, null, { orders: checkout.orderIds, total: checkout.total });
      return { checkoutId: checkout.id, total: checkout.total, orders: checkout.orderIds.map((id) => E.orderView(db().orders[id], ctx.user)) };
    },
  });

  E.releaseOrderStock = (o) => {
    for (const it of o.items) if (it.productId && it.status === 'ok' && db().products[it.productId]) db().products[it.productId].stock += it.qty;
  };

  E.paymentHandlers.checkout = {
    alreadyPaid: (pay) => {
      const c = db().checkouts[pay.targetIds[0]];
      return !!(c.paymentId && c.paymentId !== pay.id && db().payments[c.paymentId]?.status === 'success');
    },
    onSuccess: (pay) => {
      const c = db().checkouts[pay.targetIds[0]];
      const orders = c.orderIds.map((id) => db().orders[id]);
      if (orders.some((o) => o.status !== 'pending_payment' && o.status !== 'expired')) {
        E.receiveAndRefund(pay, 'The order could no longer be fulfilled', 'product_unavailable');
        return;
      }
      // Late payment after the hold lapsed: re-reserve stock if still possible, otherwise refund in full.
      for (const o of orders) {
        if (o.status !== 'expired') continue;
        const ok = o.items.every((it) => db().products[it.productId] && E.productPurchasable(db().products[it.productId]) && db().products[it.productId].stock >= it.qty);
        if (!ok) { E.receiveAndRefund(pay, 'Items were no longer available when payment arrived', 'product_unavailable'); for (const x of orders) x.status = 'cancelled'; return; }
        for (const it of o.items) db().products[it.productId].stock -= it.qty;
      }
      c.paymentId = pay.id;
      pay.allocations = [];
      const lines = [{ account: 'cash:paystack', debit: pay.amount }];
      for (const o of orders) {
        o.status = 'received';
        o.paymentId = pay.id;
        o.paidAt = E.nowIso();
        o.timeline.push({ status: 'received', at: E.nowIso(), by: 'System', note: `Paid via ${pay.channel === 'mobile_money' ? 'Mobile Money Payment' : 'card'} (${pay.reference})` });
        const org = db().orgs[o.orgId];
        if (o.deliveryFee) { lines.push({ account: 'revenue:delivery', credit: o.deliveryFee }); pay.allocations.push({ kind: 'delivery_fee', beneficiary: 'PRORESMAT', amount: o.deliveryFee, orderId: o.id }); }
        if (org.type === 'proresmat') {
          lines.push({ account: 'revenue:product_sales', credit: o.subtotal });
          pay.allocations.push({ kind: 'product_sale', beneficiary: 'PRORESMAT', amount: o.subtotal, orderId: o.id });
        } else {
          const commission = Math.round((o.subtotal * db().settings.productCommissionPct) / 100);
          lines.push({ account: `payable:org:${org.id}`, credit: o.subtotal - commission }, { account: 'revenue:product_commission', credit: commission });
          pay.allocations.push({ kind: 'provider_share', beneficiary: `org:${org.id}`, amount: o.subtotal - commission, orderId: o.id }, { kind: 'platform_commission', beneficiary: 'PRORESMAT', amount: commission, orderId: o.id });
          E.createEarning({ beneficiaryType: 'org', beneficiaryId: org.id, sourceType: 'order', sourceId: o.id, gross: o.subtotal, commission, label: `Order ${o.code}` });
        }
        if (org.ownerId) E.notify(org.ownerId, { title: 'New order', body: `Order ${o.code} (${o.items.length} item(s)) is waiting for acceptance.`, link: `#/v/order/${o.id}`, kind: 'order' });
      }
      E.post({ paymentId: pay.id, checkoutId: c.id }, `Checkout payment ${pay.reference}`, lines);
      const cart = db().carts[pay.customerId];
      if (cart) cart.items = cart.items.filter((i) => !orders.some((o) => o.items.some((it) => it.productId === i.productId)));
      E.notify(pay.customerId, { title: 'Order placed', body: `Payment received for ${orders.map((o) => o.code).join(', ')}. Receipt ${pay.receiptNo}.`, link: '#/c/orders', kind: 'order' });
    },
    describe: (pay) => {
      const c = db().checkouts[pay.targetIds[0]];
      const orders = (c?.orderIds || []).map((id) => db().orders[id]);
      return {
        title: `Order ${orders.map((o) => o.code).join(', ')}`,
        provider: [...new Set(orders.map((o) => E.sellerLabel(o.orgId)))].join('; '),
        lines: orders.flatMap((o) => [...o.items.map((i) => ({ label: `${i.name} × ${i.qty} (${E.sellerLabel(o.orgId)})`, amount: i.lineTotal })), ...(o.deliveryFee ? [{ label: `Delivery (${o.code})`, amount: o.deliveryFee }] : [])]),
      };
    },
  };

  E.orderView = (o, viewer) => {
    const org = db().orgs[o.orgId];
    const pay = o.paymentId ? db().payments[o.paymentId] : null;
    const v = {
      id: o.id, code: o.code, status: o.status, seller: E.sellerLabel(o.orgId), orgId: o.orgId, sellerType: org?.type, sellerPhone: org?.phone || '', pickupAddress: org?.address || '',
      items: o.items, subtotal: o.subtotal, deliveryFee: o.deliveryFee, total: o.total, refunded: o.refunded || 0, deliveryMethod: o.deliveryMethod,
      createdAt: o.createdAt, holdUntil: o.holdUntil, timeline: o.timeline, proofOfDelivery: o.proofOfDelivery || null, rxRequestId: o.rxRequestId || null,
      refundTerms: org?.refundTerms || '', reviewed: E.all('reviews').filter((r) => r.orderId === o.id).map((r) => r.targetType + ':' + r.targetId),
      payment: pay ? { reference: pay.reference, receiptNo: pay.receiptNo, status: pay.status, channel: pay.channel } : null,
    };
    if (viewer.id === o.customerId || (viewer.orgId === o.orgId && E.hasRole(viewer, 'vendor')) || E.hasRole(viewer, 'admin', 'support', 'finance')) {
      Object.assign(v, { address: o.address, phone: o.phone, customerName: o.customerName });
    }
    return v;
  };

  E.action('orders.list', {
    method: 'GET', path: '/orders', roles: ['customer'],
    fn: (p, ctx) => E.all('orders').filter((o) => o.customerId === ctx.user.id && o.status !== 'expired').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => E.orderView(o, ctx.user)),
  });

  E.action('orders.get', {
    method: 'GET', path: '/orders/:id',
    fn: (p, ctx) => {
      const o = E.must('orders', p.id, 'Order');
      const ok = o.customerId === ctx.user.id || (ctx.user.orgId === o.orgId && E.hasRole(ctx.user, 'vendor')) || E.hasRole(ctx.user, 'admin', 'support', 'finance');
      if (!ok) fail('FORBIDDEN', 'You do not have access to this order.', 403);
      return E.orderView(o, ctx.user);
    },
  });

  E.action('orders.cancel', {
    method: 'POST', path: '/orders/:id/cancel', roles: ['customer'],
    fn: (p, ctx) => {
      const o = E.must('orders', p.id, 'Order');
      if (o.customerId !== ctx.user.id) fail('FORBIDDEN', 'This order belongs to another account.', 403);
      if (o.status === 'pending_payment') { o.status = 'cancelled'; E.releaseOrderStock(o); return E.orderView(o, ctx.user); }
      if (o.status !== 'received') fail('INVALID_STATE', 'The seller has already accepted this order. Contact support to request a return instead.', 409);
      const amount = o.total - (o.refunded || 0);
      E.refundPayment(ctx, { paymentId: o.paymentId, amount, reason: `Order ${o.code} cancelled before acceptance`, rule: 'customer_cancel_full', target: { orderId: o.id }, deliveryPortion: o.deliveryFee });
      o.refunded = (o.refunded || 0) + amount;
      E.releaseOrderStock(o);
      o.status = 'cancelled';
      o.timeline.push({ status: 'cancelled', at: E.nowIso(), by: ctx.user.name, note: 'Cancelled by customer; refunded in full' });
      E.voidEarnings('order', o.id, 'order cancelled');
      E.audit(ctx, 'order.cancelled', 'order', o.id, { status: 'received' }, { status: 'cancelled' });
      return E.orderView(o, ctx.user);
    },
  });

  E.action('orders.acknowledge', {
    method: 'POST', path: '/orders/:id/acknowledge', roles: ['customer'],
    fn: (p, ctx) => {
      const o = E.must('orders', p.id, 'Order');
      if (o.customerId !== ctx.user.id) fail('FORBIDDEN', 'This order belongs to another account.', 403);
      if (o.status !== 'delivered') fail('INVALID_STATE', 'You can confirm receipt once the order is marked delivered.', 409);
      o.status = 'acknowledged';
      o.acknowledgedAt = E.nowIso();
      o.timeline.push({ status: 'acknowledged', at: E.nowIso(), by: ctx.user.name, note: 'Receipt confirmed by customer' });
      E.audit(ctx, 'order.acknowledged', 'order', o.id, { status: 'delivered' }, { status: 'acknowledged' });
      E.evaluateEarnings();
      return E.orderView(o, ctx.user);
    },
  });

  // ---------- conventional pharmacy: prescription validation (feature-flagged, regulated phase) ----------
  E.action('rx.create', {
    method: 'POST', path: '/rx-requests', roles: ['customer'],
    fn: (p, ctx) => {
      if (!db().flags.conventionalPharmacy) fail('FEATURE_OFF', 'Prescription medicines are not available yet. They will launch once PRORESMAT has formal regulatory authorisation.', 409);
      const pharmacy = E.get('orgs', p.pharmacyOrgId);
      if (!pharmacy || pharmacy.type !== 'pharmacy' || !E.orgActive(pharmacy)) fail('VALIDATION', 'Choose a licensed partner pharmacy.', 422);
      let documentId = '';
      let carePlanId = '';
      if (p.carePlanId) {
        const c = E.must('carePlans', p.carePlanId, 'Prescription');
        if (c.customerId !== ctx.user.id || c.type !== 'prescription') fail('VALIDATION', 'Choose one of your prescriptions.', 422);
        carePlanId = c.id;
      } else {
        const d = E.get('documents', p.documentId);
        if (!d || d.ownerId !== ctx.user.id || d.deleted) fail('VALIDATION', 'Upload a photo or PDF of your prescription.', 422);
        documentId = d.id;
      }
      const deliveryMethod = oneOf(p.deliveryMethod || 'pickup', 'Delivery option', ['delivery', 'pickup']);
      const r = E.insert('rxRequests', {
        id: newId('rxr'), code: E.code('PX'), customerId: ctx.user.id, customerName: ctx.user.name, pharmacyOrgId: pharmacy.id, documentId, carePlanId,
        notes: str(p.notes, 'Notes', { optional: true, max: 1000 }), deliveryMethod, address: deliveryMethod === 'delivery' ? str(p.address, 'Delivery address', { min: 5, max: 300 }) : '',
        status: 'submitted', createdAt: E.nowIso(), quote: null,
      });
      if (pharmacy.ownerId) E.notify(pharmacy.ownerId, { title: 'Prescription to validate', body: `Request ${r.code} needs pharmacist validation.`, link: '#/v/rx', kind: 'order' });
      E.audit(ctx, 'rx.submitted', 'rxRequest', r.id, null, { pharmacy: pharmacy.id });
      return r;
    },
  });
  E.action('rx.list', {
    method: 'GET', path: '/rx-requests', roles: ['customer'],
    fn: (p, ctx) => E.all('rxRequests').filter((r) => r.customerId === ctx.user.id).map((r) => ({ ...r, pharmacyName: db().orgs[r.pharmacyOrgId]?.name })),
  });

  E.paymentHandlers.rx = {
    alreadyPaid: (pay) => db().rxRequests[pay.targetIds[0]].status === 'paid',
    onSuccess: (pay) => {
      const r = db().rxRequests[pay.targetIds[0]];
      const org = db().orgs[r.pharmacyOrgId];
      const subtotal = r.quote.subtotal;
      const o = E.insert('orders', {
        id: newId('ord'), code: E.code('OR'), customerId: r.customerId, customerName: r.customerName, orgId: org.id, rxRequestId: r.id,
        items: r.quote.items.map((i) => ({ ...i, productId: '', status: 'ok' })), subtotal, deliveryMethod: r.deliveryMethod, deliveryFee: r.quote.deliveryFee,
        address: r.address, phone: db().users[r.customerId]?.phone || '', total: r.quote.total, status: 'received', createdAt: E.nowIso(), paidAt: E.nowIso(), paymentId: pay.id,
        timeline: [{ status: 'received', at: E.nowIso(), by: 'System', note: `Prescription ${r.code} paid (${pay.reference})` }], refunded: 0,
      });
      const commission = Math.round((subtotal * db().settings.productCommissionPct) / 100);
      const lines = [{ account: 'cash:paystack', debit: pay.amount }, { account: `payable:org:${org.id}`, credit: subtotal - commission }, { account: 'revenue:product_commission', credit: commission }];
      if (r.quote.deliveryFee) lines.push({ account: 'revenue:delivery', credit: r.quote.deliveryFee });
      E.post({ paymentId: pay.id, orderId: o.id }, `Prescription order ${o.code}`, lines);
      pay.allocations = [{ kind: 'provider_share', beneficiary: `org:${org.id}`, amount: subtotal - commission, orderId: o.id }, { kind: 'platform_commission', beneficiary: 'PRORESMAT', amount: commission, orderId: o.id }];
      E.createEarning({ beneficiaryType: 'org', beneficiaryId: org.id, sourceType: 'order', sourceId: o.id, gross: subtotal, commission, label: `Order ${o.code}` });
      r.status = 'paid';
      r.orderId = o.id;
      if (org.ownerId) E.notify(org.ownerId, { title: 'New order', body: `Prescription order ${o.code} is paid and ready to prepare.`, link: `#/v/order/${o.id}`, kind: 'order' });
      E.notify(r.customerId, { title: 'Order placed', body: `Payment received for ${o.code}. Receipt ${pay.receiptNo}.`, link: '#/c/orders', kind: 'order' });
    },
    describe: (pay) => {
      const r = db().rxRequests[pay.targetIds[0]];
      return { title: `Prescription ${r?.code}`, provider: `Dispensed by ${db().orgs[r?.pharmacyOrgId]?.name} (licensed pharmacy partner)`, lines: [...(r?.quote?.items || []).map((i) => ({ label: `${i.name} × ${i.qty}`, amount: i.lineTotal })), ...(r?.quote?.deliveryFee ? [{ label: 'Delivery', amount: r.quote.deliveryFee }] : [])] };
    },
  };

  // ---------- subscriptions (feature-flagged) ----------
  E.paymentHandlers.subscription = {
    alreadyPaid: () => false,
    onSuccess: (pay) => {
      const u = db().users[pay.customerId];
      const base = u.plusUntil && Date.parse(u.plusUntil) > E.now() ? Date.parse(u.plusUntil) : E.now();
      u.plusUntil = new Date(base + 30 * 86400000).toISOString();
      E.insert('subscriptions', { id: newId('sub'), userId: u.id, plan: 'plus', start: new Date(base).toISOString(), end: u.plusUntil, paymentId: pay.id, status: 'active' });
      E.post({ paymentId: pay.id }, `PRORESMAT Plus ${pay.reference}`, [{ account: 'cash:paystack', debit: pay.amount }, { account: 'revenue:subscription', credit: pay.amount }]);
      pay.allocations = [{ kind: 'subscription', beneficiary: 'PRORESMAT', amount: pay.amount }];
      E.notify(u.id, { title: 'PRORESMAT Plus active', body: `Free delivery on orders until ${u.plusUntil.slice(0, 10)}.`, link: '#/c/profile', kind: 'payment' });
    },
    describe: (pay) => ({ title: 'PRORESMAT Plus', provider: 'Sold by PRORESMAT', lines: [{ label: 'PRORESMAT Plus – 30 days', amount: pay.amount }] }),
  };
}
