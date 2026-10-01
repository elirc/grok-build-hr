# People & Leave Workspace

A local React, TypeScript, Express, Prisma, and PostgreSQL project for learning employee CRUD and a reliable leave-request workflow. The repaired application verifies users and roles, scopes employee and leave access, prevents overlapping active requests, protects reporting relationships, and preserves drafts after failed or conflicting writes.

Start the [detailed learning course](astraupskill/README.md) for source maps, worked changes, examples, debugging labs, and progressive exercises.

## Run locally

Use Node 22 and npm. Start a dedicated PostgreSQL database through Docker Compose or an installed local server.

```powershell
npm ci
npm run setup:local
docker compose up -d
npm run db:generate
npm run db:deploy
npm run build
npm run seed --workspace backend
```

Setup creates root `.env` and `backend/.env` with generated database, signing, and demo credentials. It refuses to overwrite either file. Review `backend/.env` locally for `DEMO_PASSWORD`; do not commit these files. An existing local database can be configured from `backend/.env.example` instead. Use a fresh dedicated database: the migration does not automatically upgrade unknown existing data. PostgreSQL's `btree_gist` extension supplies the overlap exclusion constraint and must be available to the database owner.

Start two terminals from the root:

```powershell
npm run dev --workspace backend
npm run dev --workspace frontend
```

Open `http://127.0.0.1:5174`. The API binds to `127.0.0.1:4001`; Vite proxies `/api` to it. The database Compose port is `127.0.0.1:5438`. Changing ports requires consistent `PORT`, `FRONTEND_URL`, `WEB_PORT`, and `API_PROXY_TARGET` values. Vite uses a strict port so it cannot silently switch to an unapproved browser origin.

## Fictional accounts and access

All seeded accounts share the generated demo password:

| Account | Role and scope |
|---|---|
| `hr@example.test` | HR administrator; directory and all leave |
| `manager@example.test` | Manager; own profile and Sam Developer |
| `other-manager@example.test` | Manager; own profile and Taylor Specialist |
| `worker@example.test` | Employee; own profile and own leave |
| `colleague@example.test` | Employee; own profile and own leave |

The seed requires `ALLOW_DEMO_SEED=yes` and preserves existing demo identities, passwords, and edits on repeat. Partial fixture identities cause a refusal for manual review. New employee records created through the UI have no login password: account invitations/provisioning remain a separate future feature. The form cannot choose privileged roles or password hashes.

HR manages departments and employee records. Employees with leave, review, or reporting history cannot be hard-deleted; deactivation retains those references. The last active HR administrator cannot be deactivated. Manager assignments must use an active manager/HR employee and cannot create reporting cycles. Department references and normalized names are protected.

Employees create and edit their own pending leave. Their direct manager or HR can approve or reject another employee's pending request. Self-approval is rejected. Approved requests cannot be edited or deleted; their owner can cancel them while retaining the decision history. Pending requests can be deleted or cancelled by their owner. Dates are inclusive calendar days, with a maximum span of 366 days. Pending and approved intervals cannot overlap for one employee. Balances, holidays, entitlements, and payroll are outside this demo.

## Save and recovery behavior

Every editor retains the version it loaded. Stale writes return conflicts without replacing accepted data. Export a draft before loading current values or signing out. Section changes and sign-out confirm unsaved work. A successful save remains accepted even if its following list refresh fails. New creates do not have durable idempotency keys: inspect current records before retrying an uncertain timeout.

Tokens remain in tab memory, expire after thirty minutes, and are lost on refresh. The server checks current role and active employee status per request. Reference selectors display at most 500 departments/managers and report truncation. Audits retain minimal metadata, not full historical field snapshots.

## Verify

Install PostgreSQL binaries and set `POSTGRES_BIN` if needed. The helper defaults to `C:\Program Files\PostgreSQL\18\bin` on Windows and PATH on other platforms.

```powershell
npx playwright install chromium
npm run test:api
npm test
npm run verify
```

The helper creates its own marked temporary PostgreSQL database, migrates it, runs checks, confirms shutdown, and removes its owned cluster. It does not clear your configured app database. `test:api` runs backend/setup checks; `test` adds frontend checks; `verify` adds builds, repeated seeding, and Chromium scenarios. Reports go to `.verification` and reviewed images to `astraupskill/images`.

The Review model remains a schema-level extension point; review CRUD is not implemented. Production identity management, MFA, refresh tokens, distributed throttling, deployment, full accessibility certification, and power-loss guarantees remain outside this local exercise. See [verification scope](astraupskill/VERIFICATION.md).
