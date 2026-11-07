/**
 * Every status shown as a pill, with its label and tone. Tones map to CSS
 * classes: neutral, info, success, warning, danger, accent.
 */
export const STATUS_META = {
  // Leases
  draft: { label: 'Draft', tone: 'neutral' },
  future: { label: 'Future', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  past: { label: 'Past', tone: 'neutral' },
  eviction: { label: 'Eviction pending', tone: 'danger' },
  // Renewals
  'not-started': { label: 'Not started', tone: 'neutral' },
  offered: { label: 'Offer sent', tone: 'info' },
  accepted: { label: 'Renewing', tone: 'success' },
  declined: { label: 'Moving out', tone: 'warning' },
  // Units
  occupied: { label: 'Occupied', tone: 'success' },
  vacant: { label: 'Vacant', tone: 'warning' },
  listed: { label: 'Listed', tone: 'info' },
  // Work orders and tasks
  new: { label: 'New', tone: 'info' },
  assigned: { label: 'Assigned', tone: 'accent' },
  'in-progress': { label: 'In progress', tone: 'accent' },
  waiting: { label: 'Waiting', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  deferred: { label: 'Deferred', tone: 'neutral' },
  // Bills
  due: { label: 'Due', tone: 'info' },
  partial: { label: 'Partly paid', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' },
  void: { label: 'Void', tone: 'neutral' },
  // Applicants
  screening: { label: 'Screening', tone: 'accent' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Declined', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  converted: { label: 'Lease created', tone: 'success' },
  // Inspections
  scheduled: { label: 'Scheduled', tone: 'info' },
  // Reconciliations
  open: { label: 'In progress', tone: 'warning' },
  reconciled: { label: 'Reconciled', tone: 'success' },
  // Messages
  sent: { label: 'Sent', tone: 'success' },
  failed: { label: 'Not sent', tone: 'danger' },
  logged: { label: 'Logged', tone: 'neutral' },
  // Priority
  low: { label: 'Low', tone: 'neutral' },
  normal: { label: 'Normal', tone: 'info' },
  high: { label: 'High', tone: 'warning' },
  urgent: { label: 'Urgent', tone: 'danger' },
};

export function statusLabel(status) {
  return STATUS_META[status]?.label || String(status || '');
}

export function statusTone(status) {
  return STATUS_META[status]?.tone || 'neutral';
}

export const WORK_ORDER_STATUSES = ['new', 'assigned', 'in-progress', 'waiting', 'completed', 'closed', 'cancelled'];
export const TASK_STATUSES = ['new', 'in-progress', 'waiting', 'completed', 'deferred', 'closed'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const APPLICANT_STATUSES = ['new', 'screening', 'approved', 'rejected', 'withdrawn', 'converted'];

export const TASK_KINDS = [
  { id: 'todo', label: 'To do' },
  { id: 'resident', label: 'Resident request' },
  { id: 'owner', label: 'Owner request' },
  { id: 'contact', label: 'Contact request' },
];

export function taskKindLabel(id) {
  return TASK_KINDS.find((k) => k.id === id)?.label || 'To do';
}

/** Overdue: has a due date in the past and is not finished. */
export function isOverdue(record, today, done = ['completed', 'closed', 'cancelled', 'deferred']) {
  return !!record.dueDate && record.dueDate < today && !done.includes(record.status);
}
