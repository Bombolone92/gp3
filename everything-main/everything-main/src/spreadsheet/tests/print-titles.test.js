// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintRoot, printSheet } from '../src/ui/print.js';
import { openPrintDialog, currentPrintPrefs } from '../src/ui/printdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as S from '../src/core/selection.js';
vi.mock('../src/ui/print.js', async original => ({ ...await original(), printSheet: vi.fn(() => true) }));
let storage;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true }));
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) });
  document.body.innerHTML = '<div id="app"></div>'; printSheet.mockClear();
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const open = wb => openPrintDialog({ wb, sheetId: () => wb.activeSheetId, selection: () => S.single(0,0), range: () => ({r1:0,r2:0,c1:0,c2:0}), grid: { focus() {} } });
const input = (panel,label,text) => { const n=panel.querySelector(`[aria-label="${label}"]`); n.value=text; n.dispatchEvent(new Event('input')); return n; };

it('prints titles before a distant area without rendering the intervening rows or columns', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', rows: 10001, cols: 501,
    cells: { '1,1': {v:'Title'}, '10000,500': {v:'Body'} },
    printSettings: { areas: [{r1:10000,r2:10000,c1:500,c2:500}], titleRows: [1,2], titleCols: [1,2] } }] });
  const root=buildPrintRoot(wb,wb.activeSheetId,'Data');
  expect(root.querySelectorAll('tbody tr')).toHaveLength(3);
  expect(root.querySelectorAll('col')).toHaveLength(3);
  expect(root.textContent).toContain('Title'); expect(root.textContent).toContain('Body');
  expect(root.querySelectorAll('td')).toHaveLength(9);
});

it('omits hidden title lines and titles beyond the area, and preserves hidden merge anchors', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data',
    cells: { '1,1': {v:'Merged title'}, '10,4': {v:'Body'}, '20,1': {v:'Too late'} },
    merges: [{r1:1,r2:2,c1:1,c2:2}],
    printSettings: { areas: [{r1:10,r2:10,c1:4,c2:4}], titleRows: [1,2], titleCols: [1,2] } }] });
  wb.setHidden(wb.activeSheetId,'row',[1],true); wb.setHidden(wb.activeSheetId,'col',[1],true);
  let root=buildPrintRoot(wb,wb.activeSheetId,'Data');
  expect(root.querySelectorAll('tbody tr')).toHaveLength(2); expect(root.querySelectorAll('col')).toHaveLength(2);
  expect(root.textContent).toContain('Merged title');
  wb.setPrintSettings(wb.activeSheetId,{...wb.activeSheet.printSettings,titleRows:[20,21]});
  root=buildPrintRoot(wb,wb.activeSheetId,'Data');
  expect(root.querySelectorAll('tbody tr')).toHaveLength(1); expect(root.textContent).not.toContain('Too late');
});

it('keeps titles local to each sheet when printing a workbook', () => {
  const wb=new Workbook({sheets:[
    {name:'One',cells:{'1,0':{v:'First title'},'5,0':{v:'First body'}},printSettings:{areas:[{r1:5,r2:5,c1:0,c2:0}],titleRows:[1,1]}},
    {name:'Two',cells:{'1,0':{v:'Do not print'},'5,0':{v:'Second body'}},printSettings:{areas:[{r1:5,r2:5,c1:0,c2:0}]}},
  ]});
  const root=buildPrintRoot(wb,wb.activeSheetId,'Book',{area:'workbook'});
  expect(root.textContent).toContain('First title'); expect(root.textContent).not.toContain('Do not print');
});

it('edits and clears sheet-specific titles without leaking them to account preferences', () => {
  const wb=new Workbook(), modal=open(wb);
  input(modal.panel,'Rows to repeat at top','$2:$4'); input(modal.panel,'Columns to repeat at left','B:D');
  modal.panel.querySelector('form').requestSubmit();
  expect(wb.activeSheet.printSettings).toMatchObject({titleRows:[1,3],titleCols:[1,3]});
  expect(printSheet.mock.calls[0][3]).toMatchObject({titleRows:[1,3],titleCols:[1,3]});
  for (const text of storage.values()) {expect(text).not.toContain('titleRows');expect(text).not.toContain('titleCols');}
  expect(currentPrintPrefs(new Workbook().activeSheet)).toMatchObject({titleRows:null,titleCols:null});
  closeAllModals();vi.runOnlyPendingTimers();
  const next=open(wb); expect(next.panel.querySelector('[aria-label="Rows to repeat at top"]').value).toBe('2:4');
  input(next.panel,'Rows to repeat at top',''); input(next.panel,'Columns to repeat at left',''); next.panel.querySelector('form').requestSubmit();
  expect(wb.activeSheet.printSettings.titleRows).toBeUndefined(); expect(wb.activeSheet.printSettings.titleCols).toBeUndefined();
  wb.undo();expect(wb.activeSheet.printSettings.titleRows).toEqual([1,3]);
});

it.each(['A1:B2','1:1048577','Other!1:3','SUM(A1)'])('rejects invalid row title %s with an accessible field error', text => {
  const wb=new Workbook(), modal=open(wb), field=input(modal.panel,'Rows to repeat at top',text);
  modal.panel.querySelector('form').requestSubmit();
  expect(printSheet).not.toHaveBeenCalled();expect(field.getAttribute('aria-invalid')).toBe('true');expect(document.activeElement).toBe(field);
  input(modal.panel,'Rows to repeat at top','3:5');expect(field.hasAttribute('aria-invalid')).toBe(false);
  modal.panel.querySelector('form').requestSubmit();expect(printSheet).toHaveBeenCalledTimes(1);
});


it('does not give a printed merge text from an anchor in the omitted gap', () => {
  const wb=new Workbook({sheets:[{name:'Data',cells:{'1,0':{v:'Title'},'4,0':{v:'Omitted anchor'}},
    merges:[{r1:4,r2:8,c1:0,c2:1}],printSettings:{areas:[{r1:7,r2:9,c1:0,c2:1}],titleRows:[1,1]}}]});
  const root=buildPrintRoot(wb,wb.activeSheetId,'Data');
  expect(root.textContent).toContain('Title');expect(root.textContent).not.toContain('Omitted anchor');
});
