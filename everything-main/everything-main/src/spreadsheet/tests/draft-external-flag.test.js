import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { installMockPuter } from './helpers/mock-puter.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { loadDraft } from '../src/lib/drafts.js';

Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

// An import from the device has its outside content (IMPORT* formulas, web
// images, AI prompts) blocked until the user allows it. Its local draft used
// to come back trusted, so closing the tab before the first cloud save and
// recovering the sheet let that content load without anyone agreeing.
describe('outside-content permission in local drafts', () => {
  beforeEach(() => { installMockPuter(); localStorage.clear(); });
  afterEach(() => { delete globalThis.puter; });

  it('recovers an import from elsewhere with its content still blocked', async () => {
    const bytes = await Doc.blank().toXlsxBlob();
    const imported = await Doc.fromBrowserFile(new File([await bytes.arrayBuffer()], 'device.xlsx'));
    expect(imported.wb.externalAllowed).toBe(false);
    expect(imported.writeDraft()).toBe(true);
    expect(loadDraft(imported.draftKey).external).toBe(false);
    const recovered = Doc.fromDraft(imported.draftKey);
    expect(recovered.wb.externalAllowed).toBe(false);
  });

  it('recovers a sheet made here, or one the user allowed, trusted', async () => {
    const own = Doc.blank();
    own.wb.setInput(own.wb.activeSheetId, 0, 0, 'mine');
    own.writeDraft();
    expect(Doc.fromDraft(own.draftKey).wb.externalAllowed).toBe(true);

    const bytes = await Doc.blank().toXlsxBlob();
    const imported = await Doc.fromBrowserFile(new File([await bytes.arrayBuffer()], 'device.xlsx'));
    imported.allowExternal();
    imported.writeDraft();
    expect(Doc.fromDraft(imported.draftKey).wb.externalAllowed).toBe(true);
  });

  it('treats a draft written before the flag existed as trusted', () => {
    const own = Doc.blank();
    own.wb.setInput(own.wb.activeSheetId, 0, 0, 'old');
    own.writeDraft();
    const raw = JSON.parse(localStorage.getItem(own.draftKey));
    delete raw.external;
    localStorage.setItem(own.draftKey, JSON.stringify(raw));
    expect(Doc.fromDraft(own.draftKey).wb.externalAllowed).toBe(true);
  });
});
