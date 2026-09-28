# PRORESMAT Health Connect: build prompt

This is the working brief used to build this application. It merges the two source documents,
*Proposed Software (PRORESMAT – Health Connect)* and the *PRORESMAT Reconciled Mobile Application Report*
(28 Aug 2026). Where they differ, the reconciled report wins, because it was written to supersede the
original while keeping its destination.

---

## Role and goal

You are building a supervised traditional-medicine and integrative-health marketplace for Ghana. It
connects customers with verified practitioners, clinics and approved herbal products. PRORESMAT collects
every payment and later settles eligible providers. Trust, verification, clinical supervision and
accountable commerce are the product. Catalogue size is not.

Deliver a working, testable application that covers **every** requirement below, with the business rules
enforced on the server side (never trusted to the client), plus automated tests for the acceptance criteria.

## Architecture (as built)

| Layer | Choice | Why |
|---|---|---|
| Domain engine | `core/engine.js`, plain ES modules, no dependencies | One authoritative place for permissions, prices, commissions, payment verification, settlement eligibility, audit. Runs on the server, and in the browser for the offline demo. |
| API | `server/server.js`, Node 22 `http`, versioned REST under `/api/v1` | Zero-dependency, idempotent writes, rate limits, secure headers, bearer sessions. |
| Persistence | JSON snapshot (atomic write) + AES-256-GCM encrypted document blobs outside the web root | Swap for MySQL + object storage in production (see `docs/ARCHITECTURE.md`). |
| Payments | Paystack adapter: live mode with `PAYSTACK_SECRET_KEY` (initialize, verify, HMAC-SHA512 webhook); sandbox simulator otherwise | Payment success is decided server-side only. |
| Client | `web/`, mobile-first SPA, vanilla JS, no build step | Works as a PWA-style web app; same screens intended for the Flutter port. |

The original stack (Flutter, Laravel, Nuxt/Livewire, MySQL, Redis) remains the production target. This
build is the working reference implementation and clickable high-fidelity prototype of all four environments.

## Four environments (max five bottom-nav items each)

1. **Customer**: Home, Consult, Products, Orders, Profile.
2. **Practitioner**: Today, Patients, Consult, Earnings, Profile.
3. **Clinic/Vendor**: Dashboard, Products, Orders, Payouts, Compliance.
4. **PRORESMAT control centre**: Overview, Approvals, Care, Finance, Risk.

Roles: customer, practitioner, supervisor, vendor, finance, support, admin. Enforce a role/permission matrix
in the engine. MFA (one-time code) for privileged roles (supervisor, finance, support, admin).

## Provider and seller classes (disclose everywhere)

- *PRORESMAT-supervised* practitioner; *Verified independent* practitioner.
- *Sold by PRORESMAT*; *Sold by [Clinic name]*.
- Show the provider/seller on every profile, product page, checkout and receipt. Never imply an independent
  practitioner or third-party clinic is owned by PRORESMAT.

## Customer features

- Registration with Ghana phone format (`0XX XXX XXXX` / `+233`), plain-language privacy notice, explicit consent.
- Home: brand promise, emergency warning (112 / 193), unified search (practitioners, clinics, products),
  quick actions, available verified practitioners with class badges, upcoming consultation/order, education and safety notices.
- Practitioner profile: full name, lawful title, photo/avatar, qualification, registration number, licence status,
  provider class, facility, area of practice, languages, location, consultation modes, fee, next availability,
  verification explanation, moderated reviews.
- Categories: Traditional medicine practitioners, Conventional medical services, Herbal clinics.
- Booking flow (in order): category and provider → physical/telephone/video → date/time from availability
  calendar → reason and safety screening (red flags stop booking and show emergency guidance + referral) with
  allergy, pregnancy/breastfeeding and current-medicine prompts → review (provider status, fee, cancellation
  policy, privacy notice) → informed consent → pay (Paystack: card or Mobile Money Payment) → confirmation,
  receipt and reminders → attend → care plan / referral / follow-up.
- Medical documents: upload lab results, scans and records (type/size checks, content sniffing, encrypted at rest),
  share with a specific booking's care team, short-lived access links, every access logged.
- Care plans and e-prescriptions: only professionals whose scope allows it can issue a *prescription*;
  traditional practitioners issue a *treatment recommendation / care plan*. Recommended approved products can be
  added to the cart from the plan.
- Products: approved herbal medicines and wellness products; filter by category, seller, dosage form. No
  claims-based filters. Product page: identity, FDA registration/status, manufacturer, full ingredients, approved
  indication, directions, duration, warnings, contraindications, pregnancy/breastfeeding advice, interaction
  warning, price, stock, delivery/pickup, return eligibility, report a problem/adverse reaction.
- Cart and checkout: split per seller, seller identity and refund terms visible, home delivery or pickup,
  one payment, per-seller orders, allocations recorded.
