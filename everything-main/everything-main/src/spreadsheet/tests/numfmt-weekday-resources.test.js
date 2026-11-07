// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { dateNames, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-weekday-resources.json';

afterEach(() => setLocale('en-US'));

it('matches native weekday resources for every day, calendar, locale tag and regional variant', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected);
    expect(calc(`TEXT(${value},"${code}")`), `${value}: ${code}`).toBe(expected);
  }
});

it('uses the short weekday names without changing full names or leaking between regional settings', () => {
  for (const [locale, expected] of [['ru-RU', 'Пн|понедельник'], ['pt-PT', 'seg.|segunda-feira'], ['pt-BR', 'seg.|segunda-feira'], ['en-US', 'Mon|Monday']]) {
    setLocale(locale);
    expect(formatWithCode(45306, 'ddd|dddd')).toBe(expected);
    expect(formatWithCode(45306, '[$-ca-ES]ddd|dddd')).toBe('dl|dilluns');
    expect(formatWithCode(45312, '[$-id-ID]ddd|dddd')).toBe('Mgg|Minggu');
    expect(formatWithCode(45306, '[$-vi-VN]ddd|dddd')).toBe('Th 2|Thứ Hai');
  }
  expect(dateNames('RU-md').days.short).toEqual(['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']);
  expect(dateNames('fr-FR').days.short).toEqual(['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']);
  expect(dateNames('xx-XX').days.short).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
});

it('retains date values and weekday formats through edits, Undo, external HTML and metadata-free XLSX', async () => {
  const cases = [[45306, '[$-419]ddd dddd', 'Пн понедельник'], [45308, '[$-816]ddd dddd', 'qua. quarta-feira'], [45310, '[$-403]ddd dddd', 'dv divendres'], [45311, '[$-vi-VN]ddd dddd', 'Th 7 Thứ Bảy'], [45312, '[$-421]ddd dddd', 'Mgg Minggu'], [45312, '[$-60421]ddd dddd', 'Mgg Minggu']];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [value, code, display]] of cases.entries()) {
    wb.setInput(id, r, 0, String(value));
    wb.applyStyle(id, {r1:r, c1:0, r2:r, c2:0}, {fmt:'custom', code});
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code}")`);
    expect(wb.getDisplay(id, r, 0)).toBe(display);
    const html = cellsToHtml([[display]], [[wb.getCell(id,r,0)]], null, [[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value);
    expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,0,0,'45312');
  expect(wb.getValue(id,0,1)).toBe('Вс воскресенье');
  wb.undo();
  expect(wb.getValue(id,0,1)).toBe('Пн понедельник');
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => {const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob);});
  const zip = X.CFB.read(bytes, {type:'array'}), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, {type:'array', fileType:'zip'}), 'weekdays.xlsx');
  for (const [r, [value, code, display]] of cases.entries()) {
    expect(back.getValue(back.activeSheetId,r,0)).toBe(value);
    expect(back.styleAt(back.activeSheetId,r,0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId,r,0)).toBe(display);
    expect(back.getValue(back.activeSheetId,r,1)).toBe(display);
  }
});
