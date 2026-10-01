import { Prisma } from "@prisma/client";
import { Actor } from "../middleware/auth";
import { AppError } from "../lib/errors";
import { identity } from "../lib/validation";
export type Tx = Prisma.TransactionClient;
export function employeeScope(actor: Actor): Prisma.EmployeeWhereInput {
  const userId = identity.parse(actor.id);
  if (actor.role === "HR_ADMIN") return {};
  if (actor.role === "MANAGER")
    return { OR: [{ userId }, { manager: { userId } }] };
  if (actor.role === "EMPLOYEE") return { userId };
  throw new AppError(403, "Unsupported account role.");
}
export const employeeSelect = {
  id: true,
  userId: true,
  departmentId: true,
  managerId: true,
  position: true,
  startDate: true,
  active: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, email: true, role: true } },
  department: { select: { id: true, name: true } },
  manager: { select: { id: true, user: { select: { name: true } } } },
} satisfies Prisma.EmployeeSelect;
export const leaveInclude = {
  employee: { select: employeeSelect },
  decidedBy: { select: { id: true, name: true } },
} satisfies Prisma.LeaveRequestInclude;
export type EmployeeRow = Prisma.EmployeeGetPayload<{
  select: typeof employeeSelect;
}>;
export type LeaveRow = Prisma.LeaveRequestGetPayload<{
  include: typeof leaveInclude;
}>;
export function employeeDto(row: EmployeeRow) {
  return {
    id: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    role: row.user.role,
    position: row.position,
    startDate: row.startDate.toISOString().slice(0, 10),
    active: row.active,
    version: row.version,
    department: row.department,
    departmentId: row.departmentId,
    managerId: row.managerId,
    managerName: row.manager?.user.name || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export function leaveDto(row: LeaveRow) {
  return {
    ...row,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    employee: employeeDto(row.employee),
  };
}
export function audit(
  tx: Tx,
  actor: Actor,
  resourceType: string,
  resourceId: string,
  action: string,
  version: number,
  employeeId: string | null = null,
) {
  return tx.auditEvent.create({
    data: {
      actorId: identity.parse(actor.id),
      resourceType,
      resourceId,
      action,
      version,
      employeeId,
    },
  });
}
export const stale = () =>
  new AppError(
    409,
    "This record changed. Export your draft, then load the current record before retrying.",
  );
export async function lockEmployee(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Employee" WHERE id=${identity.parse(id)} FOR UPDATE`;
  if (!rows.length) throw new AppError(404, "Employee not found.");
}
