import { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  let status = 500,
    message =
      "The service could not complete this request. Keep your draft and try refreshing.";
  if (error instanceof AppError) {
    status = error.status;
    message = error.message;
  } else if (error instanceof ZodError) {
    status = 400;
    message = error.issues
      .map((issue) => `${issue.path.join(".") || "Request"}: ${issue.message}`)
      .slice(0, 6)
      .join("; ");
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (["P2002", "P2003", "P2034"].includes(error.code)) {
      status = 409;
      message =
        "The record changed or is still referenced. Refresh current records before retrying.";
    } else {
      status = 503;
      message =
        "The database is unavailable. Keep your draft and try again later.";
    }
  } else if (error instanceof Prisma.PrismaClientInitializationError) {
    status = 503;
    message =
      "The database is unavailable. Keep your draft and try again later.";
  } else if (typeof error === "object" && error !== null && "type" in error) {
    if (error.type === "entity.too.large") {
      status = 413;
      message = "Request body must not exceed 32 KiB.";
    }
    if (error.type === "entity.parse.failed") {
      status = 400;
      message = "Request body must contain valid JSON.";
    }
  }
  if (status >= 500)
    console.error(
      JSON.stringify({
        requestId: req.requestId,
        status,
        event: "request_failed",
      }),
    );
  res.status(status).json({ error: message, requestId: req.requestId });
}
