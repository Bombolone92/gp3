import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import { conditionalFormatSignature } from '../src/core/xlsx-condformat-reconcile.js';
import * as X from '../src/vendor/xlsx.mjs';

const kinds = ['legacy bar', 'extended bar', 'scale', 'legacy icons', 'extended icons'];
const keyOf = kind => kind === 'scale' ? 'scaleMax' : kind.endsWith('icons') ? 'iconThreshold2' : 'barMaxFormula';
const range = { r1: 4, c1: 3, r2: 8, c2: 3 };
function native(kind, formula = 'H8', sqref = 'D5:D9') {
  const extended = kind.startsWith('extended'), prefix = extended ? 'x14:' : '';
  const cfvo = (type, value) => extended ? `<x14:cfvo type="${type}"><xm:f>${value}</xm:f></x14:cfvo>` : `<cfvo type="${type}" val="${value}"/>`;
  const type = kind === 'scale' ? 'colorScale' : kind.endsWith('icons') ? 'iconSet' : 'dataBar';
  const bounds = cfvo('num', '0') + (type === 'iconSet' ? cfvo('formula', `(${formula})/2`) : '') + cfvo('formula', formula);
  const contents = type === 'colorScale' ? '<color rgb="FFFFFFFF"/><color rgb="FF000000"/>' : type === 'dataBar' ? `<${extended ? 'x14:fillColor' : 'color'} rgb="FF638EC6"/>` : '';
  const attrs = type === 'dataBar' ? ` minLength="0" maxLength="100"${extended ? ' gradient="0" axisPosition="none" negativeBarColorSameAsPositive="1"' : ''}`
    : type === 'iconSet' ? ` iconSet="${extended ? '3Stars' : '3Arrows'}"` : '';
  const body = `<${prefix}cfRule type="${type}" priority="1"${extended ? ' id="{TEST}"' : ''}><${prefix}${type}${attrs}>${bounds}${contents}</${prefix}${type}></${prefix}cfRule>`;
  return extended ? `<x14:conditionalFormatting>${body}<xm:sqref>${sqref}</xm:sqref></x14:conditionalFormatting>` : `<conditionalFormatting sqref="${sqref}">${body}</conditionalFormatting>`;
}
const read = (xml, options) => readXlsxConditionalFormats(xml, { dxfs: [] }, null, null, options);
function make(kind, formula, sqref) {
  const wb = new Workbook(), id = wb.activeSheetId;
  [25, 50, 75, 100, 125].forEach((v, i) => wb.setInput(id, i + 4, 3, String(v)));
  wb.setInput(id, 3, 4, '100'); wb.setInput(id, 7, 7, '200');
  for (const rule of read(native(kind, formula, sqref))) wb.addRule(id, rule);
  return wb;
}
const look = (wb, r, c = 3) => wb.conditionalStyle(wb.activeSheetId, r, c, wb.getValue(wb.activeSheetId, r, c));
const xml = (zip, path = '/xl/worksheets/sheet1.xml') => new TextDecoder().decode(X.CFB.find(zip, path).content);
const edit = (zip, transform, path = '/xl/worksheets/sheet1.xml') => {
  const part = X.CFB.find(zip, path); part.content = new TextEncoder().encode(transform(xml(zip, path))); part.size = part.content.length;
};
const zipOf = async wb => X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
const reopen = zip => workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'thresholds.xlsx');
const removePrivate = zip => edit(zip, text => text.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''), '/xl/workbook.xml');

// Real Excel: every family uses E4, not H8, for a malformed relative H8
// threshold applying to D5:D9. Its native copy also continues to use E4.
it.each(kinds)('resolves %s malformed relative thresholds once at the sheet origin', async kind => {
  const wb = make(kind), key = keyOf(kind), id = wb.activeSheetId;
  expect(wb.activeSheet.rules[0][key]).toBe('$E$4');
  if (kind.endsWith('bar')) expect(look(wb, 4).bar).toBeCloseTo(.25);
  else if (kind === 'scale') expect(look(wb, 4).bg).toBe('#c0c0c0');
  else expect([4, 5, 6, 7, 8].map(r => look(wb, r).iconIndex)).toEqual([0, 1, 1, 2, 2]);
  const rows = [4, 5, 6, 7, 8];
  wb.pasteCells(id, wb.copyCells(id, rows, [3]), 10, 9, { r: 4, c: 3 }, null, { conditionalFormats: wb.copyConditionalFormats(id, rows, [3]) });
  expect(look(wb, 10, 9)).toEqual(look(wb, 4));
  const zip = await zipOf(wb); removePrivate(zip); const back = await reopen(zip);
  expect(look(back, 10, 9)).toEqual(look(wb, 4));
  back.setInput(back.activeSheetId, 3, 4, '200'); expect(look(back, 10, 9)).toEqual(look(back, 4));
  expect(look(back, 5)).not.toEqual(look(wb, 5));
});

it.each(kinds)('uses the bounding corner of reordered disjoint %s areas', kind => {
  const rules = read(native(kind, 'H8', 'D8:D9 D5:D6'));
  expect(rules).toHaveLength(2); expect(rules.map(rule => rule[keyOf(kind)])).toEqual(['$E$4', '$E$4']);
  const gap = read(native(kind, 'H8', 'F5:F6 D8:D9'));
  expect(gap.map(rule => rule[keyOf(kind)])).toEqual(['$E$4', '$E$4']);
});

