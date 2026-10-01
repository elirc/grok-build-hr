# Verification record and practical limits

The delivered HR workspace was checked on September 9, 2026 using Node 22.16.0, Prisma 6.19.2, PostgreSQL 18, React 18, Vite 5.4.21, and Playwright 1.60 with Chromium. Verification used fictional seed data in helper-owned temporary loopback database clusters. Existing project databases and personal environment files were not used or migrated.

## Evidence and snapshots inside the repo

`astraupskill/snapshots/` now holds the delivered `leaveRoutes`, `leaveService` and `leaveRepository` as `-before.ts.txt`, so chapter 03's before/after claims can be diffed locally. `astraupskill/evidence/` holds `results.json`, `full-first/backend.json` and `frontend.json` with their test logs, and `browser-final/browser.json`, `results.json` and `browser-tests.log`. The counts in this file refer to `full-first` (backend and frontend) plus `browser-final` (browser).

## Evidence and reproduction

There are 76 passing automated checks: 54 backend tests, eight frontend component tests, three setup-file tests, and 11 browser scenarios. Backend and frontend TypeScript compilation and production builds passed. Fresh migration deployment passed, including the btree_gist-backed leave overlap constraint. The fictional seed ran twice without overwriting existing seed records. Each helper run confirmed PostgreSQL shutdown before removing its owned temporary cluster.

Run `npm run test:api` for backend and setup checks, `npm test` to include component tests, or `npm run verify` for the complete workflow. Install the PostgreSQL executables and matching Playwright browser first, as explained in [the root guide](../README.md). Results and command logs are written to `.verification` by default. The implementation audit retained separate backend/component and final browser evidence; the browser rerun followed a locator correction for populated textareas. No failed assertion was removed, and all 11 scenarios passed on the final run.

Backend coverage includes current identity and role checks, scoped employee access, department and employee CRUD, stale versions, concurrent manager-cycle prevention, last-active-HR protection, referenced deletion, deactivation, calendar bounds, inclusive overlaps, direct database overlap protection, competing decisions, cancellation history, and transaction rollback when audit writes fail. Frontend tests cover HTTP failure handling and role-dependent forms. Browser checks exercise complete CRUD, conflict recovery, exportable drafts, independent save and refresh feedback, dirty navigation, session memory, and actual role workflows.

The [desktop capture](images/desktop.png) and [narrow capture](images/narrow.png) were visually reviewed. They show the same leave review at 1440 and 390 CSS pixels, with readable forms, wrapped controls, and no horizontal page overflow. This is practical layout evidence, not a comprehensive accessibility certification.

## Limits to carry into your own review

This is a local learning application with generated demo credentials. Tokens expire after 30 minutes; there is no MFA, refresh-token flow, invitation system, or server-side token revocation. Sign-in throttling is process-local. Database role and active-state checks occur on every request, without a promise of atomic revocation against already in-flight operations.

The schema migration targets a fresh dedicated database and requires btree_gist support. Docker Compose configuration is included, but verification used installed PostgreSQL executables rather than a running Docker daemon. No production deployment, power-loss experiment, or migration of unknown existing data was performed.

New employee records deliberately have no login password. Reference choices are bounded to 500 per category with a visible truncation warning. Review remains a schema model without implemented CRUD. Leave dates use simple inclusive calendar-day rules; balances, holidays, entitlements, payroll, and jurisdiction-specific policies are not implemented. Create requests have no durable idempotency receipt, and exported drafts are manual recovery artifacts rather than an automatic merge or backup system. Audit metadata records accountable changes without storing full before-and-after snapshots. Use [the practice exercises](05-PRACTICE.md) to extend these boundaries explicitly.
