/** Value events contain only fixed action labels, never workbook data or AI messages. */
export function trackEvent(name, props) {
  try {
    if (typeof globalThis.plausible === 'function') {
      if (props) globalThis.plausible(name, { props });
      else globalThis.plausible(name);
    }
  } catch { /* Analytics must not interrupt editing, saving, exports or AI. */ }
}

const EXPORT_FORMATS = new Set(['xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'ods', 'html', 'pdf', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);

export function trackExport(filename, method) {
  const extension = /\.([a-z0-9]+)$/i.exec(String(filename))?.[1].toLowerCase();
  trackEvent('Spreadsheet Exported', { format: EXPORT_FORMATS.has(extension) ? extension : 'other', method });
}
