// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount(prep) {
  const doc = new Doc({ name: 'Merge', path: 'Spreadsheets/Merge.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  prep?.(wb, id);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  const toast = vi.spyOn(notifications, 'toast');
  let copied = {};
  const ev = (type, data = {}) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => data[t] ?? '', setData: (t, v) => { copied[t] = v; }, files: [] } });
    return e;
  };
  const at = async (a) => { view.goTo(`Sheet1!${a}`); await vi.advanceTimersByTimeAsync(1); };
  const copy = async (a, type = 'copy') => { copied = {}; await at(a); viewport.dispatchEvent(ev(type)); return copied; };
  const pasteSpecial = async (a, label, data = copied) => {
    vi.stubGlobal('navigator', { onLine: true, clipboard: { read: async () => [{ types: Object.keys(data), getType: async t => ({ text: async () => data[t] }) }] } });
    await at(a);
    const item = name => [...document.querySelectorAll('.menu-item')].find(b => b.querySelector('.menu-label')?.textContent === name);
    view.el.querySelector('[data-menu="edit"]').click(); item('Paste special').click(); item(label).click();
    await vi.advanceTimersByTimeAsync(5);
  };
  const pasteText = async (a, text) => { await at(a); viewport.dispatchEvent(ev('paste', { 'text/plain': text })); await vi.advanceTimersByTimeAsync(2); };
  const pasteCopy = async (a, own) => { await at(a); viewport.dispatchEvent(ev('paste', { 'text/plain': own['text/plain'], 'text/html': own['text/html'] })); await vi.advanceTimersByTimeAsync(2); };
  const said = () => toast.mock.calls.map(([m]) => m).filter((m) => /merged cell/.test(m));
  return { wb, id, at, copy, pasteText, pasteCopy, pasteSpecial, said, toast };
}

const html = '<table><tr><td colspan="2" style="background:#abcdef">Header</td></tr><tr><td>12</td><td>13</td></tr></table>';
const source = (wb, id) => {
  wb.setInput(id, 0, 0, '=SUM(A3:B3)'); wb.setInput(id, 2, 0, '12'); wb.setInput(id, 2, 1, '13');
  wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 1 });
};

it('pastes Excel-style HTML spans and cells together, with reversible geometry and fill', async () => {
  const { wb, id, pasteCopy } = await mount();
  await pasteCopy('D5', { 'text/html': html });
  expect(wb.activeSheet.merges).toEqual([{ r1: 4, c1: 3, r2: 4, c2: 4 }]);
  expect(wb.getValue(id, 4, 3)).toBe('Header'); expect(wb.styleAt(id, 4, 3).bg).toBe('#abcdef');
  expect(wb.getValue(id, 5, 4)).toBe(13);
  wb.undo(); expect(wb.activeSheet.merges).toEqual([]); expect(wb.getValue(id, 4, 3)).toBeNull();
  wb.redo(); expect(wb.activeSheet.merges).toHaveLength(1);
});

it('pastes Excel overflow cells and compacted blank rows without introducing merges or shifting data', async () => {
  const { wb, id, pasteCopy } = await mount((wb, id) => wb.setInput(id, 6, 4, 'Clear me'));
  await pasteCopy('D5', { 'text/html': `<table>
    <tr><td colspan="2" style="mso-ignore:colspan;background:#abcdef">Overflow</td><td>Right</td></tr>
    <tr style="mso-xlrowspan:3"><td colspan="3" style="mso-ignore:colspan"></td></tr>
    <tr><td colspan="2">Merged</td><td>Last</td></tr></table>` });
  expect(wb.activeSheet.merges).toEqual([{ r1: 8, c1: 3, r2: 8, c2: 4 }]);
  expect(wb.getValue(id, 4, 3)).toBe('Overflow');
  expect(wb.getValue(id, 4, 5)).toBe('Right');
  expect(wb.getValue(id, 6, 4)).toBeNull();
  expect(wb.getValue(id, 8, 5)).toBe('Last');
  expect(wb.styleAt(id, 4, 4).bg).toBe('#abcdef');
  wb.undo();
  expect(wb.getValue(id, 6, 4)).toBe('Clear me');
  expect(wb.activeSheet.merges).toEqual([]);
  wb.redo();
  wb.setInput(id, 4, 4, 'Independent');
  expect(wb.getValue(id, 4, 3)).toBe('Overflow');
  expect(wb.getValue(id, 4, 4)).toBe('Independent');
});