- Conventional pharmacy (regulated later phase, behind an admin feature flag): no retail cart for
  prescription-only medicines; upload prescription → licensed pharmacy partner validates and quotes → pay → fulfil.
- Integrated dashboard: consultations, documents, care plans/prescriptions, orders, payments, refunds, support.
- Notifications: appointment, pickup and refill reminders; lock-screen-safe text (no health details in titles).
- Feedback and ratings for practitioners, clinics and pharmacy services; moderated; cure/efficacy claims flagged.
- Education: health tips, medicine information, traditional medicine insights.
- Support tickets and complaints; adverse-event reports.
- Privacy rights: data download, correction request, account deletion, device/login history, session timeout.
- Multi-language ready (English + Twi to start), language switch in profile.
- Premium subscription (PRORESMAT Plus) behind a feature flag, off by default (sequenced monetisation).

## Practitioner features

- Credentialing: identity/contact, qualification, professional category, TMPC or council registration and licence
  expiry, facility and facility licence, settlement (bank or mobile money), provider agreement, confidentiality and
  code of conduct. PRORESMAT approval and supervisor assignment.
- Availability management; appointment list; patient record for their own bookings only (consent, concern,
  allergies, current medicines, shared documents).
- Consultation documentation: notes, assessment, treatment recommendation/prescription with rationale, referral,
  urgent escalation, follow-up date, outcome, adverse event / herb–drug interaction report.
- Supervisor review queue for selected cases.
- Earnings: gross, commission, adjustments, net, payout status. Payout-eligible only when completed, documented,
  no refund/dispute hold, and the settlement hold period has closed.

## Clinic/Vendor features

- Onboarding: business registration, beneficial owner, facility address and licence, authorised representative,
  settlement account, tax ID, seller agreement (service levels, refunds, recalls). PRORESMAT review before activation.
- Listing states: Draft, Submitted, Under Review, Changes Required, Approved, Suspended, Expired, Recalled.
  Only PRORESMAT publishes. Expired regulatory evidence automatically blocks sales.
- Fulfilment: received/accepted → stock confirmed → batch and expiry captured → prepared → dispatched or ready for
  pickup → delivered → acknowledged; returns/complaints/adverse events; settlement after hold period.
- Payouts and compliance documents with expiry reminders.

## PRORESMAT control centre

- Approvals: approve, request changes, suspend, deactivate practitioners, clinics and products; licence expiry
  monitoring; claims review; supervisor assignment. Every status change records reason, date and administrator.
- Care: emergency/referral follow-up queue, adverse-event queue, complaints and investigations, product
  suspension/quarantine/recall with recall notices to affected customers, provider quality metrics, privacy requests,
  review moderation.
- Finance: double-entry ledger (payments, allocations, adjustments, settlements), refunds (full/partial/item-level),
  disputes and chargebacks (freeze settlement), settlement runs with payout references, reconciliation,
  partnership fees, commission and hold-period settings.
- Risk: audit log (user, action, time, previous value, new value), expiring licences, failed logins, feature flags.

## Refund rules (9.3)

Provider cancels → full refund (or rebooking). Customer cancels within the window → refund per policy (full ≥24h
before, 50% ≥2h, none after). Failed/duplicate payment → automatic reconciliation and refund. Product unavailable →
full product + delivery refund. Partial fulfilment → item-level partial refund. Disputed clinical outcome → complaint
review, no automatic refund. Chargeback → freeze related provider settlement. Every refund adjusts provider settlement.

## Acceptance criteria (automated tests must cover these)

1. Unverified or expired practitioners never appear in search and cannot be booked.
2. Unapproved, expired, suspended or recalled products cannot be purchased.
3. Every checkout identifies the provider/seller.
4. Every successful payment has a unique platform record and Paystack reference.
5. A refund adjusts the provider's settlement automatically.
6. No payout for cancelled, refunded or disputed transactions.
7. Customers can access receipts, history and support.
8. Practitioners can document consultation, referral, follow-up and adverse events.
9. Every approval, suspension, refund and settlement action is audited.
10. Sensitive health information is visible only to authorised roles.
11. Bottom navigation never covers content (safe-area padding, content padding).
12. Critical flows tolerate low bandwidth / interruption (retries, idempotency keys, offline banner).

## Design system

Deep green for trust and primary actions, muted gold for selective emphasis, pale green supporting surfaces,
red only for safety or destructive states. Readable sans-serif, 16px minimum on inputs, light borders, restrained
radius, one dominant action per screen, status = colour + text/icon, large touch targets, strong contrast,
screen-reader labels, plain-language errors. Language: "Practitioners and healthcare professionals", "Conventional
medical", "Mobile Money Payment", "Verified practitioner / Verified clinic / Approved product", "Traditionally used
for…", "Prescription validation required". No cure claims anywhere.

## Definition of done

All features above reachable in the UI with seeded demo accounts for every role, all engine tests passing, server
starts with `node server/server.js`, offline demo runs from the static `web/` folder, and a README explains how to test.
