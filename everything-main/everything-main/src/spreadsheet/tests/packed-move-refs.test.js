import { expect, it } from 'vitest';
import { packedMoveReferences } from '../src/core/packed-move-refs.js';
it('moves selected contiguous references once, including absolute and spill refs', () => {
  const m = packedMoveReferences('Sheet', 'Sheet', [0, 2, 3], [0, 1], 2, 0);
  expect(m.follow('$A$1+A3:B4+A1:A3+A:A+1:1+A1#', 'Sheet')).toBe('$A$3+A4:B5+A1:A3+A:A+1:1+A3#');
  expect(m.carry('A1+A3+$C$1')).toBe('A3+A4+$C$1');
});
it('qualifies cross-sheet moved and retained references without touching other or 3D sheets', () => {
  const m = packedMoveReferences('Old sheet', 'New sheet', [0, 2], [1], 4, 3);
  expect(m.carry("B1+A1+'Else'!B1+'Old sheet:Else'!B1")).toBe("D5+'Old sheet'!A1+Else!B1+'Old sheet:Else'!B1");
  expect(m.follow("'Old sheet'!$B$3+B1", 'Else')).toBe("'New sheet'!$D$6+B1");
});
it('maps fragmented source endpoints without expanding whole ranges', () => {
  const m = packedMoveReferences('S', 'T', Array.from({ length: 10000 }, (_, i) => i * 2), [0, 2], 0, 3);
  expect(m.follow('A19999+C19999+A1:A19999', 'S')).toBe('T!D10000+T!E10000+A1:A19999');
  expect(m.sourceCell(19998, 2)).toBe(true); expect(m.sourceCell(1, 2)).toBe(false);
  expect(m.destinationCell(19998, 2)).toEqual({ r: 9999, c: 4 });
  expect(m.destinationCell(1, 2)).toBeNull(); expect(m.destinationCell(0, 1)).toBeNull();
});
