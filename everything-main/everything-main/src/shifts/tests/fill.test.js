import { describe, it, expect, beforeEach } from 'vitest';
import { fillAssignments, fillSummary, planFill } from '../src/core/fill.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

/** Mon 2026-08-17 through Sun 2026-08-23. */
const WEEK = [
  '2026-08-17',
  '2026-08-18',
  '2026-08-19',
  '2026-08-20',
  '2026-08-21',
  '2026-08-22',
  '2026-08-23',
];

const alwaysAvailable = () => ({
  days: Array.from({ length: 7 }, () => ({ off: false, start: '00:00', end: '23:59' })),
  exceptions: [],
});

const shift = (id, date, start, end, { role = 'Floor', assigneeId = null } = {}) => ({
  id,
  date,
  start,
  end,
  role,
  assigneeId,
  breakMinutes: 0,
});

const team = (overrides = {}) => [
  { id: 'e1', name: 'Ava', role: 'Floor', active: true, ...overrides.e1 },
  { id: 'e2', name: 'Liam', role: 'Floor', active: true, ...overrides.e2 },
];

const context = (shifts, employees = team()) => ({
  shifts,
  employees,
  availability: Object.fromEntries(employees.map((e) => [e.id, alwaysAvailable()])),
});

describe('planFill', () => {
  it('proposes nothing when there is nothing open', () => {
    const shifts = [shift('s1', '2026-08-17', '09:00', '17:00', { assigneeId: 'e1' })];
    expect(planFill(context(shifts), WEEK)).toEqual([]);
  });

  it('lists open shifts in the order they are worked', () => {
    const shifts = [
      shift('s2', '2026-08-18', '09:00', '17:00'),
      shift('s3', '2026-08-17', '17:00', '22:00'),
      shift('s1', '2026-08-17', '09:00', '17:00'),
    ];
    expect(planFill(context(shifts), WEEK).map((p) => p.shift.id)).toEqual(['s1', 's3', 's2']);
  });

  it('ignores open shifts outside the given days', () => {
    const shifts = [shift('s1', '2026-08-24', '09:00', '17:00')];
    expect(planFill(context(shifts), WEEK)).toEqual([]);
  });

  it('never proposes the same person for two overlapping shifts', () => {
    const shifts = [
      shift('s1', '2026-08-17', '09:00', '17:00'),
      shift('s2', '2026-08-17', '12:00', '20:00'),
    ];
    const plan = planFill(context(shifts), WEEK);
    const picked = plan.map((p) => p.proposal?.employee.id);
    expect(picked).toHaveLength(2);
    expect(new Set(picked).size).toBe(2);
  });

  it('stops proposing someone once the pass would pass their weekly max', () => {
    const employees = team({ e2: { maxHours: 0 } });
    const shifts = [
      shift('s1', '2026-08-17', '09:00', '17:00'),
      shift('s2', '2026-08-18', '09:00', '17:00'),
      shift('s3', '2026-08-19', '09:00', '17:00'),
    ];
    // Ava has an 8-hour cap and Liam none: she takes the first, he takes
    // the rest, rather than every shift going to whoever ranks first.
    const capped = team({ e1: { maxHours: 8 } });
    const plan = planFill(context(shifts, capped), WEEK);
    expect(plan.map((p) => p.proposal?.employee.id)).toEqual(['e1', 'e2', 'e2']);
    // With a zero maximum nobody is offered at all.
    const none = planFill(context(shifts, [employees[1]]), WEEK);
    expect(none.every((p) => p.proposal === null)).toBe(true);
  });

  it('spreads the work by hour deficit rather than loading the first eligible person', () => {
    const employees = [
      { id: 'e1', name: 'Ava', role: 'Floor', active: true, targetHours: 8 },
      { id: 'e2', name: 'Liam', role: 'Floor', active: true, targetHours: 40 },
    ];
    const shifts = [
      shift('s1', '2026-08-17', '09:00', '17:00'),
      shift('s2', '2026-08-18', '09:00', '17:00'),
    ];
    const plan = planFill(context(shifts, employees), WEEK);
    // Liam is 40h below target, Ava 8h: he leads, and after eight hours
    // he is still the further behind, so he takes the second too.
    expect(plan.map((p) => p.proposal?.employee.id)).toEqual(['e2', 'e2']);
  });

  it('reports rows nobody can take instead of forcing an assignment', () => {
    const shifts = [shift('s1', '2026-08-17', '09:00', '17:00')];
    const plan = planFill(
      { shifts, employees: team(), availability: { e1: { days: Array.from({ length: 7 }, () => ({ off: true })) }, e2: { days: Array.from({ length: 7 }, () => ({ off: true })) } } },
      WEEK
    );
    expect(plan[0].proposal).toBeNull();
    expect(plan[0].candidates).toEqual([]);
    expect(fillSummary(plan)).toMatchObject({ total: 1, filling: 0, nobody: 1, skipped: 0 });
  });

  it('honours a pinned pick and re-derives the untouched rows after it', () => {
    const shifts = [
      shift('s1', '2026-08-17', '09:00', '17:00'),
      shift('s2', '2026-08-17', '12:00', '20:00'),
    ];
    const auto = planFill(context(shifts), WEEK);
    const first = auto[0].proposal.employee.id;
    const other = first === 'e1' ? 'e2' : 'e1';
    // Pin the other person onto the first row: the second row must give
    // up the person it had proposed, because they are now busy.
    const pinned = planFill(context(shifts), WEEK, { choices: { s1: other } });
    expect(pinned[0].proposal.employee.id).toBe(other);
    expect(pinned[0].pinned).toBe(true);
    expect(pinned[1].proposal.employee.id).toBe(first);
  });

  it('marks a shift pinned to nobody as skipped and leaves its person free', () => {
    const shifts = [
      shift('s1', '2026-08-17', '09:00', '17:00'),
      shift('s2', '2026-08-17', '12:00', '20:00'),
    ];
    const plan = planFill(context(shifts, [team()[0]]), WEEK, { choices: { s1: null } });
    expect(plan[0]).toMatchObject({ skipped: true, proposal: null });
    // Ava was going to work the first shift; skipping it frees her for
    // the second, which overlaps it.
    expect(plan[1].proposal.employee.id).toBe('e1');
    expect(fillSummary(plan)).toMatchObject({ total: 2, filling: 1, skipped: 1, nobody: 0 });
  });

  it('flags a pinned pick that another override has made impossible', () => {
    const shifts = [
      shift('s1', '2026-08-17', '09:00', '17:00'),
      shift('s2', '2026-08-17', '12:00', '20:00'),
    ];
    const plan = planFill(context(shifts), WEEK, { choices: { s1: 'e1', s2: 'e1' } });
    expect(plan[0].proposal.employee.id).toBe('e1');
    expect(plan[1]).toMatchObject({ proposal: null, stale: true, pinned: true });
  });

  it('turns a plan into the assignments it would write', () => {
    const shifts = [
      shift('s1', '2026-08-17', '09:00', '17:00'),
      shift('s2', '2026-08-18', '09:00', '17:00'),
    ];
    const plan = planFill(context(shifts), WEEK, { choices: { s2: null } });
    expect(fillAssignments(plan)).toEqual([{ shiftId: 's1', assigneeId: expect.any(String) }]);
  });
});

