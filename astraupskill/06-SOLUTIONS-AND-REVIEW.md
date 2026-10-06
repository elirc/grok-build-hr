# Solution reasoning and review standards

A useful review explains why a boundary holds under failure, not just why the happy path looks correct. Part 1 reviews the shipped code with line evidence. Part 2 assesses the Part B [practice tasks](05-PRACTICE.md); those are design directions, not implemented features. Part A drills are answered by their `Check` lines.

## Part 1: senior review of the shipped code

**A reference endpoint is guarded only by the UI.** `GET /api/employees/options` (`employeeRoutes.ts:12-17` → `employeeService.ts:35` → `employeeRepository.ts:240-262`) has no `requireHr`, unlike every employee mutation in the same service. Any signed-in employee receives the id and name of every active manager and HR administrator, although `employeeScope` (`scope.ts:6-13`) limits that employee's directory to their own profile. The frontend only skips the call for non-HR users (`EmployeesPage.tsx:54`). No integration test touches the route. The data is small, but the pattern (scope enforced on the main list, forgotten on a helper list) is the one to look for in every review. Exercise 5 fixes it.

**The global chart lock quietly protects a second invariant.** "Keep at least one active HR administrator" is a count-then-update (`employeeRepository.ts:173-181`). It is safe only because `chartLock` (lines 23-25) serializes every employee write first. Two HR administrators deactivating each other concurrently would otherwise both see a count of 2 and both succeed. The finer per-chain lock suggested in [the concepts](02-CONCEPTS.md) would break this unless the last-HR check took its own lock. Before narrowing a lock, list everything it serializes, not only the reason it was added.

**Page resets run one render late.** All three list pages reset the page in an effect: `useEffect(() => setPage(1), [query, active])` (`EmployeesPage.tsx:42`; also `LeavePage.tsx:74` and `DepartmentsPage.tsx:28`). For one render the query key combines the new filter with the old page, so React Query issues a request for, say, page 3 of a filtered list before the reset requests page 1. The later clamp (`EmployeesPage.tsx:58-60`) hides the effect visually. Resetting the page in the same event handler that changes the filter removes the extra request.

**Identity and profile are written as one aggregate.** `update` checks the version with a conditional `updateMany` on Employee (`employeeRepository.ts:182-193`), then writes the User's name and email unconditionally (lines 194-197). That is correct because both happen inside one transaction after `chartLock`, and a failed audit rolls back both (asserted at `workflow.integration.test.ts:366`). A duplicate email surfaces as Prisma P2002, which `errors.ts` maps to a generic 409; a reviewer might ask for a field-specific message.

**Leave history is authorized by its newest audit row.** `history` (`leaveRepository.ts:293-307`) loads up to 30 audit rows, then checks the caller's scope against the `employeeId` on the newest one and returns `[]` rather than 404 when access is denied. That hides whether the request exists, and it keeps working after a pending request is deleted (the DELETE audit row still carries the employee id). Note the consequence of using the *current* scope: a manager who loses a report also loses that report's leave history.

## Part 2: practice-task reasoning

### Exercise 6, worked: bounded manager filter

**Validator** (`backend/src/lib/validation.ts`, `employeeFilters`): add `managerId: identity.optional()`. `identity` is the shared id regex (`/^[a-zA-Z0-9_-]{1,64}$/`, line 12-14); ids are Prisma `cuid()` values or seed ids such as `emp_worker`, not UUIDs. A malformed id is a 400 before any query.

**Repository** (`employeeRepository.ts`, `findMany` at line 72): the `where` is already `AND: [employeeScope(actor), ...]`. Append the filter to the same array:

```ts
...(filters.managerId ? [{ managerId: filters.managerId }] : []),
```

`employeeScope` for a manager is "my own profile or my direct reports" (`scope.ts:9-10`), so a forged `managerId` for another manager intersects to an empty set: the API safely intersects rather than rejects. A 403 for a non-HR caller sending `managerId` would leak that the id exists. For HR the scope is `{}`, so the filter is a real filter. Because `items` and `total` share the same `where` inside one RepeatableRead transaction (lines 110-126), count and rows cannot disagree.

**React Query key**: today it is `[session.user.id, "employees", query, page, active]` (`EmployeesPage.tsx:41-44`). Add `managerId`, and reset `page` in the same handler that changes the filter (see the Part 1 note on effect-based resets).

**Tests** (integration, `workflow.integration.test.ts` style): HR filtering on a manager with no reports gets `{ total: 0, items: [] }`; an unknown but well-formed id returns the same empty shape, not 404; a malformed id is 400; `demo_manager` filtering by the other manager's employee id gets an empty result with `total: 0`.

### Exercise 7: reference selection

Return `{items, page, total}` with a bounded page size and stable ordering. Fetch the selected reference separately through the same authorized endpoint, and keep its id in the draft even when a search response does not contain it. Test duplicate display names and a manager deactivated between selection and save: the mutation must revalidate eligibility (as `checkReferences` already does at `employeeRepository.ts:64-68`); an old dropdown response is not permission.

### Exercise 8: review workflow

Add a version and a closed status enum to Review, with DRAFT to SUBMITTED as a one-way transition. Derive the author from the actor, and require the employee to be a current direct report at mutation time. Decide whether old submitted reviews stay visible after reassignment, and say so in the query policy; review confidentiality differs from leave coordination, so do not copy the leave scope blindly.

Put the expected version and status in the write predicate and return a conflict when no row matched. Test the audit rollback with a real database failure (the trigger technique), not a mock that fails before the mutation starts. The frontend should keep the draft on both conflict and transport failure.

### Exercise 9: idempotency receipts

A receipt needs a unique compound key such as actor id, operation, and client key, plus a normalized payload fingerprint and the accepted resource id. Create the receipt, leave, and audit atomically. Two simultaneous requests with the same key must converge on one resource; a uniqueness error requires a deliberate receipt lookup, not a second unguarded create. Here the existing employee row lock (`ownEmployee`, `leaveRepository.ts:37`) already serializes creates for one employee, so the receipt lookup can sit right after it.

Decide whether a repeat after deletion returns the original receipt or a tombstone result; silently recreating deleted data changes the meaning of a retry.

## What makes a patch reviewable

Show the smallest successful and rejected examples, schema compatibility, source of identity, scope predicate, transaction boundary, and captured version. Distinguish implemented behavior from planned extensions. A passing build proves type and bundling compatibility; it does not prove authorization, usability, or recovery after a failed write. [Verification](VERIFICATION.md) records the evidence for the current implementation.
