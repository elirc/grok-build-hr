/**
 * Frontend test example for Leave feature
 * 
 * Shows how to test components that interact with API via TanStack Query.
 * Use MSW (Mock Service Worker) in real projects for realistic API mocking.
 */

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LeavePage } from '../features/leave/pages/LeavePage';
import { vi } from 'vitest';

const queryClient = new QueryClient();

vi.mock('../../../api/client', () => ({
  fetchLeaveRequests: vi.fn().mockResolvedValue({ data: [{ id: '1', type: 'VACATION', status: 'PENDING' }] }),
  createLeaveRequest: vi.fn(),
}));

test('LeavePage shows leave requests', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <LeavePage />
    </QueryClientProvider>
  );

  expect(await screen.findByText(/vacation/i)).toBeInTheDocument();
});
