import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { Actor } from "../middleware/auth";
import { AppError } from "../lib/errors";
import { audit, stale } from "./scope";
import { identity, literal } from "../lib/validation";
export async function list(actor: Actor, query: { q: string; page: number }) {
  identity.parse(actor.id);
  const where = query.q
    ? { name: { contains: literal(query.q), mode: "insensitive" as const } }
    : {};
  return prisma.$transaction(
    async (tx) => ({
      items: await tx.department.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 20,
        skip: (query.page - 1) * 20,
        include: { _count: { select: { employees: true } } },
      }),
      total: await tx.department.count({ where }),
      page: query.page,
      pageSize: 20,
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function get(actor: Actor, id: string) {
  identity.parse(actor.id);
  const row = await prisma.department.findUnique({
    where: { id: identity.parse(id) },
  });
  if (!row) throw new AppError(404, "Department not found.");
  return row;
}
export async function create(actor: Actor, name: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.department.create({
      data: { name, nameKey: name.toLowerCase() },
    });
    await audit(tx, actor, "DEPARTMENT", row.id, "CREATE", 1);
    return row;
  });
}
export async function update(
  actor: Actor,
  id: string,
  expected: number,
  name: string,
) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.department.updateMany({
      where: { id: identity.parse(id), version: expected },
      data: { name, nameKey: name.toLowerCase(), version: { increment: 1 } },
    });
    if (changed.count !== 1) {
      if (!(await tx.department.findUnique({ where: { id } })))
        throw new AppError(404, "Department not found.");
      throw stale();
    }
    await audit(tx, actor, "DEPARTMENT", id, "UPDATE", expected + 1);
    return tx.department.findUniqueOrThrow({ where: { id } });
  });
}
export async function remove(actor: Actor, id: string, expected: number) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.department.deleteMany({
      where: {
        id: identity.parse(id),
        version: expected,
        employees: { none: {} },
      },
    });
    if (changed.count !== 1) {
      const row = await tx.department.findUnique({ where: { id } });
      if (!row) throw new AppError(404, "Department not found.");
      if (row.version !== expected) throw stale();
      throw new AppError(
        409,
        "Move or remove referenced employees before deleting this department.",
      );
    }
    await audit(tx, actor, "DEPARTMENT", id, "DELETE", expected + 1);
    return { id };
  });
}
