import request from "supertest";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { createApp } from "../app";
import { issueToken } from "../middleware/auth";
import { seedDemo } from "../seed";
const secret = "synthetic-hr-integration-secret-" + "x".repeat(40),
  password = "synthetic-only-password-2026";
let app: ReturnType<typeof createApp>;
let fixtureDatabaseVerified = false;
const call = (
  method: "get" | "post" | "put" | "patch" | "delete",
  path: string,
  user = "demo_hr",
) =>
  request(app)
    [method](path)
    .set("Authorization", "Bearer " + issueToken(user, secret));
const leaveValue = {
  startDate: "2031-01-10",
  endDate: "2031-01-12",
  type: "VACATION",
  reason: "Synthetic request",
};
const employeeValue = {
  name: "New Employee",
  email: "new@example.test",
  position: "Developer",
  startDate: "2025-01-06",
  departmentId: "dept_engineering",
  managerId: "emp_manager",
  active: true,
};
const editable = (row: any) => ({
  name: row.name,
  email: row.email,
  position: row.position,
  startDate: row.startDate,
  departmentId: row.departmentId,
  managerId: row.managerId,
  active: row.active,
});
async function employee(id: string) {
  const response = await call("get", "/api/employees/" + id);
  expect(response.status).toBe(200);
  return response.body;
}
async function newEmployee() {
  const response = await call("post", "/api/employees").send(employeeValue);
  expect(response.status).toBe(201);
  return response.body;
}
async function newLeave(user = "demo_worker", changes = {}) {
  const response = await call("post", "/api/leave", user).send({
    ...leaveValue,
    ...changes,
  });
  expect(response.status).toBe(201);
  return response.body;
}
async function failingAudit(work: () => Promise<void>) {
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION reject_hr_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic internal audit detail'; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER reject_hr_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_hr_audit()`,
  );
  try {
    await work();
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER reject_hr_audit ON "AuditEvent"',
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION reject_hr_audit()");
  }
}
beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL || "http://missing");
  if (
    process.env.HR_TEST_DATABASE !== "owned-temporary-cluster" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/astra_hr_test"
  )
    throw new Error("Use the helper-owned temporary PostgreSQL test database.");
  fixtureDatabaseVerified = true;
});
async function clearFixtures() {
  if (!fixtureDatabaseVerified)
    throw new Error("Refusing to clear an unverified database.");
  await prisma.auditEvent.deleteMany();
  await prisma.review.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.employee.updateMany({ data: { managerId: null } });
  await prisma.employee.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
}
beforeEach(async () => {
  await clearFixtures();
  await seedDemo(password);
  app = createApp(secret);
});
afterAll(async () => {
  try {
    if (fixtureDatabaseVerified) await clearFixtures();
  } finally {
    await prisma.$disconnect();
  }
});

