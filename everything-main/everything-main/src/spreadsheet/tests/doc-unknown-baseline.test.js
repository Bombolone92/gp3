import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { installMockPuter } from './helpers/mock-puter.js';

beforeEach(() => { installMockPuter(); });
afterEach(() => { delete globalThis.puter; vi.restoreAllMocks(); });

// When the opening look-up failed the first save asks before overwriting, but it used to claim
// that another copy had been saved, which nobody could confirm.
it('says the file could not be checked rather than that it changed elsewhere', async () => {
  await puter.fs.write('Spreadsheets/Plan.xlsx', new Blob(['x']));
  const stat = puter.fs.stat.bind(puter.fs);
  let fail = true;
  puter.fs.stat = async (p) => { if (fail) { fail = false; throw new Error('Network request failed'); } return stat(p); };
  const doc = await Doc.fromPath('Spreadsheets/Plan.xlsx');
  // The file is written elsewhere meanwhile: reading it back cannot confirm the bytes just opened (which would let the save through).
  await puter.fs.write('Spreadsheets/Plan.xlsx', new Blob(['xy']));
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edit');
  const events = [];
  doc.addEventListener('conflict', (e) => events.push(e.detail.kind));
  expect(await doc.save()).toBe(false);
  expect(doc.status).toBe('conflict');
  expect(doc.error).toMatch(/could not be checked/);
  expect(doc.error).not.toMatch(/changed elsewhere/);
  // The view is told the same, so that its dialog does not claim a change either.
  expect(events).toEqual(['unchecked']);
});
