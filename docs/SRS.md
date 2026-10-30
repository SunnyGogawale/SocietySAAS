# Society Management SaaS — Software Requirements Specification

**Status:** Draft for stakeholder review; not approved for implementation  
**Version:** 0.1  
**Date:** 2026-10-30  
**Scope:** Product requirements and acceptance baseline for a multi-tenant society/community management service

## 1. Purpose and repository context

This specification describes a SaaS product for managing residential societies/communities, their administrators, homes, owners, communications, service requests and financial records. The repository contained no application source, existing product documentation, or architectural decisions at the time this document was prepared. These documents are therefore a proposed baseline, not a description of existing behavior. Do not start business-module implementation until stakeholders review and approve the unresolved decisions in §13.

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** express requirement strength. A requirement marked as a proposal is subject to review. Acceptance criteria and dependencies for all scoped features are indexed in [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md).

## 2. Product objectives and success

The service should:

1. Let a platform operator onboard and support multiple independent societies.
2. Let each society administer its own membership, homes, notices, service requests, and financial records.
3. Give verified house owners convenient, appropriately limited access to their society information and actions.
4. Preserve confidentiality between tenants, provide attributable administrative actions, and produce trustworthy financial records.
5. Support web and mobile usage through consistent backend contracts without duplicating authorization or business rules in clients.

Product success measures, targets, reporting period, and instrumentation are **open decisions**. Candidate measures include society onboarding completion, active owner adoption, payment completion where enabled, request resolution time, and support burden. Do not treat these candidates as committed KPIs.

## 3. Users, roles, and authorization

The three primary product roles are **Super Admin**, **Society Admin**, and **House Owner**. They are defined in [ROLE_PERMISSION_MATRIX.md](./ROLE_PERMISSION_MATRIX.md). Authorization MUST be enforced by the backend on every request and object access; hiding a screen or button is not authorization.

- A principal may have different roles in different tenant contexts. A request that acts for a society MUST name or unambiguously resolve that context.
- A Super Admin is a platform-level operator, not an implicit owner of every society's data. Any support access to tenant data MUST be explicitly authorized, scoped, time-bounded where practical, and audited.
- A Society Admin can administer only assigned society tenant(s), subject to their grant.
- A House Owner can access only their verified membership and permitted home(s); ownership or occupancy status must not be inferred from a client-supplied identifier.
- Role grants, tenant membership, ownership, and verification state are distinct concepts. Define exactly which person may hold more than one role in the same tenant before implementation.
- No unauthenticated access to tenant data is allowed, except explicitly published public content if approved.
- Delegated roles (for example, committee member, treasurer, tenant/renter, property manager, auditor) are not part of MVP pending decision.

## 4. Product scope

### 4.1 Proposed MVP capability set

The proposed MVP is the smallest coherent society-management service:

1. Platform-managed tenant onboarding and Society Admin assignment.
2. Authentication, invitations, membership verification, role-scoped access, and account lifecycle.
3. Society profile, homes/units, and owner-to-home relationships.
4. Society announcements and owner-facing notices.
5. Maintenance/service requests with status, assignment, comments, and history.
6. Manually recorded charges, receipts/payments, expenses, and basic financial reporting, subject to jurisdiction/accounting review. External payment collection is not assumed to be in MVP.
7. An attributable audit trail for security-sensitive and financial changes.
8. Responsive Web access for administrators and a React Native Mobile read-only property/profile journey for House Owners; additional mobile workflows, offline behavior, and release support remain unresolved.

Feature boundaries and acceptance/dependency identifiers are in [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md). Whether payment collection, document storage, push notifications, and additional native mobile workflows are MVP items must be decided before planning.

### 4.2 Exclusions from proposed MVP

Unless explicitly promoted during review, the MVP excludes accounting/tax filing, bank integrations, automated payment collection, biometric access, visitor/access-control systems, facility booking, vendor marketplace, payroll, IoT, legal case management, AI decisions, and resident social networking. Exclusion does not preclude future interfaces.

## 5. System context and client/backend boundaries

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the logical boundary and [MODULE_WORKFLOWS.md](./MODULE_WORKFLOWS.md) for end-to-end flows.

