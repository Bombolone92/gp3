import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { borderSnapshot, cellBorderGesturePatch } from '../src/core/border-regions.js';
const range = { r1: 2, r2: 4, c1: 2, c2: 4 };
const kinds = ['all', 'outer', 'inner', 'horizontal', 'vertical', 'top', 'bottom', 'left', 'right', 'none', 'restyle'];
const pens = [{}, { color: '#456789' }, { style: 'double' }, { color: null, style: null }];
it.each(kinds.flatMap(kind => pens.map(options => [kind, options])))('matches ordinary finite border geometry for %s with %j', (kind, options) => {
  for (const inherited of [false, true]) {
    const before = new Workbook({ sheets: [{ id: 's', name: 'Sheet', cells: {
      '2,2': { v: 'A', s: { bl: true, bs: 'thick', bc: '#112233', bold: true } },
      '3,3': { v: 'B', s: { bt: true, br: true, btBorder: { bs: 'dotted', bc: '#ff0000' }, brBorder: { bs: 'double', bc: '#0000ff' } } },
      '4,4': { v: 'C', s: { bbBorder: { bs: 'dashed', bc: '#445566' } } },
    } }] });
    if (inherited) {
      before.sheet('s').colStyles.set(3, { bb: true, bbBorder: { bs: 'thin', bc: '#abcdef' } });
      before.sheet('s').rowStyles.set(4, { bl: true, bs: 'medium', bc: '#998877' });
    }
    const expected = new Workbook(before.toJSON()), actual = new Workbook(before.toJSON());
    expected.applyBorders('s', range, kind, options);
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) {
      const patch = cellBorderGesturePatch(actual.styleAt('s', r, c), range, r, c, kind, options);
      if (patch) actual.applyStyle('s', { r1: r, r2: r, c1: c, c2: c }, patch);
      expect(borderSnapshot(actual.styleAt('s', r, c))).toEqual(borderSnapshot(expected.styleAt('s', r, c)));
      expect(actual.getValue('s', r, c)).toEqual(expected.getValue('s', r, c));
    }
    expect(actual.styleAt('s', 2, 2).bold).toBe(true);
  }
});
