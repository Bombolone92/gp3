// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintRoot, installPrintFallback, printSheet } from '../src/ui/print.js';

afterEach(() => { document.body.replaceChildren(); document.body.className = ''; vi.restoreAllMocks(); });

function documentPage(root) {
  document.body.append(root);
  const media = [...root.querySelector('style').sheet.cssRules].find(rule => rule.conditionText === 'print');
  return media?.cssRules[0].style;
}

it('ends a one-section print document on its named page without retaining viewport height', () => {
  const wb = new Workbook({ sheets: [{ name: 'One', cells: { '0,0': { v: 'Content' } } }] });
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Document', { marginBoxes: false });
  const page = documentPage(root);
  expect(page.getPropertyValue('page')).toBe(root.querySelector('.print-section').style.page);
  expect(page.getPropertyValue('height')).toBe('auto');
});

it('takes the end page from the final visible print area across mixed sheet layouts', () => {
  const area = r => ({ r1: r, c1: 0, r2: r, c2: 0 });
  const wb = new Workbook({ sheets: [
    { name: 'Portrait', cells: { '0,0': { v: 'First' } }, printSettings: { orientation: 'portrait' } },
    { name: 'Landscape', cells: { '2,0': { v: 'Second' }, '5,0': { v: 'Third' } },
      printSettings: { orientation: 'landscape', paperSize: 9, areas: [area(2), area(5)] } },
    { name: 'Hidden', hidden: true, cells: { '0,0': { v: 'Excluded' } } },
  ] });
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Document', { area: 'workbook', marginBoxes: false });
  const sections = [...root.querySelectorAll('.print-section')], page = documentPage(root);
  expect(sections).toHaveLength(3);
  expect(page.getPropertyValue('page')).toBe(sections.at(-1).style.page);
  expect(page.getPropertyValue('page')).not.toBe(sections[0].style.page);
  expect(root.textContent).toContain('A4 landscape');
  expect(root.textContent).not.toContain('Excluded');
});

it('installs and removes document pagination with both print entry points', async () => {
  const wb = new Workbook({ sheets: [{ name: 'One', cells: { '0,0': { v: 7 } } }] });
  const off = installPrintFallback(() => ({ wb, sheetId: wb.activeSheetId, opts: { marginBoxes: false } }));
  vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('beforeprint'));
    const root = document.querySelector('.print-root');
    expect(documentPage(root).getPropertyValue('page')).toBe(root.querySelector('.print-section').style.page);
    window.dispatchEvent(new Event('afterprint'));
  });
  await printSheet(wb, wb.activeSheetId, 'Document', { marginBoxes: false });
  expect(document.querySelector('.print-root')).toBeNull();
  window.dispatchEvent(new Event('beforeprint'));
  expect(document.querySelector('.print-root style').textContent).toContain('html, body');
  off();
  expect(document.querySelector('.print-root')).toBeNull();
  expect(document.documentElement.style.page).toBe('');
  expect(document.body.style.page).toBe('');
});
