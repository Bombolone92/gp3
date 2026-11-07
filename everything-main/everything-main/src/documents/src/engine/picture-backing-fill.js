import { drawingEffectColor } from './docx-drawing-style.js';
import { UnsupportedDocumentError } from './errors.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
export function readPictureBackingFill(shape, scheme) {
  const fills = [...shape.children].filter(n => n.namespaceURI === A && ['solidFill', 'noFill'].includes(n.localName));
  if (fills.length > 1) throw new UnsupportedDocumentError('pictures with conflicting backing fills');
  const fill = fills[0];
  if (!fill) return null;
  if ([...fill.attributes].some(a => a.namespaceURI !== XMLNS) ||
      fill.localName === 'noFill' && fill.children.length ||
      fill.localName === 'solidFill' && fill.children.length !== 1) {
    throw new UnsupportedDocumentError('pictures with invalid backing fill');
  }
  return fill.localName === 'solidFill' ? drawingEffectColor(fill.children[0], scheme) : null;
}

export function backingFillPaint(fill) {
  return fill.alpha === 1 ? `#${fill.rgb}` : `rgba(${fill.rgb.match(/../g).map(c => parseInt(c, 16)).join(',')},${fill.alpha})`;
}
