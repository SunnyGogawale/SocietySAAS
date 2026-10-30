# Role and Permission Matrix

**Status:** Draft for review; permissions below are proposed defaults.  
Related documents: [SRS](./SRS.md), [Module Workflows](./MODULE_WORKFLOWS.md), [Roadmap](./IMPLEMENTATION_ROADMAP.md).

## 1. Authorization model

Enforce permissions on the backend, deny by default, and check both action and object scope. UI visibility is not an authorization control. Tenant-owned data is inaccessible without a validated tenant membership/context. A record identifier is never proof of access.

**Legend:** `Yes` = allowed in the stated scope; `Own` = only the caller's verified membership/home and permitted fields; `Assigned` = only explicitly assigned societies; `Conditional` = requires an approved policy/grant; `No` = not allowed by default.

| Capability | Super Admin | Society Admin | House Owner |
|---|---|---|---|
| Review/reject/provision, configure, suspend/reactivate, or archive society tenant | Yes | No | No |
| Configure plans, trials, subscription status, and plan limits | Yes | No | No |
| Assign/manage primary Society Admin | Yes | No | No |
| View platform dashboard, cross-tenant status and operational summaries | Yes | No | No |
| View/export platform audit events | Yes | No | No |
| Search/update/export cross-tenant support tickets | Yes | No | No |
| Create/view support tickets | No by default | Assigned tenant only | No by default |
| Read tenant resident/financial content for support | Conditional, explicit audited support access | Assigned tenant only | Own permitted records only |
| Edit society profile and operational settings | No by default; support grant only | Assigned tenant | No |
| Create/edit/archive homes or units | No by default | Assigned tenant | No |
| Invite/verify/disable society members | No by default | Assigned tenant, per policy | No |
| View member directory | No by default; support grant only | Assigned tenant | Own/approved directory fields only |
| Edit own profile/security settings | Own platform identity | Own identity | Own identity |
| Publish/target society announcements | No by default | Assigned tenant | No |
| Read announcements | No tenant-content access by default | Assigned tenant | Own eligible audience |
| Create/view/update service request | No by default | Assigned tenant; triage/manage | Create and view Own; permitted comments |
| Create and post charges/receipts/expenses | No by default | Assigned tenant, by explicit financial permission | No |
| Read financial records and reports | No by default; support grant only | Assigned tenant, by explicit financial permission | Own applicable home records only |
| Reverse/adjust posted financial records | No by default | Conditional, elevated grant and reason | No |
| Export tenant data | Conditional, explicit support grant and audit | Conditional, assigned tenant and audited | Own data, if approved |
| View/change audit records | Platform audit only; tenant audit requires audited support grant | Assigned tenant, read only | No |
| Change roles/permissions | Platform roles and tenant-admin assignments | No platform roles; may manage allowed tenant memberships | No |

## 2. Role definitions and boundaries

### Super Admin

Platform-level operational role. Can administer tenant lifecycle and Society Admin assignment. It does **not** imply routine access to tenant content or financial data. Any support/break-glass access is a separate, narrowly scoped, explicitly granted action, logged with reason and reviewed. Break-glass rules and platform support staffing are open decisions (SRS D-18).

### Society Admin

Tenant-scoped administrator, limited to assigned society or societies. Proposed permissions cover society profile, homes, member lifecycle, notices, requests, and tenant reports. Financial posting, reversal, and export should be separable grants if the product supports least privilege; whether one administrator can hold different grants is an open decision.

### House Owner

Verified member with access only to their own profile and approved home relationships. Owner access does not imply access to another home, another owner's private data, internal request notes, draft financial records, or administrative controls. Whether co-owners share all home-level data, and whether a member may own multiple homes or belong to multiple societies, require decisions D-06/D-07.

## 3. Cross-cutting policy rules

1. **Tenant scope:** Every tenant request is authorized against an active tenant membership/assignment. Reject ambiguous tenant context.
2. **Relationship scope:** Resolve the caller's current, verified home/membership relationships server-side. Do not accept client claims as authority.
3. **Lifecycle:** Disabled, suspended, expired, or unverified identities/memberships cannot perform normal actions. Existing historical attribution remains.
4. **Field-level access:** Return only fields required by the role and workflow. Mask private contact details where policy requires it.
5. **Status-specific access:** Draft, posted, reversed, archived, and internal-note visibility are independently controlled.
6. **Administrative elevation:** Sensitive actions require explicit permission, step-up authentication where approved, and an audit reason.
7. **Non-disclosure:** For inaccessible objects, return a consistent documented response that does not reveal whether another tenant's object exists.
8. **Background work:** Jobs and service accounts have explicit least-privilege scopes and retain tenant context; no unscoped "all tenant" query.
9. **Support access:** Must be time-bounded where feasible, reasoned, logged, and reviewable; no implicit global browsing.
10. **Audit:** Role grants/revocations, membership verification, support access, exports, and all financial state transitions are auditable.

## 4. Permission decision register

| Question | Default pending review | Decision reference |
|---|---|---|
| Can Super Admin inspect tenant content? | No; explicit support grant only | SRS D-18 |
| Can one Society Admin post and reverse financial activity? | Posting may be granted; reversal should be separately elevated | SRS D-02/D-18 |
| Do co-owners see the same unit-level balances and requests? | No sharing beyond explicitly verified relationship until approved | SRS D-07 |
| Can owners see other owners' names/contact information? | Only approved directory fields; default private | SRS D-14 |
| Can a user hold multiple roles or tenant memberships? | Data model permits memberships; product behavior waits on decision | SRS D-06 |
| Can an owner export personal/financial data? | Only approved own-data export, audited | SRS D-13/D-14 |

## 5. Authorization acceptance cases

- A Society Admin assigned to tenant A cannot list, read, mutate, search, or export tenant B records, even with a valid B record ID.
- A House Owner cannot access an unverified membership or a home not related to their verified membership.
- An owner cannot post a financial record, alter another owner's profile, or view internal request notes.
- A Super Admin's ordinary session cannot access tenant content; a support grant with valid scope records actor, reason, target tenant, time, and outcome.
- Revoking a grant or suspending an account blocks subsequent actions without erasing audit attribution.
- List, detail, report, export, notification, and background-job paths enforce the same scope as direct API reads.
