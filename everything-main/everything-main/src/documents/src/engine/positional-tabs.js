import { UnsupportedDocumentError } from './errors.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const values = {
  alignment: ['left', 'center', 'right'],
  relativeTo: ['margin', 'indent'],
  leader: ['none', 'dot', 'hyphen', 'underscore', 'middleDot'],
};

export function readPositionalTab(node) {
  if (node.children.length || node.textContent.trim() || [...node.attributes].some(a =>
    a.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && (a.namespaceURI !== W || !Object.hasOwn(values, a.localName)))) {
    throw new UnsupportedDocumentError('positional tab content');
  }
  const result = {};
  for (const [key, allowed] of Object.entries(values)) {
    const value = node.getAttributeNS(W, key);
    if (!allowed.includes(value)) throw new UnsupportedDocumentError('positional tab ' + key);
    result[key] = value;
  }
  return result;
}

// Native reference controls: margin-center ignores indents; indent-center includes
// half the left indent only. Both right modes respect the right indent. Left
// tabs cannot move backwards into the paragraph's indentation on a fresh line.
export function positionalTabTarget(tab, format, page, left, right) {
  const base = page.left + (tab.relativeTo === 'indent' ? format.indentLeft / 15 : 0);
  if (tab.alignment === 'left') return Math.max(left, base);
  if (tab.alignment === 'right') return right;
  return Math.min(right, (base + page.width - page.right) / 2);
}