### 5.1 Web client

- MUST present role- and tenant-appropriate workflows and clearly identify the active society.
- MAY perform presentation, local form validation, and transient client-side state management.
- MUST NOT be authoritative for permission checks, balances, status transitions, payment state, or tenant scope.
- MUST communicate through the documented authenticated API; no direct database access.

### 5.2 Mobile client

- The product MUST provide owner journeys usable on mobile-sized screens. The current implementation includes a React Native read-only property/profile view; native distribution, supported OS versions, and offline behavior remain unresolved.
- Any mobile client MUST use the same backend authorization, validation, and business rules as web.
- MUST protect locally cached data, avoid persisting credentials in insecure storage, and handle session expiry and offline state explicitly.
- Offline writes, push notification delivery, app-store distribution, and supported OS versions are unresolved and MUST NOT be assumed.

### 5.3 Backend

- MUST authenticate principals, resolve and validate tenant context, authorize actions and object scope, validate input, and enforce state transitions and financial invariants.
- MUST expose versioned API contracts and return stable error shapes.
- MUST be the source of truth for membership verification, balances/ledger entries, payment status, audit records, and tenant data access.
- MUST make tenant isolation an invariant across reads, writes, background jobs, exports, search, caches, and support tools.
- MUST prevent a client-provided tenant, home, owner, or record identifier from bypassing relationship checks.

## 6. Functional requirements

Detailed workflow and state requirements appear in [MODULE_WORKFLOWS.md](./MODULE_WORKFLOWS.md). Feature IDs, testable acceptance criteria, and prerequisite dependencies appear in [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md).

### 6.1 Platform and tenant lifecycle

- The platform MUST accept society registration requests and allow only Super Admins to review, approve, reject, provision, configure, suspend, reactivate, and archive society tenant records.
- Approval MUST validate the society profile, configure an explicitly selected subscription plan/trial, invite a primary Society Admin, and audit the resulting lifecycle action.
- Subscription plans MUST support configurable limits and subscription status/trial periods. Billing, payment collection, currencies/pricing policy, and limit policy beyond implemented member invitation limits remain separate decisions.
- Super Admins MUST be able to inspect platform audit events, cross-tenant support tickets, system/database status, and aggregate operational error counts. These controls MUST NOT grant routine access to tenant business content.
- A tenant MUST have a stable internal identifier and explicit status; tenant display names are not identifiers.
- Society Admin assignment MUST be explicit, auditable, and scoped. Suspending a tenant MUST block ordinary tenant operations without silently deleting its records; reactivation MUST restore access only where a current active membership remains.
- Tenant deletion, data retention, offboarding/export, and restoration policy are open decisions; do not implement destructive deletion before they are approved.

### 6.1.1 Society configuration

- An active Society Admin MUST be able to update the society's name, address, contact details, registration number, and HTTPS logo URL. Direct image upload and managed asset storage are not included until a storage/retention policy is approved.
- Society settings MUST cover IANA time zone, ISO currency code, supported display date format, financial-year start, and building/wing/flat numbering patterns. The server validates all values, including calendar-valid financial-year dates.
- Configurable visitor, complaint target, notification-channel, facility-booking, brand-color, and approval-policy settings are stored as tenant-scoped configuration. Saving these settings does not imply the corresponding visitor, complaint, notice, expense, or booking workflows are implemented.
- Maintenance charge rules MUST include frequency, charge definitions, recurring discounts, due day, monthly percentage late-fee rate and cap, grace period, and effective date. The society area unit is configured once and must match every flat and per-area rule; conversion is not performed. Every change creates an immutable, versioned rule record; rules cannot be backdated. Existing issued bills MUST retain their original financial snapshot and MUST NOT be recalculated by a settings edit.
- Notification templates are configurable and validated, but delivery, localization, variable rendering, and template preview remain outside this phase.
- Society Admins can read and write settings for the active authorized tenant. House Owners can read only resident-facing society identity, locale, numbering, and charge schedule; they cannot read administrative policies/templates or modify settings. The same tenant-context and membership checks apply to Web and Mobile APIs.
- Every successful configuration change MUST write a tenant-scoped audit event that records the section and, for charge rules, the new revision/effective date, without copying private contact details or template content into audit metadata.

