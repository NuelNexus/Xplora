# PRORESMAT API v1

Base path `/api/v1`. JSON in, JSON out: success is `{ "data": … }`, failure is `{ "error": { "code", "message", "details" } }` with a matching HTTP status.
Authenticate with `Authorization: Bearer <token>` from `POST /auth/login` (or `/auth/mfa` for privileged roles).
Money is in pesewas (integer). Times are ISO 8601 UTC (Ghana time).

Generated from `core/` by `node scripts/api-doc.mjs`.

## auth

| Action | Method | Path | Auth |
|---|---|---|---|
| `auth.register` | POST | `/auth/register` | Public |
| `auth.login` | POST | `/auth/login` | Public |
| `auth.verifyMfa` | POST | `/auth/mfa` | Public |
| `auth.requestReset` | POST | `/auth/reset-request` | Public |
| `auth.resetPassword` | POST | `/auth/reset` | Public |
| `auth.logout` | POST | `/auth/logout` | Public |
| `auth.me` | GET | `/me` | Bearer |

## me

| Action | Method | Path | Auth |
|---|---|---|---|
| `me.update` | PATCH | `/me` | Bearer |
| `me.changePassword` | POST | `/me/password` | Bearer |

## security

| Action | Method | Path | Auth |
|---|---|---|---|
| `security.history` | GET | `/security/logins` | Bearer |
| `security.signOutOthers` | POST | `/security/sign-out-others` | Bearer |

## notifications

| Action | Method | Path | Auth |
|---|---|---|---|
| `notifications.list` | GET | `/notifications` | Bearer |
| `notifications.read` | POST | `/notifications/read` | Bearer |

## privacy

| Action | Method | Path | Auth |
|---|---|---|---|
| `privacy.export` | GET | `/privacy/export` | Bearer |
| `privacy.request` | POST | `/privacy/requests` | Bearer |
| `privacy.list` | GET | `/privacy/requests` | Bearer |

## meta

| Action | Method | Path | Auth |
|---|---|---|---|
| `meta.get` | GET | `/meta` | Public |
| `meta.routes` | GET | `/routes` | Public |

## home

| Action | Method | Path | Auth |
|---|---|---|---|
| `home.get` | GET | `/home` | Public |

## search

| Action | Method | Path | Auth |
|---|---|---|---|
| `search.all` | GET | `/search` | Public |

## practitioners

| Action | Method | Path | Auth |
|---|---|---|---|
| `practitioners.search` | GET | `/practitioners` | Public |
| `practitioners.get` | GET | `/practitioners/:id` | Public |
| `practitioners.slots` | GET | `/practitioners/:id/slots` | Public |

## products

| Action | Method | Path | Auth |
|---|---|---|---|
| `products.search` | GET | `/products` | Public |
| `products.get` | GET | `/products/:id` | Public |

## clinics

| Action | Method | Path | Auth |
|---|---|---|---|
| `clinics.get` | GET | `/clinics/:id` | Public |

## education

| Action | Method | Path | Auth |
|---|---|---|---|
| `education.list` | GET | `/education` | Public |
| `education.get` | GET | `/education/:id` | Public |

## bookings

| Action | Method | Path | Auth |
|---|---|---|---|
| `bookings.redFlags` | GET | `/bookings/red-flags` | Public |
| `bookings.create` | POST | `/bookings` | Bearer |
| `bookings.list` | GET | `/bookings` | Bearer |
| `bookings.get` | GET | `/bookings/:id` | Bearer |
| `bookings.cancelQuote` | GET | `/bookings/:id/cancel-quote` | Bearer |
| `bookings.cancel` | POST | `/bookings/:id/cancel` | Bearer |
| `bookings.shareDocuments` | POST | `/bookings/:id/documents` | Bearer |

## documents

| Action | Method | Path | Auth |
|---|---|---|---|
| `documents.upload` | POST | `/documents` | Bearer |
| `documents.list` | GET | `/documents` | Bearer |
| `documents.link` | POST | `/documents/:id/link` | Bearer |
| `documents.fetch` | GET | `/files/:token` | Public |
| `documents.delete` | DELETE | `/documents/:id` | Bearer |

