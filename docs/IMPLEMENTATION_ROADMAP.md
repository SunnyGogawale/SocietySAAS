# Implementation Roadmap and Acceptance Register

**Status:** Proposed sequencing for review only. No business modules should be implemented until the specification is reviewed and approved.  
All dependencies below are prerequisite feature IDs or approved decisions in [SRS §13](./SRS.md#13-unresolved-decisions--approval-required). Acceptance criteria are testable exit conditions, not estimates.

## 1. Approval gate

**Gate 0 — Specification review (must precede business implementation):** Review the complete SRS, role matrix, workflows, architecture, ERD, and this roadmap. Assign decision owners and resolve all decisions needed by the first release, especially jurisdiction/accounting, identity and role model, home membership, mobile scope, hosting/data residency, retention, and operational targets. Obtain explicit product/security/finance approval. Until Gate 0 passes, only specification refinement and non-business technical spikes explicitly approved by stakeholders are in scope.

## 2. Feature acceptance and dependency register

| ID / feature | Scope and acceptance criteria (all must pass) | Dependencies |
|---|---|---|
| PLAT-01 Tenant lifecycle | A registrant can submit a validated application; only Super Admin can review, reject with reason, approve with an explicit plan/trial, provision, configure profile/primary admin, suspend, reactivate, and archive; every platform mutation is audited; tenant admin is denied platform list/detail/export access; suspension blocks tenant APIs and reactivation restores access without revoking membership; archived tenants cannot be reactivated or hard-deleted. | IAM-01; D-08, D-15, D-16, D-18 |
| PLAT-02 Plans, subscriptions, and support | Super Admin can create/update/archive plans, configure tenant subscription status/trial, and inspect tenant/subscription dashboard summaries; configured member limits prevent over-limit invitations; tenant support tickets remain tenant-scoped for Society Admins while cross-tenant support search/update/export is Super Admin-only; audit events cover mutations; dashboard exposes available database/service health and recent failed-audit counts. | PLAT-01, IAM-02, AUD-01; D-08, D-14, D-16, D-18 |
| IAM-01 Authentication and session | Approved identity method authenticates users; expiry/logout/revocation deny subsequent protected access; errors do not disclose secrets; session lifecycle passes security tests. | Gate 0; D-05, D-15 |
| IAM-02 Role and tenant authorization | Backend enforces role, tenant, action, and object relationship on direct, list, search, report, export, and job paths; two-tenant negative tests pass; support access is not implicit. | IAM-01, PLAT-01; D-06, D-18 |
| IAM-03 Invitations and verification | Invitation is tenant/role-bound, expiring, revocable and replay-safe; only approved verification activates owner access; revocation blocks new actions while preserving history. | IAM-01, IAM-02, PLAT-01; D-05, D-06, D-07 |
| SOC-01 Society and home registry | Assigned admin can manage tenant profile/homes; identifiers are tenant-scoped; cross-tenant links are rejected; suspend/archive behavior is documented and audited. | PLAT-01, IAM-02; D-07, D-08 |
| SOC-02 Ownership/membership history | Approved owner-home relationship can be created, verified, ended, and transferred with effective history; historical attribution remains; unauthorized owner cannot access another home. | IAM-03, SOC-01, IAM-02; D-06, D-07 |
| UX-01 Role-based responsive client shell | Approved role journeys render on supported viewport/browser matrix; keyboard, focus, labels, contrast and reflow meet approved accessibility target; client controls never substitute for backend authorization. | IAM-01, IAM-02; D-09, D-17 |
| COM-01 Announcements | Admin can draft/publish/unpublish tenant notice to approved audience; owners see only eligible tenant notices; author/publication history is retained; cross-tenant tests pass. | IAM-02, SOC-02, UX-01; D-11 |
| REQ-01 Service requests | Verified owner creates request for permitted home; tenant admin triages/transitions; invalid transitions and internal-note leakage are denied; history is attributable; retry does not duplicate request. | IAM-02, SOC-02, UX-01; D-10, D-12 |
| FIN-01 Charges | Authorized finance grant creates draft and posts charge; draft excluded from balance; posting is atomic/idempotent; currency precision and rounding approved; posted entry cannot be overwritten/deleted; correction links to original. | IAM-02, SOC-01, SOC-02; D-01, D-02, D-03, D-18 |
| FIN-02 Receipts and allocations | Authorized operator records a receipt with explicit evidence/source and currency; allocations respect approved limits; duplicates do not create duplicate receipts; reversal/refund preserves source history; owner view is scoped. | FIN-01, IAM-02, SOC-02; D-01, D-02, D-03, D-04 |
| FIN-03 Expenses | Authorized operator records, reviews/posts and corrects expense according to approved policy; each record is tenant-scoped, attributed, immutable after posting, and included/excluded consistently in reports. | FIN-01, IAM-02; D-01, D-02, D-03 |
| FIN-04 Ledger and balances | Balance is derived from posted records/allocations under approved rules; no unlike currencies are combined; as-of calculation is reproducible and reconciles to source records, including reversals and unapplied amounts. | FIN-01, FIN-02, FIN-03; D-02, D-03 |
| REP-01 Reports and exports | Approved reports state period/as-of, currency, included statuses and generation time; totals reconcile to ledger; role/tenant scope and export audit apply; export limits are enforced. | FIN-04, IAM-02, AUD-01; D-13, D-14 |
| AUD-01 Audit trail | Required sensitive actions produce append-only attributed events; ordinary roles cannot alter them; sensitive operation fails safely if audit cannot be durably recorded; search/read access is scoped. | IAM-01, IAM-02, PLAT-01; D-14, D-18 |
| NOTIF-01 Notifications | Approved event triggers eligible channel delivery after business commit; retries are bounded/idempotent; provider failure is visible without changing business state; consent and opt-out are respected. | IAM-03, COM-01 and/or REQ-01 and/or FIN-02; D-11 |
| DOC-01 Documents/attachments (conditional) | If included: approved file types/size are enforced, malware scanning and private access checks work, ownership/tenant scope is verified, retention/deletion is applied, and failed upload is not reported as success. | IAM-02, SOC-01; D-10 |
| SEC-01 Security and privacy controls | Threat model, authorization-negative tests, secret handling, data minimization, retention, privacy request procedure, rate limits and incident process are approved and verified before production. | Gate 0; D-01, D-05, D-14, D-15, D-18 |
| OPS-01 Backup, recovery, observability | Encrypted monitored backups; restore exercise meets approved RPO/RTO; critical alerts and request/job correlation work without sensitive log leakage; restore and incident runbooks are approved. | Gate 0; D-15, D-16 |
| OPS-02 Production readiness | Migration/rollback or forward-fix tested; accessibility/security/performance gates pass; support ownership, SLO, release/rollback process, and tenant offboarding are approved. | SEC-01, OPS-01, all launch MVP features; D-08, D-16, D-17 |

## 3. Proposed release grouping

Sequence reflects logical prerequisites, not duration or commitment:

1. **Gate 0:** Product and compliance decisions, approved spec and acceptance baseline.
2. **Foundation:** PLAT-01, IAM-01, IAM-02, AUD-01 baseline, SOC-01, SOC-02, UX-01.
3. **Operational workflows:** IAM-03, COM-01, REQ-01; DOC-01 only if approved.
4. **Financial baseline:** FIN-01, FIN-02, FIN-03, FIN-04, then REP-01, subject to accounting and jurisdiction approval.
5. **Launch hardening:** SEC-01, OPS-01, NOTIF-01 if in approved MVP, OPS-02.

No phase estimates are provided because team size, technical choices, scope, and acceptance targets are unknown.

## 4. MVP boundary and future candidates

### Proposed MVP (approval required)

Tenant lifecycle, role-scoped identity/membership, society/home registry, owner access, announcements, service requests, manual financial records and derived balances/reports, audit, responsive web journeys, security/privacy baseline, and recoverable operations.

If accounting policy, jurisdiction, or data-protection decisions are not settled, the dependent financial or production features are not ready for implementation/release. Payment collection, documents, native apps, and notifications are conditional rather than assumed.

### Future enhancements (not MVP commitments)

- Online payment collection, bank settlement/reconciliation, recurring charges.
- Native mobile apps, push notifications, and offline support.
- Facility/amenity bookings, visitor and access management.
- Vendor/work-order management and procurement.
- Document repository, e-signatures, and policy acknowledgements.
- Advanced accounting, budgets, multi-currency conversion, statutory filings.
- Multiple community roles (committee, treasurer, auditor, property manager), renter/occupant access.
- Analytics, configurable dashboards, integrations, and data warehouse.
- Multilingual experience and expanded localization.
- Resident polls, emergency communication workflows, and optional integrations.

Future candidates require separate threat, privacy, workflow, permission, data model, and acceptance review before being scheduled.

## 5. Cross-cutting release acceptance

- No open Gate 0 decision blocks any included feature.
- All feature-specific acceptance criteria above pass in automated or documented reproducible tests.
- Tenant boundary tests cover two or more tenants and all access surfaces.
- Financial records and reports reconcile under approved rounding, currency, status, and cut-off rules.
- WCAG target and supported browser/device matrix are approved; critical flows pass automated and manual accessibility checks.
- Security review, backup restore test, performance/load test against approved workload, alerting, and release recovery drill pass.
- Product owner, security/privacy owner, and finance/domain owner sign off before production release.

## 6. Traceability

- Product and non-functional requirements: [SRS.md](./SRS.md)
- Role and permission behavior: [ROLE_PERMISSION_MATRIX.md](./ROLE_PERMISSION_MATRIX.md)
- State transitions and workflows: [MODULE_WORKFLOWS.md](./MODULE_WORKFLOWS.md)
- System boundaries and integration: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Conceptual entities and constraints: [DATABASE_ERD.md](./DATABASE_ERD.md)
