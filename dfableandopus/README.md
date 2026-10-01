# HR workspace: job-readiness pack

The sibling folder `astraupskill/` teaches how this application works. This folder turns the same code into interview material: what a panel will ask about a leave-approval workflow, how to tell the story, and how to survive a live screen share.

The application is an npm workspace. `backend/` is Express 4 with TypeScript, Zod and Prisma 6 over PostgreSQL 18; `frontend/` is React 18 and Vite; `browser-tests/` is Playwright. The domain is departments, employees with a self-referencing manager chain, and leave requests that move through PENDING, APPROVED, REJECTED and CANCELLED. The part worth an hour of interview time is `decide` in `backend/src/repositories/leaveRepository.ts:212-263`: the decision a manager or HR makes on somebody else's leave request.

## The pitch

"I fixed a leave-approval endpoint that trusted the caller. It took an `approverId` out of the request body and set the status without checking who was asking, whether they still managed that person, or what state the request was already in. Now the body carries only intent, a captured version, a status and a note. The server derives identity from the verified token, re-reads the reporting relationship inside the transaction after locking the employee row, refuses self-approval, refuses anyone who is not HR or the current direct manager, and applies the change with a conditional update that requires both the captured version and a PENDING status. Overlapping leave is prevented twice: by a repository check and by a PostgreSQL exclusion constraint over an inclusive date range, so it holds even when the repository is bypassed. The verification run passed 76 checks."

## Target stacks

Aimed at Node and TypeScript back-end roles, and at any interview where the words "optimistic concurrency" come up. For a .NET panel, `updateMany({ where: { id, version, status: "PENDING" } })` is the same idea as `ExecuteUpdateAsync` with a predicate or a `[ConcurrencyCheck]` column raising `DbUpdateConcurrencyException`; the exclusion constraint has no EF Core equivalent and is written in the migration by hand either way. Zod maps to FluentValidation.

## How to use it over two weeks

- Days 1 to 3: [01-INTERVIEW-QUESTIONS.md](01-INTERVIEW-QUESTIONS.md), with `backend/src/repositories/leaveRepository.ts` and `backend/src/repositories/scope.ts` open.
- Days 4 and 5: [02-STORIES-AND-RESUME.md](02-STORIES-AND-RESUME.md). The numbers come from `astraupskill/VERIFICATION.md`.
- Days 6 to 8: [03-CODE-READING-DRILL.md](03-CODE-READING-DRILL.md), out loud and on a clock.
- Days 9 to 11: [04-TAKE-HOME.md](04-TAKE-HOME.md), submitted as if it were real.
- Days 12 and 13: [05-SYSTEM-DESIGN-FOLLOWUPS.md](05-SYSTEM-DESIGN-FOLLOWUPS.md).
- Daily: [06-FLASHCARDS.md](06-FLASHCARDS.md).

## Limits to name before an interviewer finds them

`astraupskill/VERIFICATION.md` lists them, and mentioning them is the strong answer rather than the risky one: leave dates are inclusive calendar days with no balances, entitlements, holidays or jurisdiction rules; the `Review` model exists in the schema with no CRUD behind it; create requests have no durable idempotency receipt, so a dropped response on a new leave request is not safely retryable the way an edit is; sign-in throttling is process-local; and audit rows record who changed what at which version without storing before-and-after snapshots.
