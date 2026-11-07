import { describe, expect, it } from 'vitest';
import { runQuery } from '../src/core/formula/query.js';

// Comparisons with an empty cell are false, but the literal '' was treated as an empty cell too,
// so `A <> ''` was never true.
describe("QUERY comparisons against the literal ''", () => {
  const data = [['a', 1], ['', 2], [null, 3], [4, 4]];
  const rows = (query) => runQuery(data, query, { headers: 0 }).values;

  it("picks the rows with a value with <> ''", () => {
    expect(rows("select B where A <> ''")).toEqual([[1], [4]]);
    expect(rows("select B where A != ''")).toEqual([[1], [4]]);
    expect(rows("select B where '' <> A")).toEqual([[1], [4]]);
  });

  it("matches no cell with = '' and keeps comparisons with empty cells false", () => {
    expect(rows("select B where A = ''")).toEqual([[null]]);
    expect(rows("select B where A = 'a'")).toEqual([[1]]);
    expect(rows("select B where A > ''")).toEqual([[1]]);
    // `not` of a comparison with an empty cell is true, as for `not B = 5` on an empty B.
    expect(rows("select B where not A = ''")).toEqual([[1], [2], [3], [4]]);
    expect(rows("select B where A is null")).toEqual([[2], [3]]);
  });
});
