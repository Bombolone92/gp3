import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, saveDraft } from '../src/lib/drafts.js';
import { listVersions, readVersion, RESTORE_LABEL } from '../src/lib/versions.js';
import { workbookFromFile } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const cellA1 = (wb) => wb.getValue(wb.activeSheetId, 0, 0);
function book(value) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, value);
  return wb;
}

/** A file saved here (v1) with a draft of edits made on it that never reached Puter; then, when `elsewhere` is set, v2 written from another device. */
async function fileWithDraft({ elsewhere }) {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'v1');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  const path = doc.path;
  expect(saveDraft(draftKey(path), book('draft on v1'), 'Budget', 'rev-draft', { fileModified: doc.remoteModified, fileUid: doc.uid })).toBe(true);
  doc.destroy();
  await vi.advanceTimersByTimeAsync(2000);
  if (elsewhere) {
    const v2 = await new Doc({ wb: book('v2 from elsewhere') }).toXlsxBlob();
    mock.fs.set(path, { blob: v2, size: v2.size, modified: doc.remoteModified / 1000 + 60, uid: doc.uid });
  }
  return path;
}

const snapshotText = async (v) => cellA1(await workbookFromFile(await readVersion(v.path), 'v.xlsx'));

// Restoring a draft made on an earlier revision replaced the file's newer content and cleared the undo
// history; the next autosave wrote the older edits over the file, and nothing held what the file had.
it('keeps the file\'s newer content as a version before an older draft replaces it, as a version restore does', async () => {
  const path = await fileWithDraft({ elsewhere: true });
  const doc = await Doc.fromPath(path);
  try {
    expect(cellA1(doc.wb)).toBe('v2 from elsewhere');
    expect(doc.recoverableMayBeOlder).toBe(true);
    expect(doc.restoreDraft()).toBe(true);
    expect(cellA1(doc.wb)).toBe('draft on v1');
    await vi.advanceTimersByTimeAsync(3000);
    expect(doc.status).toBe('saved');
    const versions = await listVersions(doc.file);
    const kept = versions.filter((v) => v.label === RESTORE_LABEL);
    expect(kept).toHaveLength(1);
    expect(await snapshotText(kept[0])).toBe('v2 from elsewhere');
    const reopened = await Doc.fromPath(path);
    try { expect(cellA1(reopened.wb)).toBe('draft on v1'); } finally { reopened.destroy(); }
  } finally { doc.destroy(); }
});

it('takes no such snapshot when the draft was made on the file as it is', async () => {
  const path = await fileWithDraft({ elsewhere: false });
  const doc = await Doc.fromPath(path);
  try {
    expect(doc.recoverableMayBeOlder).toBe(false);
    expect(doc.restoreDraft()).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await listVersions(doc.file)).filter((v) => v.label === RESTORE_LABEL)).toEqual([]);
  } finally { doc.destroy(); }
});
