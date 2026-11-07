import { expect, it } from 'vitest';
import { readNativeSparklineGroups, nativeSparklineExtension, normalizeNativeSparklineGroups } from '../src/core/xlsx-sparklines.js';

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const x14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const xm = 'http://schemas.microsoft.com/office/excel/2006/main';
const wrap = body => `<worksheet xmlns="${main}"><sheetData/><extLst>${body}</extLst></worksheet>`;
const spark = (ref = 'J4', formula = "'O''Brien & Co'!$B$4:$G$4") => ({ ref, formula });
const group = options => ({ sparklines: [spark()], ...options });
const read = groups => readNativeSparklineGroups(wrap(nativeSparklineExtension(groups)));

it('uses native defaults without inventing cell values, colors or cached series', () => {
  const groups = read([group()]);
  expect(groups[0]).toMatchObject({ type: 'line', lineWeight: 0.75, displayEmptyCellsAs: 'zero', minAxisType: 'individual', maxAxisType: 'individual', markers: false, displayHidden: false, rightToLeft: false, sparklines: [spark()] });
  expect(groups[0].colorSeries).toBeUndefined();
  expect(groups[0].manualMax).toBeUndefined();
  expect(read(groups)).toEqual(groups);
  expect(read([group({ sparklines: [spark('$B$2:B2')] })])[0].sparklines[0].ref).toBe('B2');
  expect(nativeSparklineExtension([])).toBe('');
  expect(readNativeSparklineGroups(wrap(''))).toEqual([]);
});
it.each(['line', 'column', 'stacked'])('round-trips %s groups, dates, mixed axes and every marker setting', type => {
  const input = [group({ type, dateAxis: true, dateFormula: "'Dates & labels'!$A$2:$F$2", lineWeight: 2.125, displayEmptyCellsAs: 'span', minAxisType: 'custom', manualMin: -3.5, maxAxisType: 'group', markers: true, high: true, low: true, first: true, last: true, negative: true, displayXAxis: true, displayHidden: true, rightToLeft: true,
    colorSeries: { theme: 5, tint: 0.39997558519241921 }, colorNegative: { indexed: 3 }, colorAxis: { rgb: 'ff00AbCd' }, colorMarkers: { theme: 0 }, colorFirst: { theme: 11, tint: -1 }, colorLast: { rgb: 'FF112233' }, colorHigh: { indexed: 8 }, colorLow: { theme: 4, tint: 1 },
    sparklines: [spark(), spark('J7', '[1]External!D1:D6')],
  }), group({ sparklines: [spark('K9', 'NamedSeries')], maxAxisType: 'custom', manualMax: 90, displayEmptyCellsAs: 'gap' })];
  const normalized = normalizeNativeSparklineGroups(input), xml = nativeSparklineExtension(input);
  expect(readNativeSparklineGroups(wrap(xml))).toEqual(normalized);
  expect(read(read(input))).toEqual(normalized);
  expect(xml.indexOf('x14:colorLow')).toBeLessThan(xml.indexOf('<xm:f>'));
  expect(xml.indexOf('<xm:f>')).toBeLessThan(xml.indexOf('<x14:sparklines>'));
  expect(normalized[0].colorAxis.rgb).toBe('FF00ABCD');
  expect(input[0].colorAxis.rgb).toBe('ff00AbCd');
});
it('resolves namespace aliases and XML boolean lexical forms, ignoring unrelated lookalikes', () => {
  const xml = `<w:worksheet xmlns:w="${main}" xmlns:s="${x14}" xmlns:m="${xm}"><w:sheetData/><w:extLst><w:ext uri="anything"><s:sparklineGroups><s:sparklineGroup high=" true " low=" 0 " lineWeight="7.5e-1"><s:sparklines><s:sparkline><m:f>Data!A1:A4</m:f><m:sqref>$xfd$1048576</m:sqref></s:sparkline></s:sparklines></s:sparklineGroup></s:sparklineGroups></w:ext><w:ext><sparklineGroups xmlns="urn:foreign"><sparklineGroup/></sparklineGroups></w:ext></w:extLst></w:worksheet>`;
  expect(readNativeSparklineGroups(xml)[0]).toMatchObject({ high: true, low: false, lineWeight: 0.75, sparklines: [{ formula: 'Data!A1:A4', ref: 'XFD1048576' }] });
  expect(readNativeSparklineGroups(`<worksheet xmlns="urn:foreign">${nativeSparklineExtension([group()])}</worksheet>`)).toEqual([]);
  expect(readNativeSparklineGroups(wrap(`<ext><wrapper>${nativeSparklineExtension([group()])}</wrapper></ext>`))).toEqual([]);
});
it('ignores inactive manual bounds and writes them only with custom scaling', () => {
  const xml = nativeSparklineExtension([group({ manualMin: 0, manualMax: 0 })]);
  expect(xml).not.toContain('manualMin'); expect(xml).not.toContain('manualMax');
  const dormant = xml.replace('lineWeight="0.75"', 'lineWeight="0.75" manualMin="0" manualMax="0"');
  expect(readNativeSparklineGroups(wrap(dormant))).toEqual(read([group()]));
  expect(() => read([group({ minAxisType: 'custom' })])).toThrow('manualMin');
});
it('retains optional revision identities and rejects ambiguous group identities', () => {
  const uid = '{12345678-abcd-4321-aaaa-123456789abc}';
  expect(read([group({ uid })])[0].uid).toBe(uid.toUpperCase());
  expect(() => read([group({ uid }), group({ uid, sparklines: [spark('K4')] })])).toThrow('duplicate uid');
  expect(() => read([group({ uid }), group({ sparklines: [spark('K4')] })])).toThrow('incomplete group identities');
});
it('rejects malformed metadata rather than silently dropping charts', () => {
  for (const options of [{ type: 'pie' }, { displayEmptyCellsAs: 'skip' }, { minAxisType: 'auto' }, { markers: 'yes' }, { lineWeight: -1 }, { lineWeight: 1585 }, { lineWeight: Infinity }, { manualMax: NaN, maxAxisType: 'custom' }, { colorSeries: { theme: 12 } }, { colorSeries: { tint: 1.1 } }, { colorSeries: { rgb: 'url(x)' } }, { colorSeries: { indexed: 2.5 } }, { uid: 'not a guid' }, { sparklines: [] }]) {
    expect(() => nativeSparklineExtension([group(options)])).toThrow('Invalid native sparkline');
  }
  for (const ref of ['XFE1', 'A1048577', 'A0', 'A1:B1', 'Sheet!A1', 'A1 B1', '']) expect(() => read([group({ sparklines: [spark(ref)] })])).toThrow('destination');
  expect(() => read([group(), group()])).toThrow('duplicate destination');
  expect(() => read([group({ sparklines: [spark('A1', '')] })])).toThrow('formula');
  const valid = nativeSparklineExtension([group()]);
  expect(() => readNativeSparklineGroups(wrap(valid.replace('<xm:f>', '<xm:f>x</xm:f><xm:f>')))).toThrow('Invalid native sparkline f');
  expect(() => readNativeSparklineGroups(wrap(valid.replace('<x14:sparklines>', '<x14:colorSeries auto="1"/><x14:sparklines>')))).toThrow('automatic color');
  expect(() => readNativeSparklineGroups('<!DOCTYPE worksheet [<!ENTITY x "bad">]>' + wrap(valid))).toThrow('declarations');
});

it('preserves sparklines with absent optional formulas without fabricating a binding', () => {
  const groups = read([group({ dateAxis: true, sparklines: [{ ref: 'B2' }] })]);
  expect(groups[0].sparklines).toEqual([{ ref: 'B2' }]);
  expect(groups[0].dateFormula).toBeUndefined();
  expect(nativeSparklineExtension(groups)).not.toContain('<xm:f>');
  expect(read(groups)).toEqual(groups);
});
