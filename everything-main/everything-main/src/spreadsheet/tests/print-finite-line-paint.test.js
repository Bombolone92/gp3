// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintTable } from '../src/ui/print.js';

it.each(['row', 'column'])('includes finite fill and border overrides of a painted %s', axis => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'Title' },
    '4,3': { s: { bg: '#ffcc66' } }, '6,5': { s: { bc: '#993344' } },
    '12,12': { s: { bg: '#ffffff' } } },
    ...(axis === 'row' ? { rowStyles: { 4: { bg: '#ffffff' }, 6: { bb: true, bc: '#000000' }, 12: { bg: '#ffffff' } } }
      : { colStyles: { 3: { bg: '#ffffff' }, 5: { bb: true, bc: '#000000' }, 12: { bg: '#ffffff' } } }),
  }] });
  const table = buildPrintTable(wb, wb.activeSheetId);
  expect(table.querySelectorAll('tr')).toHaveLength(7);
  expect(table.querySelectorAll('col')).toHaveLength(6);
  expect(table.querySelectorAll('tr')[4].children[3].style.backgroundColor).toBe('rgb(255, 204, 102)');
});

it('includes finite sparse fills over whole-column paint without materializing cells', () => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'Title' } },
    colStyles: { 1: { bg: '#ffffff' }, 2: { bg: '#ffffff' } },
    styleResets: [{ range: { r1: 5, c1: 1, r2: 8, c2: 2 }, keys: ['bg'], values: { bg: '#339966' } }],
  }] });
  const table = buildPrintTable(wb, wb.activeSheetId);
  expect(table.querySelectorAll('tr')).toHaveLength(9);
  expect(table.querySelectorAll('col')).toHaveLength(3);
  expect(wb.activeSheet.cells.size).toBe(1);
});

it('does not extend a sheet for repeated inherited paint or paint removals', () => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'Title' },
    '8,2': { s: { bg: '#ffff00' } }, '9,2': { s: { bg: null } }, '10,3': { s: { bb: false } } },
    colStyles: { 2: { bg: '#ffff00' }, 3: { bb: true } },
  }] });
  const table = buildPrintTable(wb, wb.activeSheetId);
  expect(table.querySelectorAll('tr')).toHaveLength(1);
  expect(table.querySelectorAll('col')).toHaveLength(1);
});

it.each(['row', 'column'])('retains a finite override when full-%s paint is materialized as cells', axis => {
  const cells = { '0,0': { v: 'Title' } };
  for (let n = 0; n < 12; n++) cells[axis === 'column' ? `${n},1` : `1,${n}`] = { s: { bg: '#ffff00' } };
  cells[axis === 'column' ? '4,1' : '1,4'] = { s: { bg: '#339966' } };
  const wb = new Workbook({ sheets: [{ rows: 12, cols: 12, cells }] });
  const table = buildPrintTable(wb, wb.activeSheetId);
  expect(table.querySelectorAll('tr')).toHaveLength(axis === 'column' ? 5 : 2);
  expect(table.querySelectorAll('col')).toHaveLength(axis === 'column' ? 2 : 5);
});
