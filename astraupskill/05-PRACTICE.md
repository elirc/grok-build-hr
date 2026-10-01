# Practice: extend the HR workspace deliberately

Work in a branch and use fictional fixtures. Complete the first exercise before changing database structure. For every task, write an example request, the expected rejected request, the permitted actor, the version behavior, and the rollback expectation. Read [the solution review](06-SOLUTIONS-AND-REVIEW.md) only after making your own design.

## 1. Add a bounded directory filter

The directory already searches employee name, email, and position and supports active and department filters. Add an explicit manager filter for HR. Start at the query validator, carry the normalized identifier through the service, and compose it with the existing access scope. Do not replace the scope object with a client-provided manager ID. For a manager account, a forged filter must never expose another manager's reports.

Add a labelled control and include the filter in the React Query key. Reset the page when it changes. Test an empty result, an unknown ID, a malformed ID, and a non-HR caller. Decide whether the API rejects a forbidden filter or safely intersects it with access; document that choice. Completion means both the displayed count and listed rows obey the same predicate.

## 2. Make reference selection scale

Employee options currently return up to 500 departments and 500 eligible managers with a truncation flag. Replace that bounded catalogue with searchable, paginated selection endpoints. Keep the current selected value visible even when it is outside the fetched page. Simulate a slow search followed by a faster new search; the older response must not replace the newer choices. Preserve an unsaved employee draft when a lookup fails.

This exercise teaches a different pagination problem from the main list: selecting a foreign key must preserve identity across pages. A label is presentation, while the ID is the relationship. Two people can legitimately share a name.

## 3. Introduce reviews as an actual workflow

The Prisma Review model exists, but this application does not implement review CRUD. Design a small first slice: a manager drafts a review for a direct report, edits it with a version, and submits it. Add explicit status transitions, bounded comments, rating validation, ownership, and audit events. Decide what happens after the report changes managers. Add a forward migration for an existing development database instead of rewriting an applied migration.

Deliver one complete vertical slice, including an editable draft, a read view, conflict recovery, and tests. Do not label the feature complete after adding a table and an unprotected route. Include self-review and unrelated-manager denial tests, concurrent submit tests, and a forced audit failure.

## 4. Resolve ambiguous create retries

Design an idempotency key for creating a leave request. Scope it to the authenticated actor and operation, store a fingerprint of validated input, and commit the receipt in the same transaction as the leave and audit. Retrying the same key and payload should return the same accepted identity. Reusing it with different dates should conflict. Decide retention and deletion behavior explicitly. A disabled button only prevents one local double click; it cannot solve a network retry across tabs or processes.
