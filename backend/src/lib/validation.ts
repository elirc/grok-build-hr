import { z } from "zod";
const text = (max: number, empty = false) =>
  z
    .string()
    .trim()
    .min(empty ? 0 : 1)
    .max(max)
    .refine(
      (value) => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value),
      "Unsupported control characters",
    );
export const identity = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/, "Invalid identity");
export const version = z.number().int().min(1).max(2147483646);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(value + "T00:00:00.000Z");
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value &&
      value >= "1970-01-01" &&
      value <= "2100-12-31"
    );
  }, "Choose a valid calendar date from 1970 through 2100");
export const loginInput = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z
      .string()
      .min(1)
      .refine(
        (value) => Buffer.byteLength(value) <= 72,
        "Password exceeds 72 UTF-8 bytes",
      ),
  })
  .strict();
export const departmentInput = z.object({ name: text(120) }).strict();
export const departmentUpdate = z
  .object({ version, department: departmentInput })
  .strict();
export const employeeInput = z
  .object({
    name: text(120),
    email: z.string().trim().toLowerCase().email().max(254),
    position: text(160),
    startDate: date,
    departmentId: identity,
    managerId: identity.nullable(),
    active: z.boolean(),
  })
  .strict();
export const employeeUpdate = z
  .object({ version, employee: employeeInput })
  .strict();
export const leaveInput = z
  .object({
    startDate: date,
    endDate: date,
    type: z.enum(["VACATION", "SICK", "PERSONAL"]),
    reason: text(2000, true).default(""),
  })
  .strict()
  .refine((value) => value.endDate >= value.startDate, {
    message: "End date cannot precede start date",
    path: ["endDate"],
  })
  .refine(
    (value) =>
      (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86400000 <
      366,
    {
      message: "A request may span at most 366 calendar days",
      path: ["endDate"],
    },
  );
export const leaveUpdate = z.object({ version, leave: leaveInput }).strict();
export const decisionInput = z
  .object({
    version,
    status: z.enum(["APPROVED", "REJECTED"]),
    note: text(1000, true).default(""),
  })
  .strict();
export const versionInput = z.object({ version }).strict();
const page = z
  .string()
  .regex(/^[1-9]\d{0,4}$/)
  .transform(Number)
  .refine((value) => value <= 10000)
  .default("1");
export const employeeFilters = z
  .object({
    q: text(120, true).default(""),
    page,
    departmentId: identity.optional(),
    active: z.enum(["true", "false", ""]).default(""),
  })
  .strict();
export const leaveFilters = z
  .object({
    q: text(120, true).default(""),
    page,
    status: z
      .enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED", ""])
      .default(""),
    employeeId: identity.optional(),
  })
  .strict();
export const departmentFilters = z
  .object({ q: text(120, true).default(""), page })
  .strict();
export type EmployeeInput = z.infer<typeof employeeInput>;
export type LeaveInput = z.infer<typeof leaveInput>;
export type EmployeeFilters = z.infer<typeof employeeFilters>;
export type LeaveFilters = z.infer<typeof leaveFilters>;
export const asDate = (value: string) => new Date(value + "T00:00:00.000Z");
export const literal = (value: string) =>
  value.replace(/[\\%_]/g, (char) => "\\" + char);
