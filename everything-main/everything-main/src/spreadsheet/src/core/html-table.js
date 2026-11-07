/** Table rows in HTMLTableElement.rows order, without scanning nested tables. */
export function htmlTableRows(table) {
  const header = [], body = [], footer = [];
  // Walk siblings once: copying a large live rows collection can be quadratic.
  for (let child = table.firstElementChild; child; child = child.nextElementSibling) {
    if (child.tagName === 'TR') { body.push(child); continue; }
    const group = child.tagName === 'THEAD' ? header : child.tagName === 'TBODY' ? body : child.tagName === 'TFOOT' ? footer : null;
    if (!group) continue;
    for (let row = child.firstElementChild; row; row = row.nextElementSibling) {
      if (row.tagName === 'TR') group.push(row);
    }
  }
  return [...header, ...body, ...footer];
}
