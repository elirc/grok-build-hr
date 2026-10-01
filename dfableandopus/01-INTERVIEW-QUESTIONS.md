# Interview questions: HR workspace

Each question is tagged **[junior]** or **[mid]**. Technical answers cite a path and line that was checked on disk.

## Screening

**S1. What are the entities and how do they relate? [junior]**
`Department`, `User`, `Employee`, `LeaveRequest`, `AuditEvent` and a `Review` model that has no CRUD behind it. `Employee` is the interesting one: it points at a `User` for identity, at a `Department`, and at another `Employee` as its manager, so the org chart is a self-referencing tree. `LeaveRequest` belongs to an employee and records `status`, `startDate`, `endDate`, `type`, `reason`, `version`, plus `decidedById` and `decisionNote` once decided. Every mutation writes an `AuditEvent` through the shared `audit` helper at `backend/src/repositories/scope.ts:66-85`.

**S2. Why are `User` and `Employee` separate tables? [junior]**
Because not every employee record is a login. `astraupskill/VERIFICATION.md` says new employee records deliberately have no password, and `backend/src/repositories/employeeRepository.ts:140-142` creates the `User` with role `EMPLOYEE` and no credential. The `Actor` type carries both facts: `{ id, role, employeeId }` at `backend/src/middleware/auth.ts:8`, where `employeeId` is nullable because a user may have no employee profile.

**S3. Trace `PATCH /api/leave/:id/decision`. [junior]**
`backend/src/routes/leaveRoutes.ts:50-55` calls `service.approveLeave`. The service parses the body with `decisionInput` and re-parses the path id with `identity` (`backend/src/services/leaveService.ts:23-32`), then calls `repo.decide`. Everything before that is in `backend/src/app.ts`: a request id and `Cache-Control: no-store` at lines 23-32, a CORS origin check at 33-44, a 32 KiB strict JSON body at 45, a guard rejecting query parameters and non-JSON content types on non-GET requests at 53-61, and `authenticate(secret)` at 63.

**S4. Where is the boundary that validates? [junior]**
`backend/src/lib/validation.ts`, all Zod, every object `.strict()`. `decisionInput` (line 80) accepts exactly three fields: a bounded `version`, a status limited to `APPROVED` or `REJECTED`, and a `note` of at most 1000 characters. There is no `approverId` and no `decidedAt`, which is the whole point of the change: the previous version took the approver from the body.

**S5. How does the app know who you are, and how quickly does a change take effect? [junior]**
`authenticate` verifies an HS256 bearer token with an explicit algorithm, issuer `hr-workspace` and audience `hr-workspace-web` (`auth.ts:52-56`), then calls `publicUser`, which re-reads the user and its employee profile and throws 401 if `employee.active === false` (`auth.ts:40-41`). Tokens last 30 minutes (`auth.ts:26`), so the database read is what makes deactivation effective on the next request rather than in half an hour.

**S6. How is "what I am allowed to see" expressed? [mid]**
One function, `employeeScope` at `scope.ts:6-13`. HR gets `{}`, a manager gets `{ OR: [{ userId }, { manager: { userId } }] }`, an employee gets `{ userId }`, and an unknown role throws 403. It is spread into the `where` of every lookup, including the leave lookup at `backend/src/repositories/leaveRepository.ts:24`, so a request outside your scope is a 404, not a 403. The unit case is "manager scope includes self and direct reports without trusting query filters" (`backend/src/__tests__/leaveService.test.ts:176`).

**S7. What does the error handler promise? [mid]**
`backend/src/lib/errors.ts:19-70`. An `AppError` carries its own status. A `ZodError` becomes 400 with at most six `path: message` pairs. Prisma `P2002`, `P2003` and `P2034` become 409; other known Prisma errors and initialization failures become 503; body-parser failures become 413 or 400. Only `status >= 500` logs. Every response body includes the `requestId` that was also returned in `X-Request-Id`.

**S8. Why does a manager get a 404 rather than a 403 for another team's leave request? [mid]**
Because the scope is part of the query, not a check after it. `scoped` at `leaveRepository.ts:22-30` runs `findFirst` with `employee: employeeScope(actor)` and throws "Leave request not found within your access." A 403 would confirm that the record exists, which leaks organizational structure to a curious manager.

