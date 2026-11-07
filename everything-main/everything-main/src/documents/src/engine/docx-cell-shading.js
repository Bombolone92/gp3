import { UnsupportedDocumentError } from './errors.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// CT_Shd is atomic: an explicit automatic fill must not inherit an earlier RGB.
export function readCellShading(properties, readColor) {
  const nodes = [...(properties?.children || [])].filter(n => n.namespaceURI === W && n.localName === 'shd');
  if (!nodes.length) return undefined;
  const fail = reason => { throw new UnsupportedDocumentError(`tables with ${reason} shading`); };
  if (nodes.length !== 1) fail('duplicate');
  const node = nodes[0], pattern = node.getAttributeNS(W, 'val');
  if (!['clear', 'solid', 'nil'].includes(pattern)) fail('unsupported pattern or missing');
  if ([...node.childNodes].some(n => n.nodeType === 1 || [3, 4].includes(n.nodeType) && n.textContent.trim())) fail('nested');
  const fill = readColor(properties, 'shd', 'fill'), color = readColor(properties, 'shd', 'color');
  // MS-OI29500 §17.18.78: in table/cell properties, nil behaves as an
  // absent shading declaration. Retain its XML, including unused channels.
  return pattern === 'nil' ? undefined : pattern === 'clear' ? fill : color === 'auto' ? 'foreground' : color;
}
