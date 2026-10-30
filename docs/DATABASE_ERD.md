# Conceptual Database ERD

**Status:** Logical model draft, not a physical schema. Cardinalities and jurisdiction-specific fields require review.  
Related: [SRS](./SRS.md), [Architecture](./ARCHITECTURE.md), [Roadmap](./IMPLEMENTATION_ROADMAP.md).

## 1. Entity relationship diagram

```mermaid
erDiagram
  TENANT ||--o{ TENANT_ADMIN_GRANT : assigns
  USER ||--o{ TENANT_ADMIN_GRANT : receives
  TENANT ||--o{ MEMBERSHIP : contains
  USER ||--o{ MEMBERSHIP : holds
  TENANT ||--o{ HOME : contains
  HOME ||--o{ HOME_MEMBERSHIP : relates
  MEMBERSHIP ||--o{ HOME_MEMBERSHIP : links
  TENANT ||--o{ INVITATION : issues
  USER o|--o{ INVITATION : accepts
  TENANT ||--o{ ANNOUNCEMENT : publishes
  MEMBERSHIP ||--o{ ANNOUNCEMENT : authors
  TENANT ||--o{ SERVICE_REQUEST : tracks
  HOME o|--o{ SERVICE_REQUEST : concerns
  MEMBERSHIP ||--o{ SERVICE_REQUEST : submits
  TENANT ||--o{ FINANCIAL_RECORD : owns
  HOME o|--o{ FINANCIAL_RECORD : applies_to
  FINANCIAL_RECORD o|--o{ FINANCIAL_ALLOCATION : source
  FINANCIAL_RECORD o|--o{ FINANCIAL_ALLOCATION : target
  FINANCIAL_RECORD o|--o{ FINANCIAL_RECORD : corrects
  USER o|--o{ AUDIT_EVENT : acts
  TENANT o|--o{ AUDIT_EVENT : scopes
  TENANT ||--o{ NOTIFICATION : scopes
  USER ||--o{ NOTIFICATION : receives
  TENANT ||--|| SUBSCRIPTION : has
  SUBSCRIPTION_PLAN ||--o{ SUBSCRIPTION : governs
  TENANT ||--o{ SUPPORT_TICKET : receives
  USER ||--o{ SUPPORT_TICKET : submits
  USER o|--o{ SUPPORT_TICKET : assigned_to
  TENANT ||--|| SOCIETY_SETTINGS : configures
  TENANT ||--o{ CHARGE_RULES : versions
  TENANT ||--|| APPROVAL_POLICIES : configures
  TENANT ||--|| NOTIFICATION_TEMPLATES : configures
  TENANT ||--o{ BUILDING : contains
  BUILDING ||--o{ WING : contains
  BUILDING ||--o{ FLOOR : contains
  WING o|--o{ FLOOR : organizes
  BUILDING ||--o{ HOME : contains
  WING o|--o{ HOME : organizes
  FLOOR ||--o{ HOME : contains
  MEMBERSHIP ||--o{ OWNERSHIP : holds
  HOME ||--o{ OWNERSHIP : owned_by
  HOME ||--o{ OCCUPANCY : occupied_by
  MEMBERSHIP o|--o{ OCCUPANCY : may_access
  HOME ||--o{ VEHICLE : registers
  MEMBERSHIP o|--o{ VEHICLE : registers
  OCCUPANCY o|--o{ VEHICLE : registers
  BUILDING ||--o{ PARKING_SLOT : contains
  HOME o|--o{ PARKING_SLOT : reserves
  PARKING_SLOT ||--o{ PARKING_ASSIGNMENT : receives
  HOME ||--o{ PARKING_ASSIGNMENT : uses
  VEHICLE ||--o{ PARKING_ASSIGNMENT : assigned
  TENANT ||--o{ PROPERTY_IMPORT_REPORT : records
  TENANT ||--o{ BILLING_RUN : owns
  CHARGE_RULES ||--o{ BILLING_RUN : snapshots
  BILLING_RUN ||--o{ MAINTENANCE_BILL : creates
  TENANT ||--o{ MAINTENANCE_BILL : owns
  HOME ||--o{ MAINTENANCE_BILL : liable_flat
  MEMBERSHIP ||--o{ MAINTENANCE_BILL : owner_snapshot
  MAINTENANCE_BILL ||--o{ BILL_ITEM : itemizes
  MAINTENANCE_BILL ||--o{ CREDIT_NOTE : corrects
  TENANT ||--o{ RECEIPT : records
  MEMBERSHIP ||--o{ RECEIPT : pays
  RECEIPT }o--o{ MAINTENANCE_BILL : allocates
  MAINTENANCE_BILL ||--o{ BILLING_REMINDER : notifies
  MEMBERSHIP ||--o{ BILLING_REMINDER : receives
```

