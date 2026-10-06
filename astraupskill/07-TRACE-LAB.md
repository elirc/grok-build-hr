# Trace lab: from a draft to an accountable decision

Use the generated local demo accounts from [the setup guide](../README.md). Keep all names and notes fictional. This lab follows one request through the actual application and asks you to predict each result before clicking. Keep a table with actor, request ID, submitted version, response, current status, and audit action.

## Round 3, in the repository

Round 3 is decided by these lines from `backend/src/repositories/leaveRepository.ts:239-251`. Note the overlap the break-it exercise in chapter 04 explores: a concurrent second decision loses on the version check (line 239, repeated as `version: expected` in the `where`), because the employee row lock at line 221 made it wait and re-read the advanced version, while a later decision sent with the *current* version loses on the status check. The status appears twice, as a pre-check for a clear message and in the `where`, so removing either one alone changes no test result.

```ts
    if (current.version !== expected) throw stale();
    if (current.status !== "PENDING")
      throw new AppError(409, "Only pending requests can receive a decision.");
    const changed = await tx.leaveRequest.updateMany({
      where: { id, version: expected, status: "PENDING" },
      data: {
        status,
        decidedById: actor.id,
        decisionNote: note,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw stale();
```

## Round 1: create an owned request

Sign in as `worker@example.test`. Create a vacation request for July 10-12, 2039, with reason "Prepare handover notes before leaving." The date range is illustrative and is not a holiday or entitlement calculation. Inspect the outgoing JSON in browser developer tools. It contains dates, type, and reason; it must not choose an employee ID, role, or approver. Authentication resolves the actor, and the repository locates that actor's active employee record.

Trace [the leave route](../backend/src/routes/leaveRoutes.ts), [service](../backend/src/services/leaveService.ts), and [repository](../backend/src/repositories/leaveRepository.ts). Find the employee lock, overlap query, insert, and audit insert. Explain why the response is sent only after the transaction succeeds. Record the new ID and version 1.

## Round 2: a conflicting draft

Open the same request in a second signed-in tab. Change the reason differently in each tab. Both drafts began from version 1. Save the first, then the second. The second should receive a conflict while keeping its text. Export its draft and inspect the captured version and pending reason. Loading current values requires confirmation because it replaces unsaved work.

Locate the update predicate and version increment in the repository. The correct result is one version 2 update and one UPDATE audit, not two successful overwrites. Explain why refreshing the library does not silently update the editor's captured baseline. A list cache and an editable draft have different lifetimes.

## Round 3: authorization and transitions

Sign in as `other-manager@example.test` and try to read the request by ID through the API. This manager belongs to a different reporting line and should not receive the employee's leave details. Now sign in as `manager@example.test`, review the request, and approve it with a short decision note. The server derives the decider from the authenticated actor. Attempt a second decision using the prior version; expect a conflict and no replacement of the first actor or note.

Return as the employee and cancel the approved request. The status becomes CANCELLED while the recorded decision remains available. Inspect the recent audit events. Cancellation is a later action; it does not rewrite history to suggest the approval never occurred. A cancelled interval no longer blocks a new active request for those dates.

## Round 4: explain the limits

Try deleting a referenced employee as HR. Prefer deactivation when history exists. Explain why an employee record created through the directory cannot immediately log in: its password hash is intentionally absent. Finish by identifying one guarantee enforced in validation, one in authorization, one by a row lock, and one by a database constraint. Compare your explanation with [the concepts](02-CONCEPTS.md), then write a regression test for the boundary you found hardest to follow.
