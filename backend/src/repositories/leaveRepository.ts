import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../lib/errors";
import { Actor } from "../middleware/auth";
import {
  LeaveInput,
  LeaveFilters,
  asDate,
  identity,
  literal,
} from "../lib/validation";
import {
  Tx,
  employeeScope,
  leaveInclude,
  leaveDto,
  audit,
  stale,
  lockEmployee,
} from "./scope";
const order = [{ startDate: "desc" as const }, { id: "asc" as const }];
async function scoped(tx: Tx, actor: Actor, id: string) {
  const row = await tx.leaveRequest.findFirst({
    where: { id: identity.parse(id), employee: employeeScope(actor) },
    include: leaveInclude,
  });
  if (!row)
    throw new AppError(404, "Leave request not found within your access.");
  return row;
}
async function ownEmployee(tx: Tx, actor: Actor) {
  if (!actor.employeeId)
    throw new AppError(
      403,
      "An employee profile is required to request leave.",
    );
  await lockEmployee(tx, actor.employeeId);
  const employee = await tx.employee.findFirst({
    where: {
      id: actor.employeeId,
      userId: identity.parse(actor.id),
      active: true,
    },
  });
  if (!employee)
    throw new AppError(
      403,
      "An active employee profile is required to request leave.",
    );
  return employee;
}
async function overlap(
  tx: Tx,
  employeeId: string,
  value: LeaveInput,
  except?: string,
) {
  const row = await tx.leaveRequest.findFirst({
    where: {
      employeeId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: asDate(value.endDate) },
      endDate: { gte: asDate(value.startDate) },
      ...(except ? { id: { not: except } } : {}),
    },
    select: { id: true },
  });
  if (row)
    throw new AppError(
      409,
      "These dates overlap an existing pending or approved request. Review current requests before choosing dates.",
    );
}
export async function findMany(actor: Actor, filters: LeaveFilters) {
  const where: Prisma.LeaveRequestWhereInput = {
    employee: {
      AND: [
        employeeScope(actor),
        ...(filters.q
          ? [
              {
                OR: [
                  {
                    user: {
                      name: {
                        contains: literal(filters.q),
                        mode: "insensitive" as const,
                      },
                    },
                  },
                  {
                    position: {
                      contains: literal(filters.q),
                      mode: "insensitive" as const,
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    },
    ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
  return prisma.$transaction(
    async (tx) => ({
      items: (
        await tx.leaveRequest.findMany({
          where,
          include: leaveInclude,
          orderBy: order,
          take: 20,
          skip: (filters.page - 1) * 20,
        })
      ).map(leaveDto),
      total: await tx.leaveRequest.count({ where }),
      page: filters.page,
      pageSize: 20,
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function get(actor: Actor, id: string) {
  return leaveDto(await scoped(prisma, actor, id));
}
export async function create(actor: Actor, value: LeaveInput) {
  return prisma.$transaction(async (tx) => {
    const employee = await ownEmployee(tx, actor);
    await overlap(tx, employee.id, value);
    const row = await tx.leaveRequest.create({
      data: {
        employeeId: employee.id,
        startDate: asDate(value.startDate),
        endDate: asDate(value.endDate),
        type: value.type,
        reason: value.reason,
        status: "PENDING",
      },
      include: leaveInclude,
    });
    await audit(tx, actor, "LEAVE", row.id, "CREATE", 1, employee.id);
    return leaveDto(row);
  });
}
export async function update(
  actor: Actor,
  id: string,
  expected: number,
  value: LeaveInput,
) {
  return prisma.$transaction(async (tx) => {
    const employee = await ownEmployee(tx, actor),
      current = await scoped(tx, actor, id);
    if (current.employeeId !== employee.id)
      throw new AppError(
        403,
        "Only the employee who requested leave may edit its details.",
      );
    if (current.version !== expected) throw stale();
    if (current.status !== "PENDING")
      throw new AppError(409, "Only pending leave requests can be edited.");
    await overlap(tx, employee.id, value, id);
    const changed = await tx.leaveRequest.updateMany({
      where: {
        id,
        employeeId: employee.id,
        version: expected,
        status: "PENDING",
      },
      data: {
        startDate: asDate(value.startDate),
        endDate: asDate(value.endDate),
        type: value.type,
        reason: value.reason,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw stale();
    await audit(tx, actor, "LEAVE", id, "UPDATE", expected + 1, employee.id);
    return leaveDto(await scoped(tx, actor, id));
  });
}
export async function remove(actor: Actor, id: string, expected: number) {
  return prisma.$transaction(async (tx) => {
    const employee = await ownEmployee(tx, actor),
      current = await scoped(tx, actor, id);
    if (current.employeeId !== employee.id)
      throw new AppError(
        403,
        "Only the employee who requested leave may delete a pending request.",
      );
    if (current.version !== expected) throw stale();
    if (current.status !== "PENDING")
      throw new AppError(
        409,
        "Only pending requests can be deleted. Cancel accepted requests to retain their history.",
      );
    const removed = await tx.leaveRequest.deleteMany({
      where: {
        id,
        employeeId: employee.id,
        version: expected,
        status: "PENDING",
      },
    });
    if (removed.count !== 1) throw stale();
    await audit(tx, actor, "LEAVE", id, "DELETE", expected + 1, employee.id);
    return { id };
  });
}
export async function decide(
  actor: Actor,
  id: string,
  expected: number,
  status: "APPROVED" | "REJECTED",
  note: string,
) {
  return prisma.$transaction(async (tx) => {
    const initial = await scoped(tx, actor, id);
    await lockEmployee(tx, initial.employeeId);
    const current = await scoped(tx, actor, id);
    if (current.employee.userId === actor.id)
      throw new AppError(
        403,
        "You cannot approve or reject your own leave request.",
      );
    if (
      actor.role !== "HR_ADMIN" &&
      !(
        actor.role === "MANAGER" &&
        current.employee.managerId === actor.employeeId
      )
    )
      throw new AppError(
        403,
        "Only the current direct manager or HR may decide this request.",
      );
    if (current.version !== expected) throw stale();
    if (current.status !== "PENDING")
      throw new AppError(409, "Only pending requests can receive a decision.");
    const changed = await tx.leaveRequest.updateMany({
      where: { id, version: expected, status: "PENDING" },
      data: {
        status,
        decidedById: actor.id,
        decisionNote: note,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw stale();
    await audit(
      tx,
      actor,
      "LEAVE",
      id,
      status,
      expected + 1,
      current.employeeId,
    );
    return leaveDto(await scoped(tx, actor, id));
  });
}
export async function cancel(actor: Actor, id: string, expected: number) {
  return prisma.$transaction(async (tx) => {
    const employee = await ownEmployee(tx, actor),
      current = await scoped(tx, actor, id);
    if (current.employeeId !== employee.id)
      throw new AppError(
        403,
        "Only the employee who requested leave may cancel it.",
      );
    if (current.version !== expected) throw stale();
    if (!["PENDING", "APPROVED"].includes(current.status))
      throw new AppError(
        409,
        "Only pending or approved requests can be cancelled.",
      );
    const changed = await tx.leaveRequest.updateMany({
      where: {
        id,
        employeeId: employee.id,
        version: expected,
        status: { in: ["PENDING", "APPROVED"] },
      },
      data: { status: "CANCELLED", version: { increment: 1 } },
    });
    if (changed.count !== 1) throw stale();
    await audit(tx, actor, "LEAVE", id, "CANCELLED", expected + 1, employee.id);
    return leaveDto(await scoped(tx, actor, id));
  });
}
export async function history(actor: Actor, id: string) {
  identity.parse(actor.id);
  const rows = await prisma.auditEvent.findMany({
    where: { resourceType: "LEAVE", resourceId: identity.parse(id) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 30,
  });
  if (!rows.length) return [];
  const employeeId = rows[0].employeeId;
  if (!employeeId) return [];
  const allowed = await prisma.employee.findFirst({
    where: { AND: [employeeScope(actor), { id: employeeId }] },
    select: { id: true },
  });
  return allowed ? rows : [];
}
