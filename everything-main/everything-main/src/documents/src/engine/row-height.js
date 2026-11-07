export const rowHeight = row => ({ rule: row.heightRule || (row.minHeight ? 'atLeast' : 'auto'), value: row.minHeight || 0 });

// Each physical row is laid out using the greatest margin on each side,
// including continuation cells. Keep these computed values out of the model.
export const rowPadding = row => Object.fromEntries(['top', 'bottom'].map(side => [side, Math.max(0, ...row.cells.map(cell => cell.margins[side]))]));

// The documented exact-height interpretation adds the largest bottom cell
// margin to the declared twips (MS-OI29500 §2.1.180). Keep the stored value intact.
export const exactRowHeight = row => row.heightRule === 'exact'
  ? (row.minHeight + Math.max(0, ...(row.cells || []).map(cell => cell.margins?.bottom || 0))) / 15
  : null;

export function checkedRowHeight(height) {
  if (height === null) return null;
  if (!height || !['auto', 'atLeast', 'exact'].includes(height.rule)) throw new Error('Choose automatic, minimum, or exact row height.');
  if (!Number.isInteger(height.value) || height.value < 0 || height.value > 31680) throw new Error('Row height must be between 0 and 1584 points in twentieth-point steps.');
  if (height.rule === 'auto' && height.value !== 0) throw new Error('Automatic row height has no minimum.');
  if (height.rule === 'exact' && height.value === 0) throw new Error('Exact row height must be greater than zero.');
  return { rule: height.rule, value: height.value };
}
