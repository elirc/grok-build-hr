// Leave service - handles workflow logic
// Educational: state transitions, validation, audit

import * as leaveRepo from '../repositories/leaveRepository';

export async function getLeaveRequests(filters: any) {
  return leaveRepo.findMany(filters);
}

export async function createLeaveRequest(data: any) {
  // Check for overlaps, etc. (stub for learning)
  return leaveRepo.create({ ...data, status: 'PENDING' });
}

export async function approveLeave(id: string, approverId: string, status: 'APPROVED' | 'REJECTED') {
  // In real: check approver permissions, update employee balance if approved
  return leaveRepo.update(id, { status, approvedBy: approverId });
}
