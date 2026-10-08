# Concept Templates

Templates and structural conventions for ok-fine knowledge concepts. Sources in code repositories include the repository-relative path and commit hash. For non-code sources (policies, processes, web URLs, documents), `resource` is a URL or stable URI with `title`, `author`, and `last_modified` (ISO 8601 with explicit offset), and `commit` is omitted.

## Decision

Use for architectural, technical, and process decisions with enduring impact.

### Frontmatter Example (Code Source)
```yaml
type: Decision
title: Use PostgreSQL for Persistent Relational Storage
description: Select PostgreSQL as the primary relational datastore for orders and accounts.
status: stable
tags: [database, storage, postgresql]
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-03T00:00:00Z>"
sources:
  - id: adr-004
    resource: github.com/acme/shop/docs/adr/004-storage.md
    commit: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
```

### Frontmatter Example (Non-code Source)
```yaml
type: Decision
title: Customer Refund Window and Eligibility
description: Policy granting full refunds within thirty days of purchase for unredeemed services.
status: stable
tags: [policy, finance, refunds]
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-03T00:00:00Z>"
sources:
  - id: refund-policy
    resource: https://handbook.example.com/finance/refunds
    title: Customer Operations Refund Policy
    author: Finance Team
    last_modified: 2026-08-15T10:00:00Z
```

### Body Headings
- ## Context
- ## Decision
- ## Consequences
- ## Alternatives considered

---

## Proposal

Use for designs and decisions for work on an unmerged branch or pull request. Write it at the id its type would get (usually `decisions/<slug>`), never over an existing concept. The `proposal` key gives it trust tier `proposed`; when the work lands, the same concept is rewritten as current truth without the key.

### Frontmatter Example
```yaml
type: Decision
title: Add Distributed Caching Layer
description: Proposed Redis-backed cache for reducing database read contention during checkout.
status: draft
proposal: { ref: https://github.com/acme/shop/pull/42 }
tags: [caching, redis, performance]
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-03T00:00:00Z>"
sources:
  - id: cache-pr
    resource: github.com/acme/shop/src/cache/redis.ts
    commit: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
```

### Body Headings
- ## Context
- ## Proposal
- ## Rejected alternatives
- ## Would change (bundle-absolute links to current-state concepts this proposal would modify, e.g. `[Order Service](/architecture/order-service.md)`)

---

## Convention

Use for coding standards, branching policies, naming schemes, and practices not enforced by linters.

### Frontmatter Example
```yaml
type: Convention
title: Structured JSON Logging
description: Emit all application log entries as newline-delimited JSON to stdout.
status: stable
tags: [logging, observability, conventions]
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-03T00:00:00Z>"
sources:
  - id: logging-config
    resource: github.com/acme/shop/src/logger.ts
    commit: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
  # For non-code sources, omit commit:
  # - id: branching-policy
  #   resource: https://handbook.example.com/engineering/branching
```

### Body Headings
- ## Rule
- ## Rationale
- ## Examples
- ## Exceptions

---

## Architecture

Use for high-level system topology, cross-cutting flows, and subsystem structures.

### Frontmatter Example
```yaml
type: Architecture
title: Payment Processing Subsystem
description: High-level topology and synchronous and asynchronous data flows for payments.
status: stable
tags: [architecture, payments, topology]
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-03T00:00:00Z>"
sources:
  - id: payment-spec
    resource: github.com/acme/shop/docs/architecture/payments.md
    commit: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
```

### Body Headings
- ## Overview
- ## Components
- ## Data flow
- ## Deployment

---

## Component

Use for distinct libraries, services, workers, packages, or major modules.

### Frontmatter Example
```yaml
type: Component
title: Checkout Worker
description: Asynchronous queue worker processing order checkout jobs from the broker.
status: stable
tags: [component, checkout, worker]
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-03T00:00:00Z>"
sources:
  - id: worker-entry
    resource: github.com/acme/shop/src/workers/checkout.ts
    commit: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
```

### Body Headings
- ## Responsibility
- ## Location
- ## Interfaces
- ## Dependencies
- ## Gotchas

---

## Playbook

Use for operational runbooks: building, testing, deploying, debugging, or incident recovery.

### Frontmatter Example
```yaml
type: Playbook
title: Database Migration Rollback
description: Operational procedure for safely rolling back a failed schema migration.
status: stable
tags: [playbook, database, migrations, operations]
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-03T00:00:00Z>"
sources:
  - id: migration-guide
    resource: github.com/acme/shop/docs/runbooks/migrations.md
    commit: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
```

### Body Headings
- ## When to use
- ## Prerequisites
- ## Steps (numbered; each step gives the exact command)
- ## Verification
- ## Troubleshooting

