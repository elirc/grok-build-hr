// API client for HR system
// Focused on employees and leave

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export async function fetchEmployees(filters = {}) {
  const params = new URLSearchParams(filters as any).toString();
  const res = await fetch(`${API_BASE}/employees?${params}`);
  return res.json();
}

export async function fetchLeaveRequests(filters = {}) {
  const params = new URLSearchParams(filters as any).toString();
  const res = await fetch(`${API_BASE}/leave?${params}`);
  return res.json();
}

export async function createLeaveRequest(data: any) {
  const res = await fetch(`${API_BASE}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}