## carePlans

| Action | Method | Path | Auth |
|---|---|---|---|
| `carePlans.list` | GET | `/care-plans` | Bearer |
| `carePlans.get` | GET | `/care-plans/:id` | Bearer |

## practitioner

| Action | Method | Path | Auth |
|---|---|---|---|
| `practitioner.appointments` | GET | `/practitioner/appointments` | Bearer |
| `practitioner.patients` | GET | `/practitioner/patients` | Bearer |
| `practitioner.patient` | GET | `/practitioner/patients/:id` | Bearer |
| `practitioner.me` | GET | `/practitioner/me` | Bearer |
| `practitioner.apply` | POST | `/practitioner/application` | Bearer |
| `practitioner.updateProfile` | PATCH | `/practitioner/profile` | Bearer |
| `practitioner.renewLicence` | POST | `/practitioner/licence-renewal` | Bearer |
| `practitioner.setAvailability` | PUT | `/practitioner/availability` | Bearer |

## consult

| Action | Method | Path | Auth |
|---|---|---|---|
| `consult.start` | POST | `/consult/:id/start` | Bearer |
| `consult.document` | POST | `/consult/:id/notes` | Bearer |
| `consult.carePlan` | POST | `/consult/:id/care-plan` | Bearer |
| `consult.complete` | POST | `/consult/:id/complete` | Bearer |
| `consult.noShow` | POST | `/consult/:id/no-show` | Bearer |
| `consult.providerCancel` | POST | `/consult/:id/cancel` | Bearer |
| `consult.requestReview` | POST | `/consult/:id/supervisor-review` | Bearer |

## supervisor

| Action | Method | Path | Auth |
|---|---|---|---|
| `supervisor.queue` | GET | `/supervisor/queue` | Bearer |
| `supervisor.decide` | POST | `/supervisor/reviews/:id` | Bearer |

## reviews

| Action | Method | Path | Auth |
|---|---|---|---|
| `reviews.create` | POST | `/reviews` | Bearer |
| `reviews.mine` | GET | `/reviews/mine` | Bearer |

## tickets

| Action | Method | Path | Auth |
|---|---|---|---|
| `tickets.create` | POST | `/tickets` | Bearer |
| `tickets.list` | GET | `/tickets` | Bearer |
| `tickets.reply` | POST | `/tickets/:id/messages` | Bearer |

## adverse

| Action | Method | Path | Auth |
|---|---|---|---|
| `adverse.create` | POST | `/adverse-events` | Bearer |
| `adverse.mine` | GET | `/adverse-events/mine` | Bearer |

## payments

| Action | Method | Path | Auth |
|---|---|---|---|
| `payments.initialize` | POST | `/payments` | Bearer |
| `payments.sandboxComplete` | POST | `/payments/:reference/sandbox` | Bearer |
| `payments.verify` | GET | `/payments/:reference/verify` | Bearer |
| `payments.webhook` | POST | `/paystack/webhook` | Public |
| `payments.get` | GET | `/payments/:reference` | Bearer |
| `payments.list` | GET | `/me/payments` | Bearer |

## cart

| Action | Method | Path | Auth |
|---|---|---|---|
| `cart.get` | GET | `/cart` | Bearer |
| `cart.setItem` | PUT | `/cart/items` | Bearer |

## checkout

| Action | Method | Path | Auth |
|---|---|---|---|
| `checkout.create` | POST | `/checkout` | Bearer |

## orders

| Action | Method | Path | Auth |
|---|---|---|---|
| `orders.list` | GET | `/orders` | Bearer |
| `orders.get` | GET | `/orders/:id` | Bearer |
| `orders.cancel` | POST | `/orders/:id/cancel` | Bearer |
| `orders.acknowledge` | POST | `/orders/:id/acknowledge` | Bearer |

## rx

