# Now scale it: eight follow-ups

Every answer starts from what this code does today, then names the cost of changing it.

```
React (Vite)  PATCH /api/leave/:id/decision  { version, status, note }
      |
      v
 app.ts   requestId + no-store + nosniff            (23-32)
          CORS: unapproved Origin -> 403            (33-44)
          express.json 32kb, strict                 (45)
          non-GET: no query params -> 400, non-JSON -> 415   (53-61)
          authenticate(secret) -> publicUser -> Actor{id,role,employeeId}  (63)
      |
      v
 leaveRoutes.ts:50  -> leaveService.approveLeave -> decisionInput.parse
      |
      v
 leaveRepository.decide           prisma.$transaction
 +------------------------------------------------------------+
 | scoped(tx, actor, id)            employeeScope in the where | :220
 | lockEmployee(employeeId)         SELECT ... FOR UPDATE      | :221
 | scoped(tx, actor, id) again      post-lock truth            | :222
 | not self / HR or direct manager / version / PENDING         | :223-241
 | updateMany{id, version, status:"PENDING"} -> count===1      | :242-251
 | audit(LEAVE, id, status, expected+1)                        | :252
 +------------------------------------------------------------+
      |
      v
 PostgreSQL 18   LeaveRequest_no_overlap  EXCLUDE USING gist (btree_gist)
```

## 1. Three app instances behind a load balancer: what still holds?

The concurrency story holds, because it lives in the database. `lockEmployee` is a row lock, `chartLock` is a PostgreSQL advisory lock (`backend/src/repositories/employeeRepository.ts:24`), and the overlap rule is an exclusion constraint in `backend/prisma/migrations/202609090001_hr_workspace/migration.sql:141-143`. None of them care which process asked.

Two things do not hold. Sign-in throttling is a `Map` created per process in `backend/src/middleware/auth.ts:89`, so N instances multiply the attempt budget by N; `astraupskill/VERIFICATION.md` already says throttling is process-local. And `chartLock` becomes a genuine bottleneck rather than a theoretical one: every employee create, update and delete in the entire deployment queues on one lock key. For an org chart that is edited a few times a day this is the right trade; if HR bulk-imports a thousand employees, it is a serial import.

## 2. Multi-tenant: many companies in one database.

The seam is `employeeScope` in `backend/src/repositories/scope.ts:6-13`, because it already returns a `where` fragment that every query composes. A `tenantId` on `Department`, `Employee` and `User` folded into that fragment inherits the existing property that an out-of-scope row is a 404 rather than a 403.

Three things need explicit thought. `chartLock`'s constant key `74219801` would serialize every tenant against every other tenant; it must become `pg_advisory_xact_lock(hashtext(tenantId))` or the system gets slower as customers are added. The exclusion constraint is already scoped by `employeeId`, so it is tenant-safe by construction, which is a nice property of putting the rule on the right column. And "keep at least one active HR administrator" (`employeeRepository.ts:173-181`) counts globally today and must count per tenant, or the first tenant to have one admin blocks the rest. The stronger alternative is PostgreSQL row-level security, which puts the guarantee below the ORM at the cost of setting a session variable on every pooled connection.

## 3. One million leave requests. Does the list survive?

Not comfortably. `findMany` at `backend/src/repositories/leaveRepository.ts:106-122` runs the page and a `count` inside one `RepeatableRead` transaction, `take: 20`, `skip: (page - 1) * 20`, ordered by `startDate desc, id asc`. The count is a scan of the filtered set on every request, and the offset makes the database walk and discard rows; the Zod page bound of 10000 (`backend/src/lib/validation.ts:88-93`) caps the worst case without fixing it.

Keyset pagination on `(startDate, id)` matches the existing sort exactly and turns page N into an index seek, at the cost of losing random page access and the exact total. The scope filter complicates it: a manager's query is `OR` of self and direct reports across a join to `Employee`, which is not a single-index range. At a million rows I would denormalize the scope, for example carrying `managerId` on `LeaveRequest` and maintaining it, and accept that the denormalized column must be updated when someone is reassigned, which is another reason `chartLock` exists.

## 4. Search is slow. What is actually wrong?

