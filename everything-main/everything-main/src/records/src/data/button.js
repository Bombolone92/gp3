/** The URL a button field opens: its link formula evaluated for the record. */
export function buttonUrl(base, table, rec, field) {
  const src = field.options?.url;
  if (!src) return null;
  // A plain web address works as is (the field editor saves one without
  // spaces unchanged, query strings included); anything else is a formula.
  if (/^https?:\/\/\S+$/i.test(src)) return src;
  const tmp = { ...field, id: `${field.id}:url`, type: 'formula', options: { formula: src } };
  const v = base.compute.formula(table, rec, tmp);
  const s = typeof v === 'string' ? v.trim() : '';
  return /^(https?:|mailto:|tel:)/i.test(s) ? s : s ? `https://${s}` : null;
}
