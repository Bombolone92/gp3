// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { normalizePrintSettings } from '../src/core/print-settings.js';
import { readXlsxPrint } from '../src/core/xlsx-print.js';
import { writeXlsxPrint } from '../src/core/xlsx-export-print.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { buildPrintRoot, preparePrintRoot, sheetPrintPrefs, printSettingsFromPrefs, printPageText } from '../src/ui/print.js';
import * as X from '../src/vendor/xlsx.mjs';
import { Blob } from 'node:buffer';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it.each(['worksheet', 'chartsheet'])('preserves enabled and dormant first-page numbers on a %s', kind => {
  for (const enabled of [true, false]) for (const number of [0, 1, 4, 27, 4294967295]) {
    const p = readXlsxPrint(`<s:${kind}><s:pageSetup firstPageNumber="${number}" useFirstPageNumber="${enabled}"/></s:${kind}>`, [], 'Report', 0);
    expect(p).toMatchObject({ firstPageNumber: number, useFirstPageNumber: enabled });
    const xml = writeXlsxPrint(`<${kind}></${kind}>`, p);
    expect(xml).toContain(`firstPageNumber="${number}"`);
    expect(xml).toContain(`useFirstPageNumber="${Number(enabled)}"`);
    expect(readXlsxPrint(xml, [], 'Report', 0)).toMatchObject(p);
  }
});

it('defaults malformed starts without enabling automatic-number overrides', () => {
  for (const firstPageNumber of [undefined, null, -1, 1.5, NaN, Infinity, 4294967296, '7']) {
    expect(normalizePrintSettings({ firstPageNumber })).toMatchObject({ firstPageNumber: 1, useFirstPageNumber: false });
  }
  for (const value of ['-1', '2.5', 'NaN', 'Infinity', '', '4294967296']) {
    expect(readXlsxPrint(`<worksheet><pageSetup firstPageNumber="${value}" useFirstPageNumber="1"/></worksheet>`, [], 'Report', 0))
      .toMatchObject({ firstPageNumber: 1, useFirstPageNumber: true });
  }
  expect(readXlsxPrint('<worksheet><pageSetup firstPageNumber="9"/></worksheet>', [], 'Report', 0))
    .toMatchObject({ firstPageNumber: 9, useFirstPageNumber: false });
});

it('retains numbering through settings edits, Undo, copies, JSON and native XLSX', async () => {
  const p = { firstPageNumber: 17, useFirstPageNumber: true, footer: '&P of &N' };
  const wb = new Workbook({ sheets: [{ name: 'Report', cells: { '0,0': { v: 'Value' } }, printSettings: p }] });
  const s = wb.activeSheet, id = s.id;
  wb.setPrintSettings(id, printSettingsFromPrefs(s, { ...sheetPrintPrefs(s), orientation: 'landscape' }));
  expect(wb.activeSheet.printSettings).toMatchObject(p);
  wb.undo();
  expect(wb.activeSheet.printSettings).toMatchObject({ ...p, orientation: 'portrait' });
  expect(wb.duplicateSheet(id).printSettings).toMatchObject(p); wb.undo();
  expect(new Workbook(wb.toJSON()).activeSheet.printSettings).toMatchObject(p);
  const blob = await workbookToXlsx(wb);
  const bytes = blob instanceof Blob ? await blob.arrayBuffer() : await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const reopened = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'Numbering.xlsx');
  expect(reopened.activeSheet.printSettings).toMatchObject(p);
});

it.each(['worksheet', 'chart'])('starts the job from the first included %s without changing page variants', kind => {
  const settings = { firstPageNumber: 8, useFirstPageNumber: true, differentFirst: true, differentOddEven: true,
    firstFooter: 'FIRST &P of &N', evenFooter: 'EVEN &P of &N', footer: 'ODD &P of &N' };
  const wb = new Workbook({ sheets: [
    { name: 'Hidden', hidden: true, printSettings: { firstPageNumber: 99, useFirstPageNumber: true } },
    { name: 'First', kind, cells: { '0,0': { v: 1 } }, printSettings: settings },
    { name: 'Later', cells: { '0,0': { v: 2 } }, printSettings: { ...settings, firstPageNumber: 23 } },
  ] });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100));
  const css = options => {
    const root = buildPrintRoot(wb, wb.sheets[2].id, 'Report', { marginBoxes: true, title: false, ...options });
    document.body.append(root); preparePrintRoot(root);
    const before = root.innerHTML; preparePrintRoot(root); expect(root.innerHTML).toBe(before);
    return root.querySelector('style').textContent;
  };
  expect(css({ area: 'workbook' })).toContain('"FIRST " "8" " of " counter(pages)');
  expect(css({ area: 'workbook' })).toContain('"EVEN " "9" " of " counter(pages)');
  expect(css({ area: 'sheet' })).toContain('"FIRST " "23" " of " counter(pages)');
  expect(css({ area: 'selection', range: { r1: 0, c1: 0, r2: 0, c2: 0 } })).toContain('"23" " of " counter(pages)');
  expect(css({ area: 'sheet', useFirstPageNumber: false })).not.toContain('"23" " of " counter(pages)');
  for (const [i, label] of ['FIRST', 'EVEN', 'ODD'].entries()) expect(printPageText(settings, i).footer).toBe(`${label} &P of &N`);
  expect(sheetPrintPrefs({})).toMatchObject({ firstPageNumber: 1, useFirstPageNumber: false });
});