| Action | Method | Path | Auth |
|---|---|---|---|
| `rx.create` | POST | `/rx-requests` | Bearer |
| `rx.list` | GET | `/rx-requests` | Bearer |

## earnings

| Action | Method | Path | Auth |
|---|---|---|---|
| `earnings.mine` | GET | `/earnings` | Bearer |

## org

| Action | Method | Path | Auth |
|---|---|---|---|
| `org.me` | GET | `/org/me` | Bearer |
| `org.apply` | POST | `/org/application` | Bearer |
| `org.renewLicence` | POST | `/org/licence-renewal` | Bearer |

## vendor

| Action | Method | Path | Auth |
|---|---|---|---|
| `vendor.products` | GET | `/vendor/products` | Bearer |
| `vendor.saveProduct` | POST | `/vendor/products` | Bearer |
| `vendor.submitProduct` | POST | `/vendor/products/:id/submit` | Bearer |
| `vendor.updateStock` | POST | `/vendor/products/:id/stock` | Bearer |
| `vendor.orders` | GET | `/vendor/orders` | Bearer |
| `vendor.advanceOrder` | POST | `/vendor/orders/:id/status` | Bearer |
| `vendor.rejectOrder` | POST | `/vendor/orders/:id/reject` | Bearer |
| `vendor.markUnavailable` | POST | `/vendor/orders/:id/unavailable` | Bearer |
| `vendor.rxList` | GET | `/vendor/rx-requests` | Bearer |
| `vendor.rxDecide` | POST | `/vendor/rx-requests/:id` | Bearer |
| `vendor.compliance` | GET | `/vendor/compliance` | Bearer |

## admin

| Action | Method | Path | Auth |
|---|---|---|---|
| `admin.overview` | GET | `/admin/overview` | Bearer |
| `admin.approvals` | GET | `/admin/approvals` | Bearer |
| `admin.setPractitionerStatus` | POST | `/admin/practitioners/:id/status` | Bearer |
| `admin.setOrgStatus` | POST | `/admin/orgs/:id/status` | Bearer |
| `admin.setProductStatus` | POST | `/admin/products/:id/status` | Bearer |
| `admin.care` | GET | `/admin/care` | Bearer |
| `admin.updateCareItem` | POST | `/admin/care/:id` | Bearer |
| `admin.updateAdverse` | POST | `/admin/adverse/:id` | Bearer |
| `admin.updateTicket` | POST | `/admin/tickets/:id` | Bearer |
| `admin.moderateReview` | POST | `/admin/reviews/:id` | Bearer |
| `admin.processPrivacy` | POST | `/admin/privacy/:id` | Bearer |
| `admin.finance` | GET | `/admin/finance` | Bearer |
| `admin.refund` | POST | `/admin/refunds` | Bearer |
| `admin.openDispute` | POST | `/admin/disputes` | Bearer |
| `admin.resolveDispute` | POST | `/admin/disputes/:id` | Bearer |
| `admin.runSettlement` | POST | `/admin/settlements` | Bearer |
| `admin.markPayout` | POST | `/admin/payouts/:id` | Bearer |
| `admin.reconcile` | GET | `/admin/reconcile` | Bearer |
| `admin.partnerFee` | POST | `/admin/partner-fees` | Bearer |
| `admin.updateSettings` | PUT | `/admin/settings` | Bearer |
| `admin.setFlags` | PUT | `/admin/flags` | Bearer |
| `admin.risk` | GET | `/admin/risk` | Bearer |
| `admin.unlockUser` | POST | `/admin/users/:id/unlock` | Bearer |
| `admin.setLicenceDate` | POST | `/admin/practitioners/:id/licence` | Bearer |

## demo

| Action | Method | Path | Auth |
|---|---|---|---|
| `demo.status` | GET | `/demo` | Public |
| `demo.advanceClock` | POST | `/demo/clock` | Public |
| `demo.outbox` | GET | `/demo/outbox` | Public |
| `demo.reset` | POST | `/demo/reset` | Public |
