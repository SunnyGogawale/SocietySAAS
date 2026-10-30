# SocietySAAS

JavaScript monorepo foundation for the Society Management SaaS, with separate web,
mobile, and backend applications. This repository currently contains application
shells and shared infrastructure only; no society-management business workflows have
been implemented.

The Phase 1 specification is in [`docs/`](./docs/). The SRS and related documents
remain a review baseline: complete the roadmap's specification approval gate and
resolve applicable open decisions before building business modules.

## Applications

| Workspace                    | Stack                          | Purpose                                                 |
| ---------------------------- | ------------------------------ | ------------------------------------------------------- |
| `@societysaas/web`           | React, Vite, JavaScript        | Responsive administrator/owner web shell                |
| `@societysaas/mobile`        | React Native, Expo, JavaScript | Native-capable mobile navigation and screen shell       |
| `@societysaas/backend`       | Node.js, Express, Mongoose     | Versioned API foundation and health/readiness endpoints |
| `@societysaas/design-tokens` | JavaScript, CSS                | Shared colors, typography, spacing, and radii           |

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

## API foundation

- `GET /api/v1/health` is a liveness check and reports MongoDB connectivity.
- `GET /api/v1/ready` returns readiness (`200` when MongoDB is connected, otherwise
  `503`).
- Success responses use `{ "success": true, "data": ... }`.
- Errors use `{ "success": false, "error": { "code": "...", "message": "..." },
"requestId": "..." }`.
- Requests accept a configurable JSON/form body size limit. CORS origins, port,
  logging level, and MongoDB URL are environment-configurable.

No sample account, tenant data, business endpoint, or seeded database is included.

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
coupling HTTP handlers, validation, data models, or persistence. Empty domain
directories intentionally contain no business logic.

## Operational notes

- Configure CORS with an explicit comma-separated allowlist in
  `apps/backend/.env`; do not use a wildcard with credentialed requests.
- Use TLS and managed secrets in deployed environments. The example configuration
  is for local development and does not replace production hardening.
- Health endpoints contain no user or tenant data. The readiness endpoint is
  intended for dependency-aware orchestration.
- `docs/IMPLEMENTATION_ROADMAP.md` defines feature acceptance criteria and
  dependencies. No feature work should start before the specification is approved.

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
- `npm audit --omit=dev` currently reports transitive advisories in the Expo CLI /
  config toolchain (`deepmerge` and the CLI's nested Zod). npm only offers a forced
  downgrade to Expo SDK 54 as an automated fix; that breaking SDK downgrade was
  not applied. Review and update the Expo toolchain when a compatible patched
  release is available.
- The backend test and build commands do not require a running MongoDB. Starting
  the backend server does: it connects to `MONGODB_URI` before listening.
- No MongoDB server was accepting connections on `127.0.0.1:27017` during
  validation, so a live backend/server smoke test was not possible. Health,
  readiness, validation, CORS, security-header, and request-size behavior were
  exercised through the automated API tests.
