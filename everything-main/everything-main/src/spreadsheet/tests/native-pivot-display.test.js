import { expect, it, vi } from 'vitest';
import { nativePivotDirectStyle } from '../src/core/native-pivot-display.js';
import { normalizeNativeFill } from '../src/core/native-fill.js';
import { fillColorCss } from '../src/core/fill-color.js';
import { pivotDisplayBook, xml } from './helpers/native-pivot-display.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';

it.each([[3, 2, 'C4:D7'], [17, 7, 'H18:I21'], [0, 0, 'A1:B4']])('paints saved headers and totals at origin %s,%s without querying or modifying the report', (r, c, ref) => {
  const { wb, id } = pivotDisplayBook({ r, c, ref }), before = wb.toJSON();
  const read = vi.spyOn(wb, 'getValue');
  expect(wb.hasNativePivotDisplay(id)).toBe(true);
  expect(wb.nativePivotDisplayIssues()).toEqual([]);
  expect(wb.displayStyleAt(id, r, c)).toMatchObject({ bold: true, bg: '#aaccee', bb: true, bbBorder: { bs: 'medium', bc: '#345678' } });
  expect(wb.displayStyleAt(id, r + 3, c + 1)).toMatchObject({ bold: true, bt: true, btBorder: { bs: 'double', bc: '#987654' } });
  expect(wb.displayStyleAt(id, r + 1, c)).not.toHaveProperty('bg');
  expect(wb.displayStyleAt('other', r, c)).not.toHaveProperty('bg');
  expect(read).not.toHaveBeenCalled(); expect(wb.toJSON()).toEqual(before);
});

