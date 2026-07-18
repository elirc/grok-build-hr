// Employees listing with filters (demo for RBAC and querying)

import { useQuery } from '@tanstack/react-query';
import { fetchEmployees } from '../../../api/client';

export function EmployeesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
  });

  if (isLoading) return <div>Loading employees...</div>;

  return (
    <div className="border p-4 rounded">
      <h2 className="font-semibold mb-4">Employees</h2>
      {data?.data?.map((emp: any) => (
        <div key={emp.id} className="py-2 border-b">
          {emp.position} - Dept: {emp.department?.name || 'N/A'}
        </div>
      ))}
    </div>
  );
}
