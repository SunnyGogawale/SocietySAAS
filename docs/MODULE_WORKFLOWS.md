# Module Workflows and State Requirements

**Status:** Draft for review. Feature IDs and testable acceptance criteria are indexed in [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md).

## 1. Shared workflow rules

- Backend validation and authorization are authoritative for every transition.
- Each mutation has an actor, tenant context, timestamp, request/correlation ID, and auditable outcome where required.
- A retry must not duplicate a state-changing or financial effect. Conflicts return a documented conflict response rather than silently overwriting newer state.
- Tenant suspension blocks ordinary tenant work; it does not erase existing records.
- States below are proposed minimum states. Naming, timing, and policy-specific transitions need stakeholder approval.

## 2. Tenant onboarding and lifecycle (PLAT-01)

1. A registrant submits a society profile and primary admin contact; the request enters `pending_review`.
2. Super Admin reviews the submitted profile and either records a reasoned rejection or chooses an active subscription plan and explicit trial duration.
3. Approval records `provisioning`, configures the subscription and plan-limit snapshot, and issues a single-use Society Admin invitation to the registered contact.
4. After the invitation is issued, the tenant becomes `active`; the invited Society Admin accepts and authenticates.
5. Super Admin can update the tenant profile, select an active primary admin, invite additional Society Admins, suspend/reactivate an active tenant, or archive it. Every platform mutation is audited.
6. Suspension blocks tenant-scoped APIs without deleting membership/history. Archiving is terminal in the platform API. Hard deletion remains unavailable pending retention/offboarding policy.

**Implemented tenant states:** `pending_review → provisioning → active ↔ suspended`, `pending_review → rejected`, and `active/suspended → archived`. Failed provisioning remains retryable in `provisioning`.

**Subscription setup:** Plans define optional limits; provisioning copies the plan limits to the subscription, and plan-limit edits propagate to existing subscriptions. Trial days are explicit; zero days produces `active`, and a positive duration produces `trialing`. No payment collection, invoice generation, accounting, or maintenance billing occurs in this workflow.

## 2.1 Support tickets and platform operations

1. A Society Admin creates a support ticket inside the selected active society context. The ticket is stored with that server-resolved society and the submitting user.
2. Society Admin ticket listing is restricted to that same society and requires the `members:read` permission.
3. Only Super Admin can search, filter, paginate, export, and update tickets across societies. Ticket status changes are audited.
4. The platform dashboard reports tenant/subscription counts, open support tickets, backend/database health, uptime, and the count of failed audit outcomes over the prior 24 hours.

Ticket management does not grant platform operators implicit access to the tenant's other records.

## 3. Identity, invitation, and membership (IAM-01/02/03)

1. User authenticates through the approved identity mechanism.
2. An authorized issuer creates an invitation bound to a tenant, intended role, expiration, and optional intended recipient.
3. Recipient accepts once, proves control of the approved identity, and establishes the membership.
4. Society Admin verifies the owner/home relationship using approved evidence and records decision/actor/time.
5. Membership becomes active only after required verification; rejection/revocation is attributable.
6. On role/membership revocation, further requests are denied; historical records and authorship remain.

**Proposed membership states:** `invited → pending_verification → active → suspended/revoked`; rejected/expired invitations are terminal. Exact account deactivation and reinvitation behavior is unresolved.

## 4. Society profile, homes, and ownership history (SOC-01/02)

1. Authorized Society Admin updates society profile/settings within allowed fields.
2. Admin creates a home/unit with a stable tenant-scoped identifier and human-readable label.
3. Admin links one or more verified owner memberships with effective start/end dates after cardinality policy is approved.
4. Transfer closes prior relationship and creates a new relationship; it never replaces history.
5. Historical financial/request attribution stays linked to the relevant home and actor at event time.

**Open policy:** whether owners, co-owners, renters, occupants, and delegates exist as separate relationship types; whether a home can have overlapping ownership periods.

## 4.1 Society configuration (SET-01)

