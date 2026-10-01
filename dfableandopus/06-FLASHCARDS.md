# Flashcards: HR workspace

Cover the right column. Every answer is specific to this repository.

| Question | Answer |
|---|---|
| Which endpoint decides a leave request? | `PATCH /api/leave/:id/decision`, `backend/src/routes/leaveRoutes.ts:50-55` |
| What may the decision body contain? | `version`, `status` of APPROVED or REJECTED, and a note up to 1000 characters (`backend/src/lib/validation.ts:80-86`) |
| What did the delivered version accept that it no longer does? | `approverId` in the body; the snapshots are in `astraupskill/snapshots/` |
| Four rules inside `decide`, in order? | Not your own request, HR or current direct manager, captured version, still PENDING (`backend/src/repositories/leaveRepository.ts:223-241`) |
| Why is the leave request read twice in `decide`? | The first read gives scope and the employee to lock; a competing decision can commit while the lock is acquired, so rules run against the second read |
| What does `lockEmployee` run? | `SELECT id FROM "Employee" WHERE id=$1 FOR UPDATE` (`backend/src/repositories/scope.ts:91-96`) |
| Version check versus PENDING check? | Different invariants: "you acted on what you saw" versus "a decision is still meaningful"; a refetched caller passes the first and fails the second |
| The decision write predicate? | `updateMany({ where: { id, version: expected, status: "PENDING" } })`, `leaveRepository.ts:242-243` |
| What does `count !== 1` produce? | `stale()`: 409 "This record changed. Export your draft, then load the current record before retrying." (`scope.ts:86-90`) |
| Where does the approver identity come from? | `decidedById: actor.id` (`leaveRepository.ts:246`), never the body |
| How is the manager relationship checked? | `current.employee.managerId === actor.employeeId`, read from the database inside the transaction (`leaveRepository.ts:232`) |
| Why does `Actor` carry both `id` and `employeeId`? | Self-approval compares user ids; the manager rule compares employee ids (`backend/src/middleware/auth.ts:8`) |
| What does `employeeScope` return for a manager? | `{ OR: [{ userId }, { manager: { userId } }] }`, one level of reports (`scope.ts:10`) |
| Out-of-scope leave request: 403 or 404? | 404, "Leave request not found within your access." (`leaveRepository.ts:27-28`), because the scope is inside the query |
| Unknown role in `employeeScope`? | 403 "Unsupported account role." A new enum value fails closed (`scope.ts:12`) |
| How is overlapping leave blocked in code? | `startDate <= newEnd` and `endDate >= newStart` over PENDING and APPROVED rows (`leaveRepository.ts:58-67`) |
| How is it blocked in the database? | `EXCLUDE USING gist ("employeeId" WITH =, daterange(start,end,'[]') WITH &&) WHERE status IN ('PENDING','APPROVED')`, `migration.sql:141-143` |
| Which extension does that need? | `btree_gist`, created at `migration.sql:140` |
| Why is the exclusion constraint partial? | So cancelled and rejected history never blocks new dates |
| What does `'[]'` mean in `daterange`? | Inclusive on both ends, so a shared boundary day is an overlap |
| Which test proves the constraint independently? | "database exclusion rejects overlap even when repository validation is bypassed", `backend/src/__tests__/workflow.integration.test.ts:529` |
| Longest allowed leave request? | Under 366 calendar days, enforced in Zod (`validation.ts:70-78`) and by `LeaveRequest_dates_valid` at `migration.sql:144-145` |
| Valid date range for any date field? | 1970-01-01 through 2100-12-31 (`validation.ts:24-25`) |
| Who may edit a leave request? | Only its owner, only while PENDING, only with the captured version (`leaveRepository.ts:155-162`) |
| Who may cancel, and from which states? | The owner, from PENDING or APPROVED (`leaveRepository.ts:268-278`) |
| Why cancel rather than delete an approved request? | Deletion is refused so history survives: "Cancel accepted requests to retain their history." (`leaveRepository.ts:194-198`) |
| What is `chartLock`? | `pg_advisory_xact_lock(74219801)`, a constant key serializing every employee write (`backend/src/repositories/employeeRepository.ts:23-25`) |
| Why a constant key? | Cycle detection reasons about a whole manager chain, not one row; the cost is that org-chart writes do not scale out |
| How does cycle detection terminate? | A `Set` seeded with the edited employee plus a 1000-step bound, 409 on revisit (`employeeRepository.ts:40-47`) |
| Which database constraint backs it? | `Employee_not_self_manager CHECK ("managerId" IS DISTINCT FROM id)`, `migration.sql:147`, one step only |
| Can the last HR administrator be deactivated? | No: 409 "Keep at least one active HR administrator." (`employeeRepository.ts:173-181`) |
| When is an employee deletable? | Only with no leave, reviews or reports, only role EMPLOYEE, not the caller (`employeeRepository.ts:216-229`) |
| Token lifetime and payload? | 30 minutes, HS256, empty payload with the user id as subject, issuer `hr-workspace` (`auth.ts:20-28`) |
| What makes deactivation immediate despite the 30 minute token? | `publicUser` re-reads the user each request and 401s when `employee.active === false` (`auth.ts:40-41`) |
| Which Prisma codes become 409? | `P2002`, `P2003`, `P2034` (`backend/src/lib/errors.ts:38`) |
| Body limit and its status? | 32 KiB; `entity.too.large` becomes 413 (`app.ts:45`, `errors.ts:52-54`) |
| Query string on a non-GET `/api` request? | 400 "Mutation routes do not accept query parameters." (`app.ts:53-57`) |
| What does `literal()` prevent? | `%` and `_` in a search term acting as SQL `LIKE` wildcards |
| Page size and isolation of list reads? | 20 per page, rows and count in one `RepeatableRead` transaction (`leaveRepository.ts:106-122`) |
| How is audit atomicity proved? | A trigger raising on every `AuditEvent` insert, `workflow.integration.test.ts:61-74`, used by four cases |
| How many checks did verification pass? | 76: 54 backend, 8 frontend, 3 setup, 11 browser (`astraupskill/VERIFICATION.md`) |
| Command for the backend suite? | `npm run test:api`, which is `node scripts/test-database.mjs api` |
| Two limits to say out loud in an interview? | No leave balances, holidays or entitlements, and creating a leave request has no durable idempotency receipt |
