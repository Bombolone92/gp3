import { clipboardMarkupStamp } from '../../src/core/clipboard-integrity.js';

// Give hand-written metadata fixtures a current markup stamp, so validation
// tests reach the payload validators rather than the unsigned-HTML fallback.
export function stampClipboardHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const table of doc.querySelectorAll('table')) {
    table.setAttribute('data-spreadsheet-markup', clipboardMarkupStamp(table.innerHTML, true));
  }
  return doc.body.innerHTML;
}
