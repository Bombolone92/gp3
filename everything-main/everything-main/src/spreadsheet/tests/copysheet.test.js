// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import * as IO from '../src/core/io.js';
import * as P from '../src/lib/puter.js';
import { openCopySheetDialog } from '../src/ui/copysheet.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  toast.mockClear();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('copying a sheet to a new file', () => {
  it.each([false, true])('preserves other files if a name collision arrives during serialization (%s)', async (collision) => {
    const wb = new Workbook({ sheets: [{ name: 'Budget' }] });
    const originalPath = 'Spreadsheets/Budget.xlsx';
    const files = new Map();
    const original = new Blob(['Another tab\'s workbook']);
    const copy = new Blob(['Copied sheet']);
    vi.spyOn(P, 'uniqueName').mockResolvedValue('Budget.xlsx');
    vi.spyOn(IO, 'workbookToXlsx').mockImplementation(async () => {
      if (collision) files.set(originalPath, original);
      return copy;
    });
    const write = vi.fn(async (path, blob, opts) => {
      if (files.has(path) && opts.dedupeName) path = 'Spreadsheets/Budget 2.xlsx';
      else if (files.has(path) && !opts.overwrite) throw new Error('Already exists');
      files.set(path, blob);
      return { path: `/user/${path}`, name: path.split('/').pop() };
    });
    vi.stubGlobal('puter', { fs: { mkdir: vi.fn(), write } });
    const run = vi.fn();
    const modal = openCopySheetDialog({ wb, grid: { focus() {} }, run }, wb.activeSheetId);
    modal.panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    const savedPath = collision ? 'Spreadsheets/Budget 2.xlsx' : originalPath;
    if (collision) expect(files.get(originalPath)).toBe(original);
    expect(files.get(savedPath)).toBe(copy);
    expect(toast.mock.lastCall[0]).toBe(`Copied Budget to ${collision ? 'Budget 2' : 'Budget'}`);
    toast.mock.lastCall[1].action.onClick();
    expect(run).toHaveBeenCalledWith('openFile', `/user/${savedPath}`); // the address the drive reports for the new file
  });
});

describe('copying a sheet into an existing file', () => {
  it.each(['unchanged', 'changed', 'replaced', 'deleted', 'unavailable'])('protects the destination when its revision is %s', async (state) => {
    const wb = new Workbook({ sheets: [{ name: 'Source' }] });
    const other = new Workbook({ sheets: [{ name: 'Destination' }] });
    const path = 'Spreadsheets/Destination.xlsx';
    const original = { uid: 'file-1', modified: 100, size: 50 };
    const latest = state === 'changed' ? { ...original, modified: 101 }
      : state === 'replaced' ? { ...original, uid: 'file-2' }
        : state === 'deleted' ? null : original;
    vi.spyOn(P, 'listFiles').mockResolvedValue([{ path, name: 'Destination.xlsx' }]);
    vi.spyOn(P, 'readFile').mockResolvedValue(new ArrayBuffer(0));
    vi.spyOn(IO, 'workbookFromFile').mockResolvedValue(other);
    vi.spyOn(IO, 'workbookToXlsx').mockResolvedValue(new Blob(['copy']));
    const stat = vi.spyOn(P, 'statFile').mockResolvedValueOnce(original);
    if (state === 'unavailable') stat.mockRejectedValueOnce(new Error('Offline'));
    else stat.mockResolvedValueOnce(latest);
    const write = vi.spyOn(P, 'writeFile').mockResolvedValue({ path });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { panel } = openCopySheetDialog({ wb, grid: { focus() {} }, run() {} }, wb.activeSheetId);
    await vi.advanceTimersByTimeAsync(0);
    panel.querySelector('[value="existing"]').click();
    panel.querySelector('form').requestSubmit();
    await vi.advanceTimersByTimeAsync(0);
    if (state === 'unchanged') {
      expect(write).toHaveBeenCalledOnce();
      expect(other.sheets.map((sheet) => sheet.name)).toEqual(['Destination', 'Source']);
    } else {
      expect(write).not.toHaveBeenCalled();
      expect(panel.querySelector('.field-error').hidden).toBe(false);
      expect(toast).not.toHaveBeenCalled();
    }
  });
});

it.each([[true, null], [false, null], [true, '/user/AppData/app/Spreadsheets/Original.xlsx'], [false, '/user/AppData/app/Spreadsheets/Original.xlsx']])('saves a newly linked pivot source before writing the copied file: %s, %s', async (saved, initialPath) => {
  const wb = new Workbook({ sheets: [{ name: 'Data' }, { name: 'Report' }] }), sheet = wb.sheets[1];
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  wb.nativePivots = { version: 1, caches: [{ key: 'cache', scope: 'main', sourceSheetId: wb.sheets[0].id, sourceRef: 'A1:B2', records: '',
    xml: `<pivotCacheDefinition xmlns="${ns}"><cacheSource type="worksheet"><worksheetSource sheet="Data" ref="A1:B2"/></cacheSource><cacheFields count="0"/></pivotCacheDefinition>` }],
    tables: [{ name: 'Pivot', cache: 'cache', owner: sheet.id, ref: 'A1:B2', xml: `<pivotTableDefinition xmlns="${ns}" name="Pivot" cacheId="0"><location ref="A1:B2"/></pivotTableDefinition>` }], dxfs: [], styles: [], formats: {}, connections: '' };
  const doc = { path: initialPath }, events = [];
  const saveSourceForCopy = vi.fn(async () => { events.push('save'); if (saved) doc.path = '/user/AppData/app/Spreadsheets/Original.xlsx'; return saved; });
  vi.spyOn(P, 'resolveAppFolder').mockResolvedValue('/user/AppData/app/Spreadsheets');
  vi.spyOn(P, 'uniqueName').mockResolvedValue('Copy.xlsx');
  const encode = vi.spyOn(IO, 'workbookToXlsx').mockImplementation(async one => {
    events.push('encode'); expect(one.nativePivots.caches[0].sourceWorkbook).toBe('Original.xlsx'); return new Blob(['copy']);
  });
  const write = vi.spyOn(P, 'writeFile').mockImplementation(async path => { events.push('write'); return { path, name: 'Copy.xlsx' }; });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { panel } = openCopySheetDialog({ wb, doc, saveSourceForCopy, grid: { focus() {} }, run() {} }, sheet.id);
  panel.querySelector('form').requestSubmit(); await vi.advanceTimersByTimeAsync(0);
  expect(saveSourceForCopy).toHaveBeenCalledOnce();
  if (saved) { expect(events).toEqual(['save', 'encode', 'write']); expect(write).toHaveBeenCalledOnce(); }
  else { expect(encode).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(panel.querySelector('.field-error').textContent).toContain('could not be saved'); }
});