### 6.2 Identity, membership, and home records

- Users MUST authenticate through an approved identity mechanism and have a unique principal identifier independent of email/phone changes.
- Invitations MUST be tenant-scoped, expire or be revocable, and be single-use or otherwise replay-safe.
- A Society Admin MUST be able to maintain society profile, home/unit records, owner assignments, and membership status within authorized scope.
- An owner must be verified/approved before receiving access to protected society records. Verification evidence and acceptable approvers are open decisions.
- Ownership changes MUST preserve historical relationships and their effective period; they MUST NOT overwrite history or transfer balances implicitly.
- The current relationship model supports multiple owners per home and multiple homes per owner. For billing, one bill belongs to the flat and owners whose ownership period intersects the bill period may view/pay it; broader sharing of resident-facing data among co-owners remains unresolved.

### 6.2.1 Property and resident management (SOC-03)

- Society Admins MUST be able to create and list buildings, optional wings, floors, and flats. A flat MUST reference a building and floor; parent records MUST belong to the same authorized society. Duplicate flat numbers are rejected within the same building/wing; identical identifiers in different buildings remain permitted.
- Flat records MUST include area, property type, and derived occupancy status. The server recalculates occupancy status from current owner and occupancy relationships rather than accepting a client-supplied status.
- Every flat area MUST include an explicit unit (`square_foot` or `square_metre`). Under approved D-20, one unit is configured per society, every flat and per-area charge rule must match it, and conversions are not performed.
- A flat MAY have multiple current owners/co-owners. Owner invitations are tied to the active society and selected flat; a linked owner receives access only after the existing invitation/verification/activation policy succeeds. Existing active House Owner memberships can be linked without issuing a duplicate invitation.
- Ownership and occupancy changes MUST be time-stamped and retained as history. Ending the last active property relationship revokes the associated membership; access MUST be denied on the next request. Ending one link MUST NOT revoke a member who retains another active ownership or occupancy.
- Society Admins MAY record tenant and authorized-occupant details, move-in/move-out dates, lease references, owner-linked vehicles, parking slots, and parking assignments. Occupancy end dates must follow start dates. Active parking assignments MUST NOT conflict for a slot or vehicle, and a reserved slot MUST only be assigned to its designated flat.
- Future-dated occupancy activation is unresolved; until a scheduling policy is approved, an occupancy may be recorded only on or after its move-in date.
- Owner clients MUST expose only the current member's own property/profile projection. Tenant-scoped property and resident lists, search, pagination, sorting, imports, exports, and downloadable import error reports MUST apply the same authorization as direct reads. Sensitive CSV exports and import-error downloads are audited. Imports accept at most 500 validated JSON rows and report per-row failures; CSV file upload is not part of this phase.
- Historical ownership, occupancy, vehicle, and parking records are ended rather than hard-deleted. Ending a relationship MUST NOT create, recalculate, or alter any maintenance invoice or other historical financial record.
- SOC-03 does not calculate or persist invoices; the separate FIN-01/02 billing workflow uses the approved property ownership and area-unit rules.

### 6.3 Announcements and documents

- Authorized administrators MUST be able to publish, update, unpublish, and target a notice to its approved audience.
- A notice MUST record author, publication state/time, and tenant. Owners MUST see only notices they are eligible to view.
- Document storage, allowed formats, size limits, malware scanning, retention, and public/private classifications are unresolved. If enabled, files MUST be access-checked through the backend and MUST NOT be exposed by guessable public URLs.

### 6.4 Service requests

- An eligible owner MUST be able to create a request for an authorized home, view its status/history, and add permitted updates.
- Society Admins MUST be able to triage, assign, transition, and close requests within their tenant.
- Every transition MUST validate the current state and actor permission and record who changed what and when.
- Categories, urgency levels, response targets, visibility of internal notes, attachment handling, and requester reopen policy are unresolved.

### 6.5 Financial records

