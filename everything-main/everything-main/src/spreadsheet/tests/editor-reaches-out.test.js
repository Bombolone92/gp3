// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { REACHES_OUT, textReachesOut, formulaReachesOut } from '../src/core/reaches-out.js';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import { upperName } from '../src/core/formula/tokenizer.js';
import { Workbook } from '../src/core/workbook.js';

// The paste-time scan for formulas that reach outside the spreadsheet named
// TRANSLATE but not its GOOGLETRANSLATE alias, so a pasted =GOOGLETRANSLATE(...)
// went live in a trusted document without asking. The scan the editor pastes
// through is now the one shared with the document's open-time check.
const PROVIDERS = ['IMPORTDATA', 'IMPORTHTML', 'IMPORTXML', 'IMPORTRANGE', 'AI', 'TRANSLATE', 'DETECTLANGUAGE'];

describe('the reach-out scan', () => {
  it('catches every name the external providers are registered under', () => {
    const implementations = new Set(PROVIDERS.map((name) => FUNCTIONS[name]).filter(Boolean));
    const aliases = Object.keys(FUNCTIONS).filter((name) => implementations.has(FUNCTIONS[name]));
    expect(aliases).toEqual(expect.arrayContaining(['GOOGLETRANSLATE', 'TRANSLATE']));
    for (const name of aliases) {
      expect(REACHES_OUT.test(`=${name}(B1,"en","fr")`), name).toBe(true);
      expect(REACHES_OUT.test(`=1+${name.toLowerCase()} (A1)`), `${name} lower-case with a space`).toBe(true);
    }
  });

  it('leaves ordinary formulas and inline pictures alone', () => {
    for (const formula of ['=SUM(A1:A3)', '=TRANSLATED', '=MYTRANSLATE(A1)', '=IMAGE("data:image/png;base64,AA==")', '="TRANSLATE("']) {
      expect(REACHES_OUT.test(formula), formula).toBe(formula === '="TRANSLATE("'); // a quoted call still reads as a call; the scan errs on the side of asking
    }
    expect(REACHES_OUT.test('=IMAGE("https://example.com/a.png")')).toBe(true);
  });

  // The evaluator upper-cases a function name with the tokenizer's folding, so a dotless ı or a
  // long ſ resolves to IMPORTDATA or TRANSLATE; the scan matched only the ASCII spelling and let
  // =ımportdata(...) fetch without the question a paste or an opened file otherwise gets.
  it('catches a reaching function spelled with letters that fold to its name', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setExternalAllowed(false);
    const spellings = ['=ımportdata("https://example.com/a.csv")', '=ımage("https://example.com/a.png")', '=aı("x")', '=ımporthtml("https://example.com","table",1)', '=ımportrange("https://example.com/x","A1")', '=tranſlate(A1,"en","fr")', '=googletranſlate(A1,"en","fr")'];
    spellings.forEach((text, r) => {
      wb.setInput(id, r, 0, text);
      expect(wb.getValue(id, r, 0), text).toMatchObject({ error: '#BLOCKED!' }); // the evaluator does resolve it
      expect(textReachesOut(text), text).toBe(true);
      expect(formulaReachesOut(wb.getCell(id, r, 0).f), text).toBe(true);
    });
    for (const name of PROVIDERS.concat('GOOGLETRANSLATE', 'IMAGE')) {
      const folded = name.toLowerCase().replace(/i/g, 'ı').replace(/s/g, 'ſ');
      expect(FUNCTIONS[upperName(folded)], folded).toBe(FUNCTIONS[name]);
      expect(formulaReachesOut(`${folded}(A1)`), folded).toBe(true);
    }
    // A letter with no single upper-case form is not folded by the evaluator either, so it does not match.
    expect(formulaReachesOut('ımportdataß(A1)')).toBe(false);
    expect(formulaReachesOut('größe(A1)')).toBe(false);
  });

  it('tells pasted text that is a formula from text that merely mentions one', () => {
    expect(textReachesOut('=GOOGLETRANSLATE(A1,"en","fr")')).toBe(true);
    expect(textReachesOut('  =IMPORTDATA("https://example.com/a.csv")')).toBe(true);
    expect(textReachesOut('GOOGLETRANSLATE(A1)')).toBe(false);
    expect(textReachesOut(42)).toBe(false);
    expect(formulaReachesOut('GOOGLETRANSLATE(A1)')).toBe(true);
    expect(formulaReachesOut(null)).toBe(false);
  });
});