`filters.q` becomes `contains` with `mode: "insensitive"` against `user.name` and `position` (`leaveRepository.ts:84-96`), which is `ILIKE '%term%'` across a join. A b-tree index cannot serve a leading wildcard, so this is a sequential scan of employees for every keystroke. `literal()` protects the semantics by escaping `%` and `_`, not the performance.

The fix is a trigram index with `pg_trgm` on the searched columns, or a generated `tsvector` if the requirement is word search rather than substring. Both are migrations, not code changes, and both change behaviour: trigram search on short terms is noisy, and full-text search stops matching mid-word, which is what users expect from a directory but not from a position code.

## 5. Where do background jobs belong, and what is the first one?

There are none today; every effect is synchronous inside the request. The first job is not a notification, it is reconciliation of ambiguous creates. `astraupskill/VERIFICATION.md` states that create requests have no durable idempotency receipt, so a lost response on `POST /api/leave` can become a duplicate attempt, and the exclusion constraint will reject the retry with a 409 that reads like a user error. A job that finds same-employee same-dates requests created seconds apart and flags them turns a documented hazard into something HR can see.

Run it as its own process against the same database, wrapped in `pg_advisory_xact_lock` so two replicas do not both process a batch. That reuses a primitive the codebase already depends on and adds no new infrastructure, which is the argument for doing it before reaching for a queue.

## 6. Notifications on approval: where does the send go?

Not inside the transaction. `decide` currently ends with an audit insert and a re-read, all inside `prisma.$transaction`; adding an email call there would hold the employee row lock for the duration of an SMTP round trip and, worse, would send a message for a decision that a later error rolls back.

The shape that keeps both properties is a transactional outbox: insert a notification row inside the same transaction that writes the decision, and let a worker send and mark it. That preserves the "effect and record commit together" property the audit tests already prove with the trigger harness at `workflow.integration.test.ts:61-74`, and it makes delivery at-least-once, so the sender must tolerate a duplicate. The naive alternative, sending after commit in the request handler, loses the notification whenever the process dies in between and offers no retry.

## 7. Auth at scale: what breaks after the token model?

Tokens are HS256, 30 minutes, empty payload with only a subject (`auth.ts:20-28`), and every request re-reads the user through `publicUser`. That is one extra database round trip per request, which is the deliberate trade that makes deactivation take effect immediately and makes a role change effective on the next call. At high request rates that read is the first thing to cache, and the moment you cache it you have reintroduced the revocation delay you were paying to avoid, so the cache TTL is the actual policy decision.

What is missing is named in `astraupskill/VERIFICATION.md`: no MFA, no refresh flow, no invitations, no server-side revocation, and no promise of atomicity against an operation already in flight. For a multi-instance deployment the first additions are a shared limiter and a revocation list keyed by user id with a TTL equal to the token lifetime, which is cheaper than per-token records and bounded by the same 30 minutes.

## 8. Observability: what would you add first?

Today `errorHandler` logs only for 500 and above, as `{requestId, status, event: "request_failed"}` (`backend/src/lib/errors.ts:61-68`), and `X-Request-Id` is set on every response at `app.ts:23-31`, so one user report maps to one log line and nothing more.

First, a counter of 409s split by cause: stale version, terminal status, overlap, cycle, last-HR-admin. Those are not errors, they are the system's normal way of refusing, and their mix is what tells you whether users are fighting the UI or each other. Second, lock wait time on `chartLock`, because a queue on a single advisory key is invisible until it is a support ticket. Third, a log line for every decision that names the actor, the subject employee and the resulting version, since `AuditEvent` stores the accountable fact but nothing tells you how long the whole flow took. The cost of all three is cardinality; keying any of them by employee id would be more useful and would also be the thing that makes retention expensive.

## If the interview is for a .NET role

`prisma.$transaction` becomes an explicit `IDbContextTransaction`; the conditional `updateMany` on version and status becomes `ExecuteUpdateAsync` with the same predicate, or a `[ConcurrencyCheck]` column surfacing `DbUpdateConcurrencyException`, mapped to 409 where `errors.ts:37-41` maps `P2002`. `SELECT ... FOR UPDATE` and `pg_advisory_xact_lock` stay as raw SQL through Npgsql either way. The exclusion constraint has no ORM representation in EF Core any more than it does in Prisma: it is hand-written SQL in a migration, which is a good thing to point out, because it shows the rule lives in the database rather than in whichever service happens to write next.
