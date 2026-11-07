// Navigation is saved with a document but is not an edit. Keep no-op and undo
// assertions strict for every other workbook field, including styles and sizes.
export function contentSnapshot(wb) {
  const json = wb.toJSON();
  return { ...json, sheets: json.sheets.map(({ viewSelection, ...sheet }) => sheet) };
}
