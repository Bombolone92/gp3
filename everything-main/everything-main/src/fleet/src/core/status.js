/**
 * Labels and color tones for every status the app shows. Tones map to the
 * pill styles: green, orange, red, blue, gray, purple, teal.
 */

export const ISSUE_STATUSES = [
  { id: 'open', label: 'Open', tone: 'orange' },
  { id: 'resolved', label: 'Resolved', tone: 'green' },
  { id: 'closed', label: 'Closed', tone: 'gray' },
];

export const ISSUE_PRIORITIES = [
  { id: 'none', label: 'No priority', tone: 'gray', rank: 0 },
  { id: 'low', label: 'Low', tone: 'blue', rank: 1 },
  { id: 'medium', label: 'Medium', tone: 'orange', rank: 2 },
  { id: 'high', label: 'High', tone: 'red', rank: 3 },
  { id: 'critical', label: 'Critical', tone: 'red', rank: 4 },
];

export const WORK_ORDER_STATUSES = [
  { id: 'open', label: 'Open', tone: 'blue' },
  { id: 'in_progress', label: 'In progress', tone: 'purple' },
  { id: 'on_hold', label: 'On hold', tone: 'orange' },
  { id: 'completed', label: 'Completed', tone: 'green' },
  { id: 'cancelled', label: 'Cancelled', tone: 'gray' },
];

/** Repair priority class: why the work was done. */
export const REPAIR_CLASSES = [
  { id: 'scheduled', label: 'Scheduled', tone: 'green' },
  { id: 'non_scheduled', label: 'Non-scheduled', tone: 'orange' },
  { id: 'emergency', label: 'Emergency', tone: 'red' },
];

export const REMINDER_STATUSES = [
  { id: 'overdue', label: 'Overdue', tone: 'red' },
  { id: 'due_soon', label: 'Due soon', tone: 'orange' },
  { id: 'upcoming', label: 'Upcoming', tone: 'gray' },
  { id: 'snoozed', label: 'Snoozed', tone: 'blue' },
];

export const PO_STATUSES = [
  { id: 'draft', label: 'Draft', tone: 'gray' },
  { id: 'ordered', label: 'Ordered', tone: 'blue' },
  { id: 'partial', label: 'Partially received', tone: 'orange' },
  { id: 'received', label: 'Received', tone: 'green' },
  { id: 'cancelled', label: 'Cancelled', tone: 'gray' },
];

export const OWNERSHIP = [
  { id: 'owned', label: 'Owned' },
  { id: 'leased', label: 'Leased' },
  { id: 'rented', label: 'Rented' },
  { id: 'customer', label: 'Customer' },
];

export const CONTACT_ROLES = [
  { id: 'operator', label: 'Operator' },
  { id: 'technician', label: 'Technician' },
  { id: 'manager', label: 'Manager' },
  { id: 'employee', label: 'Employee' },
];

export const VENDOR_KINDS = [
  { id: 'fuel', label: 'Fuel' },
  { id: 'service', label: 'Service' },
  { id: 'parts', label: 'Parts' },
  { id: 'charging', label: 'Charging' },
  { id: 'tires', label: 'Tires' },
  { id: 'towing', label: 'Towing' },
  { id: 'other', label: 'Other' },
];

const BY_KIND = {
  issue: ISSUE_STATUSES,
  priority: ISSUE_PRIORITIES,
  workOrder: WORK_ORDER_STATUSES,
  repair: REPAIR_CLASSES,
  reminder: REMINDER_STATUSES,
  po: PO_STATUSES,
};

export function statusMeta(kind, id) {
  return BY_KIND[kind]?.find((s) => s.id === id) || { id, label: id ? String(id).replace(/_/g, ' ') : 'Unknown', tone: 'gray' };
}

/** Vehicle status from the fleet's configurable list. */
export function vehicleStatusMeta(settings, id) {
  const s = settings?.vehicleStatuses?.find((x) => x.id === id);
  return s ? { id: s.id, label: s.label, tone: s.color || 'gray' } : { id, label: id ? String(id).replace(/_/g, ' ') : 'No status', tone: 'gray' };
}

export function priorityRank(id) {
  return ISSUE_PRIORITIES.find((p) => p.id === id)?.rank ?? 0;
}

/** Open issues past their due date (or due meter). */
export function issueOverdue(issue, today, vehicle = null) {
  if (issue.status !== 'open') return false;
  if (issue.dueDate && issue.dueDate < today) return true;
  if (issue.dueMeter && vehicle && Number(vehicle.meter) >= Number(issue.dueMeter)) return true;
  return false;
}
