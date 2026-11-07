import { afterEach, beforeEach, expect, it } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { listVersions } from '../src/lib/versions.js';
import { installMockPuter } from './helpers/mock-puter.js';

beforeEach(() => { installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

// The automatic snapshot after a save ran on its own, outside the write queue. A rename that
// followed at once moved the (still empty) history first, and the snapshot then landed under
// the old name, where the next document of that name inherited it.
it('lands the snapshot of a save under the new name when a rename follows at once', async () => {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'x');
  // Hold the snapshot's write until after the rename has been asked for.
  const write = puter.fs.write.bind(puter.fs);
  let release;
  const held = new Promise((r) => { release = r; });
  puter.fs.write = async (p, ...rest) => { if (p.includes('/.versions/')) await held; return write(p, ...rest); };
  expect(await doc.save()).toBe(true);
  const renamed = doc.rename('Plan');
  setTimeout(release, 20);
  expect(await renamed).toBeNull();
  expect(doc.path).toBe('Spreadsheets/Plan.xlsx');
  expect(await listVersions(doc.file)).toHaveLength(1);
  expect(await listVersions('Spreadsheets/Budget.xlsx')).toEqual([]); // nothing left under the old name
  doc.destroy();
});

it('renames without waiting when no snapshot is in flight', async () => {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  await puter.fs.write('Spreadsheets/Budget.xlsx', new Blob(['x']));
  expect(await doc.rename('Plan')).toBeNull();
  expect(doc.path).toBe('Spreadsheets/Plan.xlsx');
  doc.destroy();
});
