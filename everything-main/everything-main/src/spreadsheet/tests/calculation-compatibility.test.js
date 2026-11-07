import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { normalizeCalculationCompatibility } from '../src/core/calculation-compatibility.js';
import { readXlsxCalculationCompatibility, COMPATIBILITY_NAMESPACE as NS, COMPATIBILITY_EXTENSION as URI } from '../src/core/xlsx-calculation-compatibility.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import { sameBook } from '../src/lib/drafts.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import * as X from '../src/vendor/xlsx.mjs';
import { readFileSync } from 'node:fs';
// JSON.parse retains native Version 1 results containing lone surrogates.
const native = JSON.parse(readFileSync(new URL('./fixtures/reference-calculation-compatibility.json', import.meta.url), 'utf8'));

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const extension = (attrs, prefix = 'wcv') => `<ext uri="${URI}" xmlns:${prefix}="${NS}"><${prefix}:version ${attrs}/></ext>`;
const xml = body => `<workbook xmlns="${MAIN}"><extLst>${body}</extLst></workbook>`;
const value = (wb, r = 0, c = 1) => wb.getValue(wb.activeSheetId, r, c);
const book = version => new Workbook({ calculationCompatibility: { version }, sheets: [{ name: 'Data', cells: {
  '0,0': { v: 'a😀b' }, '0,1': { f: 'LEN(A1)' }, '1,1': { f: 'MID(A1,2,1)' },
} }] });

describe('workbook calculation compatibility', () => {
  it.each(native.cases)('matches native Excel: $name', ({ version, cells }) => {
    const wb = new Workbook({ calculationCompatibility: { version }, sheets: [{ cells }] });
    for (const [key, cell] of Object.entries(cells)) {
      if (!cell.f) continue;
      const [r, c] = key.split(',').map(Number);
      expect(value(wb, r, c), cell.f).toEqual(cell.v);
    }
  });

  it('defaults new and old app JSON to Version 2 and validates version declarations', () => {
    expect(value(book(undefined))).toBe(3);
    expect(normalizeCalculationCompatibility({ version: 7, warnBelowVersion: 3 })).toEqual({ version: 7, warnBelowVersion: 3 });
    for (const version of [0, -1, 1.5, Infinity, NaN, '1', null, {}, 2 ** 32]) {
      expect(normalizeCalculationCompatibility({ version })).toEqual({ version: 2 });
    }
    for (const warnBelowVersion of [0, -1, 3, 1.5, '1']) {
      expect(normalizeCalculationCompatibility({ version: 2, warnBelowVersion })).toEqual({ version: 2 });
    }
  });

  it.each([1, 2])('retains Version %i through edits, undo, drafts, replace, and sheet export', version => {
    const wb = book(version), expected = version === 1 ? 4 : 3;
    wb.setInput(wb.activeSheetId, 0, 0, '😀😀');
    expect(value(wb)).toBe(version === 1 ? 4 : 2);
    wb.undo(); expect(value(wb)).toBe(expected);
    const json = wb.toJSON(), restored = new Workbook(json), replaced = new Workbook();
    replaced.replaceWith(json);
    for (const copy of [restored, replaced, wb.sheetToWorkbook(wb.activeSheetId)]) {
      expect(copy.calculationCompatibility).toEqual({ version });
      expect(value(copy)).toBe(expected);
    }
    json.calculationCompatibility.version = 9;
    expect(wb.calculationCompatibility.version).toBe(version);
    expect(restored.calculationCompatibility.version).toBe(version);
  });

  it('compares draft versions while treating an omitted app default as Version 2', () => {
    const json = book(2).toJSON(), old = structuredClone(json);
    delete old.calculationCompatibility;
    expect(sameBook(old, json)).toBe(true);
    old.calculationCompatibility = { version: 1 };
    expect(sameBook(old, json)).toBe(false);
  });

  it.each([1, 2])('uses Version %i throughout names, lambdas, arrays, and cross-sheet references', version => {
    const wb = book(version), id = wb.activeSheetId, n = version === 1 ? 4 : 3;
    wb.defineName('TextLength', 'LEN(Data!A1)');
    const formulas = ['TextLength', 'LAMBDA(t,LEN(t))(A1)', 'LET(t,A1,LEN(t))', 'SUM(LEN({"a😀b","a😀b"}))', 'MAP(A1,LAMBDA(t,LEN(t)))'];
    formulas.forEach((f, r) => wb.setInput(id, r, 3, `=${f}`));
    expect(formulas.map((_, r) => wb.getValue(id, r, 3))).toEqual([n, n, n, 2 * n, n]);
    const sheet = wb.addSheet('Other'); wb.setInput(sheet.id, 0, 0, '=LEN(Data!A1)');
    expect(wb.getValue(sheet.id, 0, 0)).toBe(n);
  });

  it.each([1, 2])('uses the destination Version %i for imported sheets and copied formulas', version => {
    const source = book(version === 1 ? 2 : 1), destination = book(version);
    const [sheet] = destination.importSheets(source);
    expect(destination.calculationCompatibility.version).toBe(version);
    expect(destination.getValue(sheet.id, 0, 1)).toBe(version === 1 ? 4 : 3);
    destination.pasteCells(destination.activeSheetId, source.copyRange(source.activeSheetId, { r1: 0, c1: 0, r2: 0, c2: 1 }), 3, 0, { r: 0, c: 0 });
    expect(value(destination, 3)).toBe(version === 1 ? 4 : 3);
  });
});

