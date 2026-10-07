# Concept Templates

Templates and structural conventions for ok-fine knowledge concepts.

## Decision

Use for architectural, technical, and process decisions with enduring impact.

### Frontmatter Example
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
```

### Body Headings
- ## Definition
- ## Usage
- ## Related

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
