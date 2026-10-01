# Stories, resume lines and the spoken summary

## STAR story 1: the approval anyone could sign

**Situation.** The delivered leave decision endpoint read `approverId` from the request body and wrote the new status. Nothing checked whether the caller managed that employee, whether they were deciding their own leave, or whether the request had already been decided. The three delivered files are preserved as `astraupskill/snapshots/leaveRoutes-before.ts.txt`, `leaveService-before.ts.txt` and `leaveRepository-before.ts.txt`, so the change is a reviewable diff rather than a claim.

**Task.** Make a decision provably come from an authorized human, without adding a round trip to the user's click.

**Action.** The contract became intent only: `decisionInput` at `backend/src/lib/validation.ts:80-86` is `.strict()` and accepts a captured `version`, a status of `APPROVED` or `REJECTED`, and a note. Identity comes from the token through `Actor` (`backend/src/middleware/auth.ts:8`). Inside one transaction, `decide` at `backend/src/repositories/leaveRepository.ts:212-263` reads the request under the caller's scope, locks the employee row, re-reads, then refuses self-approval, refuses anyone who is not HR or the current direct manager, requires the captured version, and requires PENDING state before a conditional `updateMany` sets the status and stores `decidedById` from the actor.

**Result.** Two unit cases now fail if the old contract returns: "rejects caller-chosen employee actor status and decision fields on create" and "requires exact decision states and rejects supplied approver identities" (`backend/src/__tests__/leaveService.test.ts:64` and `:127`). Over HTTP, "only the direct manager or HR can decide a visible non-self request" (`backend/src/__tests__/workflow.integration.test.ts:608`) and "HR and managers cannot approve their own leave" (line 640) cover the authorization. The full verification run passed 76 checks.

## STAR story 2: two places that had to agree about a calendar day

**Situation.** Overlapping leave for one person is the bug users notice, and it is easy to get subtly wrong at the boundary: does a request ending on the 10th conflict with one starting on the 10th?

**Task.** Prevent overlap in a way that still holds if someone writes to the table without going through the repository.

**Action.** The repository check at `leaveRepository.ts:52-73` compares `startDate <= newEnd` and `endDate >= newStart` over PENDING and APPROVED rows and raises a 409 that tells the user what to do. The database carries the same rule as a constraint: `EXCLUDE USING gist ("employeeId" WITH =, daterange("startDate","endDate",'[]') WITH &&) WHERE ("status" IN ('PENDING','APPROVED'))` at `backend/prisma/migrations/202609090001_hr_workspace/migration.sql:141-143`, which needs the `btree_gist` extension created on the line above.

**Result.** Both layers agree that the shared day conflicts, pinned by "treats shared end days as overlap but allows the following day" (`workflow.integration.test.ts:485`). The constraint is proved independently by "database exclusion rejects overlap even when repository validation is bypassed" (line 529), and concurrency by "accepts only one of two overlapping concurrent requests" (line 510). The partial `WHERE` keeps cancelled and rejected history out of the index, so an old rejected request never blocks new dates.

## STAR story 3: one global lock, chosen on purpose

**Situation.** An employee's manager can be changed by HR. Cycle detection walks up the manager chain, so two edits at different points of the same chain can each be valid on their own and produce a loop together.

**Task.** Make cyclic org charts impossible without rewriting the hierarchy as a materialized path.

**Action.** Every employee create, update and delete first calls `chartLock` (`backend/src/repositories/employeeRepository.ts:23-25`), which takes `pg_advisory_xact_lock(74219801)`, a constant key, so org-chart writes are serialized system-wide. The walk itself is at lines 38-70: a `Set` seeded with the edited employee, a 1000-step bound, a 409 on revisit, and a rule that the immediate manager must be active and hold `MANAGER` or `HR_ADMIN`.

**Result.** "rejects direct and indirect reporting cycles" (`workflow.integration.test.ts:331`) and "serializes competing reporting changes so they cannot create a cycle" (line 351) both pass. The cost is written down rather than hidden: a single global lock means org-chart writes do not scale across instances, which is acceptable for a table that is edited rarely and is the kind of trade-off I want to be asked about.

## Resume bullets

- Replaced a leave-approval endpoint that trusted a client-supplied `approverId` with a versioned state transition that derives identity from a verified JWT and re-reads the reporting relationship inside the transaction.
- Enforced non-overlapping leave in two layers: an inclusive-interval repository check returning an actionable 409, and a PostgreSQL `btree_gist` exclusion constraint scoped by a partial `WHERE` to pending and approved rows.
- Serialized org-chart mutations with a transaction-scoped PostgreSQL advisory lock so concurrent manager reassignments cannot combine into a reporting cycle, with cycle detection bounded to 1000 steps.
- Wrote 54 backend tests over a helper-owned PostgreSQL 18 cluster covering competing decisions, stale versions, last-active-HR protection, referenced deletion and transaction rollback under injected audit failure; the full run passed 76 checks including 11 Playwright scenarios.
- Guaranteed that every mutation and its audit row commit together, proved by a trigger-based failure harness rather than asserted in a comment.

## 60-second spoken summary

"It is an HR workspace: departments, employees with a manager chain, and leave requests. Express, Prisma, PostgreSQL, React front end, Playwright for the browser. The piece I would show you is the leave decision. The client sends only the version it saw, approve or reject, and a note. The server takes identity from the token, opens a transaction, reads the request through a scope filter so you only ever see yourself and your reports unless you are HR, locks the employee row, then reads again, because a competing decision can land while you are waiting for the lock. Then four rules: not your own leave, HR or the current direct manager, the version you captured, and still pending. The write is a conditional update matching the version and the status, and if it changes zero rows that is a conflict. Overlapping dates are stopped by the repository and again by a PostgreSQL exclusion constraint over an inclusive date range, so it holds even if someone writes to the table directly. What it does not do is balances, holidays or entitlements, and creating a leave request is not idempotent."

## What I would do next

`astraupskill/05-PRACTICE.md` sets the direction and `astraupskill/VERIFICATION.md` names the gap: create requests have no durable idempotency receipt. An edit or a decision is safe to retry because it carries a version, but a `POST /api/leave` whose response was lost has no key to replay, and the exclusion constraint turns the honest retry into a confusing overlap conflict. I would add a client-generated request key with a unique index and a replay path that returns the original request with a 200, mirroring how `decide` already treats the version. After that, before-and-after values in `AuditEvent`, since the current rows record the actor, action and resulting version but not what the field used to be, and a shared sign-in limiter to replace the process-local `Map` in `backend/src/middleware/auth.ts:89`.
