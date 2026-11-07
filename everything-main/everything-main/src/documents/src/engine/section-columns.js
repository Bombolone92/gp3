// Section column declarations are measured in twips. This module does not
// paginate, paint, or change the retained source XML.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const attr = (node, name) => node?.getAttributeNS(W, name) ?? null;
const fail = () => { throw new Error('Invalid section column settings.'); };
function integer(value, fallback, minimum = 0) {
  if (value === null) return fallback;
  if (!/^\+?\d+$/.test(value)) fail();
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum) fail();
  return n;
}
function onOff(value, fallback) {
  if (value === null) return fallback;
  if (['1', 'true', 'on'].includes(value)) return true;
  if (['0', 'false', 'off'].includes(value)) return false;
  return fail();
}
function twips(value, fallback) {
  if (value === null) return fallback;
  const m = /^(\d+(?:\.\d+)?)(mm|cm|in|pt|pc|pi)$/.exec(value);
  if (!m) return integer(value, fallback);
  const n = Math.round(Number(m[1]) * { mm: 1440/25.4, cm: 1440/2.54, in: 1440, pt: 20, pc: 240, pi: 240 }[m[2]]);
  if (!Number.isSafeInteger(n)) fail();
  return n;
}

export function readSectionColumns(node) {
  if (!node) return { equalWidth: true, count: 1, space: 720, separator: false, entries: [] };
  for (const a of node.attributes) if (a.namespaceURI === W && !['equalWidth', 'num', 'sep', 'space'].includes(a.localName)) fail();
  const entries = [...node.children].map(col => {
    if (col.namespaceURI !== W || col.localName !== 'col' || col.children.length || col.textContent.trim()) fail();
    for (const a of col.attributes) if (a.namespaceURI === W && !['w', 'space'].includes(a.localName)) fail();
    return { width: twips(attr(col, 'w'), null), space: twips(attr(col, 'space'), 0) };
  });
  const equalWidth = onOff(attr(node, 'equalWidth'), true);
  const count = integer(attr(node, 'num'), 1, 1);
  if (!equalWidth && (!entries.length || entries.some(e => e.width === null))) fail();
  // num (default 1) applies even to unequal columns, contrary to
  // §17.6.4. Retain only active widths in the layout model; untouched source
  // XML, including surplus col children, is preserved by the package writer.
  // Missing width entries have undefined native geometry. Keep the existing
  // explicit-entry fallback for that unresolved case rather than invent widths.
  const active = equalWidth ? entries : entries.slice(0, count);
  return { equalWidth, count: equalWidth ? count : active.length,
    space: twips(attr(node, 'space'), 720), separator: onOff(attr(node, 'sep'), false), entries: active };
}

/** Physical horizontal column intervals in twips, before any layout scaling. */
export function sectionColumnIntervals(columns, left, available) {
  if (!Number.isFinite(left) || !Number.isFinite(available) || available <= 0) fail();
  if (!Number.isSafeInteger(columns.count) || columns.count < 1 || columns.count > 45) {
    throw new Error('This editor supports at most 45 section columns.');
  }
  const width = columns.equalWidth ? (available - (columns.count - 1)*columns.space)/columns.count : null;
  if (columns.equalWidth && (!Number.isFinite(width) || width <= 0)) fail();
  let x = left;
  return Array.from({ length: columns.count }, (_, index) => {
    const w = columns.equalWidth ? width : columns.entries[index]?.width;
    const gap = index + 1 === columns.count ? 0 : columns.equalWidth ? columns.space : columns.entries[index]?.space;
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(gap) || gap < 0) fail();
    const interval = { left: x, right: x + w, space: gap };
    x += w + gap;
    return interval;
  });
}
