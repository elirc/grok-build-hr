import { Actor } from "../middleware/auth";
import * as repo from "../repositories/leaveRepository";
import {
  leaveInput,
  leaveUpdate,
  leaveFilters,
  decisionInput,
  versionInput,
  identity,
} from "../lib/validation";
export const getLeaveRequests = (actor: Actor, query: unknown) =>
  repo.findMany(actor, leaveFilters.parse(query));
export const getLeaveRequest = (actor: Actor, id: unknown) =>
  repo.get(actor, identity.parse(id));
export const createLeaveRequest = (actor: Actor, value: unknown) =>
  repo.create(actor, leaveInput.parse(value));
export function updateLeaveRequest(actor: Actor, id: unknown, value: unknown) {
  const data = leaveUpdate.parse(value);
  return repo.update(actor, identity.parse(id), data.version, data.leave);
}
export const deleteLeaveRequest = (actor: Actor, id: unknown, value: unknown) =>
  repo.remove(actor, identity.parse(id), versionInput.parse(value).version);
export function approveLeave(actor: Actor, id: unknown, value: unknown) {
  const data = decisionInput.parse(value);
  return repo.decide(
    actor,
    identity.parse(id),
    data.version,
    data.status,
    data.note,
  );
}
export const cancelLeave = (actor: Actor, id: unknown, value: unknown) =>
  repo.cancel(actor, identity.parse(id), versionInput.parse(value).version);
export const leaveHistory = (actor: Actor, id: unknown) =>
  repo.history(actor, identity.parse(id));
