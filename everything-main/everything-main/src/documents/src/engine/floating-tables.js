// ECMA-376 §17.4.57. Omitted anchors use margins (native reference controls).
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export function readFloatingTable(node) {
  const position = { horzAnchor: 'margin', vertAnchor: 'margin', tblpX: 0, tblpY: 0,
    leftFromText: 0, rightFromText: 0, topFromText: 0, bottomFromText: 0 };
  const enums = { horzAnchor: ['page','margin','text'], vertAnchor: ['page','margin','text'],
    tblpXSpec: ['left','center','right','inside','outside'], tblpYSpec: ['top','center','bottom','inside','outside','inline'] };
  if (node.children.length || node.textContent.trim()) throw new Error('Invalid floating-table positioning.');
  for (const a of node.attributes) {
    if (a.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
    if (a.namespaceURI !== W || !(a.localName in position || a.localName in enums)) throw new Error('Unsupported floating-table positioning attribute.');
    if (enums[a.localName]) {
      if (!enums[a.localName].includes(a.value)) throw new Error('Invalid floating-table anchor or alignment.');
      position[a.localName] = a.value;
    } else {
      if (!/^[+-]?\d+$/.test(a.value) || !Number.isSafeInteger(Number(a.value)) || Math.abs(Number(a.value)) > 31680 || a.localName.endsWith('FromText') && Number(a.value) < 0) throw new Error('Invalid floating-table distance.');
      position[a.localName] = Number(a.value);
    }
  }
  return position;
}

export function floatingTableX(position, page, width, pageIndex = 0) {
  const left = position.horzAnchor === 'page' ? 0 : page.left;
  const right = position.horzAnchor === 'page' ? page.width : page.width - page.right;
  let align = position.tblpXSpec;
  if (align === 'inside') align = pageIndex % 2 ? 'right' : 'left';
  if (align === 'outside') align = pageIndex % 2 ? 'left' : 'right';
  // Modern compatibility aligns an outer frame twelve twips wider than the table grid.
  // Independent 72/144/288pt controls distinguish it from proportional scaling.
  if ((page.compatibilityMode ?? 12) >= 15) width += 12 / 15;
  return align === 'center' ? (left + right - width) / 2 : align === 'right' ? right - width : align === 'left' ? left : left + position.tblpX / 15;
}

export function floatingTableY(position, page, height, anchor) {
  if (position.vertAnchor === 'text') return anchor.y - (anchor.anchorBefore || 0) + (position.tblpYSpec ? -7 : position.tblpY) / 15;
  const top = position.vertAnchor === 'page' ? 0 : page.top;
  const bottom = position.vertAnchor === 'page' ? page.height : page.height - page.bottom;
  const align = position.tblpYSpec;
  return align === 'center' ? (top + bottom - height) / 2 : ['bottom','outside'].includes(align) ? bottom - height : ['top','inside'].includes(align) ? top : align === 'inline' ? anchor.y : top + position.tblpY / 15;
}
