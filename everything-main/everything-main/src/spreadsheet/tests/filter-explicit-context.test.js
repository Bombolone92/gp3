import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  [['Category', 'Amount'], ['Alpha', 10], ['Beta', 20], ['Alpha', 30], ['Gamma', 40]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  [['Elsewhere'], ['Other'], ['Other'], ['Other'], ['Other']].forEach((row, r) => wb.setInput(id, r, 3, row[0]));
  wb.addTable(id, parseRange('A1:B5'), { name: 'First' });
  const target = wb.sheet(id).filter;
  wb.addTable(id, parseRange('D1:D5'), { name: 'Second' });
  return { wb, id, target, active: wb.sheet(id).filter };
}

describe('filtering an explicit list without activating its menu', () => {
  it('targets numeric identities, preserves the other context, and supports undo/redo', () => {
    const { wb, id, target, active } = setup();
    wb.setFilterCriteria(id, 1, { values: ['20'] }, target);
    expect(wb.sheet(id).filter).toEqual(active);
    expect(wb.filterAt(id, 0, 0).criteria[1]).toEqual({ values: ['20'], keys: ['20'] });
    expect([...wb.sheet(id).filterHidden]).toEqual([1, 3, 4]);
    wb.undo();
    expect(wb.filterAt(id, 0, 0).criteria).toEqual({});
    expect([...wb.sheet(id).filterHidden]).toEqual([]);
    wb.redo();
    expect([...wb.sheet(id).filterHidden]).toEqual([1, 3, 4]);
    // A saved context identifies the current list, not its obsolete criteria snapshot.
    wb.setFilterCriteria(id, 0, { values: ['Beta'] }, target);
    expect(wb.filterAt(id, 0, 0).criteria[1].keys).toEqual(['20']);
    wb.setFilterCriteria(id, 1, null, target);
    expect(wb.filterAt(id, 0, 0).criteria).toEqual({ 0: { values: ['Beta'] } });
    expect(wb.sheet(id).filter).toEqual(active);
  });

  it('reads the requested list and ignores its own selection when computing availability', () => {
    const { wb, id, target, active } = setup();
    wb.setFilterCriteria(id, 0, { values: ['Beta'] }, target);
    wb.setFilterCriteria(id, 1, { op: 'gt', value: '25' }, target);
    wb.setHidden(id, 'row', [4], true);
    // Another table can hide all physical rows without changing this list's available items.
    wb.setFilterCriteria(id, 3, { values: [] });
    const hidden = [...wb.sheet(id).filterHidden];
    expect(wb.filterValues(id, 0, target)).toEqual([{ value: 'Alpha', count: 2 }, { value: 'Beta', count: 1 }, { value: 'Gamma', count: 1 }]);
    expect(wb.filterColors(id, 0, target)).toEqual([{ color: '', count: 4 }]);
    expect([...wb.filterAvailableValues(id, 0, target)]).toEqual(['Alpha', 'Gamma']);
    expect([...wb.filterAvailableValues(id, 1, target)]).toEqual(['20']);
    expect(wb.filterValues(id, 0, target, { withState: true })).toEqual([
      { value: 'Alpha', count: 2, selected: false, available: true },
      { value: 'Beta', count: 1, selected: true, available: false },
      { value: 'Gamma', count: 1, selected: false, available: true },
    ]);
    expect([...wb.sheet(id).filterHidden]).toEqual(hidden);
    expect(wb.sheet(id).filter.range).toEqual(active.range);
  });

  it.each([
    [{ values: ['20', '40'] }, ['Beta', 'Gamma']],
    [{ text: '0' }, ['Alpha', 'Beta', 'Gamma']],
    [{ op: 'between', value: '15', value2: '35' }, ['Beta', 'Alpha']],
    [{ formula: '=B2>=30' }, ['Alpha', 'Gamma']],
    [{ color: '#ff0000' }, ['Gamma']],
  ])('shares application semantics for %j', (criteria, expected) => {
    const { wb, id, target } = setup();
    wb.applyStyle(id, parseRange('B5'), { bg: '#ff0000' });
    wb.setFilterCriteria(id, 1, criteria, target);
    expect([...wb.filterAvailableValues(id, 0, target)]).toEqual(expected);
    const visibleValues = new Set();
    for (let r = 1; r <= 4; r++) if (!wb.sheet(id).filterHidden.has(r)) visibleValues.add(wb.getDisplay(id, r, 0));
    expect(wb.filterAvailableValues(id, 0, target)).toEqual(visibleValues);
    const states = wb.filterValues(id, 0, target, { withState: true });
    expect(new Set(states.filter(i => i.available).map(i => i.value))).toEqual(visibleValues);
    expect(states.every(i => i.selected)).toBe(true);
  });

  it('does not fall back to the active list for missing targets or out-of-range columns', () => {
    const { wb, id, target, active } = setup();
    for (const [col, context] of [[0, null], [0, { range: parseRange('G1:G5') }], [3, target], [0.5, target]]) {
      wb.setFilterCriteria(id, col, { values: [] }, context);
      expect(wb.filterAvailableValues(id, col, context).size).toBe(0);
      expect(wb.filterValues(id, col, context)).toEqual([]);
    }
    expect(wb.sheet(id).filter).toEqual(active);
    expect(wb.filterAt(id, 0, 0).criteria).toEqual({});
  });
});

it('aggregates selection and availability independently across case variants', () => {
  const { wb, id, target } = setup();
  wb.setInput(id, 3, 0, 'ALPHA');
  wb.setFilterCriteria(id, 0, { values: ['Alpha'], caseSensitive: true }, target);
  wb.setFilterCriteria(id, 1, { op: 'gt', value: '25' }, target);
  const options = { withState: true, caseSensitive: false };
  expect(wb.filterValues(id, 0, target, options)).toEqual([
    { value: 'Alpha', count: 2, selected: true, available: true },
    { value: 'Beta', count: 1, selected: false, available: false },
    { value: 'Gamma', count: 1, selected: false, available: true },
  ]);
  // The ordinary menu keeps its original case-sensitive grouping and shape.
  expect(wb.filterValues(id, 0, target).filter(i => i.value.toLowerCase() === 'alpha')).toEqual([
    { value: 'Alpha', count: 1 }, { value: 'ALPHA', count: 1 },
  ]);
  wb.setInput(id, 1, 0, 'Changed');
  expect(wb.filterValues(id, 0, target, options).find(i => i.value === 'ALPHA')).toMatchObject({ count: 1, selected: false, available: true });
  wb.undo();
  expect(wb.filterValues(id, 0, target, options)[0]).toMatchObject({ count: 2, selected: true });
});
it('aggregates typed filter matches that share a formatted label', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [{ v: 'Value' }, { v: 1.1, s: { fmt: 'number', dec: 0 } }, { v: 1.4, s: { fmt: 'number', dec: 0 } }, { v: 2 }].map((cell,r) => ({ r, c: 0, cell })));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 0 });
  wb.setFilterCriteria(id, 0, { op: 'gt', value: '1.2' });
  expect(wb.filterValues(id, 0, undefined, { withState: true })).toEqual([
    { value: '1', count: 2, selected: true, available: true },
    { value: '2', count: 1, selected: true, available: true },
  ]);
});
