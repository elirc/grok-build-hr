> Historical starter notes. Current implemented behavior and setup are in [README.md](README.md), with the detailed course in [astraupskill](astraupskill/README.md). Planned features below are not completion claims.



## Expanded Testing Examples (Newly Added)

We have added concrete test files:

**Backend:**
- `leaveService.test.ts`: Tests leave request creation and approval workflow. Mocks the repository layer. Shows how to test state changes and business rules in HR domains.

**Frontend:**
- `LeavePage.test.tsx`: Basic component test using React Testing Library and mocked TanStack Query responses. Demonstrates testing data-dependent UI.

Additional ideas:
- Test that a MANAGER cannot approve leave for employees outside their team.
- Integration test for leave creation endpoint with invalid dates.
- E2E test: Employee submits leave → Manager sees it in list → Approves it → Status updates in UI.

Update your test commands in package.json and run `npm test` in backend and frontend.

> **Status (2026-10-06, verified against code):** All three "additional ideas" shipped. Unrelated managers are refused in `backend/src/__tests__/workflow.integration.test.ts:608`, invalid and reversed dates in `:473`, and the employee-submits / manager-approves / UI-updates flow runs in Chromium at `browser-tests/hr.spec.mjs:269`. Two descriptions above no longer match: `leaveService.test.ts` now holds 16 database-free contract tests of validators and scope helpers (no mocked repository), and `LeavePage.test.tsx` stubs `fetch` rather than TanStack Query. Tests run from the repository root with `npm run test:api`, `npm test`, or `npm run verify`, which create their own temporary PostgreSQL cluster; running `npm test` inside `backend/` is refused by the integration fixture.
