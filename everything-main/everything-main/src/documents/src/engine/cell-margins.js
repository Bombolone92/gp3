export const CELL_MARGIN_SIDES = Object.freeze(['top', 'left', 'bottom', 'right']);

export function checkedCellMargins(patch) {
  if (patch === null) return Object.fromEntries(CELL_MARGIN_SIDES.map(side => [side, null]));
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(side => !CELL_MARGIN_SIDES.includes(side))) throw new Error('Choose top, left, bottom or right cell margins.');
  for (const value of Object.values(patch)) if (value !== null && (!Number.isInteger(value) || value < 0 || value > 31680)) throw new Error('Cell margins must be 0–1584 points in twentieth-point steps.');
  return { ...patch };
}

// A nil/auto/pct cell declaration returns to the table's defaults, cancelling
// an earlier cell-style exception. An absent declaration retains inheritance.
// The editing API removes a declaration before resolving authored null.
export const resolveCellMargins = (inherited = {}, direct = {}, defaults = inherited) => ({ ...inherited, ...Object.fromEntries(Object.entries(direct).flatMap(([side, value]) => value !== null ? [[side, value]] : defaults[side] === undefined ? [] : [[side, defaults[side]]])) });
