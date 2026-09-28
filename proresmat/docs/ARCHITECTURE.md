# Architecture, data model and controls

## Layout

```
proresmat/
  core/                 Domain engine (no dependencies; runs in Node and in the browser)
    engine.js           Registry, clock, audit, ledger, earnings, payment finalisation, daily jobs, dispatch
    actions/auth.js     Sign-in, MFA, password reset, sessions, notifications, privacy rights
    actions/catalog.js  Public discovery: practitioners, slots, clinics, products, education
    actions/care.js     Booking, screening, consent, documents, clinical notes, care plans, supervision, reviews, complaints, adverse events
    actions/commerce.js Paystack, refunds, cart, checkout, orders, prescription requests, subscriptions
    actions/providers.js Practitioner credentialing and availability, earnings, vendor onboarding, listings, fulfilment, Rx validation
    actions/admin.js    Approvals, care oversight, finance, settlement, reconciliation, risk, feature flags
    seed.js             Demo data, produced by running the real workflows with the clock moved back
  server/               HTTP layer: /api/v1 routing, rate limits, security headers, file streaming, webhook
  web/                  Mobile-first web client (vanilla ES modules, no build step)
  scripts/              Standalone build, API doc generator
  test/                 Engine tests (node:test) and Playwright browser tests
```

**Principle (report §14.1): the server decides.** Prices, fees, commission, payment success, permissions and
settlement eligibility are computed only in `core/`. The client sends intentions (book this slot, pay this booking)
and renders what the engine returns.

Every mutating request runs inside a serialised queue with a snapshot; if any step throws, the whole request is
rolled back, so a failure never leaves half-applied state. Failed sign-ins and denied document access are the
deliberate exceptions: they are persisted even though the request fails.

## Data model

| Collection | Key fields | Notes |
|---|---|---|
| users | email, phone (E.164), roles[], lang, health{}, consentAt, plusUntil, failed, lockedUntil | Passwords: PBKDF2-SHA256, 60k iterations, per-user salt |
| sessions | token, userId, device, expiresAt | Sliding 30-minute idle expiry |
| practitioners | userId, title, category, council, registrationNumber, licenceExpiry, facility{}, providerClass, supervisorId, canPrescribe, availability{}, settlement{}, agreements{}, status, statusHistory[] | Bookable only when active and every licence is in date |
| orgs | type (proresmat/clinic/pharmacy), licences, beneficialOwner, authorisedRep, settlement, taxId, refundTerms, status | |
| products | orgId, FDA reg + expiry, ingredients, indication, safety fields, price, stock, status, statusHistory[], batches[] | States: draft, submitted, under_review, changes_required, approved, suspended, expired, recalled |
| bookings | customerId, practitionerId, mode, start, reason, screening{}, consentAt, fee, status, notes{}, referral{}, supervisorReview{}, sharedDocIds[] | pending_payment holds the slot 15 minutes |
| carePlans | bookingId, type (care_plan / prescription), items[], advice, followUpDate, refills | |
| documents | ownerId, mime, size, sha256, blobKey, iv | Bytes are AES-256-GCM encrypted outside the web root |
| docLinks | token, docId, userId, expiresAt | 5-minute links; every open is audited |
| carts, checkouts, orders | orders split per seller; items[] with batch/expiry; timeline[]; proofOfDelivery | |
| payments | reference, purpose, targetIds, amount, channel, status, allocations[], refunded, receiptNo | One record per Paystack reference |
| ledger | txnId, account, debit, credit, memo, ref{} | Double entry; every posting must balance or it throws |
| earnings | beneficiary, source (booking/order/adjustment), gross, commission, adjustments, status, holds[], eligibleAt, payoutId | pending → eligible → paid; on_hold; void |
| refunds, disputes, payouts, partnerFees | | |
| careQueue | type (red_flag, referral, emergency, adverse_event, payment_mismatch), priority, status, notes[] | |
| tickets, adverseEvents, reviews, privacyRequests | | |
| notifications, scheduled, outbox | Lock-screen-safe titles; reminders; SMS/push log | |
| audit | actor, action, entity, before, after, reason, at | Every approval, suspension, refund, settlement, clinical and document access |

### Ledger accounts

`cash:paystack` (asset) · `payable:practitioner:<id>` and `payable:org:<id>` (owed to providers) ·
`revenue:consultation_commission` · `revenue:product_commission` · `revenue:product_sales` (PRORESMAT's own
products) · `revenue:delivery` · `revenue:subscription` · `revenue:partner_fees` · `revenue:cancellation_fees` ·
`liability:customer_refunds` · `receivable:partner:<id>`.

The reconciliation check (Finance → Reconcile) verifies that every transaction balances, every successful payment
has matching cash in the ledger, references are unique, and each provider's payable balance equals the net of their
unpaid earnings.

## Role and permission matrix

| Capability | Customer | Practitioner | Supervisor | Vendor | Finance | Support | Admin |
|---|---|---|---|---|---|---|---|
| Book, pay, own records, documents | ✓ | ✓ | ✓ | ✓ | | | |
| Clinical notes and records of own patients | | ✓ | ✓ | | | | |
| Review supervisees' cases | | | ✓ | | | | |
| Open a shared medical document | owner | treating | when reviewing | pharmacy for its Rx | ✗ | ✗ | ✗ |
| Listings and fulfilment for own organisation | | | | ✓ | | | |
| Payments, refunds, disputes, settlements, reconciliation | | | | | ✓ | | ✓ |
| Complaints, care queue, review moderation | | | | | | ✓ | ✓ |
| Approvals, recalls, privacy requests, flags, audit, settings | | | | | | | ✓ |

