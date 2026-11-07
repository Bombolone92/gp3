// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { openVersionHistory } from '../src/ui/versions.js';
import { closeAllModals } from '../src/ui/modal.js';
import { Doc } from '../src/lib/doc.js';
import { listVersions } from '../src/lib/versions.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// jsdom's Blob has no arrayBuffer(); reading a file back needs one.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(this); });
  };
}

// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  installMockPuter();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete globalThis.puter; document.body.replaceChildren(); });

const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const press = (label) => {
  const panel = [...document.querySelectorAll('.modal-root:not(.closing) .modal-panel')].at(-1);
  [...panel.querySelectorAll('button')].find((node) => node.textContent === label).click();
};

// Deleting a snapshot never told the document, which went on counting it as its newest: every save
// for the next ten minutes skipped its automatic snapshot, so the history stayed empty after a cleanup.
it('takes an automatic snapshot again once the newest one is deleted from the history', async () => {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'first');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  await doc._versioning;
  expect(await listVersions(doc.file)).toHaveLength(1);

  const { panel } = openVersionHistory(doc);
  await settle();
  panel.querySelector('.version-list [title="Delete"]').click();
  await settle();
  press('Delete');
  await settle();
  expect(await listVersions(doc.file)).toEqual([]);
  expect(panel.querySelector('.version-empty').textContent).toContain('No versions yet');
  closeAllModals();

  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'second');
  expect(await doc.save()).toBe(true);
  await doc._versioning;
  expect(await listVersions(doc.file)).toHaveLength(1);
  doc.destroy();
});
