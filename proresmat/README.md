# PRORESMAT Health Connect

A supervised traditional-medicine and integrative-health marketplace for Ghana. Customers book verified
practitioners, share medical documents, receive care plans, and buy approved herbal products. PRORESMAT
collects every payment through Paystack and settles practitioners and clinics after the hold period.

This folder is a working reference implementation of the two source documents:

- *Proposed Software (PRORESMAT – Health Connect)*
- *PRORESMAT Reconciled Mobile Application Report* (28 Aug 2026), which takes precedence where they differ

The build brief is in [`docs/SUPER_PROMPT.md`](docs/SUPER_PROMPT.md), the architecture, data model, permission
matrix and payment sequence are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and the full endpoint list is in
[`docs/API.md`](docs/API.md).

## Run it

Requires Node.js 22 or newer. The server has no dependencies.

```bash
cd proresmat
npm start                 # http://localhost:8080
```

Data is stored in `proresmat/data/` (created on first start, git-ignored). Delete that folder to start again,
or use **Profile → Test tools → Reset**.

### Single-file version (no server)

```bash
npm install               # installs esbuild (build-time only)
npm run build             # writes dist/proresmat-standalone.html
```

Open `dist/proresmat-standalone.html` in a browser. The same engine runs inside the page and keeps data in
the browser's IndexedDB, so each browser gets its own sandbox.

### Android app (APK)

`dist/proresmat.apk` is a native Android app (Android 7.0 or newer) that runs the same build fully on the
phone, with data stored on the device. To install it, copy the file to the phone, open it, and allow
installs from that source when Android asks.

To rebuild it (needs a JDK and Python 3; no Android SDK or Gradle):

```bash
npm run build:apk          # writes dist/proresmat.apk
```

`android/build_apk.py` compiles `android/src`, converts it to DEX, encodes the binary manifest and resource
table, zip-aligns and signs the APK. It downloads three jars from Maven Central on first run and creates a
signing key at `android/keystore.p12`. Keep that key: Android only installs an update over an existing
install when it is signed with the same key. The key is git-ignored and must not be committed.

## Test accounts

Every account uses the password **`Demo@1234`**. Staff and supervisor accounts ask for a one-time code; in test
mode the code is shown on screen (and in **Test tools → Message outbox**).

| Email | Workspace | What to try |
|---|---|---|
| akosua@demo.gh | Customer | Book a consultation, buy products, open the care plan, upload a document |
| kojo@demo.gh | Customer | Has a consultation starting soon and an order waiting for the clinic |
| kwame@demo.gh | Practitioner + supervisor | Start the consultation due now, write notes, issue a care plan, supervision queue |
| ama@demo.gh | Practitioner (supervised) | Licence expires in 25 days: see the renewal warning |
| kofi@demo.gh | Practitioner (conventional) | Can issue prescriptions (scope control) |
| clinic@demo.gh | Clinic vendor | Fulfil Kojo's order, draft and submit a listing |
| store@demo.gh | PRORESMAT dispensary | Fulfils products sold by PRORESMAT |
| pharmacy@demo.gh | Pharmacy partner | Validates prescriptions once the feature flag is on |
| adwoa@demo.gh | Clinic awaiting approval | Onboarding state |
| admin@demo.gh | PRORESMAT admin | Approvals, care queue, recalls, finance, audit, feature flags |
| finance@demo.gh | Finance | Refunds, chargebacks, settlement run, reconciliation |
| support@demo.gh | Support | Complaints, care queue, review moderation |

**Test clock.** Profile → Test tools moves time forward, so you can watch reminders fire, settlement hold periods
end, and licences or FDA registrations expire (which hides the practitioner or blocks the product automatically).

**Payments.** Without Paystack keys the app uses a sandbox checkout that behaves like Paystack (card or Mobile
Money Payment, success or decline). Set `PAYSTACK_SECRET_KEY` to switch to live Paystack: transactions are
initialised and verified server-side, and `POST /api/v1/paystack/webhook` checks the `x-paystack-signature`
HMAC-SHA512 before acting.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `./data` | Database file and encrypted document store |
| `PUBLIC_URL` | `http://localhost:PORT` | Used for the Paystack callback and HSTS |
| `PAYSTACK_SECRET_KEY` | unset | Enables live Paystack |
| `PRORESMAT_DOC_KEY` | generated | 64 hex chars; AES-256-GCM key for medical documents |
| `DEMO` | `true` unless `NODE_ENV=production` | Shows test codes, test clock, outbox and reset |

## Tests

```bash
npm test                  # 20 engine tests covering the report's acceptance criteria (section 12.1)
npm start &               # then, with a freshly seeded server:
node test/e2e-smoke.mjs   # signs in as every role, opens all 64 screens, checks nav overlap and overflow
node test/e2e-flows.mjs   # clicks through 15 real workflows in Chromium (needs Playwright)
```

## What is covered

Every numbered requirement of the original document and every section of the reconciled report is implemented:

| Requirement | Where |
|---|---|
| 1. Consultation booking (in-person, telephone, video; profiles; availability calendar) | Customer → Consult; `core/actions/care.js` |
| 2. Medical document upload (encrypted, type/size/content checks, short-lived links, access log) | Profile → Medical documents; booking → Share documents |
| 3. E-prescription (scope-controlled; traditional practitioners issue care plans) | Practitioner consultation → Issue care plan |
| 4. Pharmacy purchase (prescription validation by licensed partner; no retail cart for Rx) | Feature flag *Prescription medicines*; Orders → Prescriptions; pharmacy portal |
| 5–6. Traditional medicine consultation, listings, purchase and delivery | Categories, clinic listings with approval states, cart, delivery or pickup |
| 7. Payments (card, Mobile Money, secure server-side verification) | `core/actions/commerce.js`, sandbox or live Paystack |
| 8. Consistent UI and integrated dashboard | Profile → My health dashboard |
| 9. Notifications, feedback & ratings, education | Bell, moderated reviews, Health information |
| 10. Versioned API, scalable backend, multi-language | `/api/v1`, `docs/API.md`, English + Twi |
| 11. Monetisation (commission, subscription, partner fees) | Commission settings, PRORESMAT Plus (flag), partner fee invoices |
| Report §2 provider/seller classes and disclosure | Badges on profiles, product pages, checkout, receipts |
| Report §6–8 practitioner workspace, vendor portal, control centre | `#/p`, `#/v`, `#/a` workspaces |
| Report §9 refund rules and settlement ledger | Double-entry ledger, holds, disputes, settlement runs, reconciliation |
| Report §10 safety, compliance, privacy | Emergency screening, referrals, adverse events, recalls, MFA, audit log, privacy rights |

## What is simulated in this build

- **SMS and push delivery.** Messages are written to an outbox (visible in test mode) instead of an SMS gateway.
- **Paystack.** Sandbox checkout unless live keys are configured. Refunds call Paystack's refund API in live mode.
- **Malware scanning.** Uploads are checked for file-type mismatch, executables, the EICAR signature and PDF
  JavaScript. Production should add a full antivirus engine.
- **Storage.** A JSON database file and encrypted blob folder. The target production stack is MySQL, Redis and
  private object storage (see `docs/ARCHITECTURE.md`).
- **Twi translations** cover navigation and the main customer actions, and need review by a native speaker.

## Target production stack

The source documents specify Flutter (mobile), Laravel (API), Nuxt/Livewire (web portals), MySQL and Redis. This
build keeps all business rules in one framework-free engine (`core/`) with a documented REST API so the Flutter app
and a Laravel port can reuse the same contracts, screens and tests. `docs/ARCHITECTURE.md` maps each module to its
production counterpart.
