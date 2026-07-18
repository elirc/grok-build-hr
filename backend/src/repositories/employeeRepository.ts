// Employee repo - data access

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function findMany(filters: any) {
  return prisma.employee.findMany({ where: filters, include: { department: true } });
}

export async function create(data: any) {
  return prisma.employee.create({ data });
}
