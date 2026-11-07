import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { Doc } from '../src/lib/doc.js';
import { installMockPuter } from './helpers/mock-puter.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('workbook gate', () => {
  it('answers #BLOCKED! for outside content until allowed, then recomputes', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const calls = [];
    wb.setAsyncProvider('IMPORTDATA', async (text) => { calls.push(text); return [['fetched']]; });
    wb.setInput(id, 0, 0, '=IMPORTDATA("https://example.com/a.csv")');
    wb.setInput(id, 1, 0, '=IMAGE("https://example.com/pixel.png")');
    wb.setInput(id, 2, 0, '=IMAGE("data:image/png;base64,AAAA")');
    const blocked = [];
    wb.addEventListener('change', (e) => { if (e.detail.type === 'external-blocked') blocked.push(1); });
    wb.setExternalAllowed(false);
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BLOCKED!' });
    expect(wb.getValue(id, 1, 0)).toEqual({ error: '#BLOCKED!' });
    expect(wb.getValue(id, 2, 0)).toMatchObject({ image: 'data:image/png;base64,AAAA' });
    expect(calls).toEqual([]);
    await tick();
    expect(blocked).toHaveLength(1);
    wb.setExternalAllowed(true);
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
    await tick(); await tick();
    expect(calls).toHaveLength(1);
    expect(wb.getValue(id, 0, 0)).toBe('fetched');
    expect(wb.getValue(id, 1, 0)).toMatchObject({ image: 'https://example.com/pixel.png' });
  });
});

describe('document trust', () => {
  let mock;
  beforeEach(() => { mock = installMockPuter(); localStorage.clear(); });
  afterEach(() => { delete globalThis.puter; });

  it('trusts documents made here and distrusts files opened from elsewhere until allowed', async () => {
    expect(Doc.blank().wb.externalAllowed).toBe(true);
    const bytes = await Doc.blank().toXlsxBlob();
    mock.fs.set('Desktop/shared.xlsx', { blob: bytes, size: bytes.size, modified: 1 });
    const opened = await Doc.fromPath('Desktop/shared.xlsx');
    expect(opened.wb.externalAllowed).toBe(false);
    opened.allowExternal();
    expect(opened.wb.externalAllowed).toBe(true);
    const again = await Doc.fromPath('Desktop/shared.xlsx');
    expect(again.wb.externalAllowed).toBe(true);
    const imported = await Doc.fromBrowserFile(new File([await bytes.arrayBuffer()], 'device.xlsx'));
    expect(imported.wb.externalAllowed).toBe(false);
    // The app's own folder is trusted; a subfolder or another folder is not.
    mock.fs.set('Spreadsheets/Mine.xlsx', { blob: bytes, size: bytes.size, modified: 1 });
    mock.fs.set('Spreadsheets/Inbox/theirs.xlsx', { blob: bytes, size: bytes.size, modified: 1 });
    expect((await Doc.fromPath('Spreadsheets/Mine.xlsx')).wb.externalAllowed).toBe(true);
    expect((await Doc.fromPath('Spreadsheets/Inbox/theirs.xlsx')).wb.externalAllowed).toBe(false);
  });

  it('keeps a document made here trusted once it has a file', async () => {
    const doc = Doc.blank();
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'x');
    await doc.save();
    const reopened = await Doc.fromPath(doc.path);
    expect(reopened.wb.externalAllowed).toBe(true);
  });
});