- The system MUST distinguish a charge/assessment, a receipt/payment, an expense, a refund/reversal, and an adjustment; a balance is derived from posted financial records, not an editable number.
- Every financial record MUST be tenant-scoped, associated with the relevant home/member where appropriate, use an explicit currency and effective/recorded timestamps, and have a status and attribution.
- Posted records MUST NOT be silently edited or deleted. Corrections MUST use an authorized reversal/adjustment linked to the original, preserving both records and audit history.
- Calculations MUST use integer minor units and fixed-precision arithmetic, never binary floating point. The configured ISO currency determines minor-unit precision; calculations round half up.
- Recurring charges MUST snapshot the selected immutable charge-rule revision, flat area and unit, ownership days, period days, component rates, discounts, due date, currency, and calculated amounts.
- A recurring run MUST identify eligible flats and calculate every configured fixed-per-flat and per-area charge before review. A billing period MUST match the configured frequency; area-based rules and flat areas MUST use the one configured society area unit, with no automatic conversions.
- Partial-period charges MUST prorate by actual society-local calendar days using inclusive ownership start/end dates. Multiple co-owners share one bill for the flat; each owner whose ownership interval intersects the billing period may view it. Until a payment channel is approved, Society Admins record externally completed payments as manual receipts; owners cannot mark an invoice paid.
- A bill MUST pass draft, review, approval, and issue states. The server MUST prevent an active duplicate for the same flat and period. Issued records are immutable; an unpaid bill with no issued adjustment may be cancelled with approval and a reason, then replaced by an explicitly numbered revision. Other corrections use linked credit/debit notes.
- Discounts MUST be captured as bill items before issue. Credits, debit adjustments, and penalties MUST have a reason and Society Admin approval. An issued late-fee note is system-generated from the bill's rule snapshot and is idempotent by bill and month.
- A Society Admin MUST record manual receipts with payer, method, amount, currency, timestamp, and reference. Partial receipts are permitted. Automatic allocation is FIFO by oldest due bill; Society Admins may instead provide explicit allocations. Excess receipts remain unapplied and are automatically applied to future bills for the same flat and payer. Issued credit notes first reduce their source invoice; any excess is carried forward FIFO to future issued bills for that flat whose owner snapshot intersects the credit note's owner snapshot. Allocation changes MUST be audited.
- Opening balances MUST be imported from verified prior records with a source reference and exact batch-total reconciliation; imported entries remain drafts until approved and issued. Unpaid issued bills remain part of the flat's carried-forward account balance and ageing report.
- Monthly late fees MUST apply only to overdue principal after the configured due date and grace period; previous fees/penalties are excluded from the calculation base. The monthly fee uses the bill's configured rate, half-up rounding, and a configured cumulative cap.
- Bill details MUST show itemized charges, due date, invoice outstanding, flat account outstanding, linked adjustments, and payment allocations. Authorized Society Admins and entitled owners MUST be able to download an audited PDF. Due reminders are in-app only in this phase.
- The service MUST not claim that a manually entered receipt represents settlement by a bank/payment processor. No processor integration, bank reconciliation, expense ledger, or general-ledger posting is included.
- Tax treatment, statutory reporting, jurisdictional accounting compliance, fiscal close, full chart of accounts, refunds/chargebacks, cash control, delivery channels beyond in-app, and handling of negative credit balances remain unresolved.

### 6.6 Notifications

- In-product notification state and delivery channels MUST be distinguishable. Sending an email/SMS/push MUST not itself change the business state.
- Notification attempts SHOULD be retryable and idempotent and MUST avoid duplicate user-visible actions where possible.
- Providers, consent/legal basis, templates, locale, delivery guarantees, and MVP channels are unresolved.

### 6.7 Reporting and export

- Reports MUST be scoped to tenant and authorized audience, identify their as-of time and currency, and define included/excluded statuses.
- Financial totals MUST be reproducible from the underlying records and consistent with the approved allocation/rounding policy.
- Exports MUST apply the same authorization and privacy rules as interactive views and be audited when sensitive.
- Exact report catalog, formats, limits, and data-retention rules are unresolved.

