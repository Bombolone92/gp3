import { describe, expect, it } from 'vitest';
import { authorizedOverruns } from '../src/lib/csvimport.js';

const db = {
  classes: [
    { id: 'c1', name: 'Common Stock', kind: 'common', authorized: 1000 },
    { id: 'c2', name: 'Series A', kind: 'preferred', authorized: 0 },
    { id: 'c3', name: 'Twin', kind: 'common', authorized: 10 },
    { id: 'c4', name: 'twin', kind: 'common', authorized: 10 },
  ],
  securities: [{ id: 's1', kind: 'shares', classId: 'c1', quantity: 900 }],
};

describe('authorizedOverruns', () => {
  it('sums a file\'s certificates per class and names the ones past their count', () => {
    const creates = [
      { kind: 'shares', className: 'Common Stock', quantity: 60 },
      { kind: 'shares', className: 'common stock', quantity: 50 },
      { kind: 'shares', className: 'Series A', quantity: 1e6 },
      { kind: 'shares', className: 'Twin', quantity: 1e6 },
      { kind: 'shares', className: 'Brand New', quantity: 1e6 },
      { kind: 'option', className: 'Common Stock', quantity: 1e6 },
    ];
    expect(authorizedOverruns(db, creates)).toEqual([{ name: 'Common Stock', issued: 900, authorized: 1000, over: 10 }]);
    expect(authorizedOverruns(db, [{ kind: 'shares', className: 'Common Stock', quantity: 100 }])).toEqual([]);
  });
});
