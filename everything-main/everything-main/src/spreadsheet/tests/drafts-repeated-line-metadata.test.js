import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_COL, MAX_ROW } from '../src/core/refs.js';
import { DRAFT_ENCODING, packDraftWorkbook, unpackDraftWorkbook } from '../src/lib/draft-codec.js';
import { clearDraft, draftKey, draftRevision, listDrafts, loadDraft, moveDraft, parkDraft, readableDraft, saveDraft } from '../src/lib/drafts.js';

beforeEach(() => {
  const values = new Map();
  vi.stubGlobal('localStorage', {
    get length() { return values.size; }, key: i => [...values.keys()][i] ?? null,
    getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key),
    setItem(key, value) { if (value.length > 2_400_000) throw new Error('Quota'); values.set(key, String(value)); },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('keeps small books with whole-column formatting below the existing draft cap without losing metadata', () => {
  const style = { font: 'arial', fs: 16, bold: true, bg: '#112233', color: '#abcdef', align: 'center', wrap: true, code: '0.0000' };
  const columns = Object.fromEntries(Array.from({ length: MAX_COL + 1 }, (_, c) => [c, style]));
  const widths = Object.fromEntries(Array.from({ length: MAX_COL + 1 }, (_, c) => [c, { width: c % 3 ? 8.43 : 12.7, pixels: c % 3 ? 64 : 94 }]));
  const wb = new Workbook({ sheets: ['Summary', 'Details'].map(name => ({ name, colStyles: columns,
    nativeWidths: { font: { name: 'Arial', sz: 11 }, cols: widths }, cells: { '0,0': { v: 42 }, '1,0': { f: 'A1*2' } } })) });
  const before = wb.toJSON(), key = draftKey('/formatted.xlsx');
  expect(JSON.stringify(before).length).toBeGreaterThan(2_400_000);
  expect(saveDraft(key, wb, 'Formatted', 'revision-one')).toBe(true);
  const raw = localStorage.getItem(key), packed = JSON.parse(raw);
  expect(raw.length).toBeLessThan(600_000);
  expect(packed.encoding).toBe(DRAFT_ENCODING);
  expect(packed.workbook).toBeNull(); // Old readers cannot offer a partially decoded book.
  expect(readableDraft(packed)).toBe(false);
  const draft = loadDraft(key), restored = new Workbook(draft.workbook);
  expect(readableDraft(draft)).toBe(true);
  expect(restored.toJSON()).toEqual(before);
  expect(wb.toJSON()).toEqual(before);
  expect(restored.getValue(restored.activeSheetId, 1, 0)).toBe(84);
  restored.activeSheet.colStyles.get(0).bold = false;
  expect(restored.activeSheet.colStyles.get(1).bold).toBe(true);
});

it('preserves sparse indices, row metadata, false/zero values, and native width precision', () => {
  const style = { bold: false, indent: 0, color: '#123456', bg: '#abcdef' };
  const book = { sheets: [{ cells: {}, colStyles: { 1: style, 7: style, [MAX_COL]: style },
    rowStyles: { 0: style, 20: style, [MAX_ROW]: style },
    nativeWidths: { font: { name: 'Arial', sz: 11 }, cols: { 0: { width: 0, pixels: 1 }, 2: { width: 13.7109375, pixels: 101 }, 4: { width: 13.7109375, pixels: 101 } } } }] };
  const encoded = packDraftWorkbook(book);
  expect(encoded).not.toBeNull();
  expect(unpackDraftWorkbook(encoded)).toEqual(book);
  expect(Object.keys(unpackDraftWorkbook(encoded).sheets[0].colStyles)).toEqual(['1', '7', String(MAX_COL)]);
  expect(packDraftWorkbook({ sheets: [{ cells: {} }] })).toBeNull();
});

it('moves, lists, parks, and conditionally clears encoded drafts using the decoded revision', () => {
  const wb = new Workbook({ sheets: [{ name: 'S', colStyles: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, { font: 'arial', bold: true }])) }] });
  const key = draftKey('/one.xlsx'), destination = draftKey('/two.xlsx');
  expect(saveDraft(key, wb, 'Columns', null, { fileModified: 123, fileUid: 'file-id' })).toBe(true);
  const original = loadDraft(key), revision = draftRevision(original);
  expect(moveDraft(key, destination, revision)).toBe(true);
  expect(loadDraft(destination)).toEqual(original);
  expect(listDrafts()).toMatchObject([{ key: destination, name: 'Columns', fileUid: 'file-id' }]);
  clearDraft(destination, 'different revision');
  expect(loadDraft(destination)).toEqual(original);
  const parked = parkDraft(destination, revision);
  expect(parked).toBeTruthy();
  expect(loadDraft(parked)).toEqual(original);
  clearDraft(parked, revision);
  expect(loadDraft(parked)).toBeNull();
});

it.each([
  [[{}, [0, 0]]], [[{}, [-1]]], [[{}, [MAX_COL + 1]]], [[{}, [1.5]]],
  [[{}, ['1']]], [[{}, [0]], [{ bold: true }, [0]]], [[null, [0]]], [[{}, '0']],
].map(dictionary => [dictionary]))('rejects malformed column dictionaries instead of offering incomplete recovery: %j', dictionary => {
  localStorage.setItem('bad', JSON.stringify({ savedAt: 1, name: 'Bad', workbook: null, encoding: DRAFT_ENCODING,
    packedWorkbook: { sheets: [{ cells: {}, colStyles: dictionary }] } }));
  expect(loadDraft('bad')).toBeNull();
});

it('continues reading legacy records and leaves unknown encodings unavailable', () => {
  const draft = { savedAt: 1, name: 'Legacy', workbook: new Workbook().toJSON() };
  localStorage.setItem('legacy', JSON.stringify(draft));
  expect(loadDraft('legacy')).toEqual(draft);
  localStorage.setItem('future', JSON.stringify({ ...draft, workbook: null, encoding: 'future', packedWorkbook: draft.workbook }));
  expect(loadDraft('future')).toBeNull();
});
