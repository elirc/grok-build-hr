// Leave routes - workflow example
// PENDING -> APPROVED/REJECTED by manager/HR

import { Router } from 'express';
import * as leaveService from '../services/leaveService';

const router = Router();

router.get('/', async (req, res) => {
  const { employeeId, status } = req.query;
  const leaves = await leaveService.getLeaveRequests({ employeeId, status });
  res.json({ data: leaves });
});

router.post('/', async (req, res) => {
  const leave = await leaveService.createLeaveRequest(req.body);
  res.status(201).json({ data: leave });
});

router.patch('/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { approverId, status } = req.body; // 'APPROVED' or 'REJECTED'
  const updated = await leaveService.approveLeave(id, approverId, status);
  res.json({ data: updated });
});

export default router;
