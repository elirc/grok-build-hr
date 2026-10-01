import dotenv from "dotenv";
import { createApp } from "./app";
import { prisma } from "./lib/prisma";

dotenv.config();
const rawPort = process.env.PORT || "4001";
if (!/^[1-9]\d{0,4}$/.test(rawPort) || Number(rawPort) > 65535)
  throw new Error("PORT must be 1-65535.");
const app = createApp(
  process.env.JWT_SECRET || "",
  process.env.FRONTEND_URL || "http://127.0.0.1:5174",
);
const server = app.listen(Number(rawPort), "127.0.0.1", () =>
  console.log(`HR workspace API: http://127.0.0.1:${rawPort}`),
);
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    void prisma.$disconnect().finally(() => process.exit(1));
  }, 10000);
  deadline.unref();
  server.close(() => {
    void prisma.$disconnect().finally(() => {
      clearTimeout(deadline);
      process.exit(0);
    });
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
server.on("error", (error) => {
  console.error(error.message);
  void prisma.$disconnect().finally(() => process.exit(1));
});
