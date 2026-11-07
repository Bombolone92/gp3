import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc, UNTITLED } from '../src/lib/doc.js';
import { sanitizeName, ensureXlsx } from '../src/lib/puter.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

// A name made of a zero-width space (pasted, or what is left once the visible characters of a name are
// deleted) saved as an invisible file with a blank title and row, and a bidi override in a name showed
// the rest of the row reversed: only ASCII controls and ordinary spaces were stripped.
it('leaves nothing of a name with nothing visible in it, so it falls back to Untitled', () => {
  expect(sanitizeName('​')).toBe('');
  expect(sanitizeName('​‌‍﻿⁠')).toBe('');
  expect(sanitizeName('  ​ ')).toBe('');
  expect(sanitizeName('‮')).toBe('');
  expect(sanitizeName('...​')).toBe('');
  expect(ensureXlsx(sanitizeName('​') || UNTITLED)).toBe('Untitled spreadsheet.xlsx');
});

it('strips bidi controls, zero-width spaces and C1 controls from a name, and joiners only at its ends', () => {
  expect(sanitizeName('budget‮')).toBe('budget');
  expect(sanitizeName('‪txt.xlsx‬')).toBe('txt.xlsx');
  expect(sanitizeName('⁦Q3⁩ plan')).toBe('Q3 plan');
  expect(sanitizeName('Bud​get')).toBe('Budget');
  expect(sanitizeName('﻿Report')).toBe('Report');
  expect(sanitizeName('abc')).toBe('abc');
  expect(sanitizeName('‍budget‌')).toBe('budget');
  expect(sanitizeName('budget​.')).toBe('budget');
});

it('keeps the joiners that shape words and emoji sequences', () => {
  expect(sanitizeName('می‌خواهم')).toBe('می‌خواهم');
  expect(sanitizeName('Family 👨‍👩‍👧 budget')).toBe('Family 👨‍👩‍👧 budget');
  const england = '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
  expect(sanitizeName(`${england} sales`)).toBe(`${england} sales`);
  expect(sanitizeName('Übersicht 合計')).toBe('Übersicht 合計');
});

it('saves a spreadsheet named with nothing visible as Untitled, and refuses such a rename', async () => {
  const doc = new Doc({ name: '​' });
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'x');
  try {
    expect(await doc.save()).toBe(true);
    expect(doc.path).toBe('Spreadsheets/Untitled spreadsheet.xlsx');
    expect(doc.name).toBe(UNTITLED);
    expect(await doc.rename('‮')).toBe('Enter a name');
    expect(await doc.rename('budget‮')).toBeNull();
    expect(doc.path).toBe('Spreadsheets/budget.xlsx');
  } finally { doc.destroy(); }
});