### Steps Example
```markdown
## Steps
1. Find the failed migration: `npm run migrate:status`
2. Roll back one step: `npm run migrate:down -- --step 1`
3. Confirm the schema version: `npm run migrate:status`
```

---

## Interface

Use for API schemas, CLI commands, RPC definitions, and message contracts.

### Frontmatter Example
```yaml
type: Interface
title: Order Creation Endpoint
description: REST HTTP endpoint for creating and validating customer orders.
status: stable
tags: [interface, api, rest, orders]
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-03T00:00:00Z>"
sources:
  - id: openapi-spec
    resource: github.com/acme/shop/src/api/orders.openapi.json
    commit: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
```

### Body Headings
- ## Purpose
- ## Contract
- ## Errors
- ## Consumers

---

## Reference

Use for external service quirks, incidents, historical constraints, or third-party gotchas.

### Frontmatter Example
```yaml
type: Reference
title: Stripe Webhook Replay Behavior
description: Behavior and mitigation strategies for Stripe webhook duplicate deliveries.
status: stable
tags: [reference, stripe, webhooks, quirks]
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-03T00:00:00Z>"
sources:
  - id: incident-88
    resource: https://status.example.com/incidents/88
    title: Stripe Incident 88 Postmortem
    author: Payment Ops
    last_modified: 2026-05-10T14:30:00Z
```

### Body Headings
- ## Summary
- ## Details
- ## Impact

---

## Glossary Term

Use for domain terminology, business concepts, or organization-specific jargon.

### Frontmatter Example
```yaml
type: Glossary Term
title: Idempotency Key
description: Unique request identifier provided by clients to guarantee single execution.
status: stable
tags: [glossary, payments, transactions]
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-03T00:00:00Z>"
sources:
  - id: api-conventions
    resource: github.com/acme/shop/docs/api-conventions.md
    commit: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
  # For non-code sources, omit commit:
  # - id: term-definition
  #   resource: https://handbook.example.com/terms/billing
```

### Body Headings
- ## Definition
- ## Usage
- ## Related

---

# Business concept types

Templates and structural conventions for non-coding and team-level knowledge (support, sales, marketing, operations).

Note: Glossary Term and Decision reuse the templates from the technical section above with business prefixes and horizons:
- **Glossary Term**: Id prefix `glossary/<term>`, `stale_after` 365 days. Use for organization-wide terminology, acronyms, and business metrics.
- **Decision**: Id prefix `decisions/<slug>`, `stale_after` 180 days. Use for cross-functional business, policy, and organizational decisions.

## Playbook (Business)

Use for operational procedures and standard operating procedures for customer support, sales operations, marketing, or team workflows. Business Playbooks use `playbooks/<slug>` (engineering runbooks keep `runbooks/<slug>`).

### Frontmatter Example
```yaml
type: Playbook
title: Process Customer Refund Request
description: Step-by-step procedure for support agents validating and issuing customer refunds.
status: draft
tags: [support, refunds, operations, playbook]
stale_after: "<ISO 8601 timestamp 90 to 180 days from now, e.g. 2027-01-06T00:00:00Z>"
sources:
  - id: zendesk-macro
    resource: https://support.example.com/agent/macros/360012345678
    title: Zendesk Refund Macro and Handling Guide
    author: Support Ops
    last_modified: 2026-09-15T12:00:00Z
```

### Body Headings
- ## When to use
- ## Steps
- ## Verification
- ## Escalation

---

## Policy

Use for governance rules, compliance standards, spending limits, and organizational policies.

### Frontmatter Example
```yaml
type: Policy
title: Customer Refund and Return Policy
description: Rules and timeframes governing eligibility for customer subscription and fee refunds.
status: draft
tags: [policy, finance, refunds, governance]
stale_after: "<ISO 8601 timestamp 180 to 365 days from now, e.g. 2027-04-06T00:00:00Z>"
sources:
  - id: refund-policy
    resource: https://handbook.example.com/finance/refunds-policy
    title: Corporate Customer Refund Policy
    author: Finance Team
    last_modified: 2026-08-15T10:00:00Z
```

### Body Headings
- ## Policy
- ## Scope
- ## Exceptions
- ## Owner

---

## Process

Use for recurring multi-step cross-functional workflows, handoffs, and operational handshakes.

### Frontmatter Example
```yaml
type: Process
title: Customer Onboarding and Technical Kickoff
description: End-to-end workflow from signed sales contract through kickoff call and initial provisioning.
status: draft
tags: [process, onboarding, sales, customer-success]
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-06T00:00:00Z>"
sources:
  - id: onboarding-guide
    resource: https://handbook.example.com/ops/customer-onboarding-sop
    title: Customer Onboarding Standard Operating Procedure
    author: Customer Success
    last_modified: 2026-07-20T14:00:00Z
```

