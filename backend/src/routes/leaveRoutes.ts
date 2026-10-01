import { Router } from "express";
import { actor } from "../middleware/auth";
import { asyncRoute } from "../lib/errors";
import * as service from "../services/leaveService";
const router = Router();
router.get(
  "/",
  asyncRoute(async (req, res) => {
    res.json(await service.getLeaveRequests(actor(req), req.query));
  }),
);
router.post(
  "/",
  asyncRoute(async (req, res) => {
    const row = await service.createLeaveRequest(actor(req), req.body);
    res
      .location("/api/leave/" + row.id)
      .status(201)
      .json(row);
  }),
);
router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    res.json(await service.getLeaveRequest(actor(req), req.params.id));
  }),
);
router.get(
  "/:id/audit",
  asyncRoute(async (req, res) => {
    res.json({ items: await service.leaveHistory(actor(req), req.params.id) });
  }),
);
router.put(
  "/:id",
  asyncRoute(async (req, res) => {
    res.json(
      await service.updateLeaveRequest(actor(req), req.params.id, req.body),
    );
  }),
);
router.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    res.json(
      await service.deleteLeaveRequest(actor(req), req.params.id, req.body),
    );
  }),
);
router.patch(
  "/:id/decision",
  asyncRoute(async (req, res) => {
    res.json(await service.approveLeave(actor(req), req.params.id, req.body));
  }),
);
router.patch(
  "/:id/cancel",
  asyncRoute(async (req, res) => {
    res.json(await service.cancelLeave(actor(req), req.params.id, req.body));
  }),
);
export default router;
