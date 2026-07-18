import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeesPage } from './features/employees/pages/EmployeesPage';
import { LeavePage } from './features/leave/pages/LeavePage';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="p-8 max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">HR Platform Demo</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <EmployeesPage />
          <LeavePage />
        </div>
      </div>
    </QueryClientProvider>
  );
}
