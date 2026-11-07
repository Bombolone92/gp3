import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Every LET or LAMBDA formula, every aggregate over an array function (SUM(FILTER(...)),
// COUNTA(UNIQUE(...)), SUM(SEQUENCE(...))), a lazy IF or CHOOSE with a range branch under an
// aggregate, OFFSET over one cell and INDEX with a computed index were taken for possible spills,
// so after every edit the whole column of them was evaluated again to find out where the spills
// lie: a keystroke in a 20,000-row model that uses LET cost a tenth of a second and grew with the
// sheet. What stands under a consumer cannot spill, and a LET is judged by what its result names.

/** How many formula evaluations a read costs (each evaluation builds one context). */
function evaluations(wb, read) {
  const original = wb._context;
  let n = 0;
  wb._context = function (...args) { n++; return original.apply(this, args); };
  try { read(); } finally { wb._context = original; }
  return n;
}

const ROWS = 20000;

function column(formula, rows = ROWS) {
  const cells = {};
  for (let r = 0; r < rows; r++) { cells[`${r},0`] = { v: r + 1 }; cells[`${r},1`] = { f: formula(r + 1) }; }
  for (let r = 0; r < 5; r++) { cells[`${r},3`] = { v: r + 1 }; cells[`${r},4`] = { v: (r + 1) * 10 }; }
  const wb = new Workbook({ sheets: [{ name: 'S', rows, cols: 8, cells }] });
  return { wb, id: wb.activeSheetId };
}

describe('a column of one-value formulas built from array functions, LET or LAMBDA', () => {
  it.each([
    ['LET over one cell', (r) => `LET(x,A${r},x*2)`, 2],
    ['SUM(FILTER(...))', (r) => `SUM(FILTER($D$1:$D$5,$D$1:$D$5>A${r}))`, 14],
    ['SUM(SEQUENCE(...))', (r) => `SUM(SEQUENCE(A${r}+1))`, 3],
    ['OFFSET over one cell', () => 'OFFSET($A$1,ROW()-1,0)*2', 2],
    ['INDEX with ROW()', () => 'INDEX($A:$A,ROW())', 1],
    ['a LAMBDA called on the spot', (r) => `LAMBDA(x,x*2)(A${r})`, 2],
    ['INDIRECT of a literal address', () => 'INDIRECT("D1")*2', 2],
    ['SUM(IF(range,...))', (r) => `SUM(IF($D$1:$D$5>A${r},1,0))`, 4],
    ['COUNTA(UNIQUE(...))', (r) => `COUNTA(UNIQUE($D$1:$D$5))+A${r}`, 6],
    ['SUM(CHOOSE(1,range,range))', (r) => `SUM(CHOOSE(1,$D$1:$D$5,$E$1:$E$5))+A${r}`, 16],
    ['INDEX(SORT(...),1,1)', (r) => `INDEX(SORT($D$1:$E$5),1,1)+A${r}`, 2],
    ['a LET whose local feeds an aggregate', (r) => `SUM(LET(rng,$D$1:$D$5,rng)*A${r})`, 15],
  ])('is not evaluated sheet-wide after an unrelated edit: %s', { timeout: 60000 }, (_, formula, first) => {
    const { wb, id } = column(formula);
    expect(wb.getValue(id, 0, 1)).toBe(first);
    wb.setInput(id, 100, 0, '1000');
    // A screen of sixty rows and one blank cell cost those sixty evaluations, nothing proportional to the sheet.
    const n = evaluations(wb, () => { for (let r = 0; r < 60; r++) wb.getValue(id, r, 1); wb.getValue(id, ROWS - 1, 5); });
    expect(n).toBeLessThanOrEqual(60);
    expect(wb.getValue(id, ROWS - 1, 1)).not.toBeNull();
  });
});

describe('the array-candidate verdict', () => {
  const wb = new Workbook();
  const s = wb.sheet(wb.activeSheetId).name;
  const judge = (f) => wb._isArrayCandidate(wb._ast(f), s);

  it.each([
    'SUM(SEQUENCE(3))', 'COUNTA(UNIQUE(A:A))', 'SUM(IF(A1:A3>1,1,0))', 'MAX(FILTER(A:A,B:B>0))', 'IFERROR(SUM(FILTER(A:A,B:B>0)),0)',
    'SUM(OFFSET(A1,0,0,3))', 'SUM(INDIRECT("A1:A3"))', 'SUM(CHOOSE(1,A1:A3,B1:B3))', 'INDEX(SORT(A1:B3),1,1)', 'SUM(MAP(A1:A3,LAMBDA(x,x)))',
    'TEXTJOIN(",",1,SORT(A1:A3))&B1', 'SUM(ROW(A1:A3))', 'SUM(LAMBDA(x,x*2)(A1:A3))', 'SUM(Seq(3))',
    'LET(x,1,x)', 'LET(x,A1,x*2)', 'LET(x,A1:A3,SUM(x))', 'LET(x,A1:A3,y,SUM(x),y*2)', 'LET(f,LAMBDA(x,x*2),f(A1))', 'LET(f,LAMBDA(x,SUM(x)),f(A1:A3))',
    // A parameter written [x] may be left out; it binds the same name, and the body decides as it
    // does for a plain one, so this answers the one value LAMBDA(x,x*2)(A1) beside it answers.
    'LAMBDA(x,x*2)(A1)', 'LAMBDA(x,x*2)', 'LAMBDA(x,y,x+y)(A1,2)', 'LAMBDA([x],x*2)(A1)',
    'OFFSET(A1,1,0)', 'OFFSET(A1,ROW()-1,0,1,1)', 'OFFSET(Sheet1!$A$1,2,0)', 'INDIRECT("A1")', 'INDIRECT("Sheet1!$B$2")', 'INDIRECT("A1",TRUE)',
    'INDEX(A:A,ROW())', 'INDEX(A:A,COUNTA(A:A)+1)', 'INDEX(A:A,ROWS(A1:A3))', 'INDEX(A1:C3,ROW()*2,COLUMN())', 'INDEX(A:A,MATCH(B1,C:C,0))',
    'REDUCE(0,A1:A3,LAMBDA(a,x,a+x))',
  ])('is false for the one-value formula %s', (f) => {
    expect(judge(f)).toBe(false);
  });

  it.each([
    'SEQUENCE(3)', 'LET(x,A1:A3,x*2)', 'FILTER(A:A,B:B>0)', 'A1:A3*2', 'UNIQUE(A1:A3)', 'IF(A1>1,A1:A3,0)', 'CHOOSE(1,A1:A3,B1:B3)',
    'LET(x,A1:A3,y,x*2,y)', 'LET(x,SEQUENCE(3),x)', 'LET(f,LAMBDA(x,x*2),f(A1:A3))', 'LET(f,LAMBDA(x,SEQUENCE(x)),f(3))', 'LAMBDA(x,x*2)(A1:A3)',
    'LAMBDA(x,SEQUENCE(x))(3)', 'LAMBDA([x],x*2)(A1:A3)', 'LAMBDA([x],SEQUENCE(3))(A1)', 'Double(A1:A3)', 'Seq(3)',
    'OFFSET(A1,1,0,3)', 'OFFSET(A1:A3,1,0)', 'OFFSET(A1,{1;2},0)', 'OFFSET(A1,A1:A3,0)', 'OFFSET(A1,1,0,B1)', 'INDIRECT("A1:A3")', 'INDIRECT("A"&ROW())',
    'INDIRECT("Rng")', 'INDIRECT("A1#")', 'INDIRECT("R1C1",FALSE)', 'INDEX(A:A,ROW()-1)', 'INDEX(A:A,COUNTA(A:A))', 'INDEX(A1:C3,0,1)', 'INDEX(A:A,ROW(A1:A3))',
    'INDEX(A:A,MATCH(B1:B3,C:C,0))', 'INDEX(A:A,LEN(B1))', 'REDUCE("",A1:A3,LAMBDA(acc,x,VSTACK(acc,x)))', 'SUM(A1:A3)+SEQUENCE(2)',
  ])('is true for the formula that can spill %s', (f) => {
    expect(judge(f)).toBe(true);
  });

  it('follows a bare name read through a LET local', () => {
    const book = new Workbook();
    const id = book.activeSheetId;
    const name = book.sheet(id).name;
    [1, 2, 3].forEach((v, r) => book.setInput(id, r, 0, String(v)));
    expect(book.defineName('Rng', `${name}!$A$1:$A$3`)).toBeNull();
    expect(book.defineName('Tax', '0.5')).toBeNull();
    const candidate = (f) => book._isArrayCandidate(book._ast(f), name);
    expect(candidate('LET(x,Rng,x*2)')).toBe(true);
    expect(candidate('LET(x,Rng,SUM(x))')).toBe(false);
    expect(candidate('LET(x,Tax,x*2)')).toBe(false);
    book.setInput(id, 0, 2, '=LET(x,Rng,x*10)');
    expect(book.getValue(id, 2, 2)).toBe(30);
  });
});

describe('genuine spills still land during discovery', () => {
  it('spills SEQUENCE, a LET over a range, FILTER, range arithmetic and a LAMBDA called on a range', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    [1, 0, 3].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
    wb.setInput(id, 0, 2, '=SEQUENCE(3)');
    wb.setInput(id, 0, 3, '=LET(x,A1:A3,x*2)');
    wb.setInput(id, 0, 4, '=FILTER(A1:A3,A1:A3>0)');
    wb.setInput(id, 0, 5, '=A1:A3*2');
    wb.setInput(id, 0, 6, '=LAMBDA(x,x*2)(A1:A3)');
    wb.setInput(id, 0, 7, '=LET(f,LAMBDA(x,x+1),f(A1:A3))');
    wb.setInput(id, 0, 8, '=OFFSET(A1,0,0,3)');
    wb.setInput(id, 0, 9, '=REDUCE("",A1:A3,LAMBDA(acc,x,VSTACK(acc,x*2)))');
    // A blank cell below the spills is read first: discovery must have settled every one of them.
    expect(wb.getValue(id, 2, 2)).toBe(3);
    expect(wb.getValue(id, 2, 3)).toBe(6);
    expect(wb.getValue(id, 1, 4)).toBe(3);
    expect(wb.getValue(id, 2, 5)).toBe(6);
    expect(wb.getValue(id, 2, 6)).toBe(6);
    expect(wb.getValue(id, 2, 7)).toBe(4);
    expect(wb.getValue(id, 2, 8)).toBe(3);
    expect(wb.getValue(id, 3, 9)).toBe(6);
    expect(wb.getValue(id, 0, 9)).toBe('');
    wb.setInput(id, 1, 0, '5');
    expect(wb.getValue(id, 2, 3)).toBe(6);
    expect(wb.getValue(id, 2, 4)).toBe(3);
    expect(wb.getValue(id, 1, 7)).toBe(6);
  });

  it('keeps a one-value LET, LAMBDA and INDEX lazy, while a spill of theirs is still shown', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    [1, 2, 3].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
    wb.setInput(id, 0, 2, '=LET(x,A1,x*2)');
    wb.setInput(id, 1, 2, '=LAMBDA(x,x*2)(A2)');
    wb.setInput(id, 2, 2, '=INDEX($A:$A,ROW())');
    wb.setInput(id, 0, 3, '=INDEX(A1:A3,0,1)');
    expect(wb.rangeValues(id, { r1: 0, c1: 2, r2: 2, c2: 3 })).toEqual([[2, 1], [4, 2], [3, 3]]);
    // Reading a blank cell settles only the spill; the one-value formulas are not calculated for it.
    wb.setInput(id, 9, 9, 'x');
    expect(evaluations(wb, () => wb.getValue(id, 5, 5))).toBe(1);
  });
});