describe('store.assignShifts', () => {
  let backend;
  let store;

  beforeEach(async () => {
    backend = createMemoryBackend();
    store = createStore(backend, {
      now: () => '2026-08-04T09:00:00.000Z',
      today: () => '2026-08-04',
    });
    await store.init();
  });

  it('staffs several shifts in one write and undoes the whole pass', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const liam = await store.addEmployee({ name: 'Liam' });
    const a = await store.addShift({ date: '2026-08-17', start: '09:00', end: '17:00', role: 'Floor' });
    const b = await store.addShift({ date: '2026-08-18', start: '09:00', end: '17:00', role: 'Floor' });

    const { filled, undo } = await store.assignShifts([
      { shiftId: a.id, assigneeId: ava.id },
      { shiftId: b.id, assigneeId: liam.id },
    ]);
    expect(filled).toBe(2);
    expect(store.state.shifts.map((s) => s.assigneeId)).toEqual([ava.id, liam.id]);
    expect(backend.peek('shifts').map((s) => s.assigneeId)).toEqual([ava.id, liam.id]);

    await undo();
    expect(store.state.shifts.map((s) => s.assigneeId)).toEqual([null, null]);
    expect(backend.peek('shifts').map((s) => s.assigneeId)).toEqual([null, null]);
  });

  it('writes nothing when any row in the batch is unusable', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const a = await store.addShift({ date: '2026-08-17', start: '09:00', end: '17:00', role: 'Floor' });

    await expect(
      store.assignShifts([
        { shiftId: a.id, assigneeId: ava.id },
        { shiftId: 'nope', assigneeId: ava.id },
      ])
    ).rejects.toThrow(/Shift not found/);
    expect(store.state.shifts[0].assigneeId).toBeNull();

    await expect(store.assignShifts([])).rejects.toThrow(/nothing to assign/i);
  });
});
