import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { formulaReachesOut, textReachesOut } from '../src/core/reaches-out.js';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import { Workbook } from '../src/core/workbook.js';
import { Doc } from '../src/lib/doc.js';
import { workbookToXlsx } from '../src/core/io.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// The evaluator hands a function named without parentheses on as the function itself, so
// MAP(A1, IMPORTDATA), LET(f, IMPORTDATA, f(A1)) and a defined name Fetch = IMPORTDATA all fetch;
// the scan that decides whether a file or a paste asks first looked only for IMPORTDATA( and let
// every one of them run unasked in a trusted document. It now reads the formula as the evaluator does.
const PROVIDERS = ['IMPORTDATA', 'IMPORTHTML', 'IMPORTXML', 'IMPORTRANGE', 'AI', 'TRANSLATE', 'DETECTLANGUAGE'];
const implementations = new Set(PROVIDERS.map((name) => FUNCTIONS[name]));
const REACHING = [...Object.keys(FUNCTIONS).filter((name) => implementations.has(FUNCTIONS[name])), 'IMAGE'];
const fold = (name) => name.toLowerCase().replace(/i/g, 'ı').replace(/s/g, 'ſ');

describe('a reaching function passed or bound by its bare name', () => {
  it('is caught under every name, in every shape the evaluator accepts', () => {
    expect(REACHING).toEqual(expect.arrayContaining(['GOOGLETRANSLATE', 'TRANSLATE', 'AI', 'IMAGE']));
    for (const name of REACHING) {
      const shapes = [
        `LET(f, ${name}, f(A1))`, `MAP(A1, ${name})`, `BYROW(A1:A3, ${name})`, `REDUCE(0, A1:A3, ${name})`,
        `(${name})(A1)`, `IF(A1, ${name.toLowerCase()}, SUM)`, `LET(f, ${fold(name)}, f(A1))`, `{${name}}`,
        `SUM(A1:A3) + ${name}`, `-${name}`, `LAMBDA(x, ${name})(A1)(A2)`,
        name, // a defined name's whole definition
      ];
      for (const shape of shapes) {
        expect(formulaReachesOut(shape), shape).toBe(true);
        expect(textReachesOut(`= ${shape}`), shape).toBe(true);
      }
    }
  });

  it('is what the evaluator runs, and what the gate blocks once trust is off', () => {
    const wb = new Workbook({ sheets: [{ name: 'Sheet1' }], names: [{ name: 'Fetch', ref: 'IMPORTDATA' }] });
    const id = wb.activeSheetId;
    const calls = [];
    for (const name of ['IMPORTDATA', 'IMPORTRANGE', 'AI']) wb.setAsyncProvider(name, async (text) => { calls.push(text); return 'answer'; });
    wb.setInput(id, 0, 0, 'https://example.com/a.csv');
    const formulas = ['=LET(f, IMPORTDATA, f(A1))', '=LET(f, IMPORTRANGE, f(A1, "Sheet1!A1"))', '=LET(g, AI, g("hi"))', '=MAP(A1, IMAGE)', '=Fetch(A1)'];
    formulas.forEach((f, i) => wb.setInput(id, i + 1, 0, f));
    formulas.forEach((f, i) => expect(wb.getValue(id, i + 1, 0), f).not.toEqual({ error: '#NAME?' }));
    expect(wb.getValue(id, 4, 0)).toMatchObject({ image: 'https://example.com/a.csv' });
    wb.setExternalAllowed(false);
    formulas.forEach((f, i) => expect(wb.getValue(id, i + 1, 0), f).toEqual({ error: '#BLOCKED!' }));
    expect(formulaReachesOut(wb.names[0].ref)).toBe(true);
  });

  it('leaves columns, other names, plain text, string literals and inline pictures as they were', () => {
    for (const formula of ['SUM($AI$1:$AI$9)', 'AI1+AI2', 'Sheet1!AI1', 'TRANSLATED', 'MYTRANSLATE(A1)', 'AIM(A1)', 'AI.RATE*2', '"IMPORTDATA"',
      'IMAGE("data:image/png;base64,AA==")', 'IMAGE( "DATA:image/png;base64,AA==")', 'IMAGE("data:"&A1)']) {
      expect(formulaReachesOut(formula), formula).toBe(false);
    }
    // A bare reaching name in text the scan cannot read asks (an entry may be closed before it runs); a dropdown's
    // literal list never reaches the scan (usesExternalContent hands it only a list drawn from a range or formula).
    expect(formulaReachesOut('Yes, No, AI')).toBe(true);
    expect(formulaReachesOut('IMAGE("https://example.com/a.png")')).toBe(true);
    // Text is not a formula, however it reads; a formula spelling a call inside a string still asks, as before.
    expect(textReachesOut('AI')).toBe(false);
    expect(textReachesOut('IMPORTDATA')).toBe(false);
    expect(textReachesOut('=IMPORTDATA')).toBe(true);
    expect(formulaReachesOut('"IMPORTDATA("')).toBe(true);
    // Text too deep for the scan to read to the end asks when it names a reaching function, and not otherwise.
    expect(formulaReachesOut(`${'('.repeat(20000)}AI${')'.repeat(20000)}`)).toBe(true);
    expect(formulaReachesOut(`${'('.repeat(20000)}AI(A1)${')'.repeat(20000)}`)).toBe(true);
    expect(formulaReachesOut(`${'('.repeat(20000)}SUM(A1)${')'.repeat(20000)}`)).toBe(false);
  });
});

describe('the scan of a file being opened', () => {
  let mock;
  // SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
  beforeAll(async () => { await workbookToXlsx(new Workbook()); });
  beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); });
  afterEach(() => { delete globalThis.puter; });

  async function fileWith(formula, names = []) {
    const wb = new Workbook({ sheets: [{ name: 'Sheet1' }], names });
    wb.setInput(wb.activeSheetId, 0, 0, 'https://example.com/a.csv');
    wb.setInput(wb.activeSheetId, 1, 0, formula);
    const blob = await workbookToXlsx(wb);
    const path = `Spreadsheets/${Math.random().toString(36).slice(2)}.xlsx`;
    mock.fs.set(path, { blob, size: blob.size, modified: 1 });
    return path;
  }

  it('opens a file in the app folder untrusted when a reaching function is passed by name or hides behind a defined name', async () => {
    expect((await Doc.fromPath(await fileWith('=LET(f, IMPORTDATA, f(A1))'))).wb.externalAllowed).toBe(false);
    expect((await Doc.fromPath(await fileWith('=MAP(A1, IMAGE)'))).wb.externalAllowed).toBe(false);
    const named = await Doc.fromPath(await fileWith('=Fetch(A1)', [{ name: 'Fetch', ref: 'IMPORTDATA' }]));
    expect(named.wb.names).toEqual([{ name: 'Fetch', ref: 'IMPORTDATA' }]);
    expect(named.wb.externalAllowed).toBe(false);
    expect(named.wb.getValue(named.wb.activeSheetId, 1, 0)).toEqual({ error: '#BLOCKED!' });
  });

  it('still opens a file trusted whose formulas only use column AI and ordinary names', async () => {
    expect((await Doc.fromPath(await fileWith('=SUM($AI$1:$AI$3)+Rate', [{ name: 'Rate', ref: '0.05' }]))).wb.externalAllowed).toBe(true);
  });
});
