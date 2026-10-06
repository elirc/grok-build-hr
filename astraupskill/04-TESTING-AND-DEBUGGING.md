# Test boundaries, failures, and competing requests

Start with the [root setup and commands](../README.md). `npm run test:api` creates an owned temporary PostgreSQL cluster, applies the migration, builds the backend, runs its tests and setup tests, and verifies that a repeated seed preserves existing data. `npm test` additionally runs the frontend component tests. `npm run verify` includes production builds and Chromium workflows. These commands require the PostgreSQL executables; the browser checks also require the matching Playwright browser. The helper refuses an unmarked database for destructive fixtures. Never replace its generated connection with your personal database.

## The three commands

Each command is one entry in the root `package.json`; all three go through the same helper that owns the temporary PostgreSQL cluster.

```bash
npm run test:api   # node scripts/test-database.mjs api     (backend jest --runInBand)
npm test           # node scripts/test-database.mjs backend (adds frontend component tests)
npm run verify     # node scripts/test-database.mjs verify  (builds + Chromium workflows)
```

## Break it: two guards, two existing tests

Run every experiment with `npm run test:api` from the repository root. The helper builds a fresh cluster from the migration on every run, so altering a database by hand has no effect on the next run, and `npm test` inside `backend/` is refused by the fixture guard. Restore with `git checkout -- backend` afterwards.

**The exclusion constraint.** Comment out the three-line `ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_no_overlap"` statement in `backend/prisma/migrations/202609090001_hr_workspace/migration.sql:141-143`. Prediction: `database exclusion rejects overlap even when repository validation is bypassed` (`workflow.integration.test.ts:529`) fails, because it inserts an overlapping row directly with Prisma and expects PostgreSQL to refuse. `accepts only one of two overlapping concurrent requests` (line 510) still passes: `ownEmployee` locks the employee row (`leaveRepository.ts:37`) before the `overlap()` query, so the two creates run one after the other.

**The pending guard.** In `decide`, remove `status: "PENDING"` from the `updateMany` `where` (`leaveRepository.ts:243`). Prediction: *nothing fails*. The concurrent pair in "accepts one concurrent decision" (line 683) is already decided by the employee row lock and re-read (lines 221-222) and the version check (line 239, repeated in the same `where`); the later HR decision at version 2 is stopped by the status pre-check (lines 240-241). Now also delete that pre-check. The test's second assertion (HR sends version 2, REJECTED, after an approval) now returns 200 and overwrites the approval, so the test fails at its `toBe(409)`.

Write down, for each, whether your prediction matched. The lesson of the second experiment: when guards overlap, removing one proves nothing; find the smallest set whose removal a test notices, and ask whether each remaining guard has its own test.

## Choose the boundary that can disprove the claim

The validation tests in [leaveService.test.ts](../backend/src/__tests__/leaveService.test.ts) check strict fields, dates, identity, and role rules (16 tests, despite the file name: they import validators, `employeeScope`, and `requireHr` directly and touch no database or repository). Such tests prove a request is refused before persistence. They cannot prove that PostgreSQL rolls back an audit failure. The [integration suite](../backend/src/__tests__/workflow.integration.test.ts) uses the real database and HTTP application for that claim.

For an approval race, make two requests with the same saved version, one approving and one rejecting. Expect exactly one successful response and one conflict. Then read the row and audit events: version increased once, the recorded actor is the winner, and the losing note did not overwrite it. Merely asserting that neither request returned 500 would miss the bug.

For overlap, use inclusive intervals such as July 10-12 and July 12-14. The shared twelfth day makes them incompatible while pending or approved. Test both concurrent HTTP creates and a direct database insert. The repository lock provides understandable application behavior; the database exclusion constraint protects against another writer bypassing that repository.

## Debug from an observation

Suppose a leave save reports a conflict. Capture the request ID, URL, method, response status, and submitted version. Do not paste bearer tokens or personal notes into logs. Compare the accepted server version with the draft's captured version. A 409 is a deliberate refusal to overwrite newer state, not evidence that the database is unavailable. Export the pending draft before loading current values.

A 503 or broken JSON response is different. The client must retain input, and a failed list refresh must not erase a confirmed save. The [browser suite](../browser-tests/hr.spec.mjs) intercepts these failures and observes the actual form. A timeout after submission is ambiguous: inspect current state before repeating a create, because this project does not implement create idempotency.

If a browser locator fails, inspect its accessibility snapshot before changing behavior. Populated nested textareas can alter label-text matching while retaining the correct accessible name. Prefer a textbox role and exact accessible name, and continue asserting the actual draft value. Never remove the value assertion to make the test pass.

Finish an investigation with the smallest failing example, the invariant it violated, the corrected boundary, and a regression assertion against persisted state. [The trace lab](07-TRACE-LAB.md) provides a complete sequence to rehearse.
