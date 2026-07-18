// Leave requests page - shows workflow

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLeaveRequests, createLeaveRequest } from '../../../api/client';

export function LeavePage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['leave'],
    queryFn: fetchLeaveRequests,
  });

  const createMutation = useMutation({
    mutationFn: createLeaveRequest,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leave'] }),
  });

  if (isLoading) return <div>Loading leave...</div>;

  return (
    <div className="border p-4 rounded">
      <h2 className="font-semibold mb-4">Leave Requests</h2>
      <button onClick={() => createMutation.mutate({ employeeId: 'demo', startDate: new Date(), endDate: new Date() })}>
        Request Leave (demo)
      </button>
      {data?.data?.map((leave: any) => (
        <div key={leave.id} className="py-1">{leave.type} - {leave.status}</div>
      ))}
    </div>
  );
}
