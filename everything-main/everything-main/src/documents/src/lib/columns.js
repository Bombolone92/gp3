/**
 * Text columns. A section carries a column count and the gap between
 * columns; the app offers one, two, or three equal columns with a half-inch
 * gap and applies the choice to every section so the document reads as one.
 */

export const COLUMN_CHOICES = [
  { count: 1, label: 'One column' },
  { count: 2, label: 'Two columns' },
  { count: 3, label: 'Three columns' },
];
export const COLUMN_GAP_IN = 0.5;

/** The column count a section reports (1 when it has none). */
export function columnCount(section) {
  const n = Number(section?.columns?.count);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Set every section to `count` equal columns. Throws on the first failure. */
export async function setColumns(api, sections, count, { beforeWrite = () => {}, onChange = () => {} } = {}) {
  for (const s of sections) {
    beforeWrite();
    const target = s.address || { kind: 'section', sectionId: s.id };
    const r = await api.sections.setColumns({ target, count, gap: COLUMN_GAP_IN, equalWidth: true });
    if (r == null || (r.success === false && r.failure?.code !== 'NO_OP')) throw new Error(r?.failure?.message || 'Columns were not applied');
    if (r.success !== false) onChange();
  }
  return sections.length;
}
