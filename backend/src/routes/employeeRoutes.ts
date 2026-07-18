// Employee routes
// Focus on RBAC and filtering by manager/dept.

import { Router } from 'express';
import * as employeeService from '../services/employeeService';

const router = Router();

// GET /api/employees - list with filters (e.g. by dept or manager)
router.get('/', async (req, res) => {
  const { departmentId, managerId } = req.query;
  const employees = await employeeService.getEmployees({ departmentId, managerId });
  res.json({ data: employees });
});

// POST create employee (HR only in real impl)
router.post('/', async (req, res) => {
  const employee = await employeeService.createEmployee(req.body);
  res.status(201).json({ data: employee });
});

export default router;
