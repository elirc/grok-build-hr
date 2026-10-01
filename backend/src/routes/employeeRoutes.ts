import { Router } from "express";
import { actor } from "../middleware/auth";
import { asyncRoute } from "../lib/errors";
import * as service from "../services/employeeService";
const router = Router();
router.get(
  "/",
  asyncRoute(async (req, res) => {
    res.json(await service.getEmployees(actor(req), req.query));
  }),
);
router.get(
  "/options",
  asyncRoute(async (req, res) => {
    res.json(await service.options(actor(req)));
  }),
);
router.post(
  "/",
  asyncRoute(async (req, res) => {
    const row = await service.createEmployee(actor(req), req.body);
    res
      .location("/api/employees/" + row.id)
      .status(201)
      .json(row);
  }),
);
router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    res.json(await service.getEmployee(actor(req), req.params.id));
  }),
);
router.put(
  "/:id",
  asyncRoute(async (req, res) => {
    res.json(await service.updateEmployee(actor(req), req.params.id, req.body));
  }),
);
router.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    res.json(await service.deleteEmployee(actor(req), req.params.id, req.body));
  }),
);
export default router;
