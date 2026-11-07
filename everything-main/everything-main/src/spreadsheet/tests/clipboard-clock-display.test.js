// @vitest-environment jsdom
import { expect, it, afterEach } from 'vitest';
import { parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { formatValue, setLocale } from '../src/core/format.js';
import native from './fixtures/reference-clock-display-clipboard.json';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

afterEach(() => setLocale('en-US'));
const read = (html, text) => cellsFromHtmlRows(parseHtmlClipboard(html, text).rows).map(x => x.cell);
const table = (code, text, attr = '') => `<table xmlns:x="urn:schemas-microsoft-com:office:excel"><tr><td style='mso-number-format:"${code.replaceAll('"', '\\0022')}"' ${attr}>${text}</td></tr></table>`;

it('recovers the visible clock components from native Excel HTML without raw values', () => {
  const cells = read(native.html, native.text);
  native.seconds.forEach((seconds, i) => {
    expect(cells[i].v, `row ${i + 1}`).toBeCloseTo(seconds / 86400, 14);
    expect(formatValue(cells[i].v, cells[i].s), `row ${i + 1}`).toBe(native.text.split('\r\n')[i]);
  });
});

it('honors authoritative numbers and text before interpreting formatted clock displays', () => {
  for (const [attr, expected] of [['x:num="1.23456789"', 1.23456789], ['x:str', '01.000'], ['x:str="literal"', 'literal']]) {
    expect(read(table('ss.000', '01.000', attr))[0].v).toBe(expected);
  }
  expect(read(table('0.000', '01.000'))[0].v).toBe(1);
  expect(cellsFromHtmlRows([[{ text: '1' }]], () => ({fmt:'custom',code:'ss.000'}))[0].cell.v).toBe(1);
  expect(read(table('ss.000', ''))[0].v).toBeNull();
  expect(read(table('[>0]ss.000;"zero"', '01.000'))[0].v).toBe(1 / 86400);
  // Hidden minutes could make this positive; the visible zero alone cannot
  // satisfy the section condition without inventing an unrepresented value.
  expect(read(table('[>0]ss.000;"zero"', '00.000'))[0].v).toBe('00.000');
});

it('retains recovered numeric times through edit, Undo and metadata-free XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const cells = read(native.html, native.text);
  wb.setCells(id, cells.map((cell, r) => ({r, c:0, cell})));
  wb.setInput(id, 0, 0, '2', {literal:true});
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe(1 / 86400);
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => {
    const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result)); reader.readAsArrayBuffer(blob);
  });
  const zip = X.CFB.read(bytes, {type:'array'}), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, {type:'array',fileType:'zip'}), 'clocks.xlsx');
  cells.forEach((cell,r) => {
    expect(restored.getValue(restored.activeSheetId,r,0)).toBe(cell.v);
    expect(restored.getDisplay(restored.activeSheetId,r,0)).toBe(native.text.split('\r\n')[r]);
  });
});

it('handles localized fractions and periods, and refuses conflicting or malformed fields', () => {
  setLocale('de-DE');
  expect(read(table('ss.000', '01,250'))[0].v).toBe(1.25 / 86400);
  setLocale('en-US');
  expect(read(table('[$-407]h:mm AM/PM', '1:30 PM'))[0].v).toBe(13.5 / 24);
  for (const text of ['01.000 02.000', '99.000 99.000', '01.000 garbage']) {
    expect(read(table('ss.000 ss.000', text))[0].v).toBe(text);
  }
});

it('recovers uniquely separated compact clock fields without guessing ambiguous digit runs', () => {
  for (const [code, text, seconds] of [
    ['hhmm', '1330', 48600], ['hhmmss', '133002', 48602],
    ['hmmss', '133002', 48602], ['hmmss', '10203', 3723],
    ['hhs', '132', 46802], ['hh"1"mm', '13130', 48600],
    ['[h]mmss', '253002', 91802], ['[hh]mmss', '013002', 5402],
  ]) {
    const cell = read(table(code, text))[0];
    expect(cell.v, code).toBe(seconds / 86400);
    expect(formatValue(cell.v, cell.s), code).toBe(text);
  }
  // 132 can be 01:00:32 or 13:00:02. Neither interpretation is authoritative.
  expect(read(table('hs', '132'))[0].v).toBe('132');
});