it.each(['internal', 'another tab', 'foreign'])('copies merged perimeter borders through the editor (%s)', async path => {
  const { wb, id, copy, pasteCopy } = await mount((wb, id) => {
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 2, c2: 2 });
    const entries = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) entries.push({ r, c, cell: {
      v: r === 0 && c === 0 ? 'Outline' : null,
      s: { bt: r === 0, bl: c === 0, bb: r === 2, br: c === 2,
        btBorder: { bs: 'thin', bc: '#334455' }, blBorder: { bs: 'dashed', bc: '#556677' },
        bbBorder: { bs: 'double', bc: '#779933' }, brBorder: { bs: 'thick', bc: '#aa4466' } },
    } });
    wb.setCells(id, entries);
  });
  const own = await copy('A1:C3');
  if (path === 'another tab') own['text/html'] = own['text/html'].replace(/data-spreadsheet-copy="[^"]*"/, 'data-spreadsheet-copy="different-tab"');
  if (path === 'foreign') own['text/html'] = own['text/html'].replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  await pasteCopy('G5', own);
  expect(wb.activeSheet.merges).toContainEqual({ r1: 4, c1: 6, r2: 6, c2: 8 });
  expect(wb.getValue(id, 4, 6)).toBe('Outline');
  for (let c = 6; c <= 8; c++) expect(wb.styleAt(id, 6, c)).toMatchObject({ bb: true, bbBorder: { bs: 'double', bc: '#779933' } });
  for (let r = 4; r <= 6; r++) expect(wb.styleAt(id, r, 8)).toMatchObject({ br: true, brBorder: { bs: 'thick', bc: '#aa4466' } });
  expect(wb.styleAt(id, 4, 6)).toMatchObject({ bt: true, bl: true, bb: false, br: false });
  wb.undo(); expect(wb.getCell(id, 6, 8)).toBeUndefined();
  wb.redo(); expect(wb.styleAt(id, 6, 8)).toMatchObject({ bb: true, br: true });
});

it.each(['internal', 'another tab'])('preserves geometry and relative formulas when copied from %s', async path => {
  const { wb, id, copy, pasteCopy } = await mount(source);
  const own = await copy('A1:B3');
  if (path === 'another tab') own['text/html'] = own['text/html'].replace(/data-spreadsheet-copy="[^"]*"/, 'data-spreadsheet-copy="different-tab"');
  await pasteCopy('G5', own);
  expect(wb.activeSheet.merges).toContainEqual({ r1: 4, c1: 6, r2: 4, c2: 7 });
  expect(wb.getCell(id, 4, 6).f).toBe('SUM(G7:H7)'); expect(wb.getValue(id, 4, 6)).toBe(25);
});

it('refuses partial destination-merge overlap without mutating values or extending nearby tables', async () => {
  const { wb, id, at, pasteCopy, toast } = await mount((wb, id) => {
    wb.setInput(id, 1, 1, 'Keep'); wb.mergeCells(id, { r1: 0, c1: 2, r2: 1, c2: 2 });
  });
  await at('B2');
  const before = wb.toJSON();
  await pasteCopy('B2', { 'text/html': html });
  expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
  expect(toast.mock.calls.some(([message]) => /cross part of a merged cell/.test(message))).toBe(true);
});

it('preserves geometry in a filtered internal copy using only visible rows', async () => {
  const { wb, id, copy, pasteCopy } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, 'Tall'); wb.mergeCells(id, { r1: 0, c1: 0, r2: 2, c2: 1 });
    wb.setHidden(id, 'row', [1], true);
  });
  await pasteCopy('D5', await copy('A1:B3'));
  expect(wb.activeSheet.merges).toContainEqual({ r1: 4, c1: 3, r2: 5, c2: 4 });
});


it.each(['Values only', 'Formulas only (keep formatting)'])('%s leaves merge geometry unchanged', async label => {
  const { wb, copy, pasteSpecial } = await mount(source);
  await copy('A1:B3');
  await pasteSpecial('D5', label);
  expect(wb.activeSheet.merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 1 }]);
});

it.each(['internal', 'foreign'])('transposes %s merged geometry', async path => {
  const { wb, copy, pasteSpecial } = await mount(source);
  const data = path === 'internal' ? await copy('A1:B3') : { 'text/html': html };
  await pasteSpecial('D5', 'Transposed', data);
  expect(wb.activeSheet.merges).toContainEqual({ r1: 4, c1: 3, r2: 5, c2: 3 });
});