## 7. Data and entity relationships

The proposed conceptual entities and Mermaid ERD are in [DATABASE_ERD.md](./DATABASE_ERD.md). They are logical requirements, not a selected database schema. Tenant-owned records MUST carry or derive an unambiguous tenant identity and be protected by tenant-aware data access. Identifiers, deletion strategy, owner/unit cardinality, and jurisdictional fields remain review decisions.

Core relationships include tenant-to-memberships, tenant-to-homes, home-to-time-bounded ownership/membership, notices and requests to their tenant and actors, and financial records to tenant plus their applicable home/account. Financial corrections link to the original record. Audit events identify actor, tenant context, action, target, time, and outcome without storing unnecessary sensitive payloads.

## 8. API conventions

The API is a client/backend contract, not an implementation technology selection.

- Use HTTPS in production; publish a version prefix (proposed `/api/v1`) and machine-readable OpenAPI contract.
- Use resource-oriented nouns, consistent plural collection names, JSON request/response bodies, and stable opaque IDs. Do not encode authorization in obscurity of identifiers.
- Authenticate with an approved standard. Resolve tenant context explicitly (proposed tenant-scoped routes or a validated tenant context claim/header); the exact mechanism is an open decision. Never trust a client-supplied tenant context without verifying membership.
- Validate all input on the server. Define required/optional fields, formats, lengths, enum values, and compatibility/versioning rules.
- Use a consistent success envelope only if it improves client consistency; errors MUST at minimum expose a stable machine code, safe human-readable message, and request/correlation ID. Never return stack traces, secrets, or cross-tenant existence signals.
- Use appropriate HTTP semantics: 401 unauthenticated, 403 unauthorized (or a deliberate non-disclosing 404 policy), 404 absent/inaccessible resource as documented, 409 state/conflict, 422 invalid domain input, and 429 rate limited. Exact policy must be consistent.
- List endpoints MUST have bounded pagination, stable ordering, and tenant/permission filters applied before returning results. Default/max page size is an open decision.
- Mutation endpoints MUST prevent duplicate financial or state-changing effects on retries; define idempotency key semantics for relevant operations.
- Use optimistic concurrency or equivalent conflict detection for updates that could overwrite concurrent changes. Exact mechanism is open.
- Dates MUST be unambiguous (ISO 8601/RFC 3339 with offset or UTC); currency MUST accompany monetary values. Locale formatting belongs at presentation layer.
- API logs and error responses MUST redact credentials, payment data, and unnecessary personal data.

## 9. Financial rules and controls

The detailed financial invariants in §6.5 apply across UI, API, reports, exports, jobs, and integrations. Additional baseline controls:

1. Define whether the system is a convenience sub-ledger or a legally authoritative accounting system before release.
2. A financial event has a stable ID, tenant, type, status, amount, currency, relevant dates, actor/source, and any allocation/reference needed to explain its effect.
3. Draft records do not affect reported posted balances. A transition to posted is permission-checked, validated, and atomic with its audit event.
4. A payment/receipt allocation MUST not exceed its applicable remaining allocable amount unless an explicit approved policy permits credit balances/unallocated funds.
5. Payment-provider callbacks, if added, MUST be authenticated, replay-safe, idempotent, and reconciled; client redirects alone MUST NOT establish payment success.
6. Refunds, chargebacks, reversals, write-offs, and adjustments retain immutable links to their source and actor.
7. Totals group by currency; never combine unlike currencies without an approved exchange-rate source, rate timestamp, and conversion policy.
8. Reports MUST specify treatment of drafts, reversals, unapplied amounts, and cut-off dates.
9. Financial actions MUST be attributable; privileged override and manual status changes require explicit permissions and auditable reason.

## 10. Security, audit, privacy, and operations

### 10.1 Security