1. A Society Admin opens settings in the active society context. The API verifies the server-selected society and active membership; changing a URL or body society ID does not switch tenant context.
2. The Admin updates profile/contact/logo, locale and financial-year settings, numbering conventions, or operational rules. Backend validation rejects invalid time zones, date/currency formats, calendar dates, bounds, duplicate policy operations, and malformed templates.
3. Charge-rule changes create a new revision with an effective date no earlier than today or the latest revision. Previous revisions remain unchanged. When a future billing engine issues bills, it must snapshot the selected revision and amounts on each bill; edits to subsequent rules cannot modify issued bills.
4. Approval policies and notification templates are stored for later workflow/delivery integration; saving them does not perform approvals or send notifications.
5. Each successful section update is audited by actor, society, section, and charge-rule revision/effective date. Audit metadata excludes contact values and template content.
6. House Owners can read only resident-facing profile, locale, numbering, and current charge schedule in Web/Mobile; they cannot update settings or read administrative policies/templates.

**Current implementation boundary:** The repository has no issued-bill model or billing engine, so historical bill preservation is guaranteed by immutable charge-rule revisions and the requirement for future bills to snapshot the applicable revision. No existing bill recalculation path exists.

## 4.2 Property and resident management (SOC-03)

1. Society Admin creates a building, optional wing, floor, and flat. Each selected parent is resolved within the active society; duplicate flat identifiers in the same building/wing fail without replacing existing data.
2. Admin invites an owner for a flat or links an already active House Owner membership. Invited ownership becomes active only with membership activation. Multiple current co-owners are supported by separate relationship records.
3. Admin records tenant/authorized-occupant details and move-in/move-out periods. Invalid dates and cross-society flat/member IDs are rejected.
4. Admin records a vehicle against a current owner or occupancy, creates parking slots, then assigns an eligible vehicle to a flat/slot. A unique active assignment per slot and per vehicle prevents collisions; designated-flat restrictions are enforced.
5. Ending an ownership or occupancy record preserves it as history and updates flat occupancy. Access is revoked only when the member has no other active ownership or occupancy. Historical financial records are not modified.
6. Authorized admins search/filter/sort/paginate property and resident lists and export capped, audited CSV. Bulk import processes up to 500 JSON rows independently and provides a tenant-scoped CSV error report. A failed row does not discard successful rows.
7. House Owners see their own profile and linked properties in Mobile; their read endpoints, including building structure and parking, are scoped to active linked flats.

**Current implementation boundary:** Property imports use JSON records, not file uploads. No invoice or billing service is present; property/resident updates cannot create or recalculate maintenance invoices.

## 5. Announcement (COM-01)

1. Society Admin drafts content, audience, and optional publication window.
2. Server checks tenant scope and content rules; draft is not visible to owners.
3. Authorized admin publishes; publication event records actor/time and audience.
4. Eligible owners read the notice; content is not visible to another tenant or ineligible audience.
5. Admin edits/unpublishes under an auditable action. Whether edits notify readers or preserve immutable revisions needs decision.

**Proposed states:** `draft → published → unpublished/archived`; schedule support is optional and unresolved.

## 6. Service request (REQ-01)

1. Verified owner submits category, description, relevant home, and optional approved attachment.
2. Server validates home relationship, tenant, required fields and attachment policy; creates `open`.
3. Society Admin triages and optionally assigns an authorized handler.
4. Admin posts a public update or internal note; visibility is enforced on every read.
5. Admin transitions request through `in_progress` and `resolved`; owner may acknowledge or request reopen only if policy permits.
6. Terminal/archived status retains history and cannot be changed by an unauthorized actor.

**Proposed states:** `open → in_progress → resolved → closed`; optional `reopened` transition requires policy. Define whether House Owner may close/reopen and which roles can see internal notes before implementation.

## 7. Maintenance billing (FIN-01/02/04)

