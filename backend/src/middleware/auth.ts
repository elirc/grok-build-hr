import { Request, Response, NextFunction, Router } from "express";
import { Role } from "@prisma/client";
import jwt, { JwtPayload } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { AppError, asyncRoute } from "../lib/errors";
import { identity, loginInput } from "../lib/validation";
export type Actor = { id: string; role: Role; employeeId: string | null };
const issuer = "hr-workspace",
  audience = "hr-workspace-web";
export function validateSecret(secret: string) {
  if (
    Buffer.byteLength(secret) < 32 ||
    /^(change|replace|example|your[-_ ])/i.test(secret)
  )
    throw new Error(
      "JWT_SECRET must be a generated secret of at least 32 bytes.",
    );
}
export function issueToken(userId: string, secret: string) {
  return jwt.sign({}, secret, {
    algorithm: "HS256",
    subject: userId,
    issuer,
    audience,
    expiresIn: "30m",
  });
}
export async function publicUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id: identity.parse(id) },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      employee: { select: { id: true, active: true } },
    },
  });
  if (!user || user.employee?.active === false)
    throw new AppError(401, "Sign in with an active account to continue.");
  return user;
}
export function authenticate(secret: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;
      let id: string;
      try {
        if (!header?.startsWith("Bearer ") || header.length > 2048)
          throw new Error();
        const payload = jwt.verify(header.slice(7), secret, {
          algorithms: ["HS256"],
          issuer,
          audience,
        }) as JwtPayload;
        id = identity.parse(payload.sub);
      } catch {
        throw new AppError(
          401,
          "Sign in again to continue. Export unsaved drafts first.",
        );
      }
      const user = await publicUser(id);
      req.actor = {
        id: user.id,
        role: user.role,
        employeeId: user.employee?.id || null,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
export function actor(req: Request): Actor {
  if (!req.actor) throw new AppError(401, "Verified identity is required.");
  return req.actor;
}
export function requireHr(value: Actor) {
  if (value.role !== "HR_ADMIN")
    throw new AppError(
      403,
      "An HR administrator must change employee and department records.",
    );
}
export function authRoutes(secret: string) {
  const router = Router(),
    attempts = new Map<string, { count: number; until: number }>(),
    dummyHash = bcrypt.hashSync("synthetic-unused-account-password", 10);
  router.post(
    "/login",
    asyncRoute(async (req, res) => {
      const now = Date.now(),
        key = req.ip || "local";
      for (const [ip, item] of attempts)
        if (item.until <= now) attempts.delete(ip);
      const item = attempts.get(key) || { count: 0, until: now + 900000 };
      if (item.count >= 20 || (!attempts.has(key) && attempts.size >= 1000)) {
        res.setHeader("Retry-After", "900");
        throw new AppError(
          429,
          "Too many sign-in attempts. Try again in fifteen minutes.",
        );
      }
      item.count++;
      attempts.set(key, item);
      const data = loginInput.parse(req.body),
        found = await prisma.user.findUnique({ where: { email: data.email } }),
        matches = await bcrypt.compare(
          data.password,
          found?.passwordHash || dummyHash,
        );
      if (!found?.passwordHash || !matches)
        throw new AppError(401, "Email or password was not accepted.");
      const user = await publicUser(found.id);
      res.json({ token: issueToken(user.id, secret), user });
    }),
  );
  return router;
}
declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
      requestId: string;
    }
  }
}
