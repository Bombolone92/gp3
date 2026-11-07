import { expect, it } from 'vitest';
import { rememberRecent, recentFiles } from '../src/lib/recent.js';
import { memoryStorage } from './helpers/memory-storage.js';

// Opens inside the app folder filled the eight-entry list and pushed out the drive files
// the list exists to remember.
it('keeps files opened from elsewhere on the drive, however many app-folder files are opened', () => {
  const storage = memoryStorage();
  rememberRecent('/nj/Desktop/report.xlsx', 'report.xlsx', storage);
  for (let i = 0; i < 12; i++) rememberRecent(`Spreadsheets/Budget ${i}.xlsx`, `Budget ${i}.xlsx`, storage);
  expect(recentFiles(storage).map((r) => r.path)).toEqual(['/nj/Desktop/report.xlsx']);
  rememberRecent('Spreadsheets/Archive/Old.xlsx', 'Old.xlsx', storage); // a subfolder counts as elsewhere
  expect(recentFiles(storage).map((r) => r.path)).toEqual(['Spreadsheets/Archive/Old.xlsx', '/nj/Desktop/report.xlsx']);
});
