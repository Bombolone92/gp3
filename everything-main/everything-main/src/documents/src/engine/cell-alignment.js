export const CELL_ALIGNMENTS = Object.freeze({ top: 'Top', center: 'Center', bottom: 'Bottom' });

export function checkedCellAlignment(value) {
  if (typeof value !== 'string' || !Object.hasOwn(CELL_ALIGNMENTS, value)) throw new Error('Choose Top, Center or Bottom for cell alignment.');
  return value;
}