describe("real HR PostgreSQL and HTTP workflow", () => {
  test("signs in with normalized email and exposes no password hash", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: " WORKER@EXAMPLE.TEST ", password });
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      role: "EMPLOYEE",
      employee: { id: "emp_worker", active: true },
    });
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(jwt.verify(response.body.token, secret)).toMatchObject({
      sub: "demo_worker",
    });
  });
  test("rejects missing wrong and expired tokens", async () => {
    expect((await request(app).get("/api/employees")).status).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/leave")
          .set("Authorization", "Bearer invalid")
      ).status,
    ).toBe(401);
    const expired = jwt.sign({}, secret, {
      subject: "demo_hr",
      issuer: "hr-workspace",
      audience: "hr-workspace-web",
      expiresIn: -1,
    });
    expect(
      (
        await request(app)
          .get("/api/me")
          .set("Authorization", "Bearer " + expired)
      ).status,
    ).toBe(401);
  });
  test("employee reads stay private even with caller-supplied filters", async () => {
    const list = await call("get", "/api/employees", "demo_worker");
    expect(list.body.items.map((r: any) => r.id)).toEqual(["emp_worker"]);
    expect(
      (await call("get", "/api/employees/emp_colleague", "demo_worker")).status,
    ).toBe(404);
    expect(
      (await call("get", "/api/leave?employeeId=emp_colleague", "demo_worker"))
        .body.total,
    ).toBe(0);
  });
  test("managers see self and direct reports while HR sees the directory", async () => {
    expect(
      (await call("get", "/api/employees", "demo_manager")).body.items
        .map((r: any) => r.id)
        .sort(),
    ).toEqual(["emp_manager", "emp_worker"]);
    expect((await call("get", "/api/employees")).body.total).toBe(5);
    expect(
      (await call("get", "/api/employees/emp_colleague", "demo_manager"))
        .status,
    ).toBe(404);
  });
  test("rejects employee and department writes by non-HR roles", async () => {
    for (const user of ["demo_worker", "demo_manager"]) {
      expect(
        (await call("post", "/api/employees", user).send(employeeValue)).status,
      ).toBe(403);
      expect(
        (
          await call("post", "/api/departments", user).send({
            name: "Forbidden",
          })
        ).status,
      ).toBe(403);
    }
  });
  test("creates an employee/user aggregate without silently provisioning login credentials", async () => {
    const row = await newEmployee();
    expect(row).toMatchObject({
      version: 1,
      role: "EMPLOYEE",
      name: employeeValue.name,
    });
    expect(row.passwordHash).toBeUndefined();
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: row.userId },
    });
    expect(user.passwordHash).toBeNull();
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: employeeValue.email, password })
      ).status,
    ).toBe(401);
  });
  test("updates employee fields and user identity under one captured version", async () => {
    const row = await newEmployee();
    const result = await call("put", "/api/employees/" + row.id).send({
      version: 1,
      employee: {
        ...employeeValue,
        name: "Renamed",
        email: "renamed@example.test",
        position: "API Developer",
      },
    });
    expect(result.body).toMatchObject({
      id: row.id,
      userId: row.userId,
      name: "Renamed",
      version: 2,
    });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: row.userId } }))
        .email,
    ).toBe("renamed@example.test");
    expect(
      (
        await call("put", "/api/employees/" + row.id).send({
          version: 1,
          employee: employeeValue,
        })
      ).status,
    ).toBe(409);
  });
  test("accepts one of two concurrent employee updates", async () => {
    const row = await newEmployee();
    const results = await Promise.all(
      ["First", "Second"].map((position) =>
        call("put", "/api/employees/" + row.id).send({
          version: 1,
          employee: { ...employeeValue, position },
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await employee(row.id)).version).toBe(2);
  });
  test("deletes only an unreferenced employee aggregate and retains audit", async () => {
    const row = await newEmployee();
    expect(
      (await call("delete", "/api/employees/" + row.id).send({ version: 1 }))
        .status,
    ).toBe(200);
    expect(
      await prisma.user.findUnique({ where: { id: row.userId } }),
    ).toBeNull();
    expect(
      await prisma.employee.findUnique({ where: { id: row.id } }),
    ).toBeNull();
    expect(
      await prisma.auditEvent.count({ where: { resourceId: row.id } }),
    ).toBe(2);
  });
  test("preserves referenced and privileged employees", async () => {
    expect(
      (await call("delete", "/api/employees/emp_worker").send({ version: 1 }))
        .status,
    ).toBe(409);
    expect(
      (await call("delete", "/api/employees/emp_manager").send({ version: 1 }))
        .status,
    ).toBe(409);
    expect(await prisma.employee.count()).toBe(5);
  });
  test("deactivation blocks old tokens and login while retaining employee history", async () => {
    const row = await employee("emp_worker");
    expect(
      (
        await call("put", "/api/employees/" + row.id).send({
          version: 1,
          employee: { ...editable(row), active: false },
        })
      ).status,
    ).toBe(200);
    expect((await call("get", "/api/me", "demo_worker")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "worker@example.test", password })
      ).status,
    ).toBe(401);
    expect(
      await prisma.leaveRequest.count({ where: { employeeId: row.id } }),
    ).toBe(1);
  });
  test("does not deactivate the last active HR administrator", async () => {
    const row = await employee("emp_hr");
    expect(
      (
        await call("put", "/api/employees/" + row.id).send({
          version: 1,
          employee: { ...editable(row), active: false },
        })
      ).status,
    ).toBe(409);
    expect((await employee(row.id)).active).toBe(true);
  });
  test("rejects missing departments and invalid manager references", async () => {
    expect(
      (
        await call("post", "/api/employees").send({
          ...employeeValue,
          departmentId: "missing",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("post", "/api/employees").send({
          ...employeeValue,
          managerId: "emp_worker",
        })
      ).status,
    ).toBe(400);
    expect(
      await prisma.user.count({ where: { email: employeeValue.email } }),
    ).toBe(0);
  });
  test("rejects direct and indirect reporting cycles", async () => {
    const hr = await employee("emp_hr"),
      manager = await employee("emp_manager");
    expect(
      (
        await call("put", "/api/employees/" + manager.id).send({
          version: 1,
          employee: { ...editable(manager), managerId: manager.id },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("put", "/api/employees/" + hr.id).send({
          version: 1,
          employee: { ...editable(hr), managerId: manager.id },
        })
      ).status,
    ).toBe(409);
  });
  test("serializes competing reporting changes so they cannot create a cycle", async () => {
    const first = await employee("emp_manager"),
      second = await employee("emp_other_manager");
    const results = await Promise.all([
      call("put", "/api/employees/" + first.id).send({
        version: 1,
        employee: { ...editable(first), managerId: second.id },
      }),
      call("put", "/api/employees/" + second.id).send({
        version: 1,
        employee: { ...editable(second), managerId: first.id },
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  test("rolls back employee create and user updates when audit fails", async () => {
    const row = await newEmployee(),
      before = await prisma.user.count();
    await failingAudit(async () => {
      expect(
        (
          await call("post", "/api/employees").send({
            ...employeeValue,
            email: "rollback@example.test",
          })
        ).status,
      ).toBeGreaterThanOrEqual(500);
      expect(
        (
          await call("put", "/api/employees/" + row.id).send({
            version: 1,
            employee: {
              ...employeeValue,
              name: "Rejected",
              position: "Rejected",
            },
          })
        ).status,
      ).toBeGreaterThanOrEqual(500);
      expect(
        (await call("delete", "/api/employees/" + row.id).send({ version: 1 }))
          .status,
      ).toBeGreaterThanOrEqual(500);
    });
    expect(await prisma.user.count()).toBe(before);
    expect(await employee(row.id)).toMatchObject({
      name: employeeValue.name,
      position: employeeValue.position,
      version: 1,
    });
  });
  test("department CRUD enforces normalized uniqueness versions and references", async () => {
    const created = await call("post", "/api/departments").send({
      name: "Research",
    });
    expect(created.status).toBe(201);
    expect(
      (await call("post", "/api/departments").send({ name: " research " }))
        .status,
    ).toBe(409);
    expect(
      (
        await call("put", "/api/departments/" + created.body.id).send({
          version: 1,
          department: { name: "Discovery" },
        })
      ).body.version,
    ).toBe(2);
    expect(
      (
        await call("delete", "/api/departments/" + created.body.id).send({
          version: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("delete", "/api/departments/" + created.body.id).send({
          version: 2,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("delete", "/api/departments/dept_engineering").send({
          version: 1,
        })
      ).status,
    ).toBe(409);
  });
  test("department audit failure rolls back the mutation", async () => {
    const before = await prisma.department.count();
    await failingAudit(async () => {
      const response = await call("post", "/api/departments").send({
        name: "Rejected",
      });
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(response.body)).not.toContain(
        "synthetic internal audit detail",
      );
      expect(response.body.requestId).toBe(response.headers["x-request-id"]);
    });
    expect(await prisma.department.count()).toBe(before);
  });
  test("leave creation derives the employee from verified identity", async () => {
    const row = await newLeave();
    expect(row).toMatchObject({
      employeeId: "emp_worker",
      version: 1,
      status: "PENDING",
      startDate: leaveValue.startDate,
      endDate: leaveValue.endDate,
    });
    expect(
      (
        await call("post", "/api/leave", "demo_worker").send({
          ...leaveValue,
          employeeId: "emp_colleague",
        })
      ).status,
    ).toBe(400);
  });
  test("rejects invalid or reversed dates before writing", async () => {
    const before = await prisma.leaveRequest.count();
    for (const value of [
      { ...leaveValue, startDate: "2031-02-29" },
      { ...leaveValue, endDate: "2031-01-01" },
      { ...leaveValue, endDate: "2033-01-01" },
    ])
      expect(
        (await call("post", "/api/leave", "demo_worker").send(value)).status,
      ).toBe(400);
    expect(await prisma.leaveRequest.count()).toBe(before);
  });
  test("treats shared end days as overlap but allows the following day", async () => {
    await newLeave();
    expect(
      (
        await call("post", "/api/leave", "demo_worker").send({
          ...leaveValue,
          startDate: "2031-01-12",
          endDate: "2031-01-15",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("post", "/api/leave", "demo_worker").send({
          ...leaveValue,
          startDate: "2031-01-13",
          endDate: "2031-01-15",
        })
      ).status,
    ).toBe(201);
    expect(
      (await call("post", "/api/leave", "demo_colleague").send(leaveValue))
        .status,
    ).toBe(201);
  });
  test("accepts only one of two overlapping concurrent requests", async () => {
    const results = await Promise.all([
      call("post", "/api/leave", "demo_worker").send(leaveValue),
      call("post", "/api/leave", "demo_worker").send({
        ...leaveValue,
        startDate: "2031-01-11",
        endDate: "2031-01-14",
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.leaveRequest.count({
        where: {
          employeeId: "emp_worker",
          startDate: { gte: new Date("2031-01-01") },
        },
      }),
    ).toBe(1);
  });
  test("database exclusion rejects overlap even when repository validation is bypassed", async () => {
    await newLeave();
    await expect(
      prisma.leaveRequest.create({
        data: {
          employeeId: "emp_worker",
          startDate: new Date("2031-01-11"),
          endDate: new Date("2031-01-14"),
          type: "SICK",
        },
      }),
    ).rejects.toThrow();
    expect(
      await prisma.leaveRequest.count({
        where: {
          employeeId: "emp_worker",
          startDate: { gte: new Date("2031-01-01") },
        },
      }),
    ).toBe(1);
  });
  test("owner edits pending leave with captured versions", async () => {
    const row = await newLeave();
    expect(
      (
        await call("put", "/api/leave/" + row.id, "demo_worker").send({
          version: 1,
          leave: { ...leaveValue, reason: "Updated reasoning" },
        })
      ).body,
    ).toMatchObject({ id: row.id, reason: "Updated reasoning", version: 2 });
    expect(
      (
        await call("put", "/api/leave/" + row.id, "demo_worker").send({
          version: 1,
          leave: leaveValue,
        })
      ).status,
    ).toBe(409);
  });
  test("managers cannot edit or delete another employee request details", async () => {
    const row = await newLeave();
    expect(
      (
        await call("put", "/api/leave/" + row.id, "demo_manager").send({
          version: 1,
          leave: leaveValue,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("delete", "/api/leave/" + row.id, "demo_manager").send({
          version: 1,
        })
      ).status,
    ).toBe(403);
  });
  test("owner deletes pending requests while retaining authorized audit", async () => {
    const row = await newLeave();
    expect(
      (
        await call("delete", "/api/leave/" + row.id, "demo_worker").send({
          version: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call("get", "/api/leave/" + row.id, "demo_worker")).status,
    ).toBe(404);
    expect(
      (await call("get", "/api/leave/" + row.id + "/audit", "demo_worker")).body
        .items,
    ).toHaveLength(2);
    expect(
      (await call("get", "/api/leave/" + row.id + "/audit", "demo_colleague"))
        .body.items,
    ).toHaveLength(0);
  });
  test("only the direct manager or HR can decide a visible non-self request", async () => {
    const row = await newLeave();
    expect(
      (
        await call(
          "patch",
          "/api/leave/" + row.id + "/decision",
          "demo_other_manager",
        ).send({ version: 1, status: "APPROVED" })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "patch",
          "/api/leave/" + row.id + "/decision",
          "demo_worker",
        ).send({ version: 1, status: "APPROVED" })
      ).status,
    ).toBe(403);
    const result = await call(
      "patch",
      "/api/leave/" + row.id + "/decision",
      "demo_manager",
    ).send({ version: 1, status: "APPROVED", note: "Plan handover" });
    expect(result.body).toMatchObject({
      status: "APPROVED",
      decidedById: "demo_manager",
      decisionNote: "Plan handover",
      version: 2,
    });
  });
  test("HR and managers cannot approve their own leave", async () => {
    for (const user of ["demo_hr", "demo_manager"]) {
      const row = await newLeave(user);
      expect(
        (
          await call("patch", "/api/leave/" + row.id + "/decision", user).send({
            version: 1,
            status: "APPROVED",
          })
        ).status,
      ).toBe(403);
    }
  });
  test("uses current reporting relationships for decisions", async () => {
    const row = await newLeave(),
      worker = await employee("emp_worker");
    expect(
      (
        await call("put", "/api/employees/emp_worker").send({
          version: 1,
          employee: { ...editable(worker), managerId: "emp_other_manager" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          "patch",
          "/api/leave/" + row.id + "/decision",
          "demo_manager",
        ).send({ version: 1, status: "APPROVED" })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "patch",
          "/api/leave/" + row.id + "/decision",
          "demo_other_manager",
        ).send({ version: 1, status: "APPROVED" })
      ).status,
    ).toBe(200);
  });
  test("accepts one concurrent decision and forbids later terminal decisions", async () => {
    const row = await newLeave();
    const results = await Promise.all(
      ["APPROVED", "REJECTED"].map((status) =>
        call(
          "patch",
          "/api/leave/" + row.id + "/decision",
          "demo_manager",
        ).send({ version: 1, status }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (
        await call("patch", "/api/leave/" + row.id + "/decision").send({
          version: 2,
          status: "REJECTED",
        })
      ).status,
    ).toBe(409);
    expect(
      await prisma.auditEvent.count({ where: { resourceId: row.id } }),
    ).toBe(2);
  });
  test("approved requests cannot be edited or deleted but the owner can cancel", async () => {
    const row = await newLeave();
    await call("patch", "/api/leave/" + row.id + "/decision").send({
      version: 1,
      status: "APPROVED",
    });
    expect(
      (
        await call("put", "/api/leave/" + row.id, "demo_worker").send({
          version: 2,
          leave: leaveValue,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("delete", "/api/leave/" + row.id, "demo_worker").send({
          version: 2,
        })
      ).status,
    ).toBe(409);
    const cancelled = await call(
      "patch",
      "/api/leave/" + row.id + "/cancel",
      "demo_worker",
    ).send({ version: 2 });
    expect(cancelled.body).toMatchObject({
      status: "CANCELLED",
      version: 3,
      decidedById: "demo_hr",
    });
    expect(
      (await call("post", "/api/leave", "demo_worker").send(leaveValue)).status,
    ).toBe(201);
  });
  test("cancellation is owner-only and rejects stale or terminal intent", async () => {
    const row = await newLeave();
    expect(
      (
        await call(
          "patch",
          "/api/leave/" + row.id + "/cancel",
          "demo_manager",
        ).send({ version: 1 })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "patch",
          "/api/leave/" + row.id + "/cancel",
          "demo_worker",
        ).send({ version: 1 })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          "patch",
          "/api/leave/" + row.id + "/cancel",
          "demo_worker",
        ).send({ version: 1 })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(
          "patch",
          "/api/leave/" + row.id + "/cancel",
          "demo_worker",
        ).send({ version: 2 })
      ).status,
    ).toBe(409);
  });
  test("audit failure rolls back leave edits deletes decisions and cancellation", async () => {
    const row = await newLeave();
    await failingAudit(async () => {
      const results = [
        await call("put", "/api/leave/" + row.id, "demo_worker").send({
          version: 1,
          leave: { ...leaveValue, reason: "Rejected" },
        }),
        await call("delete", "/api/leave/" + row.id, "demo_worker").send({
          version: 1,
        }),
        await call("patch", "/api/leave/" + row.id + "/decision").send({
          version: 1,
          status: "APPROVED",
        }),
        await call(
          "patch",
          "/api/leave/" + row.id + "/cancel",
          "demo_worker",
        ).send({ version: 1 }),
      ];
      for (const response of results)
        expect(response.status).toBeGreaterThanOrEqual(500);
    });
    expect(
      (await call("get", "/api/leave/" + row.id, "demo_worker")).body,
    ).toMatchObject({
      version: 1,
      status: "PENDING",
      reason: leaveValue.reason,
      decidedById: null,
    });
    expect(
      await prisma.auditEvent.count({ where: { resourceId: row.id } }),
    ).toBe(1);
  });
  test("audit failure leaves no newly created leave record", async () => {
    const before = await prisma.leaveRequest.count();
    await failingAudit(async () => {
      expect(
        (await call("post", "/api/leave", "demo_worker").send(leaveValue))
          .status,
      ).toBeGreaterThanOrEqual(500);
    });
    expect(await prisma.leaveRequest.count()).toBe(before);
  });
  test("literal employee search and bounded leave pages stay within access", async () => {
    await call("post", "/api/employees").send({
      ...employeeValue,
      name: "100%_ Person",
    });
    expect((await call("get", "/api/employees?q=100%25_")).body.total).toBe(1);
    for (let day = 1; day <= 25; day++) {
      const date = new Date("2033-01-" + String(day).padStart(2, "0"));
      await prisma.leaveRequest.create({
        data: {
          employeeId: "emp_worker",
          startDate: date,
          endDate: date,
          type: "PERSONAL",
        },
      });
    }
    const first = await call("get", "/api/leave?page=1", "demo_worker"),
      second = await call("get", "/api/leave?page=2", "demo_worker");
    expect(first.body.items).toHaveLength(20);
    expect(second.body.items).toHaveLength(6);
    expect(
      new Set([...first.body.items, ...second.body.items].map((r: any) => r.id))
        .size,
    ).toBe(26);
  });
  test("rejects forged fields repeated queries malformed JSON and large bodies", async () => {
    expect(
      (
        await call("post", "/api/employees").send({
          ...employeeValue,
          role: "HR_ADMIN",
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("get", "/api/leave?status=PENDING&status=APPROVED")).status,
    ).toBe(400);
    expect(
      (
        await call("post", "/api/leave", "demo_worker")
          .set("Content-Type", "application/json")
          .send("{")
      ).status,
    ).toBe(400);
    expect(
      (
        await call("post", "/api/leave", "demo_worker").send({
          ...leaveValue,
          reason: "x".repeat(40000),
        })
      ).status,
    ).toBe(413);
  });
  test("rejects unapproved browser origins", async () => {
    expect(
      (
        await call("get", "/api/employees").set(
          "Origin",
          "http://unrelated.test",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call("get", "/api/employees").set(
          "Origin",
          "http://127.0.0.1:5174",
        )
      ).status,
    ).toBe(200);
  });
  test("seed repeats preserve existing passwords and edits", async () => {
    const original = await prisma.user.findUniqueOrThrow({
      where: { id: "demo_worker" },
    });
    await prisma.user.update({
      where: { id: original.id },
      data: { name: "Edited fixture" },
    });
    expect((await seedDemo("different-synthetic-password")).created).toBe(0);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: original.id } }),
    ).toMatchObject({
      name: "Edited fixture",
      passwordHash: original.passwordHash,
    });
  });
});
