# HR workspace course: CRUD with ownership and workflow

This project teaches how ordinary forms become a reliable application when records belong to people and actions depend on state. The original starter had employee and leave endpoints, but authorization and overlap checks were comments, its Prisma relationships were inconsistent, and its test runner did not match the test imports. The improvement supplies a runnable local system with verified identity, scoped access, employee/department CRUD, and an owned leave workflow.

Your learning target is to explain three things for every request: who may perform it, what state may change, and what survives a failure. Those questions are central to mid-level CRUD development. A successful button click is only the beginning of the evidence.

## Prerequisites and glossary

**Prerequisites:** TypeScript with Express-style routes, SQL and a little Prisma, and the idea of a signed token identifying a caller. The local-first courses (`JSProjectLearn`, `astra4.2`) cover versions and drafts before you meet them here against Postgres.

| Term | Meaning here | Where in this project |
|---|---|---|
| actor | The authenticated caller reduced to id, role and linked employee. | `Actor` in `backend/src/middleware/auth.ts` |
| scope | The query filter that decides which rows a role may even see. | `employeeScope` in `backend/src/repositories/scope.ts` |
| version | The per-row counter an update must match. | `version` columns in `backend/prisma/migrations/202609090001_hr_workspace/migration.sql` |
| stale write | A write whose expected version is out of date, refused with the draft preserved. | `if (current.version !== expected) throw stale()` in `backend/src/repositories/leaveRepository.ts` |
| transaction | The unit in which the row change and its audit row are written together. | the `Tx` client threaded through `backend/src/repositories/leaveRepository.ts` |
| advisory lock | A database lock taken for the whole transaction to serialise reporting-graph changes. | `chartLock` with `pg_advisory_xact_lock(74219801)` in `backend/src/repositories/employeeRepository.ts` |
| inclusive interval | Two leave ranges that share a single day overlap. | `overlap` in `backend/src/repositories/leaveRepository.ts` |
| state machine | Only a PENDING request may be edited, approved, rejected or cancelled. | the `status` guards in `backend/src/repositories/leaveRepository.ts` |
| audit event | The durable record of who changed what at which version. | `audit(tx, ...)` and the `AuditEvent` table in the migration SQL |
| verified authority | A manager may decide only for their own reports, checked server-side. | `approveLeave` in `backend/src/services/leaveService.ts` |
| HR-only guard | The narrower check used where a role label is not enough. | `requireHr` in `backend/src/middleware/auth.ts` |
| adoption | Replacing client state with the record the server accepted, including its new version. | `frontend/src/hooks/useWorkspace.ts` |

## Session boundaries

`02-CONCEPTS.md` covers five mid-level topics; do not read it in one sitting.

- **Session 1 (about 2 h):** `01` and `02` up to the state machine (roles vs scope, owner edits, calendar days).
- **Session 2 (about 2 h):** the rest of `02` (overlap intervals, versions, transactions, the reporting-graph lock and its cost) and `03` with the snapshots open.
- **Session 3 (about 2 h):** `04` including the break-it section, then `07`.
- **Session 4+:** `05` tasks in order, checking task 1 against `06` before attempting the harder two.

## Suggested progression

1. Follow [the root setup](../README.md) with fictional data. Sign in as an employee, a manager, and HR. Compare the records each can see and the actions each can perform. The department reference catalogue is available to authenticated users; employee and leave details have narrower access.
2. Read [the codebase map](01-CODEBASE-MAP.md). Trace a leave request from the React form through authentication, input validation, ownership checks, row locking, database insertion, audit, and response adoption.
3. Study [the concepts](02-CONCEPTS.md). Predict what overlapping dates, self-approval, and two simultaneous decisions should do before testing them.
4. Reconstruct [the worked change](03-WORKED-CHANGE.md). Explain why a valid manager identity alone does not authorize a decision for every employee.
5. Run [the testing and debugging exercises](04-TESTING-AND-DEBUGGING.md). Inspect real persisted state after a deliberately failed audit write.
6. Implement [the practice tasks](05-PRACTICE.md), compare [solution reasoning](06-SOLUTIONS-AND-REVIEW.md), and complete [the trace lab](07-TRACE-LAB.md).

For a first session, create a fictional pending request with a short date range and a specific handover note. Open it in two tabs, change the note in both, and save one. The second save should conflict while retaining its draft. Export that draft and identify the captured version. Then sign in as the employee's manager and record a decision. Verify that the owner can cancel an approved request while preserving its decision history.

Keep an investigation journal: observation, hypothesis, experiment, result. For example, "both requests include July 12" is an observation. "They should both be accepted because they start on different days" is a hypothesis. The inclusive interval rule should disprove it. Record the response and unchanged row count as evidence.

Complete the course with a small patch, a regression test, an example request/response, and a compatibility note. Explain the difference between a draft export and a backup, a role label and authorization, an audit event and a recoverable full snapshot, and a timeout and a known rejection. Consult [verification](VERIFICATION.md) before claiming behavior beyond the tested local scope.
