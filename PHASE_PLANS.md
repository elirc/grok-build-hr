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
