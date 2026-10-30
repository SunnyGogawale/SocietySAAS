# SocietySAAS

JavaScript monorepo for the Society Management SaaS, with separate web, mobile, and
backend applications. The platform currently includes authentication, the
Super Admin tenant/subscription/support console, Society Admin configuration,
and property and resident management. Society accounting and maintenance billing
workflows have not been implemented.

The product specification is in [`docs/`](./docs/). Decisions that affect financial
rules, payment processing, retention, and other not-yet-built modules remain open;
this implementation does not assume those policies.

## Applications

| Workspace                    | Stack                          | Purpose                                                             |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `@societysaas/web`           | React, Vite, JavaScript        | Super Admin console and Society Admin property/settings workspaces  |
| `@societysaas/mobile`        | React Native, Expo, JavaScript | House Owner property/profile and society settings views             |
| `@societysaas/backend`       | Node.js, Express, Mongoose     | Versioned API, authentication, tenant security, and property models |
| `@societysaas/design-tokens` | JavaScript, CSS                | Shared colors, typography, spacing, and radii                       |

## Prerequisites

- Node.js 22.21 or a compatible Node 22 LTS release
- npm 10+
- MongoDB for backend readiness and local API development
- Xcode/iOS Simulator or Android Studio/emulator for running a native mobile build

Mobile bundles can be exported without implementing product workflows; launching a
simulator additionally requires the corresponding native toolchain.

## Quick start

```sh
npm install
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.example apps/web/.env
# Set MONGODB_URI in apps/backend/.env for a reachable local MongoDB instance.
npm run dev:backend
npm run dev:web
npm run dev:mobile
```

The applications are separate processes. The backend listens on port `4000` by
default; Vite uses `5173`; Expo uses its normal development server. Environment
examples contain placeholders only. Never commit `.env` files or real credentials.
Configure SMTP values in `apps/backend/.env` before issuing invitations or enabling
email verification. A reset request stays deliberately generic when SMTP is not
configured; no reset email is sent in that case.

## API foundation

- `GET /api/v1/health` is a liveness check and reports MongoDB connectivity.
- `GET /api/v1/ready` returns readiness (`200` when MongoDB is connected, otherwise
  `503`).
- Success responses use `{ "success": true, "data": ... }`.
- Errors use `{ "success": false, "error": { "code": "...", "message": "..." },
"requestId": "..." }`.
- Requests accept a configurable JSON/form body size limit. CORS origins, port,
  logging level, and MongoDB URL are environment-configurable.
- `POST /api/v1/auth/login`, `/auth/logout`, `/auth/me`, `/auth/profile`,
  `/auth/password/forgot`, `/auth/password/reset`, `/auth/email/verify`, and
  `/auth/invitations/accept` provide authentication and account lifecycle.
- `GET /api/v1/auth/societies` lists the caller's active society memberships.
  `POST /api/v1/auth/societies/:societyId/select` verifies and stores the selected
  society on the server-side session.
- Platform society and tenant membership endpoints are protected by platform role,
  active membership, and permission middleware; see the backend route modules.
- `POST /api/v1/platform/registrations` accepts society registration submissions.
  Super Admin-only endpoints under `/api/v1/platform` review and provision tenants,
  manage subscriptions/plans, inspect audit events, and track support tickets.
- Society Admin support tickets use the tenant-scoped
  `/api/v1/societies/:societyId/support-tickets` endpoints and are inaccessible
  outside the selected active membership.
- `GET/PATCH /api/v1/societies/:societyId/settings` provides tenant-scoped society
  configuration. Active members can read the allowed settings projection; Society
  Admins can update profile, locale, operational rules, charge-rule revisions,
  approval policies, and notification templates. House Owners receive a restricted
  read-only projection.
- Society Admin APIs under `/api/v1/societies/:societyId` manage buildings, wings,
  floors, flats, owner invitations/links, occupancy history, vehicles, parking,
  resident/property lists, imports, and authorized CSV exports. House Owner property
  reads are scoped to active linked flats.

Maintenance charge-rule updates append immutable, dated revisions. They do not
recalculate previously issued bills; the repository does not yet include issued
bills or a billing engine. Logo configuration currently accepts an HTTPS asset URL;
file upload/storage, notification delivery, and the configured operational
workflows remain out of scope.

Property imports accept validated JSON batches (up to 500 records) with a
tenant-scoped CSV error report; CSV upload is not implemented. Property and
resident changes preserve relationship history and do not create or alter
maintenance invoices.

## Authentication setup

The web client uses an `HttpOnly`, `SameSite=Strict` session cookie plus a
double-submit CSRF token for writes. The mobile app requests bearer sessions and
stores the opaque session token with Expo SecureStore. The backend stores only a
SHA-256 digest of session and one-time tokens, hashes passwords with bcrypt, and
audits sign-in, sign-out, denied access, invitations, membership changes, and
password/email verification events.

Create the initial platform administrator once, after starting MongoDB and setting
the backend `.env`:

```sh
npm run admin:create-super-admin --workspace @societysaas/backend
```

The password is prompted without echo. The script refuses to create another
platform administrator once one exists. Then sign in as that administrator.
Prospective societies can submit through the Web sign-in page or registration API;
the Super Admin reviews the registration, selects a plan and explicit trial duration,
and provisions the tenant with a primary Society Admin invitation.

Society-scoped APIs require an active server-selected membership. Each request
revalidates that membership and the active society; changing the URL, request
body, or query parameter cannot change authorization scope. Revoked memberships
stop authorizing the next request.

No sample account, tenant data, or seeded database is included. Society accounting,
maintenance invoices/billing, and payment processing endpoints are not implemented.

## Scripts

```sh
npm run lint
npm run format:check
npm run test
npm run build
```

Workspace scripts:

```sh
npm run dev --workspace @societysaas/web
npm run dev --workspace @societysaas/mobile
npm run dev --workspace @societysaas/backend
npm run build --workspace @societysaas/web
npm run build --workspace @societysaas/mobile
```

The backend tests use Node's built-in test runner; web tests use Vitest; mobile
foundation tests use Node's test runner. `npm run build` runs each workspace's
available build script.

## Project layout

```text
apps/
  backend/src/{config,controllers,db,middleware,models,routes,services,utils,validators}
  mobile/src/{components,navigation,screens}
  web/src/{components,layouts,pages}
packages/
  design-tokens/
docs/
```

Backend layers are separated so future features can add domain code without
coupling HTTP handlers, validation, data models, or persistence.

## Super Admin platform console

The Web console is available to authenticated Super Admins at `/`. It includes a
platform dashboard, tenant review/search/filter/sort/pagination and CSV export,
society profile and primary-admin management, tenant suspension/reactivation/archive,
subscription plan configuration and per-tenant subscription status/trial controls,
support-ticket tracking, and paginated platform audit logs/exports. Backend routes
independently enforce the Super Admin role; Society Admins receive `403` for
platform-wide records and controls.

Tenant statuses are `pending_review`, `provisioning`, `rejected`, `active`,
`suspended`, and `archived`. Approval configures the subscription and sends the
registered contact an invitation; the society is marked active after the invitation
has been issued. A failed provision remains retryable as `provisioning`. Suspension
blocks tenant-scoped requests without revoking membership or erasing data;
reactivation restores access when the membership remains active. Archived societies
cannot be reactivated or hard-deleted through the platform API.

Plans carry optional member/home/storage limits. The member limit is applied to
tenant invitations; no home or storage business modules are enabled. Trial duration
is explicitly supplied during provisioning. Optional plan prices use integer minor
currency units and require a currency code; payment collection and invoicing are
not implemented. Subscription status does not automatically alter tenant access:
active society status and active membership currently determine API access; no
trial-expiry job or automatic suspension policy is enabled. Support ticket records
do not grant access to tenant records.

## Operational notes

- Configure CORS with an explicit comma-separated allowlist in
  `apps/backend/.env`; do not use a wildcard with credentialed requests.
- The default rate-limit store is process-local. Configure a shared rate-limit
  store before running multiple backend instances behind a load balancer.
- Use TLS and managed secrets in deployed environments. The example configuration
  is for local development and does not replace production hardening.
- Health endpoints contain no user or tenant data. The readiness endpoint is
  intended for dependency-aware orchestration.
- `docs/IMPLEMENTATION_ROADMAP.md` defines feature acceptance criteria and
  dependencies. Financial and maintenance billing modules remain out of scope.

## Validation and dependency notes

- The first `npm install` with npm 10.9.4 hit an npm Arborist peer-tree resolver
  exception. Retrying with `npm install --legacy-peer-deps` completed, and
  subsequent dry-run and standard `npm install` commands succeeded using the
  generated lockfile. If a clean install hits the same resolver exception, retry
  with `npm install --legacy-peer-deps`.
- `npx expo install --check` reports the React Native package versions are
  compatible with the selected Expo SDK.
- npm marks the installed ESLint 9 release unsupported. The selected React and
  React Native ESLint plugins currently declare peer support only through ESLint
  9, so the scaffold retains ESLint 9 until compatible plugins or a suitable
  replacement linter are available.
- `npm audit` currently reports 8 transitive advisories (3 high, 5 low) in the Expo
  CLI/config toolchain (`deepmerge` and the CLI's nested Zod). npm only offers a
  forced downgrade to Expo SDK 54 as an automated fix; that breaking SDK downgrade
  was not applied. Review and update the Expo toolchain when a compatible patched
  release is available.
- The backend test and build commands do not require a running MongoDB. Starting
  the backend server does: it connects to `MONGODB_URI` before listening.
- No MongoDB server was accepting connections on `127.0.0.1:27017` during
  validation, so a live backend/server smoke test was not possible. Health,
  readiness, validation, CORS, security-header, and request-size behavior were
  exercised through the automated API tests.
