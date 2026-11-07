import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function hyperlinkFile(ref) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:B2', A1: { t: 's', v: 'Keep' },
    B1: { t: 's', v: 'Valid', l: { Target: 'https://example.com/valid' } },
  }, 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = zip.FileIndex.find((e) => e.name === 'sheet1.xml');
  const attributes = ref === null ? '' : ` ref="${ref}"`;
  entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content).replace('<hyperlinks>',
    `<hyperlinks><hyperlink${attributes} location="Data!B2"/>`));
  entry.size = entry.content.length;
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it.each([null, '', ' ', 'A0', 'A1 trailing', 'A1:B2:C3', 'A1 B2', 'Data!A1', 'XFE1', 'A1048577', 'B2:A1', 'ZZZZ1', 'A9999999'].flatMap((ref) =>
  [false, true].map((dense) => ({ ref, dense }))))(
  'skips malformed hyperlink references and keeps later valid links: %j', async ({ ref, dense }) => {
    const bytes = hyperlinkFile(ref);
    const raw = XLSX.read(bytes, { type: 'array', dense });
    const sheet = raw.Sheets.Data;
    if (dense) {
      expect(sheet['!data']).toHaveLength(1);
      expect(sheet['!data'][0]).toHaveLength(2);
      expect(sheet['!data'][0][0].l).toBeUndefined();
      expect(sheet['!data'][0][1].l.Target).toBe('https://example.com/valid');
    } else {
      expect(Object.keys(sheet).filter((k) => !k.startsWith('!')).sort()).toEqual(['A1', 'B1']);
      expect(sheet.A1.l).toBeUndefined();
      expect(sheet.B1.l.Target).toBe('https://example.com/valid');
    }
    let wb = await workbookFromFile(bytes, 'references.xlsx');
    for (let round = 0; round < 2; ++round) {
      expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('Keep');
      expect(wb.linkAt(wb.activeSheetId, 0, 0)).toBeNull();
      expect(wb.linkAt(wb.activeSheetId, 0, 1)?.url).toBe('https://example.com/valid');
      wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    }
  },
);

it.each(['A1:A2', '$A$1:$A$2', 'a1:a2', '&#65;1:A2'].flatMap((ref) => [false, true].map((dense) => ({ ref, dense }))))(
  'imports valid relative, absolute, and lowercase ranges: %j', async ({ ref, dense }) => {
    const bytes = hyperlinkFile(ref);
    const sheet = XLSX.read(bytes, { type: 'array', dense }).Sheets.Data;
    for (let r = 0; r < 2; ++r) expect((dense ? sheet['!data'][r][0] : sheet[`A${r + 1}`]).l.Target).toBe('#Data!B2');
    const wb = await workbookFromFile(bytes, 'ranges.xlsx');
    for (let r = 0; r < 2; ++r) expect(wb.linkAt(wb.activeSheetId, r, 0)?.url).toBe('#Data!B2');
  },
);

it.each(['XFD1', 'A1048576', 'XFD1048576'])('accepts a single-cell hyperlink at the grid boundary: %s', (ref) => {
  const sheet = XLSX.read(hyperlinkFile(ref), { type: 'array' }).Sheets.Data;
  expect(sheet[ref].l.Target).toBe('#Data!B2');
  expect(sheet.B1.l.Target).toBe('https://example.com/valid');
});

it.each(['A1:A' + '9'.repeat(310), 'A1:XFE1048577'])(
  'rejects an oversized range before expanding cells: %s', (ref) => {
    // Keep the original unbounded range expansion isolated from the test runner.
    const bytes = Buffer.from(hyperlinkFile(ref)).toString('base64');
    const result = spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', `
      import * as X from './src/vendor/xlsx.mjs';
      const sheet = X.read(Buffer.from(${JSON.stringify(bytes)}, 'base64'), {type:'buffer'}).Sheets.Data;
      console.log(JSON.stringify({cells:Object.keys(sheet).filter(k=>!k.startsWith('!')).sort(),target:sheet.B1?.l?.Target}));
    `], { cwd: new URL('../', import.meta.url), timeout: 3000, encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ cells: ['A1', 'B1'], target: 'https://example.com/valid' });
  },
);
