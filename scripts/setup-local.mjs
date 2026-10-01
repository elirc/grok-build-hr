import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [join(root, ".env"), join(root, "backend", ".env")];
if (targets.some(existsSync))
  throw new Error(
    "An environment file already exists. Review it manually; setup never overwrites either file.",
  );
const databasePassword = randomBytes(24).toString("base64url"),
  secret = randomBytes(32).toString("hex"),
  demoPassword = randomBytes(18).toString("base64url");
const contents = [
  `HR_POSTGRES_PASSWORD=${databasePassword}\n`,
  `DATABASE_URL=postgresql://hr_dev:${databasePassword}@127.0.0.1:5438/hr_workspace?schema=public\nJWT_SECRET=${secret}\nFRONTEND_URL=http://127.0.0.1:5174\nPORT=4001\nALLOW_DEMO_SEED=yes\nDEMO_PASSWORD=${demoPassword}\n`,
];
const created = [];
try {
  for (let index = 0; index < targets.length; index++) {
    writeFileSync(targets[index], contents[index], { flag: "wx", mode: 0o600 });
    created.push(targets[index]);
  }
} catch (error) {
  for (const path of created) unlinkSync(path);
  throw error;
}
console.log(
  "Created local environment files with generated credentials. Review backend/.env locally for DEMO_PASSWORD. Existing data was not opened or changed.",
);
