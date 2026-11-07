import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookToOds, workbookFromFile } from '../src/core/io.js';

// The ODS writer and reader do not carry every number format faithfully (a scientific code
// came back garbled, a conditional code as "000", a dated one as a plain number), and the
// app's settings block used to strip the format fields as the .xlsx sidecar does, where the
// cell's own code carries them. The block now keeps them, so the app's own files round-trip.
it.each([
  ['1500', { fmt: 'scientific', dec: 3 }],
  ['1500', { fmt: 'custom', code: '[Red][>1000]#,##0.0;[Blue]-0;"zero";@' }],
  ['45000', { fmt: 'custom', code: '[$-409]mmm d, yyyy;@' }],
  ['0.256', { fmt: 'percent', dec: 1, group: false }],
  ['0.75', { fmt: 'time', sec: true }],
  ['45000.5', { fmt: 'datetime', dateStyle: 'long' }],
  ['5', { fmt: 'custom', code: '0 "abc' }],
  ['1234.5', { fmt: 'currency', cur: 'EUR', dec: 2 }],
])('shows %s formatted %j the same after an .ods round trip', async (input, style) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, input);
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { ...style, bold: true });
  const back = await workbookFromFile(await workbookToOds(wb), 'formats.ods');
  const bid = back.activeSheetId;
  expect(back.getDisplay(bid, 0, 0)).toBe(wb.getDisplay(id, 0, 0));
  expect(back.getCell(bid, 0, 0).s).toEqual({ ...style, bold: true });
});

it('keeps the format of a spilled formula and its destinations\' own overrides', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(3)*1000');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'scientific', dec: 2 });
  wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { fmt: 'custom', code: '[Red][>1000]#,##0.0;0' });
  const back = await workbookFromFile(await workbookToOds(wb), 'spill.ods');
  const bid = back.activeSheetId;
  expect([0, 1, 2].map((r) => back.getDisplay(bid, r, 0))).toEqual([0, 1, 2].map((r) => wb.getDisplay(id, r, 0)));
  expect(back.getCell(bid, 1, 0)).toBeUndefined();
  back.applyStyle(bid, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'number', dec: 0 });
  expect(back.getDisplay(bid, 1, 0)).toBe('2,000');
  expect(back.getDisplay(bid, 2, 0)).toBe('3,000.0');
});

it('still opens a settings block written before the formats were kept, reading the file\'s own codes', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1234.5');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'currency', cur: 'EUR', dec: 2, bold: true });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToOds(wb)).arrayBuffer()), { type: 'array' });
  const settings = X.CFB.find(zip, 'settings.xml');
  const xml = new TextDecoder().decode(settings.content);
  const [, json] = /config:type="string">([^<]*)</.exec(xml);
  const meta = JSON.parse(json.replace(/&quot;/g, '"'));
  const style = meta.sheets.Sheet1.styles['0,0'];
  expect(style).toMatchObject({ fmt: 'currency', cur: 'EUR', dec: 2, bold: true });
  for (const key of ['fmt', 'cur', 'dec']) delete style[key];
  X.CFB.utils.cfb_add(zip, 'settings.xml', new TextEncoder().encode(xml.replace(json, JSON.stringify(meta).replace(/"/g, '&quot;'))));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'older.ods');
  const bid = back.activeSheetId;
  expect(back.getDisplay(bid, 0, 0)).toBe('€1,234.50');
  expect(back.getCell(bid, 0, 0).s).toEqual({ fmt: 'currency', cur: 'EUR', dec: 2, bold: true });
});
