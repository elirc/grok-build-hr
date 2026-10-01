# Worked change: approve leave with verified authority

The starter accepted an `approverId` in a request body and updated status without checking ownership, current manager, or prior state. A caller could claim another person's identity and overwrite a previous decision. The improvement derives the actor from authentication and treats a decision as a versioned state transition.

A decision request now contains only intent:

```json
{
  "version": 1,
  "status": "APPROVED",
  "note": "Coordinate the handover before leaving."
}
```

The route identifies the leave record. The verified actor supplies the user ID and current role. The body cannot supply an approver identity; unknown fields are rejected. The server reads the current employee relationship rather than trusting a manager ID captured in a token or form.

Follow `decide` in [the leave repository](../backend/src/repositories/leaveRepository.ts). It performs a scoped lookup, locks the employee row, and reads the request again. The second read matters because a competing operation may have completed while the lock was being acquired. It rejects self-approval, requires HR or the current direct manager, checks the expected version, and requires PENDING state. A conditional update advances the version and stores the authenticated decider. The audit event shares the transaction, and the accepted DTO is returned only after completion.

Now compare two managers acting on the same pending request. Both may load version one. The first decision becomes version two. The second request still carries version one, so it conflicts instead of replacing the first outcome. A second attempt using version two also cannot decide an already terminal request because the PENDING-state rule is independent from the version rule. Each protects a different invariant.

In [the leave page](../frontend/src/features/leave/pages/LeavePage.tsx), `selected` holds the accepted baseline and `decisionNote` holds unsaved reasoning. Clicking a decision asks for confirmation, captures the current baseline version, and waits for the response. Success adopts the returned request and displays the saved decision. Failure leaves the note available. Export includes the captured version and decision note; loading current values requires explicit confirmation.

Reproduce the regression with an employee, their manager, and HR. Create fictional leave, open it in manager and HR tabs, and enter different notes. Accept the manager's decision first. Attempt the HR decision from the old baseline. Verify the conflict, unchanged accepted decider, retained HR note, and unchanged audit count for the rejected attempt.

Your review should connect every layer: verified identity prevents impersonation; relationship scope prevents unrelated managers acting; self-checks prevent self-approval; state rules constrain transitions; versions preserve competing intent; transactions keep history consistent; the UI preserves rejected work. A successful approval alone would not demonstrate most of these properties.

The delivered versions of the three files this chapter changes are in `astraupskill/snapshots/` (`leaveRoutes-before.ts.txt`, `leaveService-before.ts.txt`, `leaveRepository-before.ts.txt`); diff them against `backend/src/` to see the whole change.
