/**
 * Shift-swap request logic. A swap asks to move one shift from its current
 * assignee to another employee. Lifecycle: pending -> approved | declined |
 * cancelled. Approving a swap reassigns the shift.
 */
import {
  availabilityStatus,
  findConflicts,
  shiftNetMinutes,
  weeklyMinutes,
  AVAILABILITY,
} from './scheduling.js';
import { formatHours, startOfWeek } from '../lib/time.js';
import { ruleViolations } from './rules.js';

export const SWAP_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
};

/**
 * Builds a swap request for `shift`, targeting `toEmployeeId`.
 * Throws when the request is structurally invalid. A snapshot of the shift
 * is embedded so history remains readable if the shift is later deleted.
 */
export function createSwapRequest({ shift, toEmployeeId, reason = '', id, now }) {
  if (!shift) throw new Error('A shift is required.');
  if (!shift.assigneeId) throw new Error('Only assigned shifts can be swapped.');
  if (!toEmployeeId) throw new Error('Choose an employee to take the shift.');
  if (toEmployeeId === shift.assigneeId) {
    throw new Error('The shift is already assigned to that employee.');
  }
  return {
    id,
    shiftId: shift.id,
    fromEmployeeId: shift.assigneeId,
    toEmployeeId,
    reason: String(reason).trim(),
    status: SWAP_STATUS.PENDING,
    createdAt: now ?? null,
    resolvedAt: null,
    shiftSnapshot: { date: shift.date, start: shift.start, end: shift.end, role: shift.role },
  };
}

/**
 * Non-blocking checks for a proposed swap: schedule conflicts,
 * availability, the receiving employee's weekly hour limit (when
 * `employees` is provided), the optional working-time limits (when
 * `rules` is), and attendance already taken for the shift (when
 * `attendance` is). Returns { ok, warnings }.
 */
export function evaluateSwap({
  shift,
  toEmployeeId,
  shifts,
  availability,
  employees,
  attendance = null,
  rules = null,
}) {
  const warnings = [];
  const conflicts = findConflicts(shift, shifts, toEmployeeId);
  if (conflicts.length > 0) {
    warnings.push('The receiving employee already has an overlapping shift.');
  }
  const status = availabilityStatus(shift, availability?.[toEmployeeId]);
  if (status === AVAILABILITY.UNAVAILABLE) {
    warnings.push('The receiving employee is marked unavailable at this time.');
  } else if (status === AVAILABILITY.PARTIAL) {
    warnings.push('The shift only partially fits the receiving employee’s availability.');
  }
  const employee = employees?.find((e) => e.id === toEmployeeId);
  if (employee?.maxHours != null) {
    const others = shifts.filter((s) => s.id !== shift.id);
    const projected =
      weeklyMinutes(others, toEmployeeId, startOfWeek(shift.date)) + shiftNetMinutes(shift);
    if (projected > employee.maxHours * 60) {
      warnings.push(
        `This puts ${employee.name} at ${formatHours(projected)} that week, over their ${employee.maxHours}h max.`
      );
    }
  }
  if (rules) {
    const others = shifts.filter((s) => s.id !== shift.id);
    for (const violation of ruleViolations({ ...shift, assigneeId: toEmployeeId }, toEmployeeId, others, rules, {
      name: employee?.name ?? 'The receiving employee',
    })) {
      warnings.push(violation.message);
    }
  }
  // A request outlives the day it was made for: nothing expires a pending
  // one, so a shift can be worked and clocked before anybody reviews it.
  // Approving reassigns the shift, and attendance is keyed by shift, so
  // the record goes with it and the receiving employee's timesheet pays
  // out somebody else's clock times. Same hazard evaluateMove warns
  // about when a chip is dragged onto another row.
  if (attendance?.[shift.id]) {
    warnings.push(
      `The attendance already recorded for this shift becomes ${
        employee?.name ?? 'the receiving employee'
      }’s.`
    );
  }
  return { ok: warnings.length === 0, warnings };
}

/** Returns a resolved copy of the swap. Only pending swaps can be resolved. */
export function resolveSwap(swap, status, now) {
  if (swap.status !== SWAP_STATUS.PENDING) {
    throw new Error('This request has already been resolved.');
  }
  if (![SWAP_STATUS.APPROVED, SWAP_STATUS.DECLINED, SWAP_STATUS.CANCELLED].includes(status)) {
    throw new Error(`Invalid resolution: ${status}`);
  }
  return { ...swap, status, resolvedAt: now ?? null };
}

/**
 * Applies an approved swap to the shift list, returning a new list with the
 * shift reassigned. Throws when the shift no longer matches the request.
 */
export function applySwap(swap, shifts) {
  const shift = shifts.find((s) => s.id === swap.shiftId);
  if (!shift) throw new Error('The shift in this request no longer exists.');
  if (shift.assigneeId !== swap.fromEmployeeId) {
    throw new Error('The shift has been reassigned since this request was made.');
  }
  return shifts.map((s) => (s.id === swap.shiftId ? { ...s, assigneeId: swap.toEmployeeId } : s));
}

export function pendingSwaps(swaps) {
  return swaps.filter((s) => s.status === SWAP_STATUS.PENDING);
}