Privileged roles (supervisor, finance, support, admin) must pass a one-time SMS code at every sign-in.
Finance, support and admin see bookings without the reason, screening, notes or documents.

## Consultation and payment sequence (report §9.1)

1. `GET /practitioners` returns only active practitioners with in-date licences.
2. `POST /bookings` validates the slot against availability and existing holds, runs red-flag screening
   (a red flag queues a follow-up and refuses the booking), requires consent and policy acceptance, and holds the
   slot for 15 minutes.
3. `POST /payments` creates the payment record with a unique reference and the server-computed amount
   (idempotency key supported), then initialises Paystack.
4. Paystack result arrives by webhook (signature-checked) or `GET /payments/:ref/verify`. `finalizePayment` is
   idempotent; it checks amount and currency, detects duplicates (auto-refunded) and late payments for a lost slot
   (auto-refunded).
5. On success: ledger posting (cash → provider payable + commission), an earning record, receipt number,
   reminders at 24 h and 1 h, notifications to both sides.
6. The practitioner starts the consultation (from 30 minutes before), documents the assessment, issues a care plan
   or, if in scope, a prescription, refers or escalates, and completes it.
7. The earning becomes eligible once completed and documented, with no hold, after the hold period (3 days).
8. `POST /admin/settlements` pays eligible earnings per beneficiary and posts payable → cash.

Exceptions: customer cancellation (100% / 50% / 0% by notice), provider cancellation (100%), unavailable items
(item-level refund), chargebacks (freeze, then release or void), refunds after payout (negative adjustment carried
into the next settlement), complaints, adverse events and recalls (hold until resolved).

## Security and privacy controls

- Transport: run behind TLS; the server sets HSTS when `PUBLIC_URL` is https, plus CSP, `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy: no-referrer` and a restrictive `Permissions-Policy`.
- Authentication: PBKDF2 password hashes, lockout after 5 failures for 15 minutes, MFA for privileged roles, sliding
  30-minute server sessions and a 15-minute client idle sign-out, device and sign-in history, sign out other devices.
- Documents: allow-listed types with magic-byte check, 5 MB limit, executable/EICAR/PDF-script screen, AES-256-GCM at
  rest, 5-minute links, access audited, denied attempts audited.
- Rate limiting: 300 requests/minute per IP, 20/minute on auth endpoints.
- Privacy rights: data export, correction, access restriction and deletion requests with a 30-day due date; deletion
  anonymises personal data and keeps legally required records in pseudonymised form.
- Notifications never put health details in the title (tested).

## Compliance checklist (for go-live)

- [ ] Written approval of the operating model, provider classes, commission and refund policy (Phase 0)
- [ ] TMPC, MDC and facility licence verification procedure documented; renewal evidence retained
- [ ] FDA Ghana registration check for every listing; claims wording reviewed against FDA advertising guidelines
- [ ] Legal confirmation before enabling the *Prescription medicines* flag; pharmacy partner agreements signed
- [ ] Data Protection Commission registration; privacy notice reviewed; data map and retention schedule approved
- [ ] Paystack live account, settlement account, webhook URL and IP allow-list configured
- [ ] Adverse-event reporting route to FDA Ghana agreed; recall procedure rehearsed
- [ ] Incident response and breach-notification procedure; backup and restore test
- [ ] Twi translations reviewed by a native speaker

## Test plan

| Area | Coverage |
|---|---|
| Acceptance criteria 1–10 (§12.1) | `test/engine.test.mjs` |
| Criterion 11: bottom navigation never covers content, no horizontal scroll | `test/e2e-smoke.mjs` on all 64 screens at 390 px and 1280 px |
| Criterion 12: interrupted connections | Built in (retries on reads and idempotent writes, offline banner, idempotency keys on payment initialisation, rollback on failed requests); not yet covered by an automated network-throttling test |
| Workflows through the real UI | `test/e2e-flows.mjs`: booking and payment, red flag, two-seller checkout, document upload, receipts, support, language, practitioner consultation, supervision, vendor fulfilment, claims blocking, practitioner and product approval, settlement and reconciliation, care follow-up, password reset |
| Refunds, disputes, recall, expiry, suspension, MFA, lockout, privacy deletion | engine tests |

## Release plan (report §12)

| Phase | Scope in this build | Switch |
|---|---|---|
| 1 Consultation MVP | Onboarding, verified profiles, booking, triage, consent, payments, receipts, practitioner workspace, referral, complaints, administration | On |
| 2 Herbal marketplace | Clinic onboarding, product approval, catalogue, cart, fulfilment, refunds, settlements, adverse events, recalls | On |
| 3 Scale and integration | Video (flag on), Twi (flag on), prescription medicines (flag off), PRORESMAT Plus (flag off) | Admin → Risk → Feature flags |

## Mapping to the production stack

| This build | Production (per source documents) |
|---|---|
| `core/actions/*.js` | Laravel services and policies; same rules and tests ported to PHPUnit |
| `server/server.js` routes | Laravel API routes under `/api/v1`, Sanctum tokens, throttling middleware |
| JSON file + encrypted blob folder | MySQL (migrations per collection above) + private object storage with signed URLs |
| In-process tick | Laravel scheduler + Redis queues (licence expiry, reminders, settlement eligibility) |
| `web/` screens | Flutter app screens (customer, practitioner, vendor); Livewire admin portal |
| Outbox | SMS gateway (e.g. Hubtel/mNotify) and FCM push |
