# SWE Thought Process Journal - grokbuildhrproject

## Why HR System?
HR systems are classic enterprise CRUD with complexity:
- Sensitive data (PII) -> security, auditing
- Workflows (leave approval)
- Hierarchical data (org chart, managers)
- Compliance (access controls, audit logs)
- Multiple user roles with different views

This represents real work at small-mid companies: building internal tools that handle people processes.

## Architecture Decisions

### Backend: Layered Architecture
- Routes: Thin, handle HTTP concerns, validation, auth checks
- Controllers: Orchestrate, call services
- Services: Business logic, workflows (e.g., leave approval rules)
- Repositories: Data access with Prisma

Why this over flat structure?
- Testability: Services can be unit tested independently
- Maintainability: Changes to DB don't affect business rules directly
- Scalability of team: Different devs can own layers

### RBAC Implementation
Use middleware to attach user + roles, then services check permissions.
For leave: Only managers can approve for their direct reports, HR can see all.

### Workflow for Leave
Use state machine in service: PENDING -> APPROVED/REJECTED
Store history in separate audit table.

### Frontend
Feature folders: employees, leave, reviews
Use TanStack Query for all server state to avoid prop drilling and manual caching.
Separate forms into reusable components with Zod validation.

### Database
PostgreSQL with Prisma for strong typing and relations.
Use soft deletes for auditability.

## Key Challenges & Tradeoffs
- Handling manager hierarchy: Recursive queries or materialized path?
  Decision: Simple managerId for now, note recursive CTE as future.
- Data privacy: Always filter by permissions, never expose full employee list to non-HR.
- Performance: Index on employee manager_id, date fields for leave queries.

## Upskilling Focus
This project teaches:
- Thinking in domains and workflows instead of just CRUD
- Security by design (authz at multiple layers)
- Observability (audit logs)
- Testing business logic

Common junior mistakes avoided:
- Putting auth logic in components
- No separation between data and business rules
- Ignoring edge cases in approval flows (e.g., overlapping leave)

See code comments for line-by-line explanations.