- Apply least privilege, deny by default, server-side authorization, tenant-aware object checks, and secure session lifecycle.
- Protect data in transit and at rest using platform-approved controls; key management and cryptographic algorithms follow the selected hosting/provider standards.
- Store passwords only using a modern adaptive password hash if passwords are selected; do not store plaintext or reversible passwords. Prefer an approved identity provider where appropriate.
- Protect against common web/API threats: injection, broken access control, CSRF where applicable, XSS, SSRF, unsafe uploads, brute force, replay, and mass assignment.
- Apply rate limits and abuse monitoring to authentication, invitation, export, and sensitive mutation endpoints.
- Secrets MUST come from a managed secret store, not source code or client bundles.
- Perform security review and dependency/vulnerability management before production; define incident response and vulnerability disclosure process.

### 10.2 Audit

- Audit security-sensitive actions, role/membership changes, tenant lifecycle, financial state changes, exports, and support access.
- An event SHOULD include actor, effective role, tenant, action, target type/ID, timestamp, outcome, correlation ID, and change summary sufficient for accountability.
- Audit data MUST be append-only to ordinary application actors and protected from unauthorized alteration or deletion.
- Do not place passwords, tokens, full payment credentials, or unnecessary personal/sensitive field values in audit payloads.
- Retention, access, export, and tamper-evidence requirements require jurisdiction/product approval.

### 10.3 Privacy

- Collect only data necessary for defined product purposes; document purpose, access, retention, and deletion per data category.
- Provide a defined process for access/correction/deletion requests while preserving legally required financial/audit records.
- Prevent cross-tenant search, analytics, support tooling, exports, and backups from exposing data.
- Data residency, privacy jurisdiction, legal bases, consent, data-subject rights, age policy, and retention periods are unresolved and must be approved before launch.
- Use synthetic or redacted data in development/test by default; production data in non-production requires explicit approval and safeguards.

### 10.4 Backups and recovery

- Backups MUST be encrypted, access-controlled, monitored, and separated from the primary failure domain.
- Define and test backup frequency, retention, restore procedure, point-in-time recovery, and tenant-level recovery policy.
- Set business-approved Recovery Point Objective (RPO) and Recovery Time Objective (RTO); numeric targets are unresolved.
- Conduct and record restore tests before production and periodically thereafter. A successful backup job alone is not proof of recoverability.
- Backup deletion/expiry MUST follow retention policy; backups must not become an undocumented permanent copy of deleted data.

## 11. Quality attributes and acceptance baseline

Numerical targets in this section are proposed targets for review, not commitments.

- **Availability:** define service hours, SLO, maintenance policy, and exclusions before launch; target unresolved.
- **Performance:** measure API latency and client experience at agreed representative load. Proposed starting target: p95 under 500 ms for ordinary non-report API reads and p95 under 800 ms for writes, excluding external provider latency. Load level, dataset, region, and percentile window require approval.
- **Scale:** set initial tenants, homes per tenant, concurrent users, and growth assumptions before capacity sign-off.
- **Reliability:** state-changing requests should be idempotent where safe; background retries must not duplicate financial effects.
- **Accessibility:** target WCAG 2.2 AA for supported web experiences, including keyboard navigation, visible focus, semantic labels, contrast, status announcements, and zoom/reflow. Assistive technology/browser support matrix needs approval.
- **Usability:** critical flows must work on approved supported browsers and mobile viewport sizes; browser/device matrix is unresolved.
- **Maintainability:** separate presentation, domain rules, persistence, and provider adapters; document operational ownership and API contracts.
- **Observability:** correlate requests and relevant jobs; monitor failures, latency, tenant-isolation denials, queue health, and backup/restore health without logging secrets.
- **Localization:** store instants unambiguously; localize displayed dates, numbers, currency, and text. Initial language, locale, timezone defaults, and translation process are unresolved.
- **Compatibility:** API clients must handle additive optional fields and documented errors; breaking changes require versioning/deprecation policy.

## 12. Test and release requirements

- Every feature in the roadmap MUST meet its stated acceptance criteria and pass unit/domain, API/authorization, and relevant UI/integration tests.
- Tenant-isolation tests MUST exercise both allowed and denied access across at least two tenants, including list, detail, search, exports, background work, and identifier substitution.
- Financial tests MUST cover decimal precision, rounding, duplicate requests, allocation boundaries, reversal/adjustment, and report reconciliation.
- Security testing MUST include authorization-negative cases and approved threat-model findings; production launch requires a security review.
- Accessibility checks MUST include automated checks plus keyboard and screen-reader testing of critical journeys.
- Backup restore, monitoring/alerting, migration/rollback, and incident-response readiness MUST be demonstrated before production.
- Release gates, environments, rollout strategy, operational support hours, and rollback thresholds are unresolved.

