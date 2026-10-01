# Take-home: the first slice of performance reviews

Time box: 3 to 4 hours in this repository. Do not modify the applied migration; add a new one.

## Background given to the candidate

`Review` exists in `backend/prisma/schema.prisma` and has a rating constraint in the applied migration (`backend/prisma/migrations/202609090001_hr_workspace/migration.sql:152`, `Review_rating_range CHECK (rating BETWEEN 1 AND 5)`), but no route, service or repository touches it. `astraupskill/VERIFICATION.md` says so in plain words: "Review remains a schema model without implemented CRUD." Your job is the first vertical slice.

## The assignment

A manager drafts a review for a direct report, edits it under a captured version, and submits it. Once submitted it is read-only.

1. `POST /api/reviews` with `{ employeeId, rating, comment }` creates a DRAFT owned by the authoring manager.
2. `PUT /api/reviews/:id` with `{ version, review: { rating, comment } }` edits a DRAFT.
3. `PATCH /api/reviews/:id/submit` with `{ version }` moves DRAFT to SUBMITTED. A submitted review cannot be edited, resubmitted or deleted.
4. Only the employee's current direct manager or an HR administrator may author or submit. Nobody may review themselves.
5. `GET /api/reviews` lists reviews the caller is allowed to see, using the existing access scope, paginated the way the other lists are.
6. Every accepted mutation writes an `AuditEvent` in the same transaction.
7. Decide, and write down, what happens to a DRAFT when the report changes managers before it is submitted.

## Acceptance criteria

- A new migration directory beside `202609090001_hr_workspace`, additive, adding the status column and any index you need with explicit `CHECK` constraints in the style of the existing file. Rewriting the applied migration is a failure.
- Zod schemas in `backend/src/lib/validation.ts` in the house style: `.strict()` objects, the shared `version` bound from line 15, text through the `text()` helper so control characters are refused, and no client-supplied author, status or timestamp. The rating is an integer 1 to 5 and must agree with the database constraint.
- The repository opens one `prisma.$transaction`, locks the subject employee with `lockEmployee` (`backend/src/repositories/scope.ts:91-96`), re-reads after the lock, then checks authority against the current relationship, exactly as `decide` does at `backend/src/repositories/leaveRepository.ts:219-241`. The relationship must be read from the database, not from the token.
- Writes use a conditional `updateMany` whose `where` carries both the captured `version` and the expected status, and treat `count !== 1` as `stale()` from `scope.ts:86-90`.
- Reads compose `employeeScope(actor)` into the query so an out-of-scope review is a 404, not a 403.
- Routes follow `backend/src/routes/leaveRoutes.ts`: `asyncRoute`, `actor(req)`, and a `Location` header with 201 on create as at lines 16-19.

## What to submit

- A branch or patch with source, the new migration directory and tests.
- `NOTES.md`, one page maximum: your status model, your answer to requirement 7 and why, what you left out, and the race you are least confident about.
- Pasted test output.

## Tests and commands

Contract and scope cases go in `backend/src/__tests__/leaveService.test.ts`, which runs without a database; behavioural cases go in `backend/src/__tests__/workflow.integration.test.ts`, which needs the fixture.

```
npm run db:generate
npm run test:api     # node scripts/test-database.mjs api
npm test             # backend plus component tests
npm run typecheck
```

`scripts/test-database.mjs` creates and tears down its own PostgreSQL 18 cluster; it refuses an unmarked database, so do not aim it at a personal one. Note that `btree_gist` is required by the existing migration, so your local PostgreSQL must have the contrib extensions available.

Minimum tests: a schema case that a client-supplied author or status is rejected; a case that an unrelated manager gets 404 on read and 403 on write; a self-review refusal; two concurrent submits where exactly one wins and the loser sees the stale message; and one audit-failure case using the existing `failingAudit` helper at `workflow.integration.test.ts:61-74`, asserting that no review row survives, in the shape of "audit failure leaves no newly created leave record" (line 817).

## Grading rubric

| Criterion | Strong | Weak |
|---|---|---|
| Authority model | Relationship re-read inside the transaction after `lockEmployee`, self-review refused before anything else, HR treated as an override rather than a special case sprinkled through the code | `actor.role === "MANAGER"` checked in the route, relationship taken from the request body or the token |
| Concurrency | Conditional `updateMany` on version and status, `count !== 1` mapped to the shared stale conflict, two-writer test present | Read, then `update` by id; a test that calls the function twice sequentially and calls it a race |
| Validation | `.strict()` schemas, rating bound matching the database constraint, control characters refused through `text()`, rejection asserted by test name | Hand-rolled `if` checks in the service, unknown keys silently dropped |
| Migration safety | New additive directory, defaults chosen so existing rows are valid, constraints written out | Edits the applied migration or requires a database reset |
| Scoping of reads | `employeeScope` composed into the `where`, out-of-scope is 404 | Fetch then compare ids in JavaScript, returning 403 and leaking existence |
| Audit and atomicity | Audit written inside the same transaction, proved with the trigger harness | Audit written after the transaction commits, or omitted for submit |
| Communication | `NOTES.md` answers the manager-change question with a decision and a reason | Notes describe the code that is already visible in the diff |

## Reviewer's notes

I open `NOTES.md` first and go straight to requirement 7. There is no single right answer: keeping the draft with its original author is defensible, so is invalidating it, so is letting HR reassign it. What I am grading is whether the candidate noticed that authority is evaluated at submit time against a relationship that can change, which is the same property `decide` has and which "uses current reporting relationships for decisions" (`workflow.integration.test.ts:653`) pins for leave.

Second I open the migration directory. A candidate who edited `202609090001_hr_workspace/migration.sql` reset their database instead of migrating it, and in an HR system that ends the conversation.

Third, the second read after the lock. Many submissions read once, then lock, then write; I will ask what happens if the report is reassigned between those statements.

Fourth, error paths. I will submit a review twice with the same version and read the message. The generic stale sentence from `scope.ts:86-90` is a pass. A distinct message for "already submitted", in the way `leaveRepository.ts:240-241` distinguishes a terminal state from a stale version, is better, and I will ask why the candidate chose one over two.

I do not expect any UI. I do expect an honest sentence about what is not covered: ratings have no scale definition, there is no review cycle or period, and nothing prevents two reviews of the same person in the same week unless the candidate added a constraint and said so.
