import { xlsxElements as elements, xlsxText } from './xlsx-styles.js';
import { normalizeScrollControl, scrollControlValue } from './scroll-control.js';
import { xmlTag as tag, xmlText } from './xlsx-export-styles.js';

const attr = (xml, name) => xlsxText(xml?.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`))?.slice(1).find(v => v !== undefined));
const text = (xml, name) => xlsxText(elements(xml, name)[0]?.replace(/^<[^>]+>|<\/[^>]+>$/g, '') || '').trim();
const flag = value => value != null && !/^(?:false|f|0)$/i.test(value);
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';

// Serialization keeps subpixel offsets until the final EMU conversion. The
// interactive drag helper intentionally snaps to pixels and is unsuitable here.
function endMarker(sizeOf, count, index, offset) {
  while (index < count - 1 && offset >= sizeOf(index)) { offset -= sizeOf(index); index++; }
  while (index > 0 && offset < 0) { index--; offset += sizeOf(index); }
  return { index, offset };
}

function resolve(owner, target) {
  if (!target || /[?#]|^[a-z][\w+.-]*:|^\/\//i.test(target)) return null;
  const parts = target.startsWith('/') ? [] : owner.split('/').slice(0, -1);
  for (const p of target.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(p);
  }
  return parts.join('/');
}

/** Import real controls, independently of DrawingML chart/picture metadata. */
export function importXlsxScrollControls(book, sheets) {
  const cache = new Map();
  const xmlOf = part => {
    if (!cache.has(part)) cache.set(part, book.files?.[part]?.content ? new TextDecoder().decode(book.files[part].content).replace(/<!--[\s\S]*?-->/g, '') : '');
    return cache.get(part);
  };
  const related = (owner, id, kind) => {
    const i = owner.lastIndexOf('/');
    const rel = elements(xmlOf(`${owner.slice(0, i + 1)}_rels/${owner.slice(i + 1)}.rels`), 'Relationship')
      .find(r => id != null && attr(r, 'Id') === id && attr(r, 'Type')?.endsWith(`/${kind}`) && attr(r, 'TargetMode') !== 'External');
    return resolve(owner, attr(rel, 'Target'));
  };
  for (const sheet of sheets) {
    const source = book.Workbook?.Sheets?.find(s => s.name === sheet.name);
    const part = related('xl/workbook.xml', source?.id, 'worksheet');
    if (!part) continue;
    const xml = xmlOf(part), used = new Set();
    const legacy = xmlOf(related(part, attr(elements(xml, 'legacyDrawing')[0], 'r:id'), 'vmlDrawing'));
    const shapes = elements(legacy, 'shape');
    const span = (start, end, axis) => {
      const sizes = sheet[axis === 'r' ? 'rowHeights' : 'colWidths'] || {};
      const fallback = sheet[axis === 'r' ? 'defaultRowHeight' : 'defaultColWidth'] || (axis === 'r' ? 26 : 100);
      const hidden = new Set(sheet[axis === 'r' ? 'hiddenRows' : 'hiddenCols'] || []);
      let pixels = (end - start) * fallback;
      for (const [index, size] of Object.entries(sizes)) if (+index >= start && +index < end) pixels += hidden.has(+index) ? -fallback : size - fallback;
      for (const index of hidden) if (index >= start && index < end && !Object.hasOwn(sizes, index)) pixels -= fallback;
      return pixels;
    };
    const read = (control, shape, props) => {
      const client = elements(shape, 'ClientData')[0];
      if ((attr(props, 'objectType') || attr(client, 'ObjectType')) !== 'Scroll') return;
      const controlPr = elements(control, 'controlPr')[0];
      const prop = (name, legacyName) => attr(props, name) ?? (elements(client, legacyName).length ? text(client, legacyName) : undefined);
      let geometry;
      const from = elements(control, 'from')[0], to = elements(control, 'to')[0];
      if (from && to) {
        const r = Number(text(from, 'row')), c = Number(text(from, 'col'));
        const er = Number(text(to, 'row')), ec = Number(text(to, 'col'));
        const dx = Number(text(from, 'colOff')) / 9525, dy = Number(text(from, 'rowOff')) / 9525;
        const ex = Number(text(to, 'colOff')) / 9525, ey = Number(text(to, 'rowOff')) / 9525;
        if (![r, c, er, ec].every(n => Number.isInteger(n) && n >= 0) || er < r || ec < c || er > 1048575 || ec > 16383
          || ![dx, dy, ex, ey].every(Number.isFinite)) return;
        geometry = { anchor: { r, c }, dx, dy, w: span(c, ec, 'c') + ex - dx, h: span(r, er, 'r') + ey - dy };
      } else {
        // Legacy VML has physical-point geometry even when its anchor offsets
        // were written at a producer-specific screen DPI.
        const style = Object.fromEntries((attr(shape, 'style') || '').split(';').map(s => s.trim().split(':').map(s => s.trim())));
        const px = key => { const match = /^(-?\d+(?:\.\d+)?)(pt|px)$/i.exec(style[key] || ''); return match ? Number(match[1]) * (match[2] === 'pt' ? 4 / 3 : 1) : NaN; };
        geometry = { anchor: { r: 0, c: 0 }, anchorMode: 'absolute', dx: px('margin-left'), dy: px('margin-top'), w: px('width'), h: px('height') };
        if (![geometry.dx, geometry.dy, geometry.w, geometry.h].every(Number.isFinite)) return;
      }
      if (!(geometry.w > 0 && geometry.h > 0) || ![geometry.w, geometry.h].every(Number.isFinite)) return;
      const print = attr(controlPr, 'print') ?? (elements(client, 'PrintObject').length ? text(client, 'PrintObject') : undefined);
      const horizontal = prop('horiz', 'Horiz');
      const obj = normalizeScrollControl({ type: 'scroll', ...geometry,
        disabled: flag(attr(controlPr, 'disabled') ?? (elements(client, 'Disabled').length ? text(client, 'Disabled') : undefined)),
        title: attr(control, 'name') || attr(shape, 'id') || '', description: attr(controlPr, 'altText') || attr(shape, 'alt') || '',
        linkRef: prop('fmlaLink', 'FmlaLink'), value: prop('val', 'Val'), min: prop('min', 'Min'), max: prop('max', 'Max'),
        scrollWidth: prop('dx', 'Dx'), step: prop('inc', 'Inc'), page: prop('page', 'Page'), horizontal: horizontal == null ? false : flag(horizontal), print: print == null || flag(print),
      });
      const anchor = elements(control, 'anchor')[0];
      if (anchor && !flag(attr(anchor, 'moveWithCells'))) {
        obj.dx += span(0, obj.anchor.c, 'c'); obj.dy += span(0, obj.anchor.r, 'r');
        obj.anchor = { r: 0, c: 0 }; obj.anchorMode = 'absolute';
      }
      sheet.charts.push(obj);
    };
    // Native controls are authoritative after an external edit or deletion.
    sheet.charts = (sheet.charts || []).filter(c => c.type !== 'scroll');
    for (const control of elements(elements(xml, 'controls')[0], 'control')) {
      const props = elements(xmlOf(related(part, attr(control, 'r:id'), 'ctrlProp')), 'formControlPr')[0];
      const id = `_x0000_s${attr(control, 'shapeId')}`;
      const shape = shapes.find(s => attr(s, 'o:spid') === id || attr(s, 'id') === id);
      if (shape) used.add(shape);
      read(control, shape, props);
    }
    for (const shape of shapes) if (!used.has(shape)) read(undefined, shape, undefined);
  }
}

/** Emit both the modern property part and the VML form control used by Excel. */
export function exportXlsxScrollControls(wb, sheet, index, xml, rels, { get, set, contentType }) {
  const controls = sheet.charts.filter(c => c.type === 'scroll');
  if (!controls.length) return { xml, rels };
  const legacyId = attr(elements(xml, 'legacyDrawing')[0], 'r:id');
  const existing = elements(rels, 'Relationship').find(r => attr(r, 'Id') === legacyId && attr(r, 'Type') === `${REL}vmlDrawing`);
  const path = existing ? `/${resolve(`xl/worksheets/sheet${index}.xml`, attr(existing, 'Target'))}` : `/xl/drawings/controls${index}.vml`;
  let vml = get(path) || '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"></xml>';
  const drawingId = attr(elements(xml, 'drawing')[0], 'r:id');
  const drawingRel = elements(rels, 'Relationship').find(r => attr(r, 'Id') === drawingId && attr(r, 'Type') === `${REL}drawing`);
  const drawingPath = drawingRel ? `/${resolve(`xl/worksheets/sheet${index}.xml`, attr(drawingRel, 'Target'))}` : `/xl/drawings/controlDrawing${index}.xml`;
  let drawing = get(drawingPath) || tag('xdr:wsDr', { 'xmlns:xdr': XDR, 'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main' }, '');
  let shapeId = 1025;
  for (const m of vml.matchAll(/_x0000_s(\d+)/g)) shapeId = Math.max(shapeId, Number(m[1]) + 1);
  for (const props of elements(drawing, 'cNvPr')) shapeId = Math.max(shapeId, Number(attr(props, 'id')) + 1);
  const offset = (count, sizes, fallback, hidden, filtered = []) => {
    let pixels = count * fallback;
    for (const [i, size] of sizes) if (i < count) pixels += size - fallback;
    for (const i of new Set([...hidden, ...filtered])) if (i < count) pixels -= sizes.get(i) ?? fallback;
    return pixels;
  };
  const bodies = [];
  for (const [i, control] of controls.entries()) {
    const id = shapeId++, rid = `puterControl${i + 1}`, propsPath = `/xl/ctrlProps/control${index}_${i + 1}.xml`;
    const value = scrollControlValue(wb, sheet.id, control);
    set(propsPath, tag('formControlPr', { xmlns: 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main', objectType: 'Scroll',
      dx: control.scrollWidth, min: control.min, max: control.max, val: value, inc: control.step, page: control.page, horiz: Number(control.horizontal), fmlaLink: control.linkRef || null }));
    contentType(propsPath, 'application/vnd.ms-excel.controlproperties+xml');
    rels = rels.replace('</Relationships>', tag('Relationship', { Id: rid, Type: `${REL}ctrlProp`, Target: `../ctrlProps/control${index}_${i + 1}.xml` }) + '</Relationships>');
    const r = control.anchor.r, c = control.anchor.c;
    const column = endMarker(n => wb.colWidth(sheet.id, n), 16384, c, control.dx + control.w);
    const row = endMarker(n => wb.rowHeight(sheet.id, n), 1048576, r, control.dy + control.h);
    const marker = (name, col, colOff, row, rowOff) => tag(name, {}, tag('xdr:col', {}, col) + tag('xdr:colOff', {}, Math.round(colOff * 9525)) + tag('xdr:row', {}, row) + tag('xdr:rowOff', {}, Math.round(rowOff * 9525)));
    const anchor = marker('from', c, control.dx, r, control.dy) + marker('to', column.index, column.offset, row.index, row.offset);
    bodies.push(tag('control', { shapeId: id, 'r:id': rid, name: control.title || `Scroll bar ${i + 1}` }, tag('controlPr', { print: Number(control.print), disabled: control.disabled ? 1 : null, altText: control.description || null }, tag('anchor', { moveWithCells: Number(control.anchorMode !== 'absolute'), 'xmlns:xdr': XDR }, anchor))));
    // CT_Control.shapeId references DrawingML. Office also needs the VML
    // compatibility identity for its native interactive Form control.
    const shape = tag('xdr:sp', {}, tag('xdr:nvSpPr', {}, tag('xdr:cNvPr', { id, name: control.title || `Scroll bar ${i + 1}`, hidden: 1 },
      tag('a:extLst', {}, tag('a:ext', { uri: '{63B3BB69-23CF-44E3-9099-C40C66FF867C}' }, tag('a14:compatExt', { spid: `_x0000_s${id}` })))) + tag('xdr:cNvSpPr'))
      + tag('xdr:spPr', {}, tag('a:prstGeom', { prst: 'rect' }, tag('a:avLst')) + tag('a:noFill')));
    const drawingAnchor = marker('xdr:from', c, control.dx, r, control.dy) + marker('xdr:to', column.index, column.offset, row.index, row.offset);
    drawing = drawing.replace('</xdr:wsDr>', tag('mc:AlternateContent', { 'xmlns:mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006' },
      tag('mc:Choice', { 'xmlns:a14': 'http://schemas.microsoft.com/office/drawing/2010/main', Requires: 'a14' }, tag('xdr:twoCellAnchor', { editAs: control.anchorMode === 'absolute' ? 'absolute' : 'oneCell' }, drawingAnchor + shape + tag('xdr:clientData', { fPrintsWithSheet: Number(control.print) })))) + '</xdr:wsDr>');
    const x = control.dx + offset(c, sheet.colWidths, sheet.defaultColWidth, sheet.hiddenCols);
    const y = control.dy + offset(r, sheet.rowHeights, sheet.defaultRowHeight, sheet.hiddenRows, sheet.filterHidden);
    const data = (control.disabled ? tag('x:Disabled') : '') + tag('x:Anchor', {}, [c, control.dx, r, control.dy, column.index, column.offset, row.index, row.offset].map(Math.round).join(', '))
      + tag('x:PrintObject', {}, control.print ? 'True' : 'False') + (control.linkRef ? tag('x:FmlaLink', {}, xmlText(control.linkRef)) : '')
      + [['Val', value], ['Min', control.min], ['Max', control.max], ['Inc', control.step], ['Page', control.page]].map(([name, val]) => tag(`x:${name}`, {}, val)).join('')
      + (control.scrollWidth != null ? tag('x:Dx', {}, control.scrollWidth) : '') + (control.horizontal ? tag('x:Horiz') : '');
    vml = vml.replace('</xml>', tag('v:shape', { id: `_x0000_s${id}`, type: '#_puter_scroll', alt: control.description || null,
      style: `position:absolute;margin-left:${x * .75}pt;margin-top:${y * .75}pt;width:${control.w * .75}pt;height:${control.h * .75}pt`,
      'xmlns:v': 'urn:schemas-microsoft-com:vml', 'xmlns:x': 'urn:schemas-microsoft-com:office:excel' }, tag('x:ClientData', { ObjectType: 'Scroll' }, data)) + '</xml>');
  }
  vml = vml.replace(/(<xml\b[^>]*>)/, '$1<v:shapetype xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" id="_puter_scroll" coordsize="21600,21600" o:spt="201" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path shadowok="f" o:extrusionok="f" strokeok="f" fillok="f" o:connecttype="rect"/></v:shapetype>');
  set(path, vml);
  contentType(path, 'application/vnd.openxmlformats-officedocument.vmlDrawing');
  set(drawingPath, drawing);
  contentType(drawingPath, 'application/vnd.openxmlformats-officedocument.drawing+xml');
  if (!drawingRel) {
    rels = rels.replace('</Relationships>', tag('Relationship', { Id: 'puterControlDrawing', Type: `${REL}drawing`, Target: `../drawings/controlDrawing${index}.xml` }) + '</Relationships>');
    xml = xml.replace(/<legacyDrawing\b|<\/worksheet>/, match => tag('drawing', { 'r:id': 'puterControlDrawing' }) + match);
  }
  if (!existing) {
    rels = rels.replace('</Relationships>', tag('Relationship', { Id: 'puterControls', Type: `${REL}vmlDrawing`, Target: `../drawings/controls${index}.vml` }) + '</Relationships>');
    xml = xml.replace('</worksheet>', tag('legacyDrawing', { 'r:id': 'puterControls' }) + '</worksheet>');
  }
  xml = xml.replace('</worksheet>', tag('controls', {}, tag('mc:AlternateContent', { 'xmlns:mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006', 'xmlns:x14': 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main' }, tag('mc:Choice', { Requires: 'x14' }, bodies.join('')))) + '</worksheet>');
  return { xml, rels };
}