## Deep dive

**D1. Walk me through `decide`. [mid]**
`leaveRepository.ts:212-263`, all inside one `prisma.$transaction`. It reads the request under scope, locks the employee row with `SELECT ... FOR UPDATE` through `lockEmployee` (`scope.ts:91-96`), then reads the request again. Then four rules in order: not your own request (line 223), HR or the current direct manager only (lines 228-238), the captured version must match (line 239), and the status must still be PENDING (line 240). The write is a conditional `updateMany` matching `{ id, version: expected, status: "PENDING" }` that sets the status, `decidedById` from the actor, the note and `version: { increment: 1 }`. `changed.count !== 1` throws `stale()`.

**D2. Why read the row twice? [mid]**
The first read at line 220 is the scope check and tells us which employee to lock. Between that read and acquiring the lock, a competing decision can commit. The second read at line 222 is the one every rule is evaluated against, so the version check and the PENDING check see post-lock truth. Reading once and locking afterwards would evaluate the rules against a snapshot that may already be wrong.

**D3. The version check and the PENDING check look redundant. Are they? [mid]**
No, and this is the sentence to have ready. They protect different invariants. The version says "the record you looked at is the record you are acting on"; the status says "this record is still in a state where a decision is meaningful." A caller who refetches after losing the race now holds version two and passes the version check, but the request is APPROVED, so the status rule refuses it. Without the status rule, re-deciding an already terminal request would succeed at the new version and silently overwrite the first decision. The integration case is "accepts one concurrent decision and forbids later terminal decisions" (`backend/src/__tests__/workflow.integration.test.ts:683`).

**D4. Why is the manager check done against the database rather than the token? [mid]**
Because reporting lines change. `auth.ts:21` signs an empty payload with only a subject, so the token carries no role and no manager; the role comes from `publicUser` on every request, and the manager relationship is read inside the transaction at line 232 as `current.employee.managerId === actor.employeeId`. The case that proves it is "uses current reporting relationships for decisions" (`workflow.integration.test.ts:653`): reassign someone and the old manager immediately loses authority.

**D5. How is overlapping leave prevented? [mid]**
Twice. In the repository, `overlap` at `leaveRepository.ts:52-73` looks for a PENDING or APPROVED request for the same employee where `startDate <= newEnd` and `endDate >= newStart`, which is the inclusive interval test, and throws a 409 naming the fix. In the database, `backend/prisma/migrations/202609090001_hr_workspace/migration.sql:141-143` declares `EXCLUDE USING gist ("employeeId" WITH =, daterange("startDate","endDate",'[]') WITH &&) WHERE ("status" IN ('PENDING','APPROVED'))`.

**D6. Why keep both if the constraint is authoritative? [mid]**
The repository check produces a sentence a human can act on. The constraint produces a `P2002`-class violation that `errors.ts:37-41` renders as a generic 409, and it holds even for a writer that skips the repository, which is exactly what "database exclusion rejects overlap even when repository validation is bypassed" (`workflow.integration.test.ts:529`) asserts. The partial `WHERE` clause is the subtle part: cancelled and rejected requests are excluded from the index, so historical leave does not block new dates.

**D7. What is `daterange(start, end, '[]')` doing? [mid]**
Building an inclusive-inclusive range, so a request ending on the 10th and one starting on the 10th overlap. That matches the repository's `lte`/`gte` comparison and the test "treats shared end days as overlap but allows the following day" (`workflow.integration.test.ts:485`). Changing it to `'[)'` would silently permit a shared last day and make the two layers disagree, which is the worst outcome because the repository would pass and the constraint would not fire.

**D8. Explain the advisory lock in the employee repository. [mid]**
`chartLock` at `backend/src/repositories/employeeRepository.ts:23-25` runs `pg_advisory_xact_lock(74219801)` with a constant key, so every employee create, update and delete serializes globally. It exists because cycle detection walks the manager chain (lines 38-70) and a concurrent edit elsewhere in the chain could make two individually valid changes jointly cyclic. The trade-off is the honest part: one global lock means org-chart writes do not scale horizontally. `astraupskill/02-CONCEPTS.md` names that cost, and the alternative, locking every row on the path in a consistent order, is more code for a table where writes are rare.

