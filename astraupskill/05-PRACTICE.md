# Practice: extend the HR workspace deliberately

Part A needs only Node 22: each drill copies a few lines of real source into a scratch file outside the repo and checks them with `node --test`. Part B changes the application and is checked with `npm run test:api` (PostgreSQL helper). For every Part B task, write an example request, the expected rejected request, the permitted actor, the version behavior, and the rollback expectation before coding. Read [the solution review](06-SOLUTIONS-AND-REVIEW.md) only after making your own design.

## Part A: runnable drills (no install, no database)

Start a scratch file such as `../scratch/hr.test.mjs` with `import test from "node:test";` and `import assert from "node:assert/strict";`. Copy logic as plain JavaScript (drop types and Zod wrappers).

### Exercise 1: calendar days and the 366-day span

**Goal:** know exactly which dates and spans the API accepts.

Copy the `date` refine body (`backend/src/lib/validation.ts:16-27`) as `isCalendarDate(value)` (keep the regex test) and the span rule (lines 70-78) as `spanOk(start, end)`. Assert: `2032-02-29` is valid and `2031-02-29` is not; `2031-1-05` and `2101-01-01` are rejected; `2031-01-01`→`2032-01-01` is accepted but `2031-01-01`→`2032-01-02` is not.

**Check:** `node --test ../scratch/hr.test.mjs` passes. Explain in one sentence why the rule is `< 366` on the day *difference* while the README promises "a maximum span of 366 days" (the interval is inclusive). Then find the same bound in SQL: `LeaveRequest_dates_valid` in the migration (line 144-145).

### Exercise 2: inclusive overlap

**Goal:** reproduce the July 10-12 / July 12-14 rule from [the concepts](02-CONCEPTS.md) by computation.

Turn the `where` in `overlap()` (`backend/src/repositories/leaveRepository.ts:58-65`) into a predicate over ISO date strings and a status. Assert that a PENDING July 10-12 overlaps July 12-14, does not overlap July 13-14, and that a CANCELLED row overlaps nothing.

**Check:** the test passes. Name the database object that enforces the same rule when the repository is bypassed (`LeaveRequest_no_overlap`, migration lines 141-143, using `daterange(..., '[]')`) and say what `'[]'` means.

### Exercise 3: reporting-cycle detection

**Goal:** see why the manager-chain walk needs a `seen` set seeded with the employee being edited.

Copy the loop from `checkReferences` (`backend/src/repositories/employeeRepository.ts:38-70`) into a function that walks an in-memory chart object instead of `tx.employee.findUnique`. With the chart `ceo ← mgr ← dev`, assert that moving `dev` under `ceo` is accepted, that moving `mgr` under `dev` throws, and that making `ceo` its own manager throws.

**Check:** the test passes. Then explain why this check alone is not enough under concurrency, and which line makes it safe (`chartLock`, lines 23-25, taken before `checkReferences` at lines 138-139 and 165-172).

### Exercise 4: decision authority as a truth table

**Goal:** state precisely who may approve whose leave.

Write `mayDecide(actor, request)` from `decide` (`leaveRepository.ts:223-238`), combining the self check and the role/manager check. Assert five rows: direct manager yes; another manager no; HR yes; an HR admin deciding their own request no; an EMPLOYEE no.

**Check:** the test passes with all five rows. Then point to the integration tests that pin the same table against the real database (`workflow.integration.test.ts:608`, `:640`, `:653`).

## Part B: application changes (PostgreSQL helper required)

### Exercise 5: close the reference-options gap

**Goal:** make the server, not the UI, decide who may list manager options.

`GET /api/employees/options` (`backend/src/routes/employeeRoutes.ts:12-17`) calls `options` (`services/employeeService.ts:35`, `repositories/employeeRepository.ts:240-262`) with no role check, so any signed-in employee can list every active manager's and HR administrator's employee id and name. Only the UI hides it (`enabled: canEdit` at `frontend/src/features/employees/pages/EmployeesPage.tsx:54`). Add the guard in the service, as the mutations already do.

**Check:** a new integration test shows `demo_worker` receives 403 and `demo_hr` 200 from `/api/employees/options`, and the existing browser scenario "HR creates edits and explicitly deletes an unreferenced employee aggregate" (`browser-tests/hr.spec.mjs:138`) still passes under `npm run verify`.

### Exercise 6: add a bounded manager filter

**Goal:** let HR filter the directory by manager without widening anyone's access.

The API already searches name, email, and position and filters by `active` and `departmentId` (`validation.ts:94-101`); the UI sends only `q`, `page`, and `active` (`EmployeesPage.tsx:46-50`). Add `managerId`, composed with `employeeScope` rather than replacing it, and a labelled control whose value is part of the React Query key.

**Check:** integration tests cover an empty result, an unknown id, a malformed id (400), and a manager filtering by another manager's id (empty, never another team); in each case `total` equals the number of rows the same predicate returns.

### Exercise 7: make reference selection scale

**Goal:** replace the 500-row options list with searchable, paginated selection that keeps foreign-key identity.

Keep the current selected value visible even when it is outside the fetched page. Two people can share a name: the id is the relationship, the label is presentation.

**Check:** a component test fires a slow search followed by a fast one and shows the older response does not replace the newer choices; another shows an unsaved employee draft survives a failed lookup.

### Exercise 8: introduce reviews as an actual workflow

**Goal:** turn the unused `Review` model into one complete vertical slice.

A manager drafts a review for a direct report, edits it with a version, and submits it (DRAFT to SUBMITTED). Add a forward migration rather than editing the applied one.

**Check:** integration tests cover self-review denial, unrelated-manager denial, two concurrent submits (one 200, one 409), and a forced audit failure (reuse the trigger technique at `workflow.integration.test.ts:781`) that leaves the status DRAFT.

### Exercise 9: resolve ambiguous create retries

**Goal:** make a retried leave create return the same request instead of a 409 overlap.

Add an idempotency key scoped to the actor, store a fingerprint of the validated input, and commit the receipt with the leave and audit.

**Check:** the same key and payload sent twice concurrently produce one row and the same id in both responses; the same key with different dates returns 409; a key reused after the request was deleted behaves as your documented contract says.