The diagram expresses conceptual associations only. For example, `o|` is intentional where a platform-level action may not belong to one tenant. Physical referential constraints must reject cross-tenant relationships.

## 2. Entity intent and key invariants

| Entity                  | Purpose                                                                            | Important invariants                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Tenant`                | Society/community boundary and lifecycle                                           | Stable opaque ID; status; display name is not key; suspension does not delete                                                                                                                |
| `User`                  | Global authenticated principal                                                     | Stable principal ID independent of mutable email/phone; credentials are not exposed                                                                                                          |
| `TenantAdminGrant`      | Platform-issued tenant-admin assignment                                            | Tenant, user, grantor, scope/status, effective dates; auditable and revocable                                                                                                                |
| `Membership`            | User's tenant role/status and verification                                         | Tenant + user relationship; role and lifecycle; uniqueness/multi-role rule unresolved                                                                                                        |
| `Home`                  | Tenant-owned dwelling/unit                                                         | Tenant-scoped unique label policy; status; never identify by address alone                                                                                                                   |
| `HomeMembership`        | Time-bounded relationship between membership and home                              | Relationship type, verification, effective interval; preserve history                                                                                                                        |
| `Invitation`            | Time-limited onboarding capability                                                 | Tenant, intended role/recipient, token digest only, expiry, single-use/revocation                                                                                                            |
| `Announcement`          | Tenant notice with audience and publication lifecycle                              | Tenant, author, state, audience, published time; revision policy unresolved                                                                                                                  |
| `ServiceRequest`        | Owner-submitted operational issue                                                  | Tenant, submitter, optional home, status, assignment/history; internal-note access controlled                                                                                                |
| `FinancialRecord`       | Charge, receipt, expense, refund, reversal, adjustment                             | Tenant, type, amount, currency, status, dates, source/correction link; immutable after posting                                                                                               |
| `FinancialAllocation`   | Links payment/credit to charge or other approved target                            | Same tenant and compatible currency; amount within permitted bounds                                                                                                                          |
| `AuditEvent`            | Append-only accountability record                                                  | Actor, tenant context, action, target, timestamp, outcome, minimal payload                                                                                                                   |
| `Notification`          | Delivery/read state distinct from business data                                    | Recipient, tenant, event reference, channel/status; no authority to alter source state                                                                                                       |
| `SubscriptionPlan`      | Platform-defined plan, limits and optional price metadata                          | Unique plan code; archived plans cannot be newly assigned; payment processing is separate                                                                                                    |
| `Subscription`          | Tenant's current plan, status, explicit trial period and limit snapshot            | One current subscription per tenant; configured by platform actor; no billing ledger                                                                                                         |
| `SupportTicket`         | Tenant-scoped support request tracked by the platform                              | Creator and tenant are server-bound; platform ticket access does not imply access to tenant business data                                                                                    |
| `SocietySettings`       | Tenant-scoped identity, locale, numbering, branding and operational rules          | One settings document per tenant; includes society-wide area unit; backend validation; residents receive a restricted read projection                                                         |
| `ChargeRules`           | Versioned future maintenance charge, discount, due-date, late-fee and grace-period rules | Unique tenant/version; area-based charges match configured society unit; immutable after creation; effective dates cannot be backdated; never rewrites an issued bill                    |
| `ApprovalPolicies`      | Configurable operation approval requirements                                       | One tenant document; unique operation; configuration only, workflows remain separate                                                                                                         |
| `NotificationTemplates` | Tenant's configured email/SMS/push message templates                               | One tenant document; unique template keys; delivery/rendering is separate                                                                                                                    |
| `Building`              | Tenant-scoped property building                                                    | Unique code per society; never referenced across tenants                                                                                                                                     |
| `Wing`                  | Optional subdivision of a building                                                 | Building and society IDs must agree; unique code within its building                                                                                                                         |
| `Floor`                 | Numbered floor within a building and optional wing                                 | Parent hierarchy must be consistent; unique floor number within its building/wing                                                                                                            |
| `Flat`                  | A property unit on a floor                                                         | Building/wing/floor must share tenant and hierarchy; flat number is unique within building/wing; occupancy status is derived; numeric area carries explicit square-foot or square-metre unit |
| `Ownership`             | Time-bounded owner/co-owner relationship between a flat and House Owner membership | Tenant-scoped; current invited/active link is unique for a membership/flat pair; ended records remain historical                                                                             |
| `Occupancy`             | Time-bounded tenant/authorized-occupant details for a flat                         | Tenant and flat are validated together; move-out follows move-in; history is retained                                                                                                        |
| `Vehicle`               | Vehicle registered against a flat and owner membership or occupancy                | Active registration unique within society; resident relationship must be valid in the same flat and tenant                                                                                   |
| `ParkingSlot`           | Building parking resource, optionally reserved to a flat                           | Slot number unique within society/building; a reservation must belong to that building                                                                                                       |
| `ParkingAssignment`     | Effective assignment of a vehicle and flat to a parking slot                       | At most one active assignment per slot and per vehicle; all referenced records belong to the same society                                                                                    |
| `PropertyImportReport`  | Import summary and row-level validation errors                                     | Tenant and initiating actor are recorded; error download is tenant-authorized and does not expose unrelated rows                                                                             |
| `BillingRun`            | Preview, review, approval, and issue batch for a complete billing period              | Unique tenant/period/revision; snapshots rule version and aggregate totals; state transitions are audited                                                                                     |
| `MaintenanceBill`       | Immutable flat-level recurring, ad hoc, revised, or opening-balance invoice            | Tenant, flat, period, owner-membership snapshot, currency, due date, calculation inputs, total, status; one active recurring bill per flat/period                                             |
| `BillItem`              | Immutable itemized charge or discount on a bill                                       | Tenant and bill IDs agree; amount is integer minor units; rates, calculation, quantity, and reason are preserved                                                                             |
| `CreditNote`            | Approved linked credit/debit/late-fee correction                                     | Cannot modify original bill; source flat and owner snapshot, per-bill allocations, unapplied credit, reason, actor, approval, issue state, currency, and idempotent monthly fee key are retained |
| `Receipt`               | Manually recorded payment and its bill allocations                                    | Tenant, flat, active payer membership, explicit currency/method/time/reference; partial/FIFO allocation and unapplied amount are auditable                                                    |
| `BillingReminder`        | In-app issued/due/overdue reminder state                                              | Tenant, bill, and eligible owner membership agree; unique reminder key prevents duplicate delivery for a date                                                                                |

Every issued recurring bill and run snapshots the immutable `ChargeRules` revision and calculation inputs; later rule changes never recalculate bills. Receipt and credit-note allocations are embedded on their source records and projected into bill balances/history. Unused credit-note value carries forward only to later bills for the same flat with an intersecting owner snapshot. The `Membership` IDs on a bill are the owner snapshot for its ownership-period liability; current active membership is still required to access the bill.

## 3. Common data requirements

- Use opaque stable primary IDs; do not rely on sequential IDs for authorization.
- Tenant-owned entities include a `tenant_id` or enforce tenant through a composite/parent relationship. If redundant tenant ID is stored, validate it against the parent.
- Store created/updated timestamps consistently; use UTC instants with clear serialization. Effective dates for ownership/membership are separate domain dates/instants.
- Store actor/source attribution for sensitive mutations. Soft deletion/archive is not a substitute for a defined retention policy.
- Monetary amounts use exact decimal representation or integer minor units with currency-specific scale. Currency is required and not inherited silently.
- Separate drafts from posted records; preserve immutable posted history and link corrections.
- Do not store raw invitation tokens, passwords, payment credentials, or secrets. Store digests/references where applicable.
- Avoid unnecessary personally identifiable information. Define retention and access by field category.
- Indexes and uniqueness must include tenant scope where appropriate; query plans and constraints must prevent cross-tenant links.

## 4. Relationship questions requiring decisions

1. Can one person have multiple roles within a tenant or memberships in many tenants? (SRS D-06)
2. Is an owner-to-home relationship one-to-one, many-to-one, or many-to-many; are renters/occupants represented? (D-07)
3. Maintenance bills are flat liabilities shared by owners whose ownership intersects the billed period; how outstanding prior-period liability transfers on sale remains unresolved. (D-02/D-03/D-07)
4. Are expenses records in a lightweight sub-ledger or full chart-of-accounts model? (D-02)
5. Do announcements need immutable revision history, read receipts, and audience snapshots?
6. Can a service request exist without a home, and how are internal notes modeled?
7. What retention/deletion/anonymization rules apply to user and tenant records while preserving legal records? (D-01/D-14)
8. Which attachment/document metadata and storage policy is required? (D-10)

## 5. Data integrity acceptance checks

- Constraints or domain validation reject a home/member/financial allocation relationship spanning two tenants.
- Ownership history supports a transfer without rewriting prior relationship or financial attribution.
- Reversals link to an existing same-tenant original and preserve both entries.
- Duplicate idempotency key cannot create duplicate posted records.
- Tenant-scoped unique labels allow identical labels in different tenants while enforcing the approved within-tenant rule.
- User deletion/deactivation does not erase the identity needed to interpret historical audit and financial attribution.
