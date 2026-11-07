/**
 * Full-dataset backup: serializes every collection plus settings into a
 * single JSON document, and validates such documents before an import
 * replaces the live data.
 */

export const BACKUP_SCHEMA_VERSION = 1;

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The complete dataset as a plain object ready for JSON.stringify. */
export function buildBackup(state, { exportedAt = new Date().toISOString() } = {}) {
  // shareSite points at a hosting resource owned by the exporting account;
  // after an import into another account it would be wrong or dangling.
  const { shareSite, ...settings } = state.settings ?? {};
  return {
    app: 'shifts',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    employees: state.employees,
    shifts: state.shifts,
    availability: state.availability,
    swaps: state.swaps,
    attendance: state.attendance,
    settings,
  };
}

/**
 * Checks that `data` is a backup this app can restore. Returns a list of
 * human-readable problems; empty means the file is usable.
 */
export function validateBackup(data) {
  if (!isPlainObject(data) || data.app !== 'shifts') {
    return ['This file is not a Shifts backup.'];
  }
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) {
    return ['The backup is missing a valid version number.'];
  }
  if (data.schemaVersion > BACKUP_SCHEMA_VERSION) {
    return ['This backup comes from a newer version of Shifts. Update the app and try again.'];
  }

  const errors = [];
  for (const key of ['employees', 'shifts', 'swaps']) {
    if (!Array.isArray(data[key])) errors.push(`The “${key}” collection is missing or invalid.`);
  }
  for (const key of ['availability', 'attendance']) {
    if (!isPlainObject(data[key])) errors.push(`The “${key}” collection is missing or invalid.`);
  }
  if (data.settings !== undefined && !isPlainObject(data.settings)) {
    errors.push('The settings block is invalid.');
  }
  if (errors.length > 0) return errors;

  // Spot-check record shape so a truncated or hand-edited file fails here
  // instead of leaving the app with half-usable data.
  if (data.employees.some((e) => !isPlainObject(e) || typeof e.id !== 'string' || typeof e.name !== 'string')) {
    errors.push('An employee record is malformed.');
  }
  if (
    data.shifts.some(
      (s) =>
        !isPlainObject(s) ||
        typeof s.id !== 'string' ||
        typeof s.date !== 'string' ||
        typeof s.start !== 'string' ||
        typeof s.end !== 'string'
    )
  ) {
    errors.push('A shift record is malformed.');
  }
  if (data.swaps.some((s) => !isPlainObject(s) || typeof s.id !== 'string')) {
    errors.push('A swap record is malformed.');
  }
  return errors;
}

/** Content counts for previews, e.g. before confirming an import. */
export function backupCounts(data) {
  return {
    employees: data.employees.length,
    shifts: data.shifts.length,
    swaps: data.swaps.length,
    attendance: Object.keys(data.attendance).length,
    timeOff: Object.values(data.availability).reduce(
      (n, a) => n + (Array.isArray(a?.exceptions) ? a.exceptions.length : 0),
      0
    ),
  };
}

/**
 * "5 employees, 812 shifts, 214 attendance records" from counts alone,
 * so a restore point can describe itself from its index entry without
 * reading the file back.
 */
export function describeCounts(c) {
  const plural = (n, word, words = `${word}s`) => `${n} ${n === 1 ? word : words}`;
  const parts = [plural(c.employees ?? 0, 'employee'), plural(c.shifts ?? 0, 'shift')];
  if (c.attendance > 0) parts.push(plural(c.attendance, 'attendance record'));
  if (c.swaps > 0) parts.push(plural(c.swaps, 'swap request'));
  if (c.timeOff > 0) parts.push(plural(c.timeOff, 'time-off entry', 'time-off entries'));
  return parts.join(', ');
}

/** The same line for a whole backup document. */
export function describeBackup(data) {
  return describeCounts(backupCounts(data));
}