### Body Headings
- ## Trigger
- ## Steps
- ## Roles
- ## Handoffs
- ## SLA

---

## Escalation

Use for triage paths, severity criteria, and notification channels when an issue exceeds first-line resolution.

### Frontmatter Example
```yaml
type: Escalation
title: Critical Production Outage Escalation
description: Routing path and communication protocol for frontline support escalating customer-impacting outages.
status: draft
tags: [escalation, support, incidents, severity-1]
stale_after: "<ISO 8601 timestamp 90 to 180 days from now, e.g. 2027-01-06T00:00:00Z>"
sources:
  - id: slack-triage
    resource: https://example.slack.com/archives/C01234567/p1696000000000000
    title: Tier 1 to Tier 2 Outage Escalation Protocol
    author: Support Ops
    last_modified: 2026-09-10T16:00:00Z
```

### Body Headings
- ## When to escalate
- ## Who / channel
- ## What to include
- ## Response targets

---

## FAQ

Use for canonical answers to recurring questions asked by customers, sales prospects, or internal teams.

### Frontmatter Example
```yaml
type: FAQ
title: Annual Subscription Proration and Midterm Seat Additions
description: Standard answer for customer questions regarding adding user seats during an active contract year.
status: draft
tags: [faq, billing, support, sales]
stale_after: "<ISO 8601 timestamp 90 to 180 days from now, e.g. 2027-01-06T00:00:00Z>"
sources:
  - id: billing-kb
    resource: https://support.example.com/kb/articles/billing-proration
    title: "Knowledge Base Article: Annual Billing Proration"
    author: Finance Team
    last_modified: 2026-08-25T11:00:00Z
```

### Body Headings
- ## Question
- ## Answer
- ## Edge cases
- ## Related

---

## Campaign

Use for marketing initiatives, demand generation programs, product launches, and seasonal campaigns.

### Frontmatter Example
```yaml
type: Campaign
title: Q4 Enterprise Demand Generation Campaign
description: Multi-channel paid and email outreach campaign targeting enterprise procurement leaders.
status: draft
tags: [campaign, marketing, demand-gen, q4]
stale_after: "<ISO 8601 timestamp 30 to 90 days from now, e.g. 2026-11-07T00:00:00Z>"
sources:
  - id: ad-brief
    resource: https://docs.google.com/document/d/1a2b3c4d5e6f7g8h9/view
    title: Q4 Demand Generation Campaign Brief
    author: Growth Marketing
    last_modified: 2026-10-01T08:00:00Z
```

### Body Headings
- ## Goal
- ## Audience
- ## Channels and budget
- ## Timeline
- ## Results
- ## Learnings

---

## Persona

Use for target customer archetypes, buyer personas, evaluation motivations, and pain points.

### Frontmatter Example
```yaml
type: Persona
title: VP of Operations Buyer Persona
description: Role profile, purchasing criteria, and objections for operations leadership decision-makers.
status: draft
tags: [persona, sales, marketing, buyer-profile]
stale_after: "<ISO 8601 timestamp 90 to 180 days from now, e.g. 2027-01-06T00:00:00Z>"
sources:
  - id: notion-buyer-persona
    resource: https://notion.example.com/company/product/personas/vp-ops
    title: "Buyer Persona Research: VP Operations"
    author: Product Marketing
    last_modified: 2026-06-12T15:30:00Z
```

### Body Headings
- ## Who they are
- ## Goals
- ## Pain points
- ## How we talk to them

---

## Product

Use for product packaging, edition tiers, feature sets, pricing models, and target market segments.

### Frontmatter Example
```yaml
type: Product
title: Team Edition Subscription Tier
description: Overview of features, user seat limits, pricing tiers, and positioning for Team Edition.
status: draft
tags: [product, pricing, catalog, sales]
stale_after: "<ISO 8601 timestamp 90 to 180 days from now, e.g. 2027-01-06T00:00:00Z>"
sources:
  - id: product-spec
    resource: https://handbook.example.com/commercial/product-catalog
    title: Commercial Product Catalog and Tier Definitions
    author: Product Team
    last_modified: 2026-07-01T10:00:00Z
```

### Body Headings
- ## What it is
- ## Who it's for
- ## Pricing and plans
- ## Common questions

---

## Template

Use for reusable message templates, email replies, proposal outlines, and standard document skeletons.

