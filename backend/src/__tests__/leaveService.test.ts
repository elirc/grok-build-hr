import {
  date,
  employeeInput,
  employeeUpdate,
  leaveInput,
  leaveUpdate,
  decisionInput,
  versionInput,
  departmentInput,
  employeeFilters,
  leaveFilters,
  loginInput,
} from "../lib/validation";
import { employeeScope } from "../repositories/scope";
import { requireHr, validateSecret } from "../middleware/auth";
const employee = {
  name: "Example Person",
  email: "example@example.test",
  position: "Developer",
  startDate: "2025-01-06",
  departmentId: "dept_a",
  managerId: null,
  active: true,
};
const leave = {
  startDate: "2031-01-10",
  endDate: "2031-01-12",
  type: "VACATION",
  reason: "Example",
};
describe("HR domain values and scope policies", () => {
  test("validates real calendar days and canonical shape", () => {
    expect(date.parse("2028-02-29")).toBe("2028-02-29");
    for (const value of [
      "2027-02-29",
      "2028-02-30",
      "2028-2-01",
      "2028-01-01T00:00:00Z",
      "1969-12-31",
      "2101-01-01",
    ])
      expect(date.safeParse(value).success).toBe(false);
  });
  test("rejects reversed and overlong leave intervals", () => {
    expect(
      leaveInput.safeParse({ ...leave, endDate: "2031-01-09" }).success,
    ).toBe(false);
    expect(
      leaveInput.safeParse({ ...leave, endDate: "2032-01-11" }).success,
    ).toBe(false);
  });
  test("accepts a single day and a bounded inclusive leap-year interval", () => {
    expect(
      leaveInput.safeParse({ ...leave, endDate: leave.startDate }).success,
    ).toBe(true);
    expect(
      leaveInput.safeParse({
        ...leave,
        startDate: "2028-01-01",
        endDate: "2028-12-31",
      }).success,
    ).toBe(true);
  });
  test("rejects caller-chosen employee actor status and decision fields on create", () => {
    for (const key of [
      "employeeId",
      "approvedBy",
      "decidedById",
      "status",
      "version",
    ])
      expect(leaveInput.safeParse({ ...leave, [key]: "forged" }).success).toBe(
        false,
      );
  });
  test("accepts only supported leave types", () => {
    for (const type of ["vacation", "UNKNOWN", null])
      expect(leaveInput.safeParse({ ...leave, type }).success).toBe(false);
  });
  test("normalizes employee text and email without mutating input", () => {
    const value = {
      ...employee,
      name: " Example ",
      email: " PERSON@EXAMPLE.TEST ",
    };
    expect(employeeInput.parse(value)).toMatchObject({
      name: "Example",
      email: "person@example.test",
    });
    expect(value.name).toBe(" Example ");
  });
  test("rejects employee privilege and password injection", () => {
    for (const key of ["role", "userId", "passwordHash", "id"])
      expect(
        employeeInput.safeParse({ ...employee, [key]: "forged" }).success,
      ).toBe(false);
  });
  test("requires boolean active and explicit nullable manager", () => {
    expect(
      employeeInput.safeParse({ ...employee, active: "false" }).success,
    ).toBe(false);
    expect(
      employeeInput.safeParse({ ...employee, managerId: "" }).success,
    ).toBe(false);
    expect(
      employeeInput.safeParse({ ...employee, managerId: null }).success,
    ).toBe(true);
  });
  test("bounds editable text and control characters", () => {
    expect(
      employeeInput.safeParse({ ...employee, name: "x".repeat(121) }).success,
    ).toBe(false);
    expect(
      leaveInput.safeParse({ ...leave, reason: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(departmentInput.safeParse({ name: "A\u0000" }).success).toBe(false);
  });
  test("bounds captured versions to PostgreSQL integer range", () => {
    for (const version of [0, -1, 1.5, true, "1", 2147483647]) {
      expect(employeeUpdate.safeParse({ version, employee }).success).toBe(
        false,
      );
      expect(leaveUpdate.safeParse({ version, leave }).success).toBe(false);
      expect(versionInput.safeParse({ version }).success).toBe(false);
    }
  });
  test("requires exact decision states and rejects supplied approver identities", () => {
    expect(
      decisionInput.safeParse({ version: 1, status: "CANCELLED" }).success,
    ).toBe(false);
    expect(
      decisionInput.safeParse({
        version: 1,
        status: "APPROVED",
        approverId: "forged",
      }).success,
    ).toBe(false);
    expect(decisionInput.parse({ version: 1, status: "REJECTED" })).toEqual({
      version: 1,
      status: "REJECTED",
      note: "",
    });
  });
  test("rejects unknown repeated and malformed query values", () => {
    for (const query of [
      { q: ["a", "b"] },
      { page: "0" },
      { page: "01" },
      { page: "1e2" },
      { page: "10001" },
      { extra: "x" },
    ])
      expect(employeeFilters.safeParse(query).success).toBe(false);
    expect(leaveFilters.safeParse({ status: "unknown" }).success).toBe(false);
  });
  test("enforces bcrypt UTF-8 byte limits", () => {
    expect(
      loginInput.safeParse({
        email: "person@example.test",
        password: "\u00e9".repeat(37),
      }).success,
    ).toBe(false);
  });
  test("employee scope cannot become unbounded when identity is missing", () => {
    expect(() =>
      employeeScope({
        id: undefined as never,
        role: "EMPLOYEE",
        employeeId: null,
      }),
    ).toThrow();
    expect(
      employeeScope({ id: "u", role: "EMPLOYEE", employeeId: "e" }),
    ).toEqual({ userId: "u" });
  });
  test("manager scope includes self and direct reports without trusting query filters", () => {
    expect(
      employeeScope({ id: "u", role: "MANAGER", employeeId: "e" }),
    ).toEqual({ OR: [{ userId: "u" }, { manager: { userId: "u" } }] });
  });
  test("requires HR authority and a generated signing secret", () => {
    expect(() =>
      requireHr({ id: "u", role: "MANAGER", employeeId: "e" }),
    ).toThrow();
    expect(() => validateSecret("replace-with-" + "x".repeat(40))).toThrow();
    expect(() =>
      validateSecret("synthetic-test-secret-" + "x".repeat(40)),
    ).not.toThrow();
  });
});
