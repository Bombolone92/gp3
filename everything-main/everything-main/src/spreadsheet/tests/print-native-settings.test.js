// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintRoot, sheetPrintPrefs, printableWidth, printSettingsFromPrefs } from '../src/ui/print.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { openPrintDialog } from '../src/ui/printdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as S from '../src/core/selection.js';

function invoice() {
  return new Workbook({ sheets: [{ name: 'Invoice', rows: 100, cols: 26, defaultColWidth: 100, defaultRowHeight: 30,
    cells: { '0,0': { v: 'Invoice' }, '40,6': { v: 100 }, '50,0': { v: 'Outside the print area' } },
    printSettings: { areas: [{ r1: 0, c1: 0, r2: 40, c2: 6 }], fitToPage: true, scale: 77, horizontalCentered: true, verticalCentered: true },
  }] });
}
afterEach(() => { closeAllModals(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('keeps printer-default paper when editing other options and records a changed paper choice', () => {
  const wb = invoice(), sheet = wb.activeSheet, prefs = sheetPrintPrefs(sheet);
  expect(sheet.printSettings.paperSize).toBeNull();
  expect(printSettingsFromPrefs(sheet, { ...prefs, orientation: 'landscape' }).paperSize).toBeNull();
  wb.setPrintSettings(sheet.id, printSettingsFromPrefs(sheet, { ...prefs, paper: 'a4' }));
  expect(sheet.printSettings.paperSize).toBe(9);
  wb.setPrintSettings(sheet.id, printSettingsFromPrefs(sheet, { ...prefs, paper: 'letter' }));
  expect(sheet.printSettings.paperSize).toBe(1);
  wb.undo(); wb.undo();
  expect(sheet.printSettings.paperSize).toBeNull();
});

it('prints only the saved area, fitting both dimensions with exact margins and no added furniture', () => {
  const wb = invoice(), root = buildPrintRoot(wb, wb.activeSheetId, 'Invoice', { marginBoxes: true });
  expect(root.textContent).not.toContain('Outside the print area');
  expect(root.querySelectorAll('tbody tr')).toHaveLength(41);
  expect(root.querySelector('.print-table').classList.contains('no-grid')).toBe(true);
  expect(root.querySelector('.print-head')).toBeNull();
  expect(root.querySelector('style').textContent).not.toContain('counter(page)');
  expect(root.querySelector('style').textContent).toContain('margin: 0.75in 0.7in 0.75in 0.7in');
  // 41 * 30px on the 912px-high content area; fit-to-page overrides stored scale=77.
  expect(root.querySelector('.print-sheet').style.zoom).toBe('0.74');
  expect(parseFloat(root.querySelector('.print-position').style.paddingLeft)).toBeCloseTo((681.6 - 700 * .74) / 2);
  expect(parseFloat(root.querySelector('.print-position').style.paddingTop)).toBeCloseTo((912 - 1230 * .74) / 2);
  expect(printableWidth(sheetPrintPrefs(wb.activeSheet))).toBeCloseTo(681.6);
});

it('keeps nonadjacent print areas separate and lets selection/entire-sheet override them', () => {
  const wb = invoice();
  wb.activeSheet.printSettings.areas.push({ r1: 50, c1: 0, r2: 50, c2: 0 });
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Invoice', { marginBoxes: false });
  expect(root.querySelectorAll('.print-section')).toHaveLength(2);
  expect(root.querySelectorAll('.print-section.page-break')).toHaveLength(1);
  expect(root.querySelectorAll('tbody tr')).toHaveLength(42);
  const selection = buildPrintRoot(wb, wb.activeSheetId, 'Invoice', { area: 'selection', range: { r1: 50, c1: 0, r2: 50, c2: 0 } });
  expect(selection.querySelectorAll('tbody tr')).toHaveLength(1);
  const all = buildPrintRoot(wb, wb.activeSheetId, 'Invoice', { area: 'sheet' });
  expect(all.querySelectorAll('tbody tr')).toHaveLength(51);
});

it('shows native fit and margin values in the print dialog without inheriting another workbook’s setup', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ scale: 200, margins: 'wide', gridlines: true, orientation: 'landscape' }), setItem() {} });
  document.body.innerHTML = '<div id="app"></div>';
  const wb = invoice(), ctx = { wb, sheetId: () => wb.activeSheetId, selection: () => S.single(0, 0), range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), grid: { focus() {} } };
  const modal = openPrintDialog(ctx), panel = modal.panel;
  expect(panel.querySelector('[aria-label="Print"] [aria-checked="true"]').dataset.key).toBe('printArea');
  expect(panel.querySelector('[aria-label="Scale"] [aria-checked="true"]').dataset.key).toBe('pages');
  expect(panel.querySelector('[aria-label="Pages tall"]').value).toBe('1');
  expect(panel.querySelector('[aria-label="Left margin in inches"]').value).toBe('0.7');
  expect(panel.querySelector('[aria-label="Top margin in inches"]').value).toBe('0.75');
  expect(panel.querySelector('[aria-label="Orientation"] [aria-checked="true"]').dataset.key).toBe('portrait');
});

it('keeps edited page setup through save/reopen and does not dirty the file when nothing changed', async () => {
  vi.stubGlobal('Blob', NodeBlob);
  const wb = invoice(), prefs = sheetPrintPrefs(wb.activeSheet);
  wb.setPrintSettings(wb.activeSheetId, printSettingsFromPrefs(wb.activeSheet, prefs));
  expect(wb.canUndo()).toBe(false);
  Object.assign(prefs, { scale: 88, fit: 'scale', footer: '&CPage &P of &N &R&D', title: true });
  prefs.customMargins.left = .25;
  wb.setPrintSettings(wb.activeSheetId, printSettingsFromPrefs(wb.activeSheet, prefs));
  const blob = await workbookToXlsx(wb);
  const back = await workbookFromFile(new Uint8Array(await blob.arrayBuffer()), 'saved.xlsx');
  expect(sheetPrintPrefs(back.activeSheet)).toMatchObject({ scale: 88, fit: 'scale', customMargins: { left: .25 }, footer: '&CPage &P of &N &R&D', title: true });
  wb.undo();
  expect(wb.activeSheet.printSettings.scale).toBe(77);
  expect(wb.activeSheet.printSettings.margins.left).toBe(.7);
});