### Frontmatter Example
```yaml
type: Template
title: Security Questionnaire Response Email
description: Standardized canned response for answering prospective customer security and compliance inquiries.
status: draft
tags: [template, sales, security, support]
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-06T00:00:00Z>"
sources:
  - id: notion-canned-response
    resource: https://notion.example.com/company/sales/security-canned-response
    title: Security Canned Response Library
    author: Security Team
    last_modified: 2026-09-05T13:45:00Z
```

### Body Headings
- ## When to use
- ## Template text
- ## Placeholders

---

## Complete Decision Example

```yaml
---
type: Decision
title: Use PostgreSQL for Persistent Relational Storage
description: Select PostgreSQL as the primary relational datastore for orders and accounts.
status: stable
tags:
  - database
  - storage
  - postgresql
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-03T00:00:00Z>"
sources:
  - id: adr-004
    resource: github.com/acme/shop/docs/adr/004-storage.md
    commit: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
---

## Context
The order processing service requires ACID transactions, robust foreign key constraints, and relational queries across customers, orders, and payment records[^adr-004]. Prior iterations relied on SQLite for prototypes, which lacked concurrent write performance under staging workloads.

## Decision
Adopt PostgreSQL 16 as the primary relational datastore managed through migration scripts in the codebase. All transactional data access flows through the [Order Service](/architecture/order-service.md).

## Consequences
- Guarantees strict transactional consistency and row-level locking.
- Requires maintaining connection pooling via PgBouncer in production.
- Developers must run PostgreSQL locally or via container tooling during development.

## Alternatives considered
- MySQL 8.0: rejected due to differences in JSON indexing and less flexible transactional DDL support.
- DynamoDB: rejected because multi-table ACID transactions and flexible reporting queries introduced unnecessary complexity.

[^adr-004]: Recorded in Architecture Decision Record 004, `docs/adr/004-storage.md`.
```

---

## Complete Non-Code Decision Example

```yaml
---
type: Decision
title: Customer Refund Window and Eligibility
description: Policy granting full refunds within thirty days of purchase for unredeemed services.
status: stable
tags:
  - policy
  - finance
  - refunds
stale_after: "<ISO 8601 timestamp 180 days from now, e.g. 2027-04-03T00:00:00Z>"
sources:
  - id: refund-policy
    resource: https://handbook.example.com/finance/refunds
    title: Customer Operations Refund Policy
    author: Finance Team
    last_modified: 2026-08-15T10:00:00Z
---

## Context
Customer support previously resolved refund requests ad hoc without a documented timeline, leading to inconsistent customer outcomes and delayed finance reconciliation[^refund-policy].

## Decision
All direct customers may request a full refund within 30 days of purchase for unused subscriptions or unredeemed service credits.

## Consequences
- Support agents can process eligible refunds immediately without manager approval.
- Reduces payment disputes and chargebacks.
- Finance reconciles processed refund ledger events monthly.

## Alternatives considered
- 14-day refund window: rejected as too short for customer evaluation.
- No cash refunds / store credit only: rejected due to negative impact on trial conversion.

[^refund-policy]: Documented in Customer Operations Policy, `https://handbook.example.com/finance/refunds`.
```

---

## Complete Business FAQ Example

```yaml
---
type: FAQ
title: Annual Subscription Proration and Midterm Seat Additions
description: Standard answer for customer questions regarding adding user seats during an active contract year.
status: draft
tags:
  - faq
  - billing
  - support
stale_after: "<ISO 8601 timestamp 90 to 180 days from now, e.g. 2027-01-06T00:00:00Z>"
sources:
  - id: billing-kb
    resource: https://support.example.com/kb/articles/billing-proration
    title: "Knowledge Base Article: Annual Billing Proration"
    author: Finance Team
    last_modified: 2026-08-25T11:00:00Z
---

## Question
How are additional user seats billed when added midway through an annual contract term?

## Answer
When an account administrator adds seats during an active annual billing cycle, the new seats are billed on a prorated basis for the remaining days until the renewal date[^billing-kb]. The system issues an immediate invoice for the prorated charge, and the renewed total seat count will apply automatically at the next annual billing renewal.

## Edge cases
- Reductions in seat count during an active annual term take effect only at the end of the current term; unused time on removed seats is not refunded.
- For customers invoiced under custom contractual terms (such as Net 30), a separate prorated invoice is generated immediately rather than charged directly to a credit card.

## Related
- [Customer Refund and Return Policy](/policies/refund-policy.md)
- [Enterprise Discount Approval Matrix](/policies/discount-matrix.md)

[^billing-kb]: Documented in Billing Knowledge Base Article 104, `https://support.example.com/kb/articles/billing-proration`.
```
