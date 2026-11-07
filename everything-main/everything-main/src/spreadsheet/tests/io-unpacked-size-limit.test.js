import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

// A zip says what each of its parts unpacks to before any of it is unpacked. A worksheet part of
// a few tens of megabytes can unpack to hundreds, held unpacked and decoded at once, so a file
// from a drive or a mail attachment could exhaust the tab before any of this app's own limits
// were reached. The declared sizes are read from the directory first, and the file refused there.

async function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Amount');
  wb.setInput(id, 1, 0, '5');
  return new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
}

/** The same zip, with the first `parts` entries claiming to unpack to `size` bytes each. */
function claims(bytes, size, parts = 1) {
  const u8 = new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  expect(eocd).toBeGreaterThan(0);
  const count = view.getUint16(eocd + 10, true);
  expect(count).toBeGreaterThan(parts);
  let at = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    if (i < parts) view.setUint32(at + 24, size, true);
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return u8;
}

it('refuses a file one of whose parts claims to unpack past the limit, before unpacking any of it', async () => {
  const bytes = await book();
  await expect(workbookFromFile(claims(bytes, 300 * 1024 * 1024), 'bomb.xlsx')).rejects.toMatchObject({ code: 'too-large' });
  await expect(workbookFromFile(claims(bytes, 300 * 1024 * 1024), 'bomb.xlsx')).rejects.toThrow(/too large to open here/);
});

it('refuses a file whose parts together claim to unpack past the limit', async () => {
  const bytes = await book();
  await expect(workbookFromFile(claims(bytes, 200 * 1024 * 1024, 3), 'many.xlsx')).rejects.toMatchObject({ code: 'too-large' });
});

it('opens an ordinary file, and leaves text files alone', async () => {
  const back = await workbookFromFile(await book(), 'fine.xlsx');
  expect(back.getValue(back.activeSheetId, 1, 0)).toBe(5);
  const csv = await workbookFromFile(new TextEncoder().encode('a,b\n1,2\n'), 'fine.csv');
  expect(csv.getValue(csv.activeSheetId, 1, 0)).toBe(1);
});
