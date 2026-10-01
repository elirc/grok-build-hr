export type Role = "EMPLOYEE" | "MANAGER" | "HR_ADMIN";
export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  employee: { id: string; active: boolean } | null;
};
export type Session = { token: string; user: User };
export type Employee = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  position: string;
  startDate: string;
  active: boolean;
  version: number;
  departmentId: string;
  department: { id: string; name: string };
  managerId: string | null;
  managerName: string | null;
};
export type EmployeeDraft = Pick<
  Employee,
  | "name"
  | "email"
  | "position"
  | "startDate"
  | "active"
  | "departmentId"
  | "managerId"
>;
export type Department = {
  id: string;
  name: string;
  version: number;
  _count?: { employees: number };
};
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type LeaveDraft = {
  startDate: string;
  endDate: string;
  type: "VACATION" | "SICK" | "PERSONAL";
  reason: string;
};
export type Leave = LeaveDraft & {
  id: string;
  employeeId: string;
  employee: Employee;
  status: LeaveStatus;
  version: number;
  decidedById: string | null;
  decidedBy: { id: string; name: string } | null;
  decisionNote: string;
};
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type Options = {
  departments: { id: string; name: string }[];
  managers: { id: string; name: string }[];
  truncated: boolean;
};
export type Audit = {
  id: string;
  action: string;
  version: number;
  createdAt: string;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController(),
    external = options.signal,
    abort = () => controller.abort();
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted) controller.abort();
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(
          "The request timed out and may already have completed. Refresh current records before retrying.",
        ),
      ),
    15000,
  );
  try {
    const response = await fetch("/api" + path, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(
        "The service returned an unreadable response. Keep your draft and refresh before retrying.",
        response.status,
      );
    }
    if (!response.ok)
      throw new ApiError(
        data.error || "The request could not be completed.",
        response.status,
      );
    return data as T;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", abort);
  }
}
export const fetchEmployees = (
  token: string,
  query: Record<string, string>,
  signal?: AbortSignal,
) =>
  request<Page<Employee>>("/employees?" + new URLSearchParams(query), token, {
    signal,
  });
export const fetchLeaveRequests = (
  token: string,
  query: Record<string, string>,
  signal?: AbortSignal,
) =>
  request<Page<Leave>>("/leave?" + new URLSearchParams(query), token, {
    signal,
  });
export const createLeaveRequest = (token: string, leave: LeaveDraft) =>
  request<Leave>("/leave", token, {
    method: "POST",
    body: JSON.stringify(leave),
  });
export function exportDraft(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
export const employeeDraft = (row: Employee): EmployeeDraft => ({
  name: row.name,
  email: row.email,
  position: row.position,
  startDate: row.startDate,
  active: row.active,
  departmentId: row.departmentId,
  managerId: row.managerId,
});