1. Society Admin selects a complete billing period. The server selects the latest effective `ChargeRules` revision, verifies configured frequency and currency, and identifies active flats with ownership covering some or all of the period.
2. The server unions inclusive ownership intervals for each flat, computes actual society-local days, prorates fixed-per-flat and per-area components with half-up rounding, applies configured recurring discounts, and snapshots all inputs and outputs. Per-area billing fails if any eligible flat does not use the society's configured area unit.
3. The server creates a draft `BillingRun` and draft bills with itemized `BillItems`. A flat with no eligible active owner is reported as skipped. An existing bill for that flat/period blocks duplicate generation.
4. Society Admin reviews preview totals and skipped flats, approves, then issues the run. Issue assigns invoice numbers and creates in-app bill-issued reminders for eligible owners. No external email/SMS/push is sent.
5. Ad hoc charges and reconciled opening balances create draft bills and use the same review/approval/issue flow. Opening-balance import requires a source reference and exact match between row totals and the verified source total.
6. To correct an unpaid issued bill, Society Admin cancels it with a reason; cancellation is denied if any receipt allocation or issued adjustment exists. An explicit revision creates a new immutable bill and keeps the original cancellation record. Otherwise corrections use linked credit/debit notes with reason, approval, and issue. A credit note first reduces its source invoice; any excess is automatically allocated FIFO to later issued bills for that flat whose owner snapshot intersects the credit note's owner snapshot.
7. Society Admin records a manual receipt against an active owner and flat. Partial payment is allowed. The server applies it to the oldest due eligible bills first, or accepts an explicit audited allocation. Unapplied receipt credit is kept and automatically allocated to later issued bills for that flat and payer.
8. Monthly late-fee assessment uses the bill's saved rule snapshot, only overdue principal after due/grace date, excludes previous fees/penalties, rounds half up, and enforces the cumulative cap. An idempotency key prevents more than one assessment per bill and calendar month.
9. Owners can read only issued bills whose ownership-period snapshot includes their active membership. Bill details show items, payment history, adjustments, due amount, and flat account balance. PDF downloads are authorized and audited.
10. Society Admin can create in-app due/overdue reminders and view ageing buckets. A scheduler, external delivery channels, full general ledger, expenses, and payment-provider settlement are not part of this phase.

**Bill state transitions:** `draft → in_review → approved → issued`; unpaid bills may be cancelled with approval and reason; an explicit revision is a new draft with a new revision number. Issued bill items and rule snapshots are immutable.

## 8. Expenses and reports (FIN-03/04, REP-01)

1. Authorized operator enters expense, date, payee/category, amount/currency, evidence reference if enabled.
2. Draft expense requires review/posting according to approved policy.
3. Reversal/correction links to original and records reason/actor.
4. Report selects tenant, period/as-of time, currency, and filters; server enforces permission and includes defined statuses only.
5. Report reconciles to ledger-derived totals and labels scope, generation time, and currency.
6. Export is permission checked, rate/size bounded, and audited.

## 9. Notifications (NOTIF-01)

1. A business event commits before notification delivery is attempted.
2. A delivery job references the event, recipient eligibility, channel consent/policy, and idempotency key.
3. Provider failure is recorded and retried under bounded policy; notification failure does not roll back the committed business event.
4. User-visible read/delivery state is distinct from business status.
5. Do not send sensitive financial or personal details through an unapproved channel.

Channels, retries, opt-out, and delivery guarantees are unresolved.

## 10. Audit and support access (AUD-01)

1. The backend emits audit events for defined sensitive actions as part of or reliably coupled to the mutation.
2. Event captures actor, effective role, tenant, action, target, timestamp, outcome, correlation ID, and minimal before/after summary.
3. Ordinary application roles cannot alter or delete audit history.
4. Super Admin support access requires an approved grant and reason; access and completion are both audited.
5. Authorized audit review is read-only and scoped; audit retention and export follow approved policy.

## 11. Common error and recovery paths

- Expired invitation: reject with a safe actionable error; authorized issuer may create a new invitation.
- Revoked/suspended membership: deny new actions; retain history.
- Stale update: return conflict with a refresh/retry path; do not overwrite.
- Duplicate idempotent mutation: return the original result or stable duplicate response, not a second record.
- Attachment/provider outage: expose a clear failure and safe retry; do not report success.
- Tenant suspended mid-workflow: prevent new ordinary mutations; preserve already committed records.
- Failed audit persistence for a mandatory audited operation: operation MUST fail closed or use a durable transactional mechanism; never silently perform an unaudited sensitive action.
