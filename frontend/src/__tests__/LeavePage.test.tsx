import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect, afterEach } from "vitest";
import { LeavePage } from "../features/leave/pages/LeavePage";
import {
  Session,
  request,
  createLeaveRequest,
  fetchLeaveRequests,
} from "../api/client";
const worker: Session = {
  token: "synthetic-token",
  user: {
    id: "worker",
    name: "Sam",
    email: "worker@example.test",
    role: "EMPLOYEE",
    employee: { id: "emp_worker", active: true },
  },
};
const row = {
  id: "leave_a",
  employeeId: "emp_worker",
  employee: {
    id: "emp_worker",
    userId: "worker",
    name: "Sam",
    email: "worker@example.test",
    role: "EMPLOYEE",
    position: "Developer",
    departmentId: "dept_a",
    department: { id: "dept_a", name: "Engineering" },
    managerId: "emp_manager",
    managerName: "Alex",
    startDate: "2025-01-06",
    active: true,
    version: 1,
  },
  startDate: "2031-01-10",
  endDate: "2031-01-12",
  type: "VACATION",
  reason: "Synthetic note",
  status: "PENDING",
  version: 1,
  decidedById: null,
  decidedBy: null,
  decisionNote: "",
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function fixture() {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          response(
            url.includes("/audit")
              ? { items: [] }
              : url.includes("/leave?")
                ? { items: [row], total: 1, page: 1, pageSize: 20 }
                : row,
          ),
        ),
      ),
  );
}
function mount(session = worker) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LeavePage session={session} onGuardChange={() => {}} />
    </QueryClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());
describe("leave browser boundary and role-aware editing", () => {
  it("sends only editable leave fields with the authenticated request", async () => {
    const mock = vi.fn().mockResolvedValue(response(row));
    vi.stubGlobal("fetch", mock);
    const input = {
      startDate: "2031-01-10",
      endDate: "2031-01-12",
      type: "VACATION" as const,
      reason: "Example",
    };
    await createLeaveRequest("token", input);
    expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual(input);
    expect(mock.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
  });
  it("rejects failed requests instead of treating them as records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ error: "Not your request" }, 403)),
    );
    await expect(request("/leave/a", "token")).rejects.toThrow(
      "Not your request",
    );
  });
  it("rejects unreadable responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>wrong</html>")),
    );
    await expect(request("/leave", "token")).rejects.toThrow("unreadable");
  });
  it("forwards cancellation for obsolete list requests", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, options) => {
        expect(options.signal.aborted).toBe(true);
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      }),
    );
    await expect(
      fetchLeaveRequests("t", { page: "1" }, controller.signal),
    ).rejects.toThrow("Aborted");
  });
  it("opens a real pending request as an editable owner draft", async () => {
    fixture();
    mount();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Review Sam 2031-01-10",
        exact: true,
      }),
    );
    expect(await screen.findByLabelText("Request reason")).toHaveValue(
      "Synthetic note",
    );
    expect(
      screen.getByRole("button", { name: "Save leave request", exact: true }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Approve request", exact: true }),
    ).not.toBeInTheDocument();
  });
  it("shows decision controls to a direct manager while request fields stay read-only", async () => {
    fixture();
    mount({
      token: "t",
      user: {
        id: "manager",
        name: "Alex",
        email: "manager@example.test",
        role: "MANAGER",
        employee: { id: "emp_manager", active: true },
      },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Review Sam 2031-01-10",
        exact: true,
      }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Approve request",
        exact: true,
      }),
    ).toBeVisible();
    expect(screen.getByLabelText("Request reason")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save leave request", exact: true }),
    ).not.toBeInTheDocument();
  });
  it("new requests begin with explicit empty dates", async () => {
    fixture();
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "New leave request", exact: true }),
    );
    expect(screen.getByLabelText("Leave start date")).toHaveValue("");
    expect(screen.getByLabelText("Leave end date")).toHaveValue("");
    expect(screen.getByText("Unsaved leave or decision changes")).toBeVisible();
  });
  it("shows list errors without claiming there are no requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(response({ error: "Database unavailable" }, 503)),
    );
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Database unavailable",
    );
    expect(
      screen.queryByText("No requests match these filters."),
    ).not.toBeInTheDocument();
  });
});
