// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPrintFallback, printSheet } from '../src/ui/print.js';
import { Workbook } from '../src/core/workbook.js';

let uninstall = null;
beforeEach(() => {
  vi.useFakeTimers();
  // The browser fires beforeprint from inside print(); jsdom's print does nothing, so the stub does the firing.
  vi.stubGlobal('print', vi.fn(() => window.dispatchEvent(new Event('beforeprint'))));
  window.print = globalThis.print;
});
afterEach(() => {
  uninstall?.();
  uninstall = null;
  document.body.replaceChildren();
  document.body.className = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function sheet(text) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, text);
  return wb;
}

// The app's own Print command lays the sheet out as a table and hides the chrome. Printing from
// the browser's menu (File > Print) skipped all that and printed the toolbar, the grid viewport
// and the status bar. The editor installs a beforeprint fallback that lays the sheet out with the
// default print settings, unless the app's command already has.
describe('printing from the browser menu', () => {
  it('lays the current sheet out for beforeprint and clears it after', () => {
    const wb = sheet('Hello there');
    uninstall = installPrintFallback(() => ({ wb, sheetId: wb.activeSheetId, docName: 'Budget' }));
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.body.classList.contains('printing')).toBe(true);
    const root = document.querySelector('.print-root');
    expect(root.textContent).toContain('Hello there');
    expect(root.querySelector('.print-title').textContent).toBe('Budget');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('printing')).toBe(false);
    expect(document.querySelector('.print-root')).toBeNull();
    // A second print asks the context again, so it follows a sheet switch.
    wb.addSheet('Other');
    wb.setInput(wb.activeSheetId, 0, 0, 'Second sheet');
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.querySelector('.print-root').textContent).toContain('Second sheet');
    window.dispatchEvent(new Event('afterprint'));
  });

  it('honours the settings the context hands it', () => {
    const wb = sheet('Cell');
    uninstall = installPrintFallback(() => ({ wb, sheetId: wb.activeSheetId, docName: 'Budget', opts: { title: false, headers: true } }));
    window.dispatchEvent(new Event('beforeprint'));
    const root = document.querySelector('.print-root');
    expect(root.querySelector('.print-title')).toBeNull();
    expect(root.querySelector('th.print-hdr')).toBeTruthy();
  });

  it('leaves the layout the app’s own Print command built alone', async () => {
    const wb = sheet('Mine');
    uninstall = installPrintFallback(() => ({ wb, sheetId: wb.activeSheetId, docName: 'Fallback name' }));
    expect(await printSheet(wb, wb.activeSheetId, 'Chosen name', { headers: true })).toBe(true);
    expect(window.print).toHaveBeenCalledTimes(1);
    // One layout, the command's, not a second from the fallback.
    expect(document.querySelectorAll('.print-root')).toHaveLength(1);
    expect(document.querySelector('.print-title').textContent).toBe('Chosen name');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('.print-root')).toBeNull();
    expect(document.body.classList.contains('printing')).toBe(false);
  });

  it('does nothing without a sheet to print, and nothing once uninstalled', () => {
    uninstall = installPrintFallback(() => null);
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.querySelector('.print-root')).toBeNull();
    expect(document.body.classList.contains('printing')).toBe(false);
    uninstall();
    uninstall = null;
    const wb = sheet('Gone');
    const off = installPrintFallback(() => ({ wb, sheetId: wb.activeSheetId }));
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.querySelector('.print-root')).toBeTruthy();
    // Uninstalling mid-print clears the layout it made.
    off();
    expect(document.querySelector('.print-root')).toBeNull();
    expect(document.body.classList.contains('printing')).toBe(false);
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.querySelector('.print-root')).toBeNull();
  });
});
