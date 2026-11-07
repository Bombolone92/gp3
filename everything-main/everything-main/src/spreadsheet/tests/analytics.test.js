// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { trackEvent, trackExport } from '../src/lib/analytics.js';
import { Doc } from '../src/lib/doc.js';
import * as P from '../src/lib/puter.js';
import { installMockPuter } from './helpers/mock-puter.js';
import { memoryStorage } from './helpers/memory-storage.js';

let doc;
beforeEach(() => {
  vi.stubGlobal('plausible', vi.fn());
  vi.stubGlobal('localStorage', memoryStorage());
  installMockPuter();
  window.puter = globalThis.puter;
});
afterEach(() => {
  doc?.destroy(); doc = null;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete globalThis.puter; delete window.puter;
  document.body.replaceChildren();
});

it('keeps app actions working when analytics is blocked, missing or throws', () => {
  vi.stubGlobal('plausible', undefined);
  expect(() => trackEvent('Spreadsheet Edited')).not.toThrow();
  vi.stubGlobal('plausible', () => { throw new Error('blocked'); });
  expect(() => trackEvent('Spreadsheet Saved', { method: 'manual' })).not.toThrow();
});

it('queues custom events before the async script loads', () => {
  const queue = [];
  vi.stubGlobal('plausible', (...args) => queue.push(args));
  trackEvent('Spreadsheet Edited');
  trackEvent('Spreadsheet Saved', { method: 'auto' });
  expect(queue).toEqual([['Spreadsheet Edited'], ['Spreadsheet Saved', { props: { method: 'auto' } }]]);
});

it('sends only a known format and export method, never a filename or arbitrary extension', () => {
  trackExport('Private payroll for jane@example.com.XLSX', 'browser');
  trackExport('Payroll.private-financial-information', 'puter');
  expect(plausible.mock.calls).toEqual([
    ['Spreadsheet Exported', { props: { format: 'xlsx', method: 'browser' } }],
    ['Spreadsheet Exported', { props: { format: 'other', method: 'puter' } }],
  ]);
});

it('tracks actual cloud saves and copies, skipping failed and unchanged saves', async () => {
  doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'Private data');
  const write = puter.fs.write;
  puter.fs.write = async () => { throw new Error('quota'); };
  await expect(doc.save()).rejects.toThrow('quota');
  expect(plausible).not.toHaveBeenCalled();
  puter.fs.write = write;
  expect(await doc.save()).toBe(true);
  expect(await doc.save()).toBe(true);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'Changed data');
  expect(await doc.save({ auto: true })).toBe(true);
  expect(await doc.saveAs('Private copy')).toBeNull();
  expect(await doc.saveAs('Private copy')).toBe('A file with that name already exists');
  expect(plausible.mock.calls).toEqual([
    ['Spreadsheet Saved', { props: { method: 'manual' } }],
    ['Spreadsheet Saved', { props: { method: 'auto' } }],
    ['Spreadsheet Saved', { props: { method: 'copy' } }],
  ]);
});

it('counts no export for Puter\'s save dialog, which saves files rather than exporting them', async () => {
  const saved = { name: 'Renamed private file.xlsx', path: '~/Desktop/Renamed private file.xlsx', uid: 'u-9' };
  const answered = Promise.resolve(saved);
  puter.ui.showSaveFilePicker = vi.fn().mockReturnValueOnce(Object.assign(new Promise(() => {}), { undefinedOnCancel: Promise.resolve(undefined) }))
    .mockReturnValueOnce(Object.assign(answered, { undefinedOnCancel: answered }));
  const blob = new Blob(['secret']);
  expect(await P.saveFileAs(blob, 'Private.xlsx')).toBeNull();
  expect(await P.saveFileAs(blob, 'Private.xlsx')).toMatchObject(saved);
  expect(plausible).not.toHaveBeenCalled();
});

it('tracks a browser export after starting the download', () => {
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:export', revokeObjectURL: vi.fn() });
  vi.useFakeTimers();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    P.downloadBlob(new Blob(['secret']), 'Private.csv');
    expect(plausible.mock.calls).toEqual([['Spreadsheet Exported', { props: { format: 'csv', method: 'browser' } }]]);
    vi.runAllTimers();
  } finally { vi.useRealTimers(); }
});

it('tracks an AI answer without sending its prompt or reply, skipping failures and empty replies', async () => {
  window.puter.ai = { chat: vi.fn().mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ success: false, error: { message: 'quota' } }).mockResolvedValueOnce('')
    .mockResolvedValueOnce({ message: { content: [{ text: 'Private answer' }] } }) };
  await expect(P.aiChat('Private prompt')).rejects.toThrow();
  await expect(P.aiChat('Private prompt')).rejects.toThrow();
  expect(await P.aiChat('Private prompt')).toBe('');
  expect(plausible).not.toHaveBeenCalled();
  expect(await P.aiChat('Private prompt', { feature: 'ask-data' })).toBe('Private answer');
  expect(plausible.mock.calls).toEqual([['AI Interaction', { props: { feature: 'ask-data' } }]]);
});
