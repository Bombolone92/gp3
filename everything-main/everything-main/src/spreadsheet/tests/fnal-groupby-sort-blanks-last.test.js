import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// GROUPBY and PIVOTBY sorted by a summary read an empty summary (a pivot cell with no rows, a lambda's
// "") as the text "", which ranks above every number, so a descending order led with the groups that
// had nothing. SORT and SORTBY put blanks and errors last whichever the direction; the group sorts
// now do the same.
describe('GROUPBY and PIVOTBY sorted by a summary with empty cells', () => {
  const join = (formula) => calc(`TEXTJOIN("|",FALSE,${formula})`);
  const keys = (formula) => [1, 2, 3].map((r) => calc(`INDEX(${formula},${r},1)`));

  it('puts pivot rows with no value in the sort column last, descending as well as ascending', () => {
    expect(join('PIVOTBY({"a";"b";"c"},{"x";"y";"y"},{1;5;3},SUM,0,1,-3)')).toBe('|x|y|Total|b||5|5|c||3|3|a|1||1|Total|1|8|9');
    expect(join('PIVOTBY({"a";"b";"c"},{"x";"y";"y"},{1;5;3},SUM,0,1,3)')).toBe('|x|y|Total|c||3|3|b||5|5|a|1||1|Total|1|8|9');
    // Two empty groups keep their key order between them.
    expect(join('PIVOTBY({"a";"b";"c"},{"x";"y";"x"},{1;5;3},SUM,0,1,-3)')).toBe('|x|y|Total|b||5|5|a|1||1|c|3||3|Total|4|5|9');
  });

  it('puts pivot columns with no value in the sort row last', () => {
    expect(join('PIVOTBY({"a";"b";"c"},{"x";"y";"x"},{1;5;3},SUM,0,1,0,1,-2)')).toBe('|x|y|Total|a|1||1|b||5|5|c|3||3|Total|4|5|9');
    expect(join('PIVOTBY({"a";"b";"c"},{"x";"y";"x"},{1;5;3},SUM,0,1,0,1,2)')).toBe('|x|y|Total|a|1||1|b||5|5|c|3||3|Total|4|5|9');
  });

  it('puts groups whose summary is empty text or an error last in GROUPBY', () => {
    const blank = 'GROUPBY({"a";"b";"c"},{1;5;3},LAMBDA(x,IF(SUM(x)>2,SUM(x),"")),0,1,-2)';
    expect(join(blank)).toBe('b|5|c|3|a||Total|9');
    expect(join(blank.replace('-2)', '2)'))).toBe('c|3|b|5|a||Total|9');
    const error = 'GROUPBY({"a";"b";"c"},{1;5;3},LAMBDA(x,IF(SUM(x)>2,SUM(x),NA())),0,0,-2)';
    expect(keys(error)).toEqual(['b', 'c', 'a']);
    expect(keys(error.replace('-2)', '2)'))).toEqual(['c', 'b', 'a']);
  });

  it('still sorts full summaries in either direction', () => {
    expect(join('GROUPBY({"a";"b";"c"},{1;5;3},SUM,0,0,-2)')).toBe('b|5|c|3|a|1');
    expect(join('GROUPBY({"a";"b";"c"},{1;5;3},SUM,0,0,2)')).toBe('a|1|c|3|b|5');
  });
});