## 13. Unresolved decisions — approval required

Do not silently choose defaults for these product or compliance decisions. Record an owner and approved answer before implementing the dependent feature:

| ID   | Decision                                                                                                                                                                 | Affected requirements/features    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| D-01 | Initial launch jurisdiction(s), applicable privacy, housing, tax, and accounting obligations                                                                             | FIN, privacy, retention, hosting  |
| D-02 | Accounting authority and fiscal-period policy: approved as authoritative for maintenance charges, receivables, and receipts; full general ledger, accounting basis, and period-close policy remain unresolved | FIN-01/02; future FIN-03/04 |
| D-03 | Approved: INR default; configured ISO currency precision; half-up rounding; ownership-date proration; monthly capped late fees on principal; FIFO receipt allocation and automatic carry-forward of unused receipt credit. Taxes, interest, negative balances/refunds, and jurisdictional rounding/compliance remain unresolved | FIN-01/02; future FIN-03/04 |
| D-04 | Approved for MVP: manually recorded receipts and in-app reminders only. Payment processors, settlement evidence, refunds, chargebacks, and bank reconciliation remain unresolved | FIN-02, NOTIF-01 |
| D-05 | Identity method, MFA requirement, password recovery, supported identity providers, and account uniqueness rules                                                          | IAM-01–IAM-03                     |
| D-06 | Whether one person can access multiple societies and which role combinations are allowed                                                                                 | IAM, tenant switching             |
| D-07 | Home-to-owner cardinality, renters/occupants/delegates, owner verification evidence and approver. Billing decision approved: one flat bill shared by owners whose ownership intersects its period; no owner apportionment | SOC-02, IAM-03, FIN-01 |
| D-08 | Commercial/access policy: trial expiry, subscription-status effects on access, pricing/billing, tenant suspension behavior, export, retention, deletion, and restoration | PLAT-01                           |
| D-09 | Mobile delivery: responsive web/PWA/native; supported OS/devices; offline and push behavior                                                                              | UX-01, NOTIF-01                   |
| D-10 | Document and attachment policy: storage, formats, limits, scanning, retention, and access                                                                                | DOC-01, REQ-01                    |
| D-11 | Communication channels, consent/legal basis, templates, language, delivery guarantees                                                                                    | NOTIF-01                          |
| D-12 | Service-request categories, urgency, internal notes, response targets, reopen and escalation policy                                                                      | REQ-01                            |
| D-13 | Approved reports, exports, formats, limits, and financial cutoff/status rules                                                                                            | REP-01                            |
| D-14 | Data residency, retention schedules, data-subject request handling, audit retention                                                                                      | SEC-04, PRIV-01                   |
| D-15 | Hosting/provider, deployment topology, database, identity provider, observability and key-management choices                                                             | Architecture                      |
| D-16 | Availability/performance/load targets, RPO/RTO, backup retention, support and incident response                                                                          | NFR/OPS                           |
| D-17 | Supported languages, locales, time zones, browsers and assistive-technology test matrix                                                                                  | UX-01, accessibility              |
| D-18 | Tenant-admin count, Super Admin support access procedure, break-glass authorization and review cadence                                                                   | IAM-02, AUD-01                    |
| D-19 | Success measures, pricing model, onboarding/support ownership                                                                                                            | Product operations                |
| D-20 | Approved: configure one society-wide area unit (square foot or square metre), require matching flat and charge-rule units, and perform no automatic conversion | SOC-03, FIN-01 |

## 14. Approval and change control

Reviewers should approve or amend this document set and resolve the decisions relevant to the first release. Changes to a requirement, permission, workflow, financial invariant, data model, or acceptance criterion must update the related documents and feature IDs together. Until approval, this SRS is a discussion baseline and authorizes no business-module implementation.
