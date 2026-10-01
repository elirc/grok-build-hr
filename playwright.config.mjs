import { defineConfig } from "@playwright/test";
const apiPort = Number(process.env.API_PORT || 4001),
  webPort = Number(process.env.WEB_PORT || 5174);
if (process.env.HR_TEST_DATABASE !== "owned-temporary-cluster")
  throw new Error(
    "Run browser tests through scripts/test-database.mjs so they use a temporary database.",
  );
export default defineConfig({
  testDir: "./browser-tests",
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          process.env.HR_BROWSER_REPORT || ".verification/browser.json",
      },
    ],
  ],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    browserName: "chromium",
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node dist/index.js",
      cwd: "backend",
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "node ../node_modules/vite/bin/vite.js preview",
      cwd: "frontend",
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
