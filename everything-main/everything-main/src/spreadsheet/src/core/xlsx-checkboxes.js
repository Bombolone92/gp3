/** Excel's unlabelled, unlinked form checkboxes become editable checkbox cells. */
import { cellKey, rangeContains } from './cell.js';
import { xlsxAttr as attr, xlsxElements as elements, xlsxText } from './xlsx-styles.js';

export function importXlsxCheckboxes(book, sheets) {
  const files = book.files || {}, cache = new Map();
  const xmlOf = part => {
    if (!cache.has(part)) cache.set(part, files[part]?.content
      ? new TextDecoder().decode(files[part].content).replace(/<!--[\s\S]*?-->/g, '') : '');
    return cache.get(part);
  };
  if (!Object.keys(files).some(p => p.endsWith('.rels') && /\/ctrlProp["']/.test(xmlOf(p)))) return;
  const related = (owner, id, kind) => {
    const i = owner.lastIndexOf('/'), rels = `${owner.slice(0, i + 1)}_rels/${owner.slice(i + 1)}.rels`;
    const rel = elements(xmlOf(rels), 'Relationship').find(r => attr(r, 'Id') === id && attr(r, 'Type')?.endsWith(`/${kind}`) && attr(r, 'TargetMode') !== 'External');
    const target = attr(rel, 'Target');
    if (!target || /[?#]|^[a-z][\w+.-]*:|^\/\//i.test(target)) return null;
    const parts = target.startsWith('/') ? [] : owner.split('/').slice(0, -1);
    for (const p of target.split('/')) {
      if (!p || p === '.') continue;
      if (p === '..') { if (!parts.length) return null; parts.pop(); }
      else parts.push(p);
    }
    return parts.join('/');
  };
  const text = (xml, tag) => xlsxText(elements(xml, tag)[0]?.replace(/^<[^>]+>|<\/[^>]+>$/g, '') || '').trim();
  for (const sheet of sheets) {
    const source = book.Workbook?.Sheets?.find(s => s.name === sheet.name);
    const part = related('xl/workbook.xml', source?.id, 'worksheet');
    if (!part) continue;
    const xml = xmlOf(part), controls = elements(xml, 'controls')[0];
    if (!controls) continue;
    const legacy = related(part, attr(elements(xml, 'legacyDrawing')[0], 'r:id'), 'vmlDrawing');
    const shapes = new Map(elements(xmlOf(legacy), 'shape').map(s => [attr(s, 'id'), s]));
    for (const control of elements(controls, 'control')) {
      const props = elements(xmlOf(related(part, attr(control, 'r:id'), 'ctrlProp')), 'formControlPr')[0];
      const shape = shapes.get(`_x0000_s${attr(control, 'shapeId')}`);
      // Linked cells, captions, macros and tri-state controls need a floating
      // control model. Never replace their meaning with an ordinary cell.
      if (attr(props, 'objectType') !== 'CheckBox' || !shape || attr(props, 'fmlaLink')
        || attr(props, 'macro') || attr(elements(control, 'controlPr')[0], 'macro')
        || text(shape, 'FmlaLink') || text(shape, 'FmlaMacro')
        || xlsxText(elements(shape, 'textbox')[0]?.replace(/<[^>]*>/g, '') || '').trim()
        || /visibility\s*:\s*hidden/i.test(shape)
        || ![undefined, 'Checked', 'Unchecked'].includes(attr(props, 'checked'))) continue;
      const from = elements(control, 'from')[0], to = elements(control, 'to')[0];
      const rText = text(from, 'row'), cText = text(from, 'col');
      if (!/^\d+$/.test(rText) || !/^\d+$/.test(cText)) continue;
      const r = Number(rText), c = Number(cText), endR = Number(text(to, 'row')), endC = Number(text(to, 'col'));
      if (r >= 1048576 || c >= 16384 || !to || endC !== c || endR < r || endR > r + 1) continue;
      const key = cellKey(r, c), cell = sheet.cells[key];
      if (cell?.f != null || cell?.v != null || sheet.merges.some(m => rangeContains(m, r, c))
        || sheet.validations.some(v => rangeContains(v.range, r, c))) continue;
      const offset = Number(text(from, 'colOff')) / 9525;
      sheet.cells[key] = { ...cell, v: attr(props, 'checked') === 'Checked', f: null };
      sheet.validations.push({ type: 'checkbox', range: { r1: r, c1: c, r2: r, c2: c }, strict: true, allowBlank: true,
        checkboxStyle: 'excel', ...(Number.isFinite(offset) && offset >= 0 && offset <= 1000 ? { checkboxOffset: offset } : {}) });
      sheet.rows = Math.max(sheet.rows, r + 1);
      sheet.cols = Math.max(sheet.cols, c + 1);
    }
  }
}