it('resolves mixed, qualified, range and whole-axis references without touching strings or names', () => {
  const f = `SUM(H8,$H8,H$8,$H$8,'Other sheet'!H8,H8:I9,H:I,8:9,INDIRECT(&quot;H8&quot;),Limit)`;
  expect(read(native('scale', f))[0].scaleMax).toBe(`SUM($E$4,$H$4,$E$8,$H$8,'Other sheet'!$E$4,$E$4:$F$5,$E:$F,$4:$5,INDIRECT("H8"),Limit)`);
});

it('keeps reference edits live after normalization', () => {
  const wb = make('extended bar'), id = wb.activeSheetId;
  wb.insertRows(id, 1, 2); expect(wb.activeSheet.rules[0].barMaxFormula).toBe('$E$6');
  expect(look(wb, 6).bar).toBeCloseTo(.25); wb.undo();
  wb.moveRange(id, { r1: 3, c1: 4, r2: 3, c2: 4 }, 1, 11);
  expect(wb.activeSheet.rules[0].barMaxFormula).toBe('$L$2'); expect(look(wb, 4).bar).toBeCloseTo(.25);
});

it.each(kinds)('exports app-authored %s bounds as fixed live references while retaining app copy behavior', async kind => {
  const wb = make(kind, '$H$8'), id = wb.activeSheetId, key = keyOf(kind), original = wb.activeSheet.rules[0];
  wb.updateRule(id, original.id, { [key]: 'H8', ...(kind.endsWith('icons') ? { iconThreshold1: 'H8/2' } : {}) });
  const before = wb.toJSON(), zip = await zipOf(wb);
  expect(wb.toJSON()).toEqual(before); expect(xml(zip)).toContain('$H$8');
  expect((await reopen(zip)).activeSheet.rules).toEqual(wb.activeSheet.rules);
  removePrivate(zip); const back = await reopen(zip);
  expect(back.activeSheet.rules[0][key]).toBe('$H$8'); expect(look(back, 5)).toEqual(look(wb, 5));
  wb.setInput(id, 7, 13, '100');
  const rows = [4, 5, 6, 7, 8];
  wb.pasteCells(id, wb.copyCells(id, rows, [3]), 4, 9, { r: 4, c: 3 }, null, { conditionalFormats: wb.copyConditionalFormats(id, rows, [3]) });
  expect(wb.activeSheet.rules[0][key]).toBe('N8');
  const copied = await zipOf(wb); removePrivate(copied);
  expect(xml(copied)).toContain('$N$8'); expect(look(await reopen(copied), 5, 9)).toEqual(look(wb, 5, 9));
});

it('leaves candidate-relative activation formulas relative while fixing threshold formulas', async () => {
  const wb = make('extended bar', '$H$8'), id = wb.activeSheetId;
  wb.updateRule(id, wb.activeSheet.rules[0].id, { barMaxFormula: 'H8', barActiveFormula: 'E5' });
  wb.setInput(id, 4, 4, '1'); wb.setInput(id, 5, 4, '0');
  const zip = await zipOf(wb); expect(xml(zip)).toContain('<formula>E5</formula>'); expect(xml(zip)).toContain('$H$8');
  removePrivate(zip); const back = await reopen(zip);
  expect(look(back, 4).bar).toBeCloseTo(.125); expect(look(back, 5)).toBeNull();
});

it.each(kinds)('wraps negative reference offsets in malformed %s thresholds around the grid', kind => {
  expect(read(native(kind, 'A1'))[0][keyOf(kind)]).toBe('$XFB$1048573');
  expect(read(native(kind, '$A1'))[0][keyOf(kind)]).toBe('$A$1048573');
  expect(read(native(kind, 'A$1', 'F5:F9'))[0][keyOf(kind)]).toBe('$XEZ$1');
  expect(read(native(kind, '$A$1'))[0][keyOf(kind)]).toBe('$A$1');
});

it.each([1, 2].flatMap(version => kinds.map(kind => [version, kind])))('matches version %i fingerprints for old %s saves without hiding native edits', async (version, kind) => {
  const wb = make(kind, '$H$8'), key = keyOf(kind), id = wb.activeSheetId;
  wb.updateRule(id, wb.activeSheet.rules[0].id, { [key]: 'H8' }); wb.setInput(id, 3, 5, '250');
  const zip = await zipOf(wb), previousSignature = await conditionalFormatSignature(read(xml(zip))[0]);
  // Reproduce the historical writer and its versioned native fingerprint.
  edit(zip, text => text.replaceAll('$H$8', 'H8'));
  const oldSignature = await conditionalFormatSignature(read(xml(zip), { legacyThresholds: true })[0], version);
  edit(zip, text => text.replace(previousSignature, oldSignature).replace('nativeConditionalFormats&quot;:{&quot;version&quot;:3', `nativeConditionalFormats&quot;:{&quot;version&quot;:${version}`), '/xl/worksheets/sheet2.xml');
  expect((await reopen(zip)).activeSheet.rules).toEqual(wb.activeSheet.rules);
  edit(zip, text => text.replaceAll('H8', 'I8'));
  const edited = await reopen(zip);
  expect(edited.activeSheet.rules[0][key]).toBe('$F$4');
  expect(edited.activeSheet.rules[0].id).not.toBe(wb.activeSheet.rules[0].id);
});