it('resolves built-in styles when no custom definition or DXFs are stored', () => {
  const { wb, id, r, c } = pivotDisplayBook({ styleName: 'PivotStyleLight18', dxfs: [] });
  expect(wb.nativePivotDisplayIssues()).toEqual([]);
  expect(wb.displayStyleAt(id, r, c)).toMatchObject({ bold: true, bb: true });
  expect(fillColorCss(wb.displayStyleAt(id, r, c).bg)).toMatch(/^#[a-f0-9]{6}$/);
});

it('compares font properties individually with Normal, including explicit false and color identity', () => {
  const { wb, id, r, c } = pivotDisplayBook();
  wb.applyStyle(id, { r1: r, c1: c, r2: r, c2: c }, { italic: true, bold: false, color: '#000000' });
  expect(wb.displayStyleAt(id, r, c)).toMatchObject({ bold: true, italic: true, color: '#000000' });
  const normal = { bold: true, italic: true, color: { theme: 1, base: '#000000', rgb: '#000000' } };
  expect(nativePivotDirectStyle({ bold: false, italic: false, color: '#000000' }, normal)).toMatchObject({ bold: false, italic: false, color: '#000000' });
  expect(nativePivotDirectStyle({ color: { theme: 1, base: '#000000', rgb: '#000000' } }, normal)).not.toHaveProperty('color');
});

const fill = (key, paint = '#fafafa', none = false) => normalizeNativeFill({ key,
  xml: xml('fill', none ? '<patternFill patternType="none"/>' : '<patternFill patternType="solid"><fgColor rgb="FFFAFAFA"/></patternFill>'), palette: {}, paint: none ? null : paint });
it.each([false, true])('distinguishes shared Normal fills from duplicate native records, including no-fill=%s', none => {
  const { wb, id, r, c } = pivotDisplayBook(), normal = fill('normal', '#fafafa', none), duplicate = fill('duplicate', '#fafafa', none);
  wb.nativeNormalFill = normal;
  wb.applyStyle(id, { r1: r, c1: c, r2: r, c2: c }, { bg: normal.paint, nativeFill: normal });
  wb.applyStyle(id, { r1: r, c1: c + 1, r2: r, c2: c + 1 }, { bg: duplicate.paint, nativeFill: duplicate });
  expect(wb.displayStyleAt(id, r, c).bg).toBe('#aaccee');
  expect(wb.displayStyleAt(id, r, c + 1).bg).toBe(none ? 'transparent' : '#fafafa');
  expect(wb.styleAt(id, r, c).nativeFill).toBe(normal);
});

it('keeps a literal user fill over a PivotTable style even when it equals the Normal fill paint', () => {
  const { wb, id, r, c } = pivotDisplayBook(); wb.nativeNormalFill = fill('normal');
  wb.applyStyle(id, { r1: r, c1: c, r2: r, c2: c }, { bg: '#fafafa' });
  expect(wb.displayStyleAt(id, r, c).bg).toBe('#fafafa');
  wb.undo(); expect(wb.displayStyleAt(id, r, c).bg).toBe('#aaccee');
  wb.redo(); expect(wb.displayStyleAt(id, r, c).bg).toBe('#fafafa');
});

it('retains direct edge pens without altering the style on other sides', () => {
  const { wb, id, r, c } = pivotDisplayBook();
  wb.applyStyle(id, { r1: r, c1: c, r2: r, c2: c }, { bt: true, bs: 'dashed', bc: '#aabbcc' });
  expect(wb.displayStyleAt(id, r, c)).toMatchObject({ btBorder: { bs: 'dashed', bc: '#aabbcc' }, bbBorder: { bs: 'medium', bc: '#345678' } });
  expect(nativePivotDirectStyle({ bb: true, bs: 'medium', bc: '#345678' }, { bb: true, bbBorder: { bs: 'medium', bc: '#345678' } })).not.toHaveProperty('bb');
});

it('reads Normal alignment and number formats as the reference for differential layers', () => {
  const { wb, id, r, c } = pivotDisplayBook({ parts: ['headerRow'], dxfs: [xml('dxf', '<alignment horizontal="center" vertical="top" wrapText="0"/><numFmt numFmtId="180" formatCode="0.0&quot; units&quot;"/>')] });
  wb.nativeNormalStyle = { xf: xml('xf', '<alignment vertical="center" wrapText="1"/>', 'fontId="0" fillId="0" borderId="0" numFmtId="0"'), fill: xml('fill', '<patternFill patternType="none"/>'), border: xml('border'), numberFormat: 0 };
  wb.applyStyle(id, { r1: r, c1: c, r2: r, c2: c + 1 }, { valign: 'middle', wrap: true });
  expect(wb.displayStyleAt(id, r, c)).toMatchObject({ align: 'center', valign: 'top', wrap: false, code: '0.0" units"' });
  wb.applyStyle(id, { r1: r, c1: c + 1, r2: r, c2: c + 1 }, { align: 'right', fmt: 'percent', dec: 2 });
  expect(wb.displayStyleAt(id, r, c + 1)).toMatchObject({ align: 'right', fmt: 'percent', code: null, dec: 2 });
  wb.setInput(id, r, c, '4'); expect(wb.getDisplay(id, r, c)).toBe('4.0 units');
});

it('recompiles a replaced native style and returns independent style objects', () => {
  const { wb, id, r, c } = pivotDisplayBook();
  const first = wb.displayStyleAt(id, r, c); first.bbBorder.bc = '#ffffff';
  expect(wb.displayStyleAt(id, r, c).bbBorder.bc).toBe('#345678');
  wb.nativePivots = { ...wb.nativePivots, dxfs: [xml('dxf', '<font><i/></font>'), wb.nativePivots.dxfs[1]] };
  expect(wb.displayStyleAt(id, r, c)).toMatchObject({ italic: true });
  expect(wb.displayStyleAt(id, r, c).bold).not.toBe(true);
});

it('applies saved member-specific format rules over style layers without refreshing data', () => {
  const { wb, id, r, c, pivot } = pivotDisplayBook({ parts: ['wholeTable'], dxfs: [xml('dxf', '<font><b/></font>')] });
  const formats = '<formats count="1"><format dxfId="1"><pivotArea><references count="1"><reference field="0" count="1"><x v="0"/></reference></references></pivotArea></format></formats>';
  wb.nativePivots = { ...wb.nativePivots, dxfs: [...wb.nativePivots.dxfs, xml('dxf', '<font><b val="0"/><i/></font><numFmt numFmtId="180" formatCode="0.00&quot; units&quot;"/>')],
    tables: [{ ...pivot, xml: pivot.xml.replace('<pivotTableStyleInfo', `${formats}<pivotTableStyleInfo`) }] };
  expect(wb.nativePivotDisplayIssues()).toEqual([]);
  expect(wb.displayStyleAt(id, r + 1, c + 1)).toMatchObject({ bold: false, italic: true, code: '0.00" units"' });
  expect(wb.getDisplay(id, r + 1, c + 1)).toBe('5.00 units');
  expect(wb.displayStyleAt(id, r + 2, c + 1)).toMatchObject({ bold: true });
  expect(wb.styleAt(id, r + 1, c + 1)).not.toHaveProperty('italic');
});

it('keeps whole-grid style regions sparse and caches plans across ordinary cell changes', () => {
  const { wb, id } = pivotDisplayBook({ ref: 'A1:XFD1048576', r: 0, c: 0, parts: ['wholeTable'], dxfs: [xml('dxf', '<font><i/></font>')] });
  expect(wb.displayStyleAt(id, 1048575, 16383)).toMatchObject({ italic: true });
  const before = wb.sheet(id).cells.size, native = wb.nativePivots;
  for (let i = 0; i < 1000; i++) expect(wb.displayStyleAt(id, i * 1000, 16383).italic).toBe(true);
  expect(wb.sheet(id).cells.size).toBe(before);
  wb.setInput(id, 20, 4, 'Unrelated');
  expect(wb.nativePivots).toBe(native); expect(wb.displayStyleAt(id, 1048575, 16383).italic).toBe(true);
});

it('reports an unsupported report without applying a partial successful style', () => {
  const { wb, id, r, c } = pivotDisplayBook({ parts: ['headerRow', 'wholeTable'], dxfs: [xml('dxf', '<font><b/></font>'), xml('dxf', '<fill><gradientFill/></fill>')] });
  expect(wb.nativePivotDisplayIssues(id)).toEqual([expect.objectContaining({ name: 'Summary', message: expect.stringContaining('not implemented') })]);
  expect(wb.hasNativePivotDisplay(id)).toBe(false);
  expect(wb.displayStyleAt(id, r, c)).toEqual(wb.styleAt(id, r, c));
});

it('preserves source styles and saved definitions across XLSX export without private metadata', async () => {
  const { wb, id, r, c } = pivotDisplayBook(), before = wb.toJSON();
  wb.displayStyleAt(id, r, c);
  const back = await nativeRoundTrip(wb), target = back.sheets[0].id;
  expect(back.nativePivotDisplayIssues()).toEqual([]);
  expect(back.displayStyleAt(target, r, c)).toMatchObject({ bold: true, bg: '#aaccee', bb: true });
  expect(back.styleAt(target, r, c)).not.toHaveProperty('bg');
  expect(wb.toJSON()).toEqual(before);
  const privateBack = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()));
  expect(privateBack.displayStyleAt(privateBack.sheets[0].id, r, c)).toMatchObject({ bold: true });
});