**D9. How does cycle detection actually work? [mid]**
It walks upward from the proposed manager, collecting ids in a `Set` seeded with the employee being edited (line 40). If it revisits an id, or walks more than 1000 steps, it throws 409 "The reporting relationship would create a cycle or exceeds the supported hierarchy depth." (lines 43-47). It also enforces that the immediate manager is active and has role `MANAGER` or `HR_ADMIN` (lines 64-68). The database backs part of this with `Employee_not_self_manager CHECK ("managerId" IS DISTINCT FROM id)` at `migration.sql:147`, which only catches the one-step case.

**D10. What breaks if you remove the `status: "PENDING"` clause from the update at line 243? [mid]**
The four guards above it still run, so a single well-behaved caller sees no difference. What breaks is the guarantee under the lock's absence in future code: the clause is the last line of defence that makes the write itself state-aware rather than trusting that the read above it was accurate. Combined with removing the read-side check it would allow a request that is already APPROVED to be re-decided at its current version, producing a second audit row and a changed `decidedById` for a finished decision.

**D11. Can an employee delete a decided request? [junior]**
No. `remove` at `leaveRepository.ts:184-211` requires ownership, the captured version, and `status === "PENDING"`, with the message "Only pending requests can be deleted. Cancel accepted requests to retain their history." Cancellation, at lines 264-292, accepts PENDING or APPROVED and writes `CANCELLED` rather than deleting, so the audit trail and the row survive. That pair is covered by "approved requests cannot be edited or deleted but the owner can cancel" (`workflow.integration.test.ts:707`).

**D12. Why can't an HR administrator deactivate themselves into a locked-out system? [mid]**
`employeeRepository.ts:173-181` counts active HR administrators before allowing a transition from active to inactive for an HR user and throws 409 "Keep at least one active HR administrator." It runs under `chartLock`, so two simultaneous deactivations cannot both read a count of two. The case is "does not deactivate the last active HR administrator" (`workflow.integration.test.ts:298`).

**D13. Why does deletion of an employee check three relations? [mid]**
`deleteMany` at lines 221-229 matches `{ id, version, leaveRequests: { none: {} }, reviews: { none: {} }, reports: { none: {} } }`. Anything else is a 409 telling the caller to deactivate instead. Line 216 refuses first if the target is not a plain `EMPLOYEE` or is the caller themselves. The intent is that deletion is only for a record that never became history.

**D14. How do you know audit rows and their effects commit together? [mid]**
The integration suite installs a trigger that raises `synthetic internal audit detail` on every `AuditEvent` insert (`workflow.integration.test.ts:61-74`) and uses it in four places, including "audit failure rolls back leave edits deletes decisions and cancellation" (line 781) and "audit failure leaves no newly created leave record" (line 817). Each asserts the failure status and then asserts the data did not move.

## Behavioral

**B1. Tell me about a time you found an authorization hole. [mid]**
*Situation:* the delivered leave decision endpoint accepted `approverId` in the body and set the status with no check on the caller, the relationship or the previous state. The delivered files are kept in `astraupskill/snapshots/leaveRoutes-before.ts.txt` and its two siblings, so the diff is reviewable. *Task:* close it without turning a one-click approval into a multi-step form. *Action:* I removed identity from the contract, derived it from the verified token, and turned the decision into a versioned state transition guarded inside a transaction after locking the employee row. *Result:* the decision body is now three fields, and "rejects caller-chosen employee actor status and decision fields on create" plus "requires exact decision states and rejects supplied approver identities" (`leaveService.test.ts:64` and `:127`) fail loudly if anyone reintroduces it. The verification run passed 76 checks.

**B2. Describe a trade-off you made knowingly. [mid]**
The constant advisory lock at `employeeRepository.ts:24`. It serializes every org-chart write in the whole system, which is a real throughput ceiling. I took it because cycle detection reasons about a path, not a row, and two concurrent edits at different points of the same path can each be valid alone and cyclic together. The case "serializes competing reporting changes so they cannot create a cycle" (`workflow.integration.test.ts:351`) is the evidence. I wrote the cost into the course rather than leaving a future reader to discover it.

