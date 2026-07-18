// Employee service - business logic, RBAC stubs

import * as employeeRepo from '../repositories/employeeRepository';

export async function getEmployees(filters: any) {
  // In real: apply RBAC here based on current user role
  return employeeRepo.findMany(filters);
}

export async function createEmployee(data: any) {
  return employeeRepo.create(data);
}
