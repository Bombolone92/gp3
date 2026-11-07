import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REACHES_OUT, formulaReachesOut, textReachesOut } from '../src/core/reaches-out.js';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx } from '../src/core/io.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// The functions that reach outside the spreadsheet, and every other name they are registered under.
const REACHING = ['IMPORTDATA', 'IMPORTHTML', 'IMPORTXML', 'IMPORTRANGE', 'AI', 'TRANSLATE', 'DETECTLANGUAGE', 'IMAGE'];
const aliasesOf = (name) => Object.keys(FUNCTIONS).filter((other) => FUNCTIONS[other] === FUNCTIONS[name]);

// The open-time scan named TRANSLATE but not GOOGLETRANSLATE, which answers to the same function:
// a file whose only reaching formula was =GOOGLETRANSLATE(...) opened trusted, without the notice.
it('matches every name a reaching function is registered under', () => {
  expect(FUNCTIONS.GOOGLETRANSLATE).toBe(FUNCTIONS.TRANSLATE);
  for (const name of REACHING) {
    expect(FUNCTIONS[name], name).toBeDefined();
    for (const alias of aliasesOf(name)) {
      expect(formulaReachesOut(`${alias}(A1)`), alias).toBe(true);
      expect(formulaReachesOut(`IF(A1, ${alias.toLowerCase()} (A2), 0)`), alias).toBe(true);
      expect(textReachesOut(` =${alias}(A1)`), alias).toBe(true);
    }
  }
  expect(formulaReachesOut('SUM(A1:A9)')).toBe(false);
  expect(formulaReachesOut('MYAI(A1)')).toBe(false);
  expect(textReachesOut('AI(A1)')).toBe(false); // plain text, not a formula
});

it('lets an inline picture pass but not one fetched from the web', () => {
  expect(REACHES_OUT.test('IMAGE("data:image/png;base64,iVBORw0KGgo=")')).toBe(false);
  expect(REACHES_OUT.test('IMAGE( "data:image/png;base64,iVBORw0KGgo=")')).toBe(false);
  expect(REACHES_OUT.test('IMAGE("https://example.com/a.png")')).toBe(true);
  expect(REACHES_OUT.test('IMAGE(A1)')).toBe(true);
});

describe('the scan of a file being opened', () => {
  let mock;
  // SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
  beforeAll(async () => { await workbookToXlsx(new Workbook()); });
  beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); });
  afterEach(() => { delete globalThis.puter; });

  async function fileWith(formula) {
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, 'hello');
    wb.setInput(wb.activeSheetId, 1, 0, formula);
    const blob = await workbookToXlsx(wb);
    const path = `Spreadsheets/${Math.random().toString(36).slice(2)}.xlsx`;
    mock.fs.set(path, { blob, size: blob.size, modified: 1 });
    return path;
  }

  it('opens a file in the app folder untrusted when its only reaching formula uses an alias', async () => {
    expect((await Doc.fromPath(await fileWith('=GOOGLETRANSLATE(A1,"en","fr")'))).wb.externalAllowed).toBe(false);
    expect((await Doc.fromPath(await fileWith('=TRANSLATE(A1,"en","fr")'))).wb.externalAllowed).toBe(false);
  });

  it('opens a file untrusted when its reaching formula is spelled with a dotless ı the evaluator folds to I', async () => {
    const doc = await Doc.fromPath(await fileWith('=ımportdata("https://example.com/a.csv")'));
    expect(doc.wb.getCell(doc.wb.activeSheetId, 1, 0).f).toMatch(/^ımportdata/);
    expect(doc.wb.externalAllowed).toBe(false);
  });

  it('opens a file whose pictures are inline trusted, and one that fetches them untrusted', async () => {
    expect((await Doc.fromPath(await fileWith('=IMAGE("data:image/png;base64,iVBORw0KGgo=")'))).wb.externalAllowed).toBe(true);
    expect((await Doc.fromPath(await fileWith('=IMAGE("https://example.com/a.png")'))).wb.externalAllowed).toBe(false);
  });
});
