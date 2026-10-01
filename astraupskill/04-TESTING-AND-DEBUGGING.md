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

**The exclusion constraint.** In a scratch database (never the one you keep), run `ALTER TABLE "LeaveRequest" DROP CONSTRAINT "LeaveRequest_no_overlap";` and rerun `npm test` in `backend/`. Prediction: `database exclusion rejects overlap even when repository validation is bypassed` fails, because it inserts an overlapping row directly with Prisma and expects PostgreSQL to refuse; `accepts only one of two overlapping concurrent requests` still passes, because the application-level lock and the `overlap()` check in the repository catch the concurrent case first. Restore with `npx prisma migrate reset` (scratch database only).

**The pending guard.** In `backend/src/repositories/leaveRepository.ts`, remove `status: "PENDING"` from the `updateMany` `where` in `decide` (keep the pre-check above it). Prediction: `only the direct manager or HR can decide a visible non-self request` still passes, but the competing-decision test now lets a second decision overwrite the first when both read `PENDING` before either writes: the pre-check is a read, the `where` is the guard. Restore the line.

Write down, for each, whether your prediction matched. Then ask what test would catch the case where the pre-check passes but the conditional write loses (a count of 0 must become a 409, never a silent success).

## Choose the boundary that can disprove the claim

The validation tests in [leaveService.test.ts](../backend/src/__tests__/leaveService.test.ts) check strict fields, dates, identity, and role rules. A mocked repository is suitable for proving that an unauthorized service call stops before persistence. It cannot prove that PostgreSQL rolls back an audit failure. The [integration suite](../backend/src/__tests__/workflow.integration.test.ts) uses the real database and HTTP application for that claim.

For an approval race, make two requests with the same saved version, one approving and one rejecting. Expect exactly one successful response and one conflict. Then read the row and audit events: version increased once, the recorded actor is the winner, and the losing note did not overwrite it. Merely asserting that neither request returned 500 would miss the bug.

For overlap, use inclusive intervals such as July 10-12 and July 12-14. The shared twelfth day makes them incompatible while pending or approved. Test both concurrent HTTP creates and a direct database insert. The repository lock provides understandable application behavior; the database exclusion constraint protects against another writer bypassing that repository.

## Debug from an observation

Suppose a leave save reports a conflict. Capture the request ID, URL, method, response status, and submitted version. Do not paste bearer tokens or personal notes into logs. Compare the accepted server version with the draft's captured version. A 409 is a deliberate refusal to overwrite newer state, not evidence that the database is unavailable. Export the pending draft before loading current values.

A 503 or broken JSON response is different. The client must retain input, and a failed list refresh must not erase a confirmed save. The [browser suite](../browser-tests/hr.spec.mjs) intercepts these failures and observes the actual form. A timeout after submission is ambiguous: inspect current state before repeating a create, because this project does not implement create idempotency.

If a browser locator fails, inspect its accessibility snapshot before changing behavior. Populated nested textareas can alter label-text matching while retaining the correct accessible name. Prefer a textbox role and exact accessible name, and continue asserting the actual draft value. Never remove the value assertion to make the test pass.

Finish an investigation with the smallest failing example, the invariant it violated, the corrected boundary, and a regression assertion against persisted state. [The trace lab](07-TRACE-LAB.md) provides a complete sequence to rehearse.
