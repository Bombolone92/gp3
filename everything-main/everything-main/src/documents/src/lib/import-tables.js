/**
 * Tables the converter refuses, rewritten into ones it takes before an HTML
 * import. The converter rejects a table with a row-spanning cell and a table
 * inside a table outright, and with them the whole page; both are everyday
 * constructs in HTML saved by word processors, browsers and mail programs.
 *
 * - A single-cell table holding another table is a layout box: it is
 *   unwrapped into its content. A single-cell table on its own stays a
 *   table, the note box it usually is.
 * - A table inside a cell becomes one paragraph per row inside that cell,
 *   its cells separated by " | " (a tab would collapse to a space).
 * - A cell spanning rows keeps its content in the first row; the rows below
 *   get an empty cell in that column, so the grid stays rectangular.
 */

const CELLS = 'td, th';

/** Rows of a table's own row groups, in document order, excluding rows of tables nested inside cells. */
function rowsOf(table) {
  return [...table.querySelectorAll('tr')].filter((row) => row.closest('table') === table);
}

function cellsOf(row) {
  return [...row.children].filter((cell) => cell.matches(CELLS));
}

/** Unwrap a table with one cell that holds another table: a layout box around content, not a grid. */
function unwrapSingleCell(table) {
  const rows = rowsOf(table);
  if (rows.length !== 1 || cellsOf(rows[0]).length !== 1) return false;
  const [cell] = cellsOf(rows[0]);
  if (!cell.querySelector('table')) return false;
  const doc = table.ownerDocument;
  // Inline content on its own becomes a paragraph, so it does not run into the text around the box.
  const blockish = [...cell.childNodes].some((node) => node.nodeType === 1 && /^(p|div|ul|ol|table|h[1-6]|pre|blockquote|dl|hr)$/i.test(node.tagName));
  if (blockish) table.replaceWith(...cell.childNodes);
  else { const paragraph = doc.createElement('p'); paragraph.append(...cell.childNodes); table.replaceWith(paragraph); }
  return true;
}

/** A table inside a cell, as paragraphs of cells separated by " | ". */
function flattenNested(table) {
  const doc = table.ownerDocument;
  const paragraphs = rowsOf(table).map((row) => {
    const paragraph = doc.createElement('p');
    cellsOf(row).forEach((cell, index) => {
      if (index) paragraph.append(doc.createTextNode(' | '));
      paragraph.append(...cell.childNodes);
    });
    return paragraph;
  });
  table.replaceWith(...paragraphs);
}

/** Give the rows below a row-spanning cell an empty cell in its column, and drop the span. */
function padRowSpans(table) {
  const rows = rowsOf(table);
  if (!rows.some((row) => cellsOf(row).some((cell) => cell.hasAttribute('rowspan')))) return;
  const doc = table.ownerDocument;
  let pending = []; // { column, span, rowsLeft } of spans still covering the rows to come
  rows.forEach((row, rowIndex) => {
    const cells = cellsOf(row);
    const covering = pending.filter((span) => span.rowsLeft > 0).sort((a, b) => a.column - b.column);
    let column = 0, next = 0;
    const placed = [];
    // Walk the grid: a column a span from above still covers gets an empty cell; the row's own cells fill the rest.
    while (next < cells.length || covering.some((span) => span.column >= column)) {
      const above = covering.find((span) => span.column === column);
      if (above) {
        const filler = doc.createElement(cells[0]?.tagName.toLowerCase() === 'th' ? 'th' : 'td');
        if (above.span > 1) filler.setAttribute('colspan', String(above.span));
        const before = cells[next] || null;
        row.insertBefore(filler, before);
        column += above.span;
        above.rowsLeft -= 1;
        continue;
      }
      // The row's own cells have run out, but a span from above still covers a later column: skip ahead to it.
      if (next >= cells.length) { const later = covering.find((span) => span.column > column && span.rowsLeft > 0); if (!later) break; column = later.column; continue; }
      const cell = cells[next++];
      const span = Math.max(1, Number.parseInt(cell.getAttribute('colspan') || '1', 10) || 1);
      const rowspanAttr = cell.getAttribute('rowspan');
      if (rowspanAttr != null) {
        // rowspan="0" spans to the end of the table.
        const declared = Number.parseInt(rowspanAttr, 10);
        const rowspan = declared === 0 ? rows.length - rowIndex : Math.max(1, declared || 1);
        cell.removeAttribute('rowspan');
        if (rowspan > 1) placed.push({ column, span, rowsLeft: rowspan - 1 });
      }
      column += span;
    }
    pending = [...covering.filter((span) => span.rowsLeft > 0), ...placed];
  });
}

/** Rewrite every table in `root` (a parsed document or element) into a form the converter accepts. */
export function normalizeTables(root) {
  // Layout boxes go first, from the outside in: a box around a box around a grid leaves just the grid.
  for (const table of [...root.querySelectorAll('table')]) if (table.isConnected) unwrapSingleCell(table);
  // Then, innermost first, a table still inside a cell is flattened and the rest have their row spans padded.
  for (const table of [...root.querySelectorAll('table')].reverse()) {
    if (!table.isConnected) continue;
    if (table.parentElement?.closest('table')) { flattenNested(table); continue; }
    padRowSpans(table);
  }
}
