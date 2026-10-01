import test from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
function fixture(work, backendDirectory = true) {
  const root = mkdtempSync(join(tmpdir(), "astra-hr-setup-"));
  try {
    mkdirSync(join(root, "scripts"));
    if (backendDirectory) mkdirSync(join(root, "backend"));
    copyFileSync(
      new URL("./setup-local.mjs", import.meta.url),
      join(root, "scripts/setup-local.mjs"),
    );
    work(root, () =>
      spawnSync(process.execPath, [join(root, "scripts/setup-local.mjs")], {
        encoding: "utf8",
        windowsHide: true,
      }),
    );
  } finally {
    const inside = relative(resolve(tmpdir()), resolve(root));
    assert(
      inside &&
        !inside.startsWith("..") &&
        !isAbsolute(inside) &&
        inside.startsWith("astra-hr-setup-"),
    );
    rmSync(root, { recursive: true, force: true });
  }
}
test("creates correctly separated generated credentials without logging their values", () =>
  fixture((root, run) => {
    const result = run();
    assert.equal(result.status, 0);
    const text = readFileSync(join(root, "backend/.env"), "utf8");
    const lines = Object.fromEntries(
      text
        .trim()
        .split("\n")
        .map((line) => {
          const i = line.indexOf("=");
          return [line.slice(0, i), line.slice(i + 1)];
        }),
    );
    assert.equal(Object.keys(lines).length, 6);
    assert(lines.JWT_SECRET.length >= 64);
    assert(lines.DEMO_PASSWORD.length >= 12);
    assert(!result.stdout.includes(lines.DEMO_PASSWORD));
    assert.equal(
      new URL(lines.DATABASE_URL).password,
      readFileSync(join(root, ".env"), "utf8").trim().split("=")[1],
    );
  }));
test("refuses existing environment files without creating the other one", () =>
  fixture((root, run) => {
    writeFileSync(join(root, "backend/.env"), "existing-value\n");
    assert.notEqual(run().status, 0);
    assert.equal(
      readFileSync(join(root, "backend/.env"), "utf8"),
      "existing-value\n",
    );
    assert(!existsSync(join(root, ".env")));
  }));
test("removes only its newly created root file if the second write fails", () =>
  fixture((root, run) => {
    writeFileSync(join(root, "backend"), "existing-file");
    assert.notEqual(run().status, 0);
    assert(!existsSync(join(root, ".env")));
    assert.equal(readFileSync(join(root, "backend"), "utf8"), "existing-file");
  }, false));
