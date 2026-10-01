import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { prisma } from "./lib/prisma";
dotenv.config();
export async function seedDemo(password: string) {
  if (password.length < 12 || Buffer.byteLength(password) > 72)
    throw new Error(
      "DEMO_PASSWORD must contain at least 12 characters and at most 72 UTF-8 bytes.",
    );
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.$transaction(async (tx) => {
    const userIds = [
      "demo_hr",
      "demo_manager",
      "demo_other_manager",
      "demo_worker",
      "demo_colleague",
    ];
    const employeeIds = [
      "emp_hr",
      "emp_manager",
      "emp_other_manager",
      "emp_worker",
      "emp_colleague",
    ];
    const departments = ["dept_engineering", "dept_operations"];
    const existing = [
      await tx.user.count({ where: { id: { in: userIds } } }),
      await tx.employee.count({ where: { id: { in: employeeIds } } }),
      await tx.department.count({ where: { id: { in: departments } } }),
    ];
    if (existing[0] === 5 && existing[1] === 5 && existing[2] === 2)
      return {
        created: 0,
        note: "Existing fictional identities, passwords and edits preserved.",
      };
    if (existing.some(Boolean))
      throw new Error(
        "Partial demo identities exist. Inspect before seeding; no rows were changed.",
      );
    await tx.department.createMany({
      data: [
        { id: departments[0], name: "Engineering", nameKey: "engineering" },
        { id: departments[1], name: "Operations", nameKey: "operations" },
      ],
    });
    const users = [
      {
        id: userIds[0],
        name: "Rowan HR",
        email: "hr@example.test",
        role: "HR_ADMIN" as const,
      },
      {
        id: userIds[1],
        name: "Alex Manager",
        email: "manager@example.test",
        role: "MANAGER" as const,
      },
      {
        id: userIds[2],
        name: "Morgan Manager",
        email: "other-manager@example.test",
        role: "MANAGER" as const,
      },
      {
        id: userIds[3],
        name: "Sam Developer",
        email: "worker@example.test",
        role: "EMPLOYEE" as const,
      },
      {
        id: userIds[4],
        name: "Taylor Specialist",
        email: "colleague@example.test",
        role: "EMPLOYEE" as const,
      },
    ];
    await tx.user.createMany({
      data: users.map((user) => ({ ...user, passwordHash })),
    });
    const startDate = new Date("2025-01-06T00:00:00.000Z");
    await tx.employee.create({
      data: {
        id: employeeIds[0],
        userId: userIds[0],
        departmentId: departments[1],
        position: "People Operations Lead",
        startDate,
      },
    });
    await tx.employee.createMany({
      data: [
        {
          id: employeeIds[1],
          userId: userIds[1],
          departmentId: departments[0],
          managerId: employeeIds[0],
          position: "Engineering Manager",
          startDate,
        },
        {
          id: employeeIds[2],
          userId: userIds[2],
          departmentId: departments[1],
          managerId: employeeIds[0],
          position: "Operations Manager",
          startDate,
        },
      ],
    });
    await tx.employee.createMany({
      data: [
        {
          id: employeeIds[3],
          userId: userIds[3],
          departmentId: departments[0],
          managerId: employeeIds[1],
          position: "Software Developer",
          startDate,
        },
        {
          id: employeeIds[4],
          userId: userIds[4],
          departmentId: departments[1],
          managerId: employeeIds[2],
          position: "Operations Specialist",
          startDate,
        },
      ],
    });
    await tx.auditEvent.createMany({
      data: employeeIds.map((id) => ({
        actorId: userIds[0],
        resourceType: "EMPLOYEE",
        resourceId: id,
        employeeId: id,
        action: "SEED",
        version: 1,
      })),
    });
    const leave = await tx.leaveRequest.create({
      data: {
        employeeId: employeeIds[3],
        startDate: new Date("2030-06-10T00:00:00.000Z"),
        endDate: new Date("2030-06-12T00:00:00.000Z"),
        type: "VACATION",
        reason: "Fictional example for reviewing the request workflow.",
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: userIds[3],
        resourceType: "LEAVE",
        resourceId: leave.id,
        employeeId: employeeIds[3],
        action: "SEED",
        version: 1,
      },
    });
    return {
      created: 5,
      note: "Created five fictional employee accounts, two departments and one example request.",
    };
  });
}
if (require.main === module) {
  if (process.env.ALLOW_DEMO_SEED !== "yes")
    throw new Error(
      "Set ALLOW_DEMO_SEED=yes explicitly for fictional local data.",
    );
  seedDemo(process.env.DEMO_PASSWORD || "")
    .then((value) => console.log(JSON.stringify(value)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
