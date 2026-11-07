import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile, sheetToCsv, sheetToHtml, decodeText } from '../src/core/io.js';

describe('the settings sheet', () => {
  it('never splits a character between two chunks', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    // A long note pushes an emoji onto every possible chunk boundary somewhere in the JSON.
    for (let r = 0; r < 40; r++) wb.setNote(id, r, 0, `${'x'.repeat(1499)}😀`);
    const back = await workbookFromFile(await workbookToXlsx(wb), 'notes.xlsx');
    for (let r = 0; r < 40; r++) expect(back.getNote(back.activeSheetId, r, 0)).toBe(`${'x'.repeat(1499)}😀`);
  });
});

describe('exporting a sheet with one far-off cell', () => {
  it('writes the CSV and web page quickly, keeping the columns lined up', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'near');
    wb.setInput(id, 1, 2, 'c2');
    wb.setInput(id, 3, 0, '=SEQUENCE(1,3)');
    wb.setInput(id, 19999, 701, 'far');
    const t0 = performance.now();
    const csv = sheetToCsv(wb, id);
    const html = sheetToHtml(wb, id);
    expect(performance.now() - t0).toBeLessThan(4000);
    const lines = csv.replace(/^\ufeff/, '').split('\r\n');
    expect(lines[0]).toBe(`near${','.repeat(701)}`);
    expect(lines[1]).toBe(`,,c2${','.repeat(699)}`);
    expect(lines[3]).toBe(`1,2,3${','.repeat(699)}`);
    expect(lines[19999]).toBe(`${','.repeat(701)}far`);
    const odd = lines.map((l, i) => [i, l.split(',').length]).filter(([, n]) => n !== 702 && n !== 1);
    expect(odd.slice(0, 3).map(([i, n]) => `${i}:${n}:${lines[i].slice(0, 40)}`)).toEqual([]);
    expect(html).toContain('near');
    expect(html).toContain('far');
    expect(html.length).toBeLessThan(2_000_000);
  });
});

describe('decoding a text file', () => {
  it('keeps UTF-8 when a single stray byte spoils an otherwise valid file', () => {
    const good = new TextEncoder().encode('café,naïve,Zürich\r\nrésumé,x,y\r\n');
    const withStray = new Uint8Array([...good, 0xe9]);
    expect(decodeText(withStray)).toMatch(/^café,naïve,Zürich\r\nrésumé,x,y\r\n/);
    expect(decodeText(withStray)).not.toContain('Ã');
    // A file cut inside its last character keeps everything before the cut.
    const cut = good.slice(0, good.length - 1);
    expect(decodeText(cut)).toContain('résumé');
    // A real Windows-1252 file still decodes as such.
    const cp1252 = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x2c, 0x31]); // "café,1"
    expect(decodeText(cp1252)).toBe('café,1');
  });
});