it('moves complete merges in a filtered cut and restores both ends in one undo', async () => {
  const { wb, id, copy, pasteCopy } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, 'Merged'); wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 1 });
    wb.setInput(id, 1, 0, 'Hidden'); wb.setHidden(id, 'row', [1], true);
    wb.setInput(id, 2, 0, 'Visible');
  });
  await pasteCopy('D5', await copy('A1:B3', 'cut'));
  expect(wb.activeSheet.merges).toEqual([{ r1: 4, c1: 3, r2: 4, c2: 4 }]);
  expect(wb.getValue(id, 0, 0)).toBeNull(); expect(wb.getValue(id, 1, 0)).toBe('Hidden');
  expect(wb.getValue(id, 4, 3)).toBe('Merged'); expect(wb.getValue(id, 5, 3)).toBe('Visible');
  wb.undo();
  expect(wb.activeSheet.merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 1 }]);
  expect(wb.getValue(id, 0, 0)).toBe('Merged'); expect(wb.getValue(id, 4, 3)).toBeNull();
});

it('refuses a filtered cut that would leave part of a merged cell behind', async () => {
  const { wb, id, copy, pasteCopy, toast } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, 'Tall'); wb.mergeCells(id, { r1: 0, c1: 0, r2: 2, c2: 1 });
    wb.setHidden(id, 'row', [1], true);
  });
  await pasteCopy('D5', await copy('A1:B3', 'cut'));
  expect(wb.activeSheet.merges).toEqual([{ r1: 0, c1: 0, r2: 2, c2: 1 }]);
  expect(wb.getValue(id, 0, 0)).toBe('Tall'); expect(wb.getValue(id, 4, 3)).toBeNull();
  expect(wb.canUndo()).toBe(false);
  expect(toast.mock.calls.some(([text]) => /Select every row/.test(text))).toBe(true);
});

it('inserts copied merges while shifting existing merges and undoes the whole operation', async () => {
  const { wb, id, copy, pasteSpecial } = await mount((wb, id) => {
    source(wb, id); wb.setInput(id, 4, 3, 'Existing');
    wb.mergeCells(id, { r1: 4, c1: 3, r2: 4, c2: 4 });
  });
  await copy('A1:B3'); await pasteSpecial('D5', 'Insert copied cells, shifting down');
  expect(wb.activeSheet.merges).toContainEqual({ r1: 4, c1: 3, r2: 4, c2: 4 });
  expect(wb.activeSheet.merges).toContainEqual({ r1: 7, c1: 3, r2: 7, c2: 4 });
  expect(wb.getValue(id, 7, 3)).toBe('Existing');
  wb.undo(); expect(wb.getValue(id, 4, 3)).toBe('Existing'); expect(wb.activeSheet.merges).toHaveLength(2);
});

it('refuses inserting copied merges into a growing table before shifting cells', async () => {
  const { wb, copy, pasteSpecial, at } = await mount((wb, id) => {
    source(wb, id); wb.addTable(id, { r1: 3, c1: 3, r2: 7, c2: 4 });
  });
  await copy('A1:B3'); await at('D5'); const before = wb.toJSON();
  await pasteSpecial('D5', 'Insert copied cells, shifting down');
  expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
});

it('keeps pasted merges below a table outside its data rows', async () => {
  const { wb, pasteCopy } = await mount((wb, id) => wb.addTable(id, { r1: 0, c1: 3, r2: 3, c2: 4 }));
  await pasteCopy('D5', { 'text/html': html });
  expect(wb.activeSheet.tables[0].range.r2).toBe(3);
  expect(wb.activeSheet.merges).toContainEqual({ r1: 4, c1: 3, r2: 4, c2: 4 });
});

it.each(['internal', 'another tab', 'foreign'])('transfers %s formatting and merges without replacing destination contents', async path => {
  const { wb, id, copy, pasteSpecial } = await mount((wb, id) => {
    source(wb, id); wb.setInput(id, 4, 3, '10'); wb.setInput(id, 4, 4, '=D5*2');
  });
  const data = path === 'foreign' ? { 'text/html': html } : await copy('A1:B3');
  if (path === 'another tab') data['text/html'] = data['text/html'].replace(/data-spreadsheet-copy="[^"]*"/, 'data-spreadsheet-copy="different-tab"');
  await pasteSpecial('D5', 'Formatting only', data);
  expect(wb.activeSheet.merges).toContainEqual({ r1: 4, c1: 3, r2: 4, c2: 4 });
  expect(wb.getValue(id, 4, 3)).toBe(10); expect(wb.getValue(id, 4, 4)).toBe(20);
  expect(wb.getCell(id, 4, 4).f).toBe('D5*2');
  wb.undo(); expect(wb.activeSheet.merges).toHaveLength(1);
});


