# Code reading drill: six rounds on a shared screen

Say the answer out loud before opening the `<details>`. Aim for four minutes each.

## Drill 1: explain this function

`backend/src/repositories/scope.ts:6-13`.

```ts
export function employeeScope(actor: Actor): Prisma.EmployeeWhereInput {
  const userId = identity.parse(actor.id);
  if (actor.role === "HR_ADMIN") return {};
  if (actor.role === "MANAGER")
    return { OR: [{ userId }, { manager: { userId } }] };
  if (actor.role === "EMPLOYEE") return { userId };
  throw new AppError(403, "Unsupported account role.");
}
```

<details><summary>What a strong answer says</summary>

It returns a Prisma `where` fragment, not a boolean, so authorization is composed into the query instead of checked after it. That is why an out-of-scope read is a 404 from `scoped` at `backend/src/repositories/leaveRepository.ts:27-28` rather than a 403: the row is not found, so nothing about its existence is revealed.

Three details earn points. `identity.parse(actor.id)` re-validates the id even though it came from the token, so a malformed subject cannot reach the query builder. The manager branch is `OR` of self and direct reports, and it is expressed as a relation filter, `{ manager: { userId } }`, which means one level, not the whole subtree; a manager cannot see their reports' reports. And the final `throw` is the reason a new role added to the Prisma enum cannot silently become unrestricted: the default is refusal, not `{}`. The unit case is "employee scope cannot become unbounded when identity is missing" (`backend/src/__tests__/leaveService.test.ts:164`).
</details>

## Drill 2: explain this function

`backend/src/repositories/leaveRepository.ts:219-241`, the opening of `decide`.

```ts
  return prisma.$transaction(async (tx) => {
    const initial = await scoped(tx, actor, id);
    await lockEmployee(tx, initial.employeeId);
    const current = await scoped(tx, actor, id);
    if (current.employee.userId === actor.id)
      throw new AppError(403, "You cannot approve or reject your own leave request.");
    if (
      actor.role !== "HR_ADMIN" &&
      !(actor.role === "MANAGER" && current.employee.managerId === actor.employeeId)
    )
      throw new AppError(403, "Only the current direct manager or HR may decide this request.");
    if (current.version !== expected) throw stale();
    if (current.status !== "PENDING")
      throw new AppError(409, "Only pending requests can receive a decision.");
```

<details><summary>What a strong answer says</summary>

Read, lock, read again. The first read establishes scope and yields the employee id to lock; `lockEmployee` runs `SELECT id FROM "Employee" WHERE id=$1 FOR UPDATE` (`scope.ts:91-96`). Waiting for that lock is exactly the window in which a competing manager can commit a decision, so the second read is the one all four rules are evaluated against.

The rules are ordered from identity to state. Self-approval is checked by comparing `current.employee.userId` against `actor.id`, user id to user id, while the manager rule compares `current.employee.managerId` against `actor.employeeId`, employee id to employee id. Mixing those two identifier spaces is the mistake to avoid, and it is why `Actor` carries both (`backend/src/middleware/auth.ts:8`).

The relationship is read from the database, not from the token, which is deliberate: a reassignment takes effect immediately, covered by "uses current reporting relationships for decisions" (`backend/src/__tests__/workflow.integration.test.ts:653`).
</details>

## Drill 3: spot the bug

A mutated copy of the overlap helper. Compare with `leaveRepository.ts:52-73`.

```ts
async function overlap(tx: Tx, employeeId: string, value: LeaveInput, except?: string) {
  const row = await tx.leaveRequest.findFirst({
    where: {
      employeeId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lt: asDate(value.endDate) },
      endDate: { gt: asDate(value.startDate) },
      ...(except ? { id: { not: except } } : {}),
    },
    select: { id: true },
  });
  if (row) throw new AppError(409, "These dates overlap ...");
}
```

<details><summary>The mutation</summary>

`lte` and `gte` became `lt` and `gt`, turning the inclusive interval test into an exclusive one. A request for the 5th to the 10th no longer conflicts with one for the 10th to the 12th, so the repository allows a booking that shares its last day with the next request's first day.

The interesting part is what happens next. The database still holds `daterange("startDate","endDate",'[]')`, an inclusive-inclusive range, in `backend/prisma/migrations/202609090001_hr_workspace/migration.sql:142`, so the insert is rejected by the exclusion constraint. That surfaces as a Prisma known error and therefore a generic 409 from `backend/src/lib/errors.ts:37-41`, "The record changed or is still referenced", instead of the sentence naming the dates. The user gets a confusing message for a real conflict, and the two layers no longer describe the same rule. "treats shared end days as overlap but allows the following day" (`workflow.integration.test.ts:485`) catches it.
</details>

## Drill 4: spot the bug

A mutated copy of the employee update path, compare with `backend/src/repositories/employeeRepository.ts:164-198`.

```ts
  return prisma.$transaction(async (tx) => {
    const current = await tx.employee.findUnique({
      where: { id: identity.parse(id) },
      select: employeeSelect,
    });
    if (!current) throw new AppError(404, "Employee not found.");
    if (current.version !== expected) throw stale();
    await checkReferences(tx, value, id);
    await chartLock(tx);
    const changed = await tx.employee.updateMany({
      where: { id, version: expected },
      data: { ...  version: { increment: 1 } },
    });
    if (changed.count !== 1) throw stale();
```