describe('native calculation compatibility extension', () => {
  it('reads scoped namespaces, strict OOXML, and XML integer spelling', () => {
    expect(readXlsxCalculationCompatibility(xml(extension('setVersion="2" warnBelowVersion="2"')))).toEqual({ version: 2, warnBelowVersion: 2 });
    expect(readXlsxCalculationCompatibility(xml(extension('setVersion="2"', '__proto__')))).toEqual({ version: 2 });
    expect(readXlsxCalculationCompatibility(xml(extension("setVersion=' +0003 ' warnBelowVersion='&#50;'", 'renamed')))).toEqual({ version: 3, warnBelowVersion: 2 });
    expect(readXlsxCalculationCompatibility(`<s:workbook xmlns:s="http://purl.oclc.org/ooxml/spreadsheetml/main" xmlns:c="${NS}"><s:extLst><s:ext uri="${URI.toLowerCase()}"><c:version setVersion="2"></c:version></s:ext></s:extLst></s:workbook>`)).toEqual({ version: 2 });
    expect(readXlsxCalculationCompatibility(xml(`<ext uri="${URI}"><version xmlns="${NS}" setVersion="2"/></ext>`))).toEqual({ version: 2 });
  });

  it('defaults absent, malformed, misplaced, commented, and unrelated extensions to Version 1', () => {
    const valid = extension('setVersion="2"');
    for (const document of [xml(''), xml('<!--' + valid + '-->'), xml('<![CDATA[' + valid + ']]>'), xml('<?probe ' + valid + '?>'),
      xml(valid.replace(NS, 'urn:other')), xml(valid.replace(URI, '{unrelated}')),
      `<workbook xmlns="${MAIN}">${valid}</workbook>`, xml(`<ext uri="other">${valid}</ext>`),
      ...['0', '-1', '2.5', '2e0', 'NaN', '4294967296', ''].map(n => xml(extension(`setVersion="${n}"`))),
    ]) expect(readXlsxCalculationCompatibility(document), document).toEqual({ version: 1 });
  });

  it.each([null, { version: 1 }, { version: 2, warnBelowVersion: 2 }, { version: 4, warnBelowVersion: 3 }])(
    'imports, edits and exports the native setting without private metadata: %j', async settings => {
      const input = otherProgramsXlsx({ sheetXml: { Data: { rows: '<row r="1"><c r="A1" t="str"><v>a😀b</v></c><c r="B1"><f>LEN(A1)</f><v>0</v></c></row>' } },
        patch: { '/xl/workbook.xml': text => settings ? text.replace('</workbook>', `<extLst>${extension(`setVersion="${settings.version}"${settings.warnBelowVersion ? ` warnBelowVersion="${settings.warnBelowVersion}"` : ''}`)}</extLst></workbook>`) : text } });
      let wb = await workbookFromFile(input, 'external.xlsx');
      for (let round = 0; round < 2; round++) {
        expect(wb.calculationCompatibility).toEqual(settings || { version: 1 });
        expect(value(wb)).toBe((settings?.version || 1) === 1 ? 4 : 3);
        wb.setInput(wb.activeSheetId, 2, 0, 'edited');
        const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), zip = X.CFB.read(bytes, { type: 'array' });
        const part = X.CFB.find(zip, '/xl/workbook.xml');
        let text = new TextDecoder().decode(part.content);
        expect((text.match(/setVersion=/g) || []).length).toBe(1);
        expect(readXlsxCalculationCompatibility(text)).toEqual(settings || { version: 1 });
        const raw = X.read(bytes), sheet = raw.Sheets[raw.SheetNames[0]];
        expect(sheet.B1.v).toBe(value(wb));
        text = text.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '');
        part.content = new TextEncoder().encode(text); part.size = part.content.length;
        wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external-roundtrip.xlsx');
      }
    });

  it.each([1, 2])('retains Version %i in app ODS saves', async version => {
    const wb = await workbookFromFile(await workbookToOds(book(version)), 'saved.ods');
    expect(wb.calculationCompatibility.version).toBe(version);
    expect(value(wb)).toBe(version === 1 ? 4 : 3);
  });
});

it('reads the declared workbook part instead of assuming its filename', async () => {
  const bytes = new Uint8Array(await (await workbookToXlsx(book(1))).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  for (const [from, to] of [['/xl/workbook.xml', '/xl/calculations.xml'], ['/xl/_rels/workbook.xml.rels', '/xl/_rels/calculations.xml.rels']]) {
    const content = X.CFB.find(zip, from).content;
    X.CFB.utils.cfb_add(zip, to, content); X.CFB.utils.cfb_del(zip, from);
  }
  for (const name of ['/[Content_Types].xml', '/_rels/.rels']) {
    const entry = X.CFB.find(zip, name);
    entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content).replaceAll('xl/workbook.xml', 'xl/calculations.xml'));
    entry.size = entry.content.length;
  }
  const imported = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'renamed.xlsx');
  expect(imported.calculationCompatibility).toEqual({ version: 1 });
  expect(value(imported)).toBe(4);
});
