import { Actor, requireHr } from "../middleware/auth";
import * as repo from "../repositories/employeeRepository";
import * as departments from "../repositories/departmentRepository";
import {
  employeeInput,
  employeeUpdate,
  employeeFilters,
  versionInput,
  departmentInput,
  departmentUpdate,
  departmentFilters,
  identity,
} from "../lib/validation";
export const getEmployees = (actor: Actor, query: unknown) =>
  repo.findMany(actor, employeeFilters.parse(query));
export const getEmployee = (actor: Actor, id: unknown) =>
  repo.get(actor, identity.parse(id));
export function createEmployee(actor: Actor, value: unknown) {
  requireHr(actor);
  return repo.create(actor, employeeInput.parse(value));
}
export function updateEmployee(actor: Actor, id: unknown, value: unknown) {
  requireHr(actor);
  const data = employeeUpdate.parse(value);
  return repo.update(actor, identity.parse(id), data.version, data.employee);
}
export function deleteEmployee(actor: Actor, id: unknown, value: unknown) {
  requireHr(actor);
  return repo.remove(
    actor,
    identity.parse(id),
    versionInput.parse(value).version,
  );
}
export const options = (actor: Actor) => repo.options(actor);
export const listDepartments = (actor: Actor, query: unknown) =>
  departments.list(actor, departmentFilters.parse(query));
export const getDepartment = (actor: Actor, id: unknown) =>
  departments.get(actor, identity.parse(id));
export function createDepartment(actor: Actor, value: unknown) {
  requireHr(actor);
  return departments.create(actor, departmentInput.parse(value).name);
}
export function updateDepartment(actor: Actor, id: unknown, value: unknown) {
  requireHr(actor);
  const data = departmentUpdate.parse(value);
  return departments.update(
    actor,
    identity.parse(id),
    data.version,
    data.department.name,
  );
}
export function deleteDepartment(actor: Actor, id: unknown, value: unknown) {
  requireHr(actor);
  return departments.remove(
    actor,
    identity.parse(id),
    versionInput.parse(value).version,
  );
}