<details><summary>The mutation</summary>

`chartLock(tx)` moved from the top of the transaction to after the read and after `checkReferences`. In the real code it is the first statement (line 165), which is the whole point: cycle detection inside `checkReferences` walks the manager chain, and that walk is only meaningful if no other transaction can be rewriting another link of the same chain while it runs.

With the lock taken afterwards, two transactions can both complete their walks against a pre-change snapshot, then serialize on the lock and both write. Each change is individually acyclic; together they form a loop. The version check does not save you, because the two edits target different employees and therefore different version columns. `Employee_not_self_manager` (`migration.sql:147`) only catches an employee managing themselves, not a two-step loop. The case that fails is "serializes competing reporting changes so they cannot create a cycle" (`workflow.integration.test.ts:351`).
</details>

## Drill 5: predict the status code

Give the status and the line that produces it.

1. An employee sends `PATCH /api/leave/<their own request>/decision` with `{"version":1,"status":"APPROVED","note":""}`.
2. A manager decides a report's request with `{"version":1,"status":"APPROVED","note":"ok","approverId":"emp_7"}`.
3. Two managers both load version 1 of the same pending request; both click approve.
4. A manager sends `PUT /api/leave/<a report's request>` with valid dates.
5. `POST /api/leave` with `{"startDate":"2026-03-10","endDate":"2026-03-05","type":"SICK"}`.
6. HR sends `PUT /api/employees/<id>?notify=false` with a valid body.
7. An employee sends `DELETE /api/leave/<their approved request>` with the correct version.

<details><summary>Answers</summary>

1. **403.** `leaveRepository.ts:223-227`, "You cannot approve or reject your own leave request." It fires before the version and status rules, and it applies to HR too, which is what "HR and managers cannot approve their own leave" (`workflow.integration.test.ts:640`) asserts.
2. **400.** `decisionInput` is `.strict()` (`backend/src/lib/validation.ts:86`), so the extra key is a Zod issue rendered by `errors.ts:31-36`. The old contract accepted that field; rejecting it is the fix.
3. **200 then 409.** The second blocks on `lockEmployee`, re-reads, and fails the version check at `leaveRepository.ts:239` with the stale message from `scope.ts:86-90`. If it then refetches and retries at version 2, it fails again at line 240, because the request is no longer PENDING.
4. **403.** `update` requires the caller to be the owner: `current.employeeId !== employee.id` throws "Only the employee who requested leave may edit its details." (`leaveRepository.ts:155-159`). Managers decide; they do not edit somebody's dates.
5. **400.** `leaveInput.refine` at `validation.ts:66-69` rejects an end date before the start date, with the issue path `endDate`.
6. **400.** `backend/src/app.ts:53-57` rejects any query string on a non-GET `/api` request before routing, with "Mutation routes do not accept query parameters."
7. **409.** `remove` allows only PENDING: "Only pending requests can be deleted. Cancel accepted requests to retain their history." (`leaveRepository.ts:194-198`). Cancelling instead succeeds and writes a `CANCELLED` audit row.
</details>

## Drill 6: review this diff

Three defects. Which do you block?

```diff
--- a/backend/src/repositories/leaveRepository.ts
+++ b/backend/src/repositories/leaveRepository.ts
@@ export async function decide(
-    const changed = await tx.leaveRequest.updateMany({
-      where: { id, version: expected, status: "PENDING" },
-      data: { status, decidedById: actor.id, decisionNote: note,
-              version: { increment: 1 } },
-    });
-    if (changed.count !== 1) throw stale();
+    const updated = await tx.leaveRequest.update({
+      where: { id },
+      data: { status, decidedById: actor.id, decisionNote: note,
+              version: { increment: 1 } },
+    });
     await audit(tx, actor, "LEAVE", id, status, expected + 1, current.employeeId);
-    return leaveDto(await scoped(tx, actor, id));
+    return leaveDto(updated as any);
   });
 }
@@ export async function findMany(
-      total: await tx.leaveRequest.count({ where }),
+      total: await prisma.leaveRequest.count({ where }),
```

<details><summary>Review notes</summary>

**Block on the unconditional `update`.** The conditional `updateMany` is the last guard that is evaluated at write time; with a plain `update` by id, the version and status rules survive only as the read-side checks a few lines above, which were taken before nothing in particular. Under the employee lock the window is small, but the code no longer says what it means, and `changed.count !== 1` was the branch that produced the conflict. This is exactly the shape the worked change in `astraupskill/03-WORKED-CHANGE.md` argues for.

**Block on the return value.** `leaveDto` (`backend/src/repositories/scope.ts:58-65`) expects a row shaped by `leaveInclude`, with `employee` selected through `employeeSelect` and `decidedBy` attached. A bare `update` result has neither, so `row.employee` is undefined and `employeeDto` throws at runtime, which the `as any` hides from the compiler. The real code re-reads through `scoped` for precisely this reason.

**Block on the count, more quietly.** Moving `count` from `tx` to `prisma` takes it out of the `RepeatableRead` transaction opened at `leaveRepository.ts:106-122`, so the page rows and the total come from two different snapshots and the UI can show twenty rows out of a total of nineteen. Nothing breaks loudly; the page just occasionally lies.

Worth saying, not blocking: the audit row still writes `expected + 1` as the version. That was correct when the update was conditional on `expected`; with an unconditional update it can record a version the row never had.
</details>
