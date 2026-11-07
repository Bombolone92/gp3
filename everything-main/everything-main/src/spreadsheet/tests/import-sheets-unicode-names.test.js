import { expect, it } from 'vitest';
import { Workbook, safeSheetName } from '../src/core/workbook.js';

const NFC = 'Café';
const NFD = 'Café'.normalize('NFD'); // the same letters as a macOS file name spells them

// Two spellings of one name are one sheet to sheetByName, so an import must number the newcomer as it
// numbers a case-only respelling; matching lower-case text alone let two "Café" tabs into the book, the
// second of which no formula could reach by name.
it('numbers an imported sheet whose name repeats an existing one in another Unicode composition', () => {
  const wb = new Workbook();
  wb.renameSheet(wb.activeSheetId, NFC);
  const source = new Workbook({ sheets: [{ name: NFD, cells: { '0,0': { v: 5 }, '1,0': { f: `'${NFD}'!A1*2` } } }] });
  const [added] = wb.importSheets(source);
  expect(wb.sheets.map((s) => s.name.normalize('NFC'))).toEqual(['Café', 'Café (2)']);
  expect(wb.sheetByName(NFD)).toBe(wb.sheets[0]);
  expect(wb.validateSheetName(NFD, added.id)).toBeTruthy(); // the newcomer cannot take the twin's name back
  // The imported sheet's own references followed its new name.
  expect(wb.getCell(added.id, 1, 0).f.normalize('NFC')).toBe("'Café (2)'!A1*2");
  expect(wb.getValue(added.id, 1, 0)).toBe(10);
});

it('keeps two incoming sheets apart whose names differ only in composition', () => {
  const wb = new Workbook();
  const added = wb.importSheets(new Workbook({ sheets: [{ name: NFC }, { name: NFD }] }));
  expect(added.map((s) => s.name.normalize('NFC'))).toEqual(['Café', 'Café (2)']);
});

it('safeSheetName, which the file reader uses, numbers a name taken in the other composition', () => {
  expect(safeSheetName(NFD, [NFC]).normalize('NFC')).toBe('Café 2');
  expect(safeSheetName(NFC, [NFD, 'Café 2'.normalize('NFD')]).normalize('NFC')).toBe('Café 3');
  expect(safeSheetName('Plain', ['plain'])).toBe('Plain 2');
});