**B3. When did a test change your mind? [mid]**
The inclusive-date case. My first overlap check compared with exclusive end dates, and "treats shared end days as overlap but allows the following day" (`workflow.integration.test.ts:485`) failed. Fixing it in the repository was easy; the point is that it forced the same decision in the migration, where `daterange(...,'[]')` had to match. Two layers that disagree about the boundary would have been worse than one layer being wrong.

**B4. Tell me about something you did not build. [mid]**
Leave balances, entitlements, holidays and jurisdiction rules, all named in `astraupskill/VERIFICATION.md`, and durable idempotency on create. Edits and decisions are safe to retry because they carry a version; a `POST /api/leave` whose response was lost is not, because there is no receipt keyed to a client request id. I would rather say that in an interview than let someone find it, and it is the first thing I would add.

**B5. How do you make failure useful to the user? [mid]**
The conflict message is written for a person: "This record changed. Export your draft, then load the current record before retrying." (`scope.ts:86-90`). The front end honours the second half: in `frontend/src/features/leave/pages/LeavePage.tsx` the unsaved decision note survives a rejected decision, and export includes the captured version. The browser suite covers "exportable drafts" and "conflict recovery" per `astraupskill/VERIFICATION.md`.

## Follow-ups the interviewer asks next

**F1. Your decision transaction does four checks and then a conditional update. Is the conditional update not enough on its own?**
Functionally, for version and status, it is: `updateMany` matching `{ id, version, status }` returning zero rows would catch both. The read-side checks exist to produce distinct, actionable messages, "Only pending requests can receive a decision." versus the generic stale message, rather than one 409 for two different situations. The authorization checks cannot be folded into the predicate at all, because they involve the actor and the employee relationship.

**F2. Why lock the employee rather than the leave request?**
Because the rules are about the employee: who manages them right now, and whether any of their other requests overlap. Locking the employee serializes every decision and every date change for one person, which is the unit of contention that matters, and it is the same lock `ownEmployee` takes at `leaveRepository.ts:37` for creates and edits. Locking the request row would let two decisions on two different requests of the same person interleave with the overlap check.

**F3. `history` returns audit rows. Can I read someone else's?**
`history` at `leaveRepository.ts:293-300` parses both ids and queries `AuditEvent` by resource. Access is enforced by the service and route path, and the suite includes "owner deletes pending requests while retaining authorized audit" (`workflow.integration.test.ts:587`). The honest answer in an interview is to say the scope check for audit reads is the thing I would re-verify first if I were reviewing my own code, because it lives in a different place from the `scoped` helper that guards every other read.

**F4. What does `literal()` in the search filters protect against?**
A `contains` filter with `mode: "insensitive"` passes the string to SQL `LIKE`, where `%` and `_` are wildcards. `literal` escapes them, so searching for a position containing `_` does not match every single-character difference. It is used at `leaveRepository.ts:86` and `employeeRepository.ts:82`. This is not SQL injection, which Prisma already parameterizes; it is filter-semantics leakage, and the test is "literal employee search and bounded leave pages stay within access" (`workflow.integration.test.ts:827`).

**F5. Why `RepeatableRead` on the list query?**
`findMany` at `leaveRepository.ts:106-122` runs the page and the count in one transaction at `RepeatableRead`, so the total cannot disagree with the rows. The price is that a serialization failure would arrive as `P2034`, which `errors.ts:38` maps to 409, a strange status on a GET. At this size it does not happen; at scale I would drop the transaction before I dropped the count.

**F6. If this went to production next month, what is first?**
Idempotent creation of leave requests, because it is the one write a user can accidentally duplicate, and the exclusion constraint turns that duplicate into a confusing 409 rather than a clean replay. Second, a shared sign-in limiter, since the current one is a `Map` inside one process (`auth.ts:88-89`). Third, before-and-after snapshots in the audit rows, because "who changed this at version 4" is not enough to answer an HR dispute.