it.each(['internal', 'another tab'])('preserves underlying values when a merged block is subsequently copied from %s', async path => {
  const { wb, id, copy, pasteSpecial, pasteCopy, toast } = await mount((wb, id) => {
    source(wb, id); wb.setInput(id, 4, 3, '10'); wb.setInput(id, 4, 4, '=D5*2');
  });
  await pasteSpecial('D5', 'Formatting only', await copy('A1:B3'));
  const data = await copy('D5:E7');
  if (path === 'another tab') data['text/html'] = data['text/html'].replace(/data-spreadsheet-copy="[^"]*"/, 'data-spreadsheet-copy="different-tab"');
  await pasteCopy('H8', data);
  expect(wb.activeSheet.merges).toContainEqual({ r1: 7, c1: 7, r2: 7, c2: 8 });
  expect(wb.getValue(id, 7, 7)).toBe(10); expect(wb.getValue(id, 7, 8)).toBe(20);
  expect(wb.getCell(id, 7, 8).f).toBe('H8*2');
  expect(toast.mock.calls.some(([message]) => /fell under.*merged/.test(message))).toBe(false);
});

it('refuses a packed cut landing on part of a destination merge without clearing its source', async () => {
  const { wb, id, copy, pasteCopy } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, 'First'); wb.setInput(id, 2, 0, 'Last'); wb.setHidden(id, 'row', [1], true);
    wb.setNote(id, 2, 0, 'Keep'); wb.setInput(id, 0, 7, '=A3');
    wb.setInput(id, 5, 2, 'Destination'); wb.mergeCells(id, { r1: 5, r2: 5, c1: 2, c2: 3 });
  });
  await pasteCopy('D5', await copy('A1:A3', 'cut'));
  expect(wb.getValue(id, 0, 0)).toBe('First'); expect(wb.getValue(id, 2, 0)).toBe('Last');
  expect(wb.getNote(id, 2, 0)).toBe('Keep'); expect(wb.getCell(id, 0, 7).f).toBe('A3');
  expect(wb.getValue(id, 4, 3)).toBeNull(); expect(wb.getValue(id, 5, 2)).toBe('Destination');
  expect(wb.canUndo()).toBe(false);
});

it('replaces fully covered destination merges for a packed cut so every source cell lands', async () => {
  const { wb, id, copy, pasteCopy } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, 'First'); wb.setInput(id, 2, 0, 'Last'); wb.setHidden(id, 'row', [1], true);
    wb.mergeCells(id, { r1: 4, r2: 5, c1: 3, c2: 3 });
  });
  await pasteCopy('D5', await copy('A1:A3', 'cut'));
  expect(wb.getValue(id, 4, 3)).toBe('First'); expect(wb.getValue(id, 5, 3)).toBe('Last');
  expect(wb.activeSheet.merges).toEqual([]); expect(wb.undoLabels()).toHaveLength(1);
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe('First'); expect(wb.getValue(id, 2, 0)).toBe('Last');
  expect(wb.activeSheet.merges).toEqual([{ r1: 4, r2: 5, c1: 3, c2: 3 }]);
  wb.redo(); expect(wb.getValue(id, 5, 3)).toBe('Last'); expect(wb.activeSheet.merges).toEqual([]);
});


it('keeps the copy fallback for partial arrays before applying cut-only merge restrictions', async () => {
  const { wb, id, copy, pasteCopy } = await mount((wb, id) => {
    wb.setArrayFormula(id, { r1: 0, r2: 2, c1: 0, c2: 1 }, '=ROW()+COLUMN()');
    wb.setHidden(id, 'row', [1], true);
    wb.mergeCells(id, { r1: 5, r2: 5, c1: 4, c2: 5 });
  });
  await pasteCopy('D5', await copy('A1:B3', 'cut'));
  expect(wb.getCell(id, 0, 0).array).toEqual({ rows: 3, cols: 2 });
  expect(wb.getValue(id, 4, 3)).toBe(2); expect(wb.getValue(id, 4, 4)).toBe(3); expect(wb.getValue(id, 5, 3)).toBe(4);
  expect(wb.activeSheet.merges).toEqual([{ r1: 5, r2: 5, c1: 4, c2: 5 }]);
});
