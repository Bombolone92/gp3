import { describe, it, expect } from 'vitest';
import { CELL_STYLES, cellStyle } from '../src/core/cellstyles.js';
import { Workbook } from '../src/core/workbook.js';

describe('cell style presets', () => {
  it('are well formed and apply through the workbook', () => {
    const keys = new Set();
    for (const s of CELL_STYLES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(keys.has(s.key)).toBe(false);
      keys.add(s.key);
      for (const b of s.borders || []) expect(['none', 'outer', 'top', 'bottom', 'left', 'right', 'all']).toContain(b.kind);
    }
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Total');
    const total = cellStyle('total');
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 1 }, total.patch);
    for (const b of total.borders) wb.applyBorders(id, { r1: 0, c1: 0, r2: 0, c2: 1 }, b.kind, { color: b.color, style: b.style });
    const s = wb.getCell(id, 0, 0).s;
    expect(s.bold).toBe(true);
    expect(s.bt).toBeTruthy();
    expect(s.bb).toBeTruthy();
    expect(cellStyle('nope')).toBeNull();
  });
});
