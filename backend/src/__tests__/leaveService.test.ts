/**
 * Unit tests for leaveService (HR domain)
 * 
 * Educational goal: Show testing of workflow/business logic in HR systems.
 * 
 * Mid-level focus:
 * - Test state transitions (PENDING -> APPROVED)
 * - Mock the repository to isolate business rules
 * - Cover happy path + invalid states + permission checks
 */

import * as leaveService from '../services/leaveService';
import * as leaveRepo from '../repositories/leaveRepository';
import { vi } from 'vitest';

vi.mock('../repositories/leaveRepository');

describe('leaveService - HR workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create leave request with PENDING status', async () => {
    const mockCreate = vi.spyOn(leaveRepo, 'create').mockResolvedValue({ id: '1', status: 'PENDING' } as any);

    const result = await leaveService.createLeaveRequest({
      employeeId: 'emp1',
      startDate: new Date(),
      endDate: new Date(),
      type: 'VACATION'
    });

    expect(mockCreate).toHaveBeenCalled();
    expect(result.status).toBe('PENDING');
  });

  it('should allow manager to approve leave', async () => {
    const mockUpdate = vi.spyOn(leaveRepo, 'update').mockResolvedValue({ id: '1', status: 'APPROVED' } as any);

    const result = await leaveService.approveLeave('1', 'manager1', 'APPROVED');

    expect(mockUpdate).toHaveBeenCalledWith('1', { status: 'APPROVED', approvedBy: 'manager1' });
    expect(result.status).toBe('APPROVED');
  });

  // Add tests for overlap detection, rejection, etc. in real expansion
});
