import { Router } from "express";
import { actor } from "../middleware/auth";
import { asyncRoute } from "../lib/errors";
import * as service from "../services/employeeService";
const router = Router();
router.get(
  "/",
  asyncRoute(async (req, res) => {
    res.json(await service.listDepartments(actor(req), req.query));
  }),
);
router.post(
  "/",
  asyncRoute(async (req, res) => {
    const row = await service.createDepartment(actor(req), req.body);
    res
      .location("/api/departments/" + row.id)
      .status(201)
      .json(row);
  }),
);
router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    res.json(await service.getDepartment(actor(req), req.params.id));
  }),
);
router.put(
  "/:id",
  asyncRoute(async (req, res) => {
    res.json(
      await service.updateDepartment(actor(req), req.params.id, req.body),
    );
  }),
);
router.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    res.json(
      await service.deleteDepartment(actor(req), req.params.id, req.body),
    );
  }),
);
export default router;
