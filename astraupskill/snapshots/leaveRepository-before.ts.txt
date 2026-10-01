// Leave repo

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function findMany(filters: any) {
  return prisma.leaveRequest.findMany({ where: filters });
}

export async function create(data: any) {
  return prisma.leaveRequest.create({ data });
}

export async function update(id: string, data: any) {
  return prisma.leaveRequest.update({ where: { id }, data });
}
