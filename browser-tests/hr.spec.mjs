import { test, expect } from "@playwright/test";
import jwt from "jsonwebtoken";
import { mkdirSync, readFileSync } from "node:fs";
const api = "http://127.0.0.1:" + process.env.API_PORT,
  password = process.env.DEMO_PASSWORD;
const headers = (user = "demo_hr") => ({
  Authorization:
    "Bearer " +
    jwt.sign({}, process.env.JWT_SECRET, {
      algorithm: "HS256",
      subject: user,
      issuer: "hr-workspace",
      audience: "hr-workspace-web",
      expiresIn: "30m",
    }),
});
async function newLeave(request, start, user = "demo_worker", end = start) {
  const response = await request.post(api + "/api/leave", {
    headers: headers(user),
    data: {
      startDate: start,
      endDate: end,
      type: "VACATION",
      reason: "Prepare a handover and agree the next steps before time away.",
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function login(page, email = "worker@example.test") {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Workspace sections" }),
  ).toBeVisible();
}
async function openLeave(page, start, name = "Sam Developer") {
  await page
    .getByRole("button", { name: `Review ${name} ${start}`, exact: true })
    .click();
  await expect(
    page.getByLabel("Leave start date", { exact: true }),
  ).toHaveValue(start);
}
const accepted = (page, text) =>
  expect(page.getByRole("status").filter({ hasText: text })).toBeVisible();

test("employee access and token lifetime match the actual authenticated scope", async ({
  page,
}) => {
  await login(page);
  await openLeave(page, "2030-06-10");
  await expect(
    page.getByRole("button", { name: "Approve request", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "People directory", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review Sam Developer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review Taylor Specialist", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New employee", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("department CRUD retains identity and prevents referenced deletion", async ({
  page,
  request,
}) => {
  await login(page, "hr@example.test");
  await page.getByRole("button", { name: "Departments", exact: true }).click();
  await page
    .getByRole("button", { name: "New department", exact: true })
    .click();
  await page
    .getByLabel("Department name", { exact: true })
    .fill("Browser Research");
  await page
    .getByRole("button", { name: "Save department", exact: true })
    .click();
  await accepted(page, "Department saved at version 1");
  const rows = await request.get(
    api + "/api/departments?q=Browser%20Research",
    { headers: headers() },
  );
  const row = (await rows.json()).items[0];
  await page
    .getByLabel("Department name", { exact: true })
    .fill("Browser Discovery");
  await page
    .getByRole("button", { name: "Save department", exact: true })
    .click();
  await accepted(page, "Department saved at version 2");
  expect(
    (
      await (
        await request.get(api + "/api/departments/" + row.id, {
          headers: headers(),
        })
      ).json()
    ).name,
  ).toBe("Browser Discovery");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Delete department", exact: true })
    .click();
  await expect(page.getByLabel("Department name", { exact: true })).toHaveValue(
    "Browser Discovery",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete department", exact: true })
    .click();
  await accepted(page, "Department deleted.");
  await page
    .getByRole("button", { name: "Review Engineering", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete department", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("referenced employees");
});

test("HR creates edits and explicitly deletes an unreferenced employee aggregate", async ({
  page,
  request,
}) => {
  await login(page, "hr@example.test");
  await page
    .getByRole("button", { name: "People directory", exact: true })
    .click();
  await page.getByRole("button", { name: "New employee", exact: true }).click();
  await expect(
    page.getByText(
      "This creates an employee record. Login credentials are not provisioned by this form.",
    ),
  ).toBeVisible();
  await page
    .getByLabel("Employee name", { exact: true })
    .fill("Browser Learner");
  await page
    .getByLabel("Employee email", { exact: true })
    .fill("browser-learner@example.test");
  await page.getByLabel("Position", { exact: true }).fill("Software Developer");
  await page.getByLabel("Start date", { exact: true }).fill("2025-09-01");
  await page
    .getByRole("combobox", { name: "Department", exact: true })
    .selectOption({ label: "Engineering" });
  await page
    .getByRole("combobox", { name: "Direct manager", exact: true })
    .selectOption({ label: "Alex Manager" });
  await page
    .getByRole("button", { name: "Save employee", exact: true })
    .click();
  await accepted(page, "Employee saved at version 1");
  const rows = await request.get(api + "/api/employees?q=browser-learner", {
    headers: headers(),
  });
  const row = (await rows.json()).items[0];
  await page.getByLabel("Position", { exact: true }).fill("API Developer");
  await page
    .getByRole("button", { name: "Save employee", exact: true })
    .click();
  await accepted(page, "Employee saved at version 2");
  expect(
    (
      await (
        await request.get(api + "/api/employees/" + row.id, {
          headers: headers(),
        })
      ).json()
    ).position,
  ).toBe("API Developer");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Delete employee", exact: true })
    .click();
  await expect(page.getByLabel("Employee name", { exact: true })).toHaveValue(
    "Browser Learner",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete employee", exact: true })
    .click();
  await accepted(page, "Employee deleted.");
});

test("employee leave CRUD preserves accepted versions and confirms deletion", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New leave request", exact: true })
    .click();
  await page.getByLabel("Leave start date", { exact: true }).fill("2031-07-03");
  await page.getByLabel("Leave end date", { exact: true }).fill("2031-07-04");
  await page
    .getByRole("textbox", { name: "Request reason", exact: true })
    .fill("Initial request reasoning");
  await page
    .getByRole("button", { name: "Save leave request", exact: true })
    .click();
  await accepted(page, "Leave request saved at version 1");
  await page
    .getByRole("textbox", { name: "Request reason", exact: true })
    .fill("Updated request reasoning");
  await page
    .getByRole("button", { name: "Save leave request", exact: true })
    .click();
  await accepted(page, "Leave request saved at version 2");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Delete pending request", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Request reason", exact: true })).toHaveValue(
    "Updated request reasoning",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete pending request", exact: true })
    .click();
  await accepted(page, "Leave request deleted.");
});

test("overlapping dates are rejected while the unsaved request remains exportable", async ({
  page,
  request,
}) => {
  await newLeave(request, "2032-07-10", "demo_worker", "2032-07-12");
  await login(page);
  await page
    .getByRole("button", { name: "New leave request", exact: true })
    .click();
  await page.getByLabel("Leave start date", { exact: true }).fill("2032-07-11");
  await page.getByLabel("Leave end date", { exact: true }).fill("2032-07-13");
  await page
    .getByRole("textbox", { name: "Request reason", exact: true })
    .fill("Keep this overlap draft");
  await page
    .getByRole("button", { name: "Save leave request", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("overlap");
  await expect(page.getByRole("textbox", { name: "Request reason", exact: true })).toHaveValue(
    "Keep this overlap draft",
  );
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export leave draft", exact: true })
    .click();
  const data = JSON.parse(readFileSync(await (await download).path(), "utf8"));
  expect(data.id).toBeNull();
  expect(data.leave.startDate).toBe("2032-07-11");
});

test("manager decisions and owner cancellation preserve the recorded decision", async ({
  page,
  context,
  request,
}) => {
  const row = await newLeave(request, "2033-07-10");
  await login(page, "manager@example.test");
  await openLeave(page, row.startDate);
  await expect(
    page.getByRole("textbox", { name: "Request reason", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Decision note", exact: true })
    .fill("Coordinate a handover before leaving.");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Approve request", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve request", exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Approve request", exact: true })
    .click();
  await accepted(page, "Decision saved: approved.");
  await expect(
    page.getByText("Coordinate a handover before leaving.", { exact: true }),
  ).toBeVisible();
  const owner = await context.newPage();
  await login(owner);
  await openLeave(owner, row.startDate);
  owner.once("dialog", (d) => d.accept());
  await owner
    .getByRole("button", { name: "Cancel request", exact: true })
    .click();
  await accepted(owner, "Leave request cancelled.");
  const current = await request.get(api + "/api/leave/" + row.id, {
    headers: headers("demo_worker"),
  });
  expect(await current.json()).toMatchObject({
    status: "CANCELLED",
    decidedById: "demo_manager",
    version: 3,
  });
});

test("two employee editors preserve the losing draft and captured version", async ({
  page,
  context,
  request,
}) => {
  const row = await newLeave(request, "2034-07-10");
  await login(page);
  await openLeave(page, row.startDate);
  const second = await context.newPage();
  await login(second);
  await openLeave(second, row.startDate);
  await page
    .getByRole("textbox", { name: "Request reason", exact: true })
    .fill("Accepted first-editor note");
  await page
    .getByRole("button", { name: "Save leave request", exact: true })
    .click();
  await accepted(page, "Leave request saved at version 2");
  await second
    .getByRole("textbox", { name: "Request reason", exact: true })
    .fill("Pending second-editor note");
  await second
    .getByRole("button", { name: "Save leave request", exact: true })
    .click();
  await expect(second.getByRole("alert")).toContainText("record changed");
  await expect(
    second.getByRole("textbox", { name: "Request reason", exact: true }),
  ).toHaveValue("Pending second-editor note");
  const download = second.waitForEvent("download");
  await second
    .getByRole("button", { name: "Export leave draft", exact: true })
    .click();
  expect(
    JSON.parse(readFileSync(await (await download).path(), "utf8")).version,
  ).toBe(1);
  second.once("dialog", (d) => d.accept());
  await second
    .getByRole("button", { name: "Load current request", exact: true })
    .click();
  await expect(
    second.getByRole("textbox", { name: "Request reason", exact: true }),
  ).toHaveValue("Accepted first-editor note");
});

test("competing manager and HR decisions do not overwrite the first decision", async ({
  page,
  context,
  request,
}) => {
  const row = await newLeave(request, "2035-07-10");
  await login(page, "manager@example.test");
  await openLeave(page, row.startDate);
  const second = await context.newPage();
  await login(second, "hr@example.test");
  await openLeave(second, row.startDate);
  await second
    .getByRole("textbox", { name: "Decision note", exact: true })
    .fill("Pending HR reasoning");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Approve request", exact: true })
    .click();
  await accepted(page, "Decision saved: approved.");
  second.once("dialog", (d) => d.accept());
  await second
    .getByRole("button", { name: "Reject request", exact: true })
    .click();
  await expect(second.getByRole("alert")).toContainText("record changed");
  await expect(second.getByRole("textbox", { name: "Decision note", exact: true })).toHaveValue(
    "Pending HR reasoning",
  );
  second.once("dialog", (d) => d.accept());
  await second
    .getByRole("button", { name: "Load current request", exact: true })
    .click();
  await expect(
    second.getByRole("button", { name: "Reject request", exact: true }),
  ).toHaveCount(0);
});

test("failed saves preserve input and failed refreshes do not undo accepted saves", async ({
  page,
  request,
}) => {
  const row = await newLeave(request, "2036-07-10");
  await login(page);
  await openLeave(page, row.startDate);
  await page.route("**/api/leave/" + row.id, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 503,
          json: { error: "Synthetic write outage" },
        })
      : route.continue(),
  );
  await page
    .getByRole("textbox", { name: "Request reason", exact: true })
    .fill("Keep this pending note");
  await page
    .getByRole("button", { name: "Save leave request", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Synthetic write outage");
  await expect(page.getByRole("textbox", { name: "Request reason", exact: true })).toHaveValue(
    "Keep this pending note",
  );
  await page.unroute("**/api/leave/" + row.id);
  await page.route("**/api/leave?*", (route) =>
    route.fulfill({ status: 503, json: { error: "Synthetic list outage" } }),
  );
  await page
    .getByRole("button", { name: "Save leave request", exact: true })
    .click();
  await accepted(page, "Leave request saved at version 2");
  await expect(page.getByRole("alert")).toContainText("Synthetic list outage");
  await expect(
    page.getByText("Showing saved request values", { exact: true }),
  ).toBeVisible();
});

test("section changes and sign-out confirm unsaved work", async ({ page }) => {
  await login(page);
  await page
    .getByRole("button", { name: "New leave request", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Request reason", exact: true })
    .fill("Unsaved transition draft");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "People directory", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Request reason", exact: true })).toHaveValue(
    "Unsaved transition draft",
  );
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Request reason", exact: true })).toHaveValue(
    "Unsaved transition draft",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "People directory", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review Sam Developer", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("desktop and narrow leave-review layouts remain readable", async ({
  page,
  request,
}) => {
  const row = await newLeave(
    request,
    "2038-07-10",
    "demo_worker",
    "2038-07-12",
  );
  const pending = await request.get(api + "/api/leave?status=PENDING", {
    headers: headers("demo_worker"),
  });
  for (const item of (await pending.json()).items) {
    if (item.id !== row.id && item.startDate >= "2031-01-01")
      expect(
        (
          await request.delete(api + "/api/leave/" + item.id, {
            headers: headers("demo_worker"),
            data: { version: item.version },
          })
        ).status(),
      ).toBe(200);
  }
  await login(page, "hr@example.test");
  await page
    .getByRole("combobox", { name: "Request status filter", exact: true })
    .selectOption("PENDING");
  await openLeave(page, row.startDate);
  await expect(page.locator(".audit-panel li")).toHaveCount(1);
  mkdirSync("astraupskill/images", { recursive: true });
  for (const [name, width, height] of [
    ["desktop", 1440, 1200],
    ["narrow", 390, 1000],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `astraupskill/images/${name}.png`,
      fullPage: true,
    });
  }
});
