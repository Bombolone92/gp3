// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { getLocale, setLocale } from '../src/core/format.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
const initialLocale = getLocale();
afterEach(() => setLocale(initialLocale));
const linked = "'[1]Data'!$A$1";
const value = wb => wb.getValue(wb.activeSheetId, 0, 0);
function source(f, input = 40, names = []) {
  setLocale('en-US');
  const known = new Workbook({ names,
    externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: { '0,0': input } }] }] },
    sheets: [{ name: 'Report', cells: { '0,0': { f } } }] });
  const saved = value(known), json = known.toJSON();
  json.externalWorkbooks.books[0].sheets[0].cells = null;
  json.sheets[0].cells['0,0'].externalResult = { formula: f, value: saved };
  return new Workbook(json);
}
const cases = [
  [`FIXED(${linked},1,TRUE)`, 40, '40.0', '40,0'],
  [`TEXT(${linked},"0.0")`, 40, '40.0', '40,0'],
  [`FIND(".",${linked})`, 1.5, 2, { error: '#VALUE!' }],
  [`${linked}+"1.234"`, 40, 41.234, 1274],
  [`-${linked}`, '1.234', -1.234, -1234],
  [`${linked}%`, '1.234', 0.01234, 12.34],
  [`${linked}&""`, 1.5, '1.5', '1,5'],
  [`SUM(${linked},"1.234")`, 40, 41.234, 1274],
  [`NUMBERVALUE(${linked})`, '1.234', 1.234, 1234],
];
it.each(cases)('tracks regional conversions in %s', (f, input, original, regional) => {
  const wb = source(f, input);
  expect(value(wb)).toEqual(original);
  setLocale('de-DE'); wb.recalculate();
  expect(value(wb)).toEqual({ error: '#REF!' });
  const json = wb.toJSON(); json.externalWorkbooks.books[0].sheets[0].cells = { '0,0': input };
  expect(value(new Workbook(json))).toEqual(regional);
  setLocale('en-US'); wb.recalculate();
  expect(value(wb)).toEqual(original);
});
it.each([linked, `+${linked}`, `${linked}=40`, `ISNUMBER(${linked})`, `IFERROR(${linked},0)`, `IF(${linked},1,0)`, `AND(${linked},TRUE)`, `N(${linked})`, `T(${linked})`])('keeps locale-independent %s portable', f => {
  const wb = source(f), original = value(wb);
  setLocale('de-DE'); wb.recalculate();
  expect(value(wb)).toEqual(original);
});
it('evaluates the current fallback after invalidating a saved branch result', () => {
  const wb = source(`IFERROR(${linked},FIXED(1.5,1,TRUE))`);
  expect(value(wb)).toBe(40);
  setLocale('de-DE'); wb.recalculate();
  expect(value(wb)).toBe('1,5');
});
it.each([`LET(number,${linked},FIXED(number,1,TRUE))`, `LAMBDA(number,FIXED(number,1,TRUE))(${linked})`, `IF(${linked},FormattedSource,0)`])('follows conversions within %s', f => {
  const wb = source(f, 40, [{ name: 'FormattedSource', ref: `FIXED(${linked},1,TRUE)` }]);
  expect(value(wb)).toBe('40.0');
  setLocale('de-DE'); wb.recalculate();
  expect(value(wb)).toEqual({ error: '#REF!' });
});
it.each([null, 4, {}, '', 'xx-YY'])('rejects invalid locale provenance %j', locale => {
  const json = source(`FIXED(${linked},1,TRUE)`).toJSON();
  json.sheets[0].cells['0,0'].externalResult.context.locale = locale;
  expect(value(new Workbook(json))).toEqual({ error: '#REF!' });
});
it('does not upgrade older provenance missing a required locale', () => {
  const json = source(`FIXED(${linked},1,TRUE)`).toJSON();
  delete json.sheets[0].cells['0,0'].externalResult.context.locale;
  expect(value(new Workbook(json))).toEqual({ error: '#REF!' });
});
it('retains the source locale through JSON, undo/redo and cell copy', () => {
  const wb = source(`FIXED(${linked},1,TRUE)`), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '7'); wb.undo(); expect(value(wb)).toBe('40.0');
  wb.redo(); expect(value(wb)).toBe(7); wb.undo();
  const dest = new Workbook({ sheets: [{ name: 'Report' }] });
  setLocale('de-DE');
  dest.pasteCells(dest.activeSheetId, wb.copyCells(id, [0], [0]), 0, 0, { r: 0, c: 0 }, null, { externalWorkbooks: wb.externalWorkbooks });
  expect(value(dest)).toEqual({ error: '#REF!' });
  expect(value(new Workbook(wb.toJSON()))).toEqual({ error: '#REF!' });
});
it.each(['en-US', 'de-DE'])('exports current native values under %s', async locale => {
  let wb = source(`FIXED(${linked},1,TRUE)`);
  setLocale(locale); wb.recalculate();
  const expected = locale === 'en-US' ? '40.0' : { error: '#REF!' };
  for (let cycle = 0; cycle < 2; cycle++) {
    const blob = await workbookToXlsx(wb);
    const bytes = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
    });
    const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    expect(value(wb)).toEqual(expected);
  }
});

it.each(['en-US', 'de-DE'])('preserves locale provenance through HTML clipboard under %s', locale => {
  const wb = source(`FIXED(${linked},1,TRUE)`);
  const parsed = parseHtmlClipboard(cellsToHtml([['40.0']], wb.copyCells(wb.activeSheetId, [0], [0]), null, [['40.0']],
    { r: 0, c: 0 }, { externalWorkbooks: wb.externalWorkbooks }), '40.0');
  setLocale(locale);
  const dest = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '/Other.xlsx', sheets: [{ name: 'Data', cells: { '0,0': 99 } }] }] } });
  dest.pasteCells(dest.activeSheetId, parsed.cells, 0, 0, parsed.origin, null, { externalWorkbooks: parsed.externalWorkbooks });
  expect(value(dest)).toEqual(locale === 'en-US' ? '40.0' : { error: '#REF!' });
});
