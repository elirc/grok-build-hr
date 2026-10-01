import { createRequire } from "node:module";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import {
  openSync,
  closeSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] || "backend";
if (!["api", "backend", "verify", "browser", "database-check"].includes(mode))
  throw new Error("Use api, backend, verify, browser, or database-check.");
const binaryDirectory =
  process.env.POSTGRES_BIN ||
  (process.platform === "win32"
    ? "C:\\Program Files\\PostgreSQL\\18\\bin"
    : "");
const binary = (name) =>
  binaryDirectory
    ? join(binaryDirectory, name + (process.platform === "win32" ? ".exe" : ""))
    : name;
const results = resolve(
  process.env.HR_VERIFY_RESULTS_DIR || join(root, ".verification"),
);
mkdirSync(results, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), "astra-hr-pg-"));
const cluster = join(temporary, "cluster");
const ports = new Set();
async function freePort() {
  let port;
  do {
    port = await new Promise((resolvePort, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const selected = probe.address().port;
        probe.close(() => resolvePort(selected));
      });
    });
  } while (ports.has(port));
  ports.add(port);
  return port;
}
const port = await freePort();
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://astra_test@127.0.0.1:${port}/astra_hr_test?schema=public`,
  HR_TEST_DATABASE: "owned-temporary-cluster",
  CI: "1",
  NODE_ENV: "production",
  JWT_SECRET: "synthetic-local-verification-secret-" + "c".repeat(64),
  DEMO_PASSWORD: "synthetic-only-password-2026",
  ALLOW_DEMO_SEED: "yes",
};
let startAttempted = false;
let safeToRemove = true;
// pg_ctl can exit while postgres retains inherited pipe handles on Windows.
// Redirect to a file and await the controller process exit, not pipe closure.
async function controlPostgres(label, executable, args, cwd, timeout) {
  const log = join(results, `${label}.log`);
  const fd = openSync(log, "w");
  try {
    await new Promise((resolveRun, reject) => {
      const child = spawn(executable, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ["ignore", fd, fd],
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("PostgreSQL controller timed out."));
      }, timeout);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolveRun()
          : reject(new Error(`PostgreSQL controller exited ${code}.`));
      });
    });
    return { stdout: readFileSync(log, "utf8"), stderr: "" };
  } catch (error) {
    error.stdout = readFileSync(log, "utf8");
    throw error;
  } finally {
    closeSync(fd);
  }
}
async function run(label, executable, args, cwd = root, timeout = 180_000) {
  console.log(`START ${label}`);
  try {
    const result = label.startsWith("postgres-")
      ? await controlPostgres(label, executable, args, cwd, timeout)
      : await execute(executable, args, {
          cwd,
          env,
          windowsHide: true,
          timeout,
          maxBuffer: 16 * 1024 * 1024,
        });
    writeFileSync(join(results, `${label}.log`), result.stdout + result.stderr);
    console.log(`PASS ${label}`);
    return result;
  } catch (error) {
    writeFileSync(
      join(results, `${label}.log`),
      String(error.stdout || "") +
        String(error.stderr || "") +
        "\n" +
        error.message,
    );
    throw new Error(`${label} failed. See ${join(results, `${label}.log`)}`, {
      cause: error,
    });
  }
}
const node = (label, relativeCli, args, cwd = root, timeout) => {
  const parts = relativeCli.split("node_modules/").pop().split("/");
  const pkg = parts[0].startsWith("@")
    ? parts.splice(0, 2).join("/")
    : parts.shift();
  const entry = join(
    dirname(
      createRequire(join(cwd, "package.json")).resolve(pkg + "/package.json"),
    ),
    ...parts,
  );
  return run(label, process.execPath, [entry, ...args], cwd, timeout);
};
try {
  await run("initdb", binary("initdb"), [
    "-D",
    cluster,
    "--username=astra_test",
    "--auth=trust",
    "--encoding=UTF8",
    "--no-locale",
  ]);
  startAttempted = true;
  safeToRemove = false;
  await run("postgres-start", binary("pg_ctl"), [
    "-D",
    cluster,
    "-l",
    join(results, "postgres.log"),
    "-o",
    `-h 127.0.0.1 -p ${port}`,
    "-w",
    "start",
  ]);
  await run("createdb", binary("createdb"), [
    "-h",
    "127.0.0.1",
    "-p",
    String(port),
    "-U",
    "astra_test",
    "astra_hr_test",
  ]);
  const backend = join(root, "backend"),
    frontend = join(root, "frontend");
  await node(
    "prisma-generate",
    "node_modules/prisma/build/index.js",
    ["generate"],
    backend,
  );
  await node(
    "migrations",
    "node_modules/prisma/build/index.js",
    ["migrate", "deploy"],
    backend,
  );
  const summary = {
    passed: true,
    mode,
    database: "PostgreSQL 18; helper-owned temporary loopback cluster",
  };
  if (mode !== "database-check") {
    const setup = await run("setup-tests", process.execPath, [
      "--test",
      "scripts/setup-local.test.mjs",
    ]);
    const setupCount = setup.stdout.match(/# pass (\d+)/);
    if (!setupCount || !/# fail 0/.test(setup.stdout))
      throw new Error("Local setup tests failed.");
    summary.setupTests = Number(setupCount[1]);
    await node("backend-build", "node_modules/typescript/bin/tsc", [], backend);
    if (mode !== "browser") {
      env.NODE_ENV = "test";
      await node(
        "backend-tests",
        "node_modules/jest/bin/jest.js",
        [
          "--runInBand",
          "--json",
          "--outputFile=" + join(results, "backend.json"),
        ],
        backend,
      );
      if (mode !== "api") {
        await node(
          "frontend-tests",
          "node_modules/vitest/vitest.mjs",
          [
            "run",
            "--reporter=json",
            "--outputFile=" + join(results, "frontend.json"),
          ],
          frontend,
        );
      }
      for (const name of mode === "api"
        ? ["backend"]
        : ["backend", "frontend"]) {
        const data = JSON.parse(
          readFileSync(join(results, name + ".json"), "utf8"),
        );
        if (
          !data.success ||
          !data.numTotalTests ||
          data.numFailedTests ||
          data.numPendingTests
        )
          throw new Error(name + " tests did not all execute successfully.");
        summary[name + "Tests"] = data.numPassedTests;
      }
    }
    env.NODE_ENV = "production";
    await run("seed", process.execPath, ["dist/seed.js"], backend);
    await run("seed-repeat", process.execPath, ["dist/seed.js"], backend);
    if (["verify", "browser"].includes(mode)) {
      await node(
        "frontend-typecheck",
        "node_modules/typescript/bin/tsc",
        ["--noEmit"],
        frontend,
      );
      await node(
        "frontend-build",
        "node_modules/vite/bin/vite.js",
        ["build"],
        frontend,
      );
      env.API_PORT = String(await freePort());
      env.WEB_PORT = String(await freePort());
      env.PORT = env.API_PORT;
      env.FRONTEND_URL = "http://127.0.0.1:" + env.WEB_PORT;
      env.API_PROXY_TARGET = "http://127.0.0.1:" + env.API_PORT;
      env.HR_BROWSER_REPORT = join(results, "browser.json");
      await node(
        "browser-tests",
        "node_modules/@playwright/test/cli.js",
        ["test"],
        root,
        600000,
      );
      const stats = JSON.parse(
        readFileSync(join(results, "browser.json"), "utf8"),
      ).stats;
      if (!stats.expected || stats.unexpected || stats.flaky || stats.skipped)
        throw new Error("Browser tests did not all pass.");
      summary.browserTests = stats.expected;
      summary.build = true;
    }
    writeFileSync(
      join(results, "results.json"),
      JSON.stringify(summary, null, 2),
    );
    console.log(JSON.stringify(summary));
  }
} finally {
  if (startAttempted) {
    try {
      await run("postgres-stop", binary("pg_ctl"), [
        "-D",
        cluster,
        "-m",
        "fast",
        "-w",
        "stop",
      ]);
      safeToRemove = true;
    } catch (error) {
      safeToRemove = false;
      console.error(
        `Shutdown was not confirmed; retained cluster directory: ${cluster}`,
      );
      throw error;
    }
  }
  const inside = relative(resolve(tmpdir()), resolve(temporary));
  if (
    safeToRemove &&
    inside &&
    !inside.startsWith("..") &&
    !isAbsolute(inside) &&
    inside.startsWith("astra-hr-pg-")
  )
    rmSync(temporary, { recursive: true, force: true });
}
