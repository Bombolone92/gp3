// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const seen = [];
vi.mock('../src/ui/menu.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, openMenu: vi.fn((config) => { seen.push(config.items[0].custom.querySelectorAll('.dp-day').length); return real.openMenu(config); }) };
});

const { openDatePicker, partsToSerial } = await import('../src/ui/datepicker.js');
const { Workbook } = await import('../src/core/workbook.js');
const { closeMenu } = await import('../src/ui/menu.js');

afterEach(() => { closeMenu(); document.body.replaceChildren(); seen.length = 0; });

describe('date picker layout', () => {
  it('draws the calendar before the menu measures itself, so it can flip above a cell near the bottom', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: partsToSerial(2024, 1, 31), s: { fmt: 'date' } } }]);
    const menu = openDatePicker({ wb, sheetId: () => id, grid: { focus() {}, cellRect: () => ({ left: 0, right: 100, top: 560, bottom: 586, width: 100, height: 26 }) } }, 0, 0);
    expect(seen).toEqual([42]);
    expect(document.querySelectorAll('.dp-day')).toHaveLength(42);
    // Picking a day still closes the menu and writes the date.
    document.querySelector('.dp-day[data-serial]').click();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(wb.getCell(id, 0, 0).v).not.toBe(partsToSerial(2024, 1, 31));
    void menu;
  });
});
