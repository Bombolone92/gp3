/**
 * The schedule's view filter: which shifts, rows, and days are on
 * screen. Session-only state, never persisted, and deliberately pure so
 * the week grid, the month overview, the day list, the printout, and the
 * published snapshot all narrow the same way.
 *
 * Filtering hides records; it never changes what they mean. Coverage,
 * labor cost, weekly hours, and conflicts stay computed over the whole
 * dataset by their callers, so a filtered view can never hide a warning.
 */

export const EMPTY_FILTER = {
  roles: [],
  employees: [],
  openOnly: false,
  understaffedOnly: false,
};

const sameRole = (a, b) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** A filter object with every field present, from partial or absent input. */
export function normalizeFilter(filter) {
  return {
    roles: [...(filter?.roles ?? [])],
    employees: [...(filter?.employees ?? [])],
    openOnly: Boolean(filter?.openOnly),
    understaffedOnly: Boolean(filter?.understaffedOnly),
  };
}

/**
 * True when the filter narrows which *shifts* are shown. The understaffed
 * toggle is deliberately not one of these: it narrows which days are on
 * screen and leaves every shift on them alone.
 */
function narrowsShifts(filter) {
  return (
    (filter?.roles?.length ?? 0) > 0 ||
    (filter?.employees?.length ?? 0) > 0 ||
    Boolean(filter?.openOnly)
  );
}

export function isFiltered(filter) {
  return narrowsShifts(filter) || Boolean(filter?.understaffedOnly);
}

/**
 * Does a shift survive the filter? An open shift passes the people
 * filter: nobody holds it yet, and it is the one thing everybody
 * looking at a narrowed week still needs to see.
 */
export function shiftMatchesFilter(shift, filter) {
  if (!filter) return true;
  const roles = filter.roles ?? [];
  if (roles.length > 0 && !roles.some((r) => sameRole(r, shift.role))) return false;
  if (filter.openOnly && shift.assigneeId) return false;
  const employees = filter.employees ?? [];
  if (employees.length > 0 && shift.assigneeId && !employees.includes(shift.assigneeId)) {
    return false;
  }
  return true;
}

/**
 * Does a row stay on screen? `employeeId` is null for the open-shifts
 * row and the shared former-employees row. Somebody picked by name
 * keeps their row even on a week where nothing lands in it, so shifts
 * can still be added there; every other row earns its place by holding
 * at least one shift the filter kept. Only a filter that narrows shifts
 * asks that of a row at all.
 */
export function rowMatchesFilter(filter, employeeId, matchingShiftCount) {
  // Narrowing to understaffed days on its own leaves every row standing.
  // The people who can cover a gap are exactly the ones with nothing on
  // that day, and culling their rows would take away the cells the
  // missing shifts have to be added to.
  if (!narrowsShifts(filter)) return true;
  const picked = filter.employees ?? [];
  if (employeeId && picked.length > 0) {
    if (!picked.includes(employeeId)) return false;
    if ((filter.roles?.length ?? 0) === 0 && !filter.openOnly) return true;
  }
  return matchingShiftCount > 0;
}

/** "Kitchen · 2 people · open shifts only", for the filtered flag. */
export function describeFilter(filter, state) {
  const parts = [];
  const roles = filter?.roles ?? [];
  if (roles.length === 1) parts.push(roles[0]);
  else if (roles.length > 1) parts.push(`${roles.length} roles`);
  const employees = filter?.employees ?? [];
  if (employees.length === 1) {
    parts.push(state?.employees?.find((e) => e.id === employees[0])?.name ?? '1 person');
  } else if (employees.length > 1) {
    parts.push(`${employees.length} people`);
  }
  if (filter?.openOnly) parts.push('open shifts only');
  if (filter?.understaffedOnly) parts.push('understaffed days only');
  return parts.join(' · ');
}
