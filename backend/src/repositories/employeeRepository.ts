import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../lib/errors";
import { Actor } from "../middleware/auth";
import {
  EmployeeInput,
  EmployeeFilters,
  asDate,
  identity,
  literal,
} from "../lib/validation";
import {
  Tx,
  employeeScope,
  employeeSelect,
  employeeDto,
  audit,
  stale,
} from "./scope";
const order = [{ createdAt: "desc" as const }, { id: "asc" as const }];
// One constant key: every chart write waits for every other. Correct and simple; the finer
// per-chain key (hashtextextended(rootManagerId, 0)) is discussed in astraupskill/02-CONCEPTS.md.
async function chartLock(tx: Tx) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74219801)`;
}
async function checkReferences(
  tx: Tx,
  value: EmployeeInput,
  currentId?: string,
) {
  if (
    !(await tx.department.findUnique({
      where: { id: value.departmentId },
      select: { id: true },
    }))
  )
    throw new AppError(400, "Choose an existing department.");
  if (!value.managerId) return;
  let cursor: string | null = value.managerId;
  const seen = new Set<string>(currentId ? [currentId] : []);
  let count = 0;
  while (cursor) {
    if (seen.has(cursor) || count++ >= 1000)
      throw new AppError(
        409,
        "The reporting relationship would create a cycle or exceeds the supported hierarchy depth.",
      );
    seen.add(cursor);
    const row: {
      id: string;
      managerId: string | null;
      active: boolean;
      user: { role: string };
    } | null = await tx.employee.findUnique({
      where: { id: cursor },
      select: {
        id: true,
        managerId: true,
        active: true,
        user: { select: { role: true } },
      },
    });
    if (!row) throw new AppError(400, "Choose an existing manager.");
    if (
      cursor === value.managerId &&
      (!row.active || !["MANAGER", "HR_ADMIN"].includes(row.user.role))
    )
      throw new AppError(400, "Choose an active manager or HR administrator.");
    cursor = row.managerId;
  }
}
export async function findMany(actor: Actor, filters: EmployeeFilters) {
  const where: Prisma.EmployeeWhereInput = {
    AND: [
      employeeScope(actor),
      ...(filters.q
        ? [
            {
              OR: [
                {
                  position: {
                    contains: literal(filters.q),
                    mode: "insensitive" as const,
                  },
                },
                {
                  user: {
                    name: {
                      contains: literal(filters.q),
                      mode: "insensitive" as const,
                    },
                  },
                },
                {
                  user: {
                    email: {
                      contains: literal(filters.q),
                      mode: "insensitive" as const,
                    },
                  },
                },
              ],
            },
          ]
        : []),
      ...(filters.departmentId ? [{ departmentId: filters.departmentId }] : []),
      ...(filters.active ? [{ active: filters.active === "true" }] : []),
    ],
  };
  return prisma.$transaction(
    async (tx) => ({
      items: (
        await tx.employee.findMany({
          where,
          select: employeeSelect,
          orderBy: order,
          take: 20,
          skip: (filters.page - 1) * 20,
        })
      ).map(employeeDto),
      total: await tx.employee.count({ where }),
      page: filters.page,
      pageSize: 20,
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function get(actor: Actor, id: string) {
  const row = await prisma.employee.findFirst({
    where: { AND: [employeeScope(actor), { id: identity.parse(id) }] },
    select: employeeSelect,
  });
  if (!row) throw new AppError(404, "Employee not found within your access.");
  return employeeDto(row);
}
export async function create(actor: Actor, value: EmployeeInput) {
  return prisma.$transaction(async (tx) => {
    await chartLock(tx);
    await checkReferences(tx, value);
    const user = await tx.user.create({
      data: { name: value.name, email: value.email, role: "EMPLOYEE" },
    });
    const row = await tx.employee.create({
      data: {
        userId: user.id,
        departmentId: value.departmentId,
        managerId: value.managerId,
        position: value.position,
        startDate: asDate(value.startDate),
        active: value.active,
      },
      select: employeeSelect,
    });
    await audit(tx, actor, "EMPLOYEE", row.id, "CREATE", 1, row.id);
    return employeeDto(row);
  });
}
export async function update(
  actor: Actor,
  id: string,
  expected: number,
  value: EmployeeInput,
) {
  return prisma.$transaction(async (tx) => {
    await chartLock(tx);
    const current = await tx.employee.findUnique({
      where: { id: identity.parse(id) },
      select: employeeSelect,
    });
    if (!current) throw new AppError(404, "Employee not found.");
    if (current.version !== expected) throw stale();
    await checkReferences(tx, value, id);
    if (
      current.active &&
      !value.active &&
      current.user.role === "HR_ADMIN" &&
      (await tx.employee.count({
        where: { active: true, user: { role: "HR_ADMIN" } },
      })) <= 1
    )
      throw new AppError(409, "Keep at least one active HR administrator.");
    const changed = await tx.employee.updateMany({
      where: { id, version: expected },
      data: {
        departmentId: value.departmentId,
        managerId: value.managerId,
        position: value.position,
        startDate: asDate(value.startDate),
        active: value.active,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw stale();
    await tx.user.update({
      where: { id: current.userId },
      data: { name: value.name, email: value.email },
    });
    await audit(tx, actor, "EMPLOYEE", id, "UPDATE", expected + 1, id);
    return employeeDto(
      await tx.employee.findUniqueOrThrow({
        where: { id },
        select: employeeSelect,
      }),
    );
  });
}
export async function remove(actor: Actor, id: string, expected: number) {
  return prisma.$transaction(async (tx) => {
    await chartLock(tx);
    const current = await tx.employee.findUnique({
      where: { id: identity.parse(id) },
      select: employeeSelect,
    });
    if (!current) throw new AppError(404, "Employee not found.");
    if (current.version !== expected) throw stale();
    if (current.user.role !== "EMPLOYEE" || current.userId === actor.id)
      throw new AppError(
        409,
        "Deactivate privileged accounts through a reviewed account-management process; this delete action is for unreferenced employee accounts.",
      );
    const removed = await tx.employee.deleteMany({
      where: {
        id,
        version: expected,
        leaveRequests: { none: {} },
        reviews: { none: {} },
        reports: { none: {} },
      },
    });
    if (removed.count !== 1)
      throw new AppError(
        409,
        "This employee has leave, review, or reporting history. Deactivate the record to preserve those references.",
      );
    await tx.user.delete({ where: { id: current.userId } });
    await audit(tx, actor, "EMPLOYEE", id, "DELETE", expected + 1, id);
    return { id };
  });
}
export async function options(actor: Actor) {
  identity.parse(actor.id);
  const [departments, managers] = await Promise.all([
    prisma.department.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 501,
      select: { id: true, name: true },
    }),
    prisma.employee.findMany({
      where: { active: true, user: { role: { in: ["MANAGER", "HR_ADMIN"] } } },
      orderBy: { id: "asc" },
      take: 501,
      select: { id: true, user: { select: { name: true } } },
    }),
  ]);
  return {
    departments: departments.slice(0, 500),
    managers: managers
      .slice(0, 500)
      .map((row) => ({ id: row.id, name: row.user.name })),
    truncated: departments.length > 500 || managers.length > 500,
  };
}
