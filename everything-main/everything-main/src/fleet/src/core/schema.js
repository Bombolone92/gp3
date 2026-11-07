/**
 * Collections and how they are laid out in storage.
 *
 * Most collections are small and change rarely (vehicles, contacts, parts),
 * so each one is a single storage bucket that loads with one prefix query.
 *
 * Logs that grow every day (fuel, meter readings, inspections, service
 * entries, expenses) are split into one bucket per calendar month, taken
 * from the record's own date. Every bucket has its own version counter, so
 * when a driver logs fuel today, other devices re-read only this month's
 * fuel bucket instead of the fleet's entire fuel history.
 *
 * Bucket names are plain identifiers: `vehicles`, `fuel_202610`.
 */

export const COLLECTIONS = [
  'vehicles',
  'contacts',
  'vendors',
  'assignments',
  'meters',
  'fuel',
  'expenses',
  'issues',
  'inspectionForms',
  'inspections',
  'serviceTasks',
  'servicePrograms',
  'reminders',
  'renewals',
  'serviceEntries',
  'workOrders',
  'parts',
  'purchaseOrders',
  'comments',
];

/** Month-partitioned collections and the date field that picks the bucket. */
export const PARTITIONED = {
  meters: 'date',
  fuel: 'date',
  expenses: 'date',
  inspections: 'date',
  serviceEntries: 'date',
};

/** Collections whose records get a human-friendly sequential number. */
export const NUMBERED = { issues: 'issue', workOrders: 'workOrder', purchaseOrders: 'purchaseOrder' };

const MONTH_RE = /^(\d{4})-(\d{2})/;

/** Storage bucket a record belongs in. */
export function bucketOf(coll, rec) {
  const field = PARTITIONED[coll];
  if (!field) return coll;
  const m = MONTH_RE.exec(String(rec?.[field] || ''));
  return `${coll}_${m ? m[1] + m[2] : '000000'}`;
}

/** Collection name from a bucket name (`fuel_202610` -> `fuel`). */
export function collOfBucket(bucket) {
  const i = bucket.indexOf('_');
  return i < 0 ? bucket : bucket.slice(0, i);
}

const BUCKET_RE = /^([a-zA-Z]+)(?:_(\d{6}))?$/;

/** True for a well-formed bucket of a known collection. */
export function isBucket(name) {
  const m = BUCKET_RE.exec(String(name || ''));
  if (!m || !COLLECTIONS.includes(m[1])) return false;
  return Boolean(m[2]) === Boolean(PARTITIONED[m[1]]);
}
