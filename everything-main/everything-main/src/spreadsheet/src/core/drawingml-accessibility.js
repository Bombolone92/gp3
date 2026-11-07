import { xmlTag } from './xlsx-export-styles.js';

// Office's DrawingML decorative extension (MS-ODRAWXML §2.34.3.1).
const URI = '{C183D7F6-B498-43B3-948B-1728B52AA6E4}';
const NS = 'http://schemas.microsoft.com/office/drawing/2017/decorative';
const child = (node, name) => node?.children?.find(c => c.name === name);

export function drawingDecorative(node) {
  const nv = node?.children?.find(c => ['nvSpPr', 'nvCxnSpPr', 'nvGrpSpPr', 'nvPicPr', 'nvGraphicFramePr'].includes(c.name));
  const list = child(child(nv, 'cNvPr'), 'extLst');
  return !!list?.children.some(ext => ext.name === 'ext' && ext.attrs.uri?.toUpperCase() === URI
    && ['1', 'true'].includes(child(ext, 'decorative')?.attrs.val?.trim()));
}

export function decorativeXml(decorative) {
  return decorative === true ? xmlTag('a:extLst', {}, xmlTag('a:ext', { uri: URI },
    xmlTag('adec:decorative', { 'xmlns:adec': NS, val: 1 }))) : '';
}

// Excel treats a nonempty cNvPr description as informative even alongside a
// decorative extension. Keep the description in the model, but do not attach
// an accessible alternative to decorative artwork in the exchanged document.
export function drawingDescription(obj) {
  return obj.decorative === true ? null : obj.description ?? obj.title;
}
