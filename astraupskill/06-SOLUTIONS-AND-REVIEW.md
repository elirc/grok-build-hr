# Solution reasoning and review standards

A useful review explains why a boundary holds under failure, not just why the happy path looks correct. Use these notes to assess the [practice tasks](05-PRACTICE.md). They describe design directions; the proposed features are not already implemented.

## Task 1, worked: bounded manager filter

**Validator** (`backend/src/lib/validation.ts`), on the directory query schema: `managerId: identity.optional()` (the same UUID validator the rest of the file uses; a malformed id is a 400 before any query).

**Service / scope composition** (`employeeRepository.list`): never replace the scope; intersect with it:

```ts
where: { AND: [employeeScope(actor), managerId ? { managerId } : {}, search ? { OR: [...] } : {}] }
```

`employeeScope(actor)` for a manager already restricts rows to their reports, so a forged `managerId` for another manager intersects to an empty set: the API *safely intersects* rather than rejects. Document that choice in the endpoint comment; the alternative (403 for a non-HR caller sending `managerId`) leaks that the id exists. HR's scope is the whole company, so the filter works as a real filter for HR.

**React Query key**: `["directory", { page, search, active, department, managerId }]`; changing `managerId` resets `page` to 1 in the same state update so the key never combines a new filter with an old page.

**Tests** (four, in `backend/src/__tests__/workflow.integration.test.ts` style): an HR filter on a manager with no reports returns `{ total: 0, items: [] }`; an unknown but well-formed UUID returns the same empty shape (not 404); a malformed id is 400 with no query; a manager account filtering by *another* manager's id gets an empty result and, crucially, the same `total` the list shows, so count and rows agree.

Completion: both the displayed count and the listed rows obey the one `AND` predicate above.

## Directory and reference selection

A safe directory filter is composed with the existing employee scope. Conceptually, query `AND: [authorizedScope, requestedFilters]`, using validated identifiers. A forbidden filter may also be rejected early, but that rejection is not a replacement for repository scope. Reuse the same predicate for count and rows within the existing consistent read transaction. Otherwise the interface can display a total from one population and records from another.

For reference selection, return `{items, page, total}` with a bounded page size and stable ordering. Fetch the selected reference separately when necessary, through the same authorized endpoint. Keep its identifier in the employee draft. Do not clear it simply because a search response does not contain it. Test duplicate display names and an option deactivated between selection and save. The mutation must revalidate the manager's current eligibility; an old dropdown response is not permission.

## Review workflow

A plausible initial design adds a version and a closed status enum to Review, with DRAFT to SUBMITTED as a one-way transition. The author is derived from the actor. The employee must be a currently authorized direct report when the mutation occurs. Decide whether old submitted reviews remain visible after reassignment and explain that decision in the query policy. Reusing leave policy blindly is risky because review confidentiality and leave coordination may have different requirements.

Use a transaction for the state change and audit. Include the expected version and expected status in the write predicate. Return a conflict if no row matched. A failed audit insert must roll back the submitted status. Test this with a real database failure, not a mock that simply returns a failure before the mutation starts. The frontend should retain the review draft on both conflict and transport failure.

## Idempotency receipts

A receipt needs a unique compound key such as actor ID, operation, and client key. Store a normalized payload fingerprint and the accepted resource ID or response. Create the receipt, leave, and audit atomically. Two simultaneous requests with the same key must converge on one accepted resource; a uniqueness error requires a deliberate receipt lookup, not a second unguarded create. Different payloads with the same key must be rejected.

Decide whether a repeated request after deletion returns the original receipt or a deliberate tombstone result. Silently recreating deleted data changes the meaning of a retry. Also consider key expiry and an interrupted client receiving no response after commit. These decisions belong in tests and documentation before promising exactly-once behavior.

## What makes the patch reviewable

Show the smallest successful and rejected examples, schema compatibility, source of identity, scope predicate, transaction boundary, and captured version. Explain who can see the resulting audit. Distinguish implemented behavior from planned extensions. A passing build proves type and bundling compatibility; it does not prove authorization, browser usability, or recovery after a failed write. [Verification](VERIFICATION.md) records the evidence available for the current implementation.
