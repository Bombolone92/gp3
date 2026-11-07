import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateMove } from '../src/core/scheduling.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

const employee = (id, extra = {}) => ({ id, name: id === 'e1' ? 'Ava' : 'Liam', active: true, ...extra });

const shift = (id, date, start, end, assigneeId = null) => ({
  id,
  date,
  start,
  end,
  role: 'Floor',
  assigneeId,
  breakMinutes: 0,
});

const availability = (days) => ({ days, exceptions: [] });
const openDays = () => Array.from({ length: 7 }, () => ({ off: false, start: '00:00', end: '23:59' }));

describe('evaluateMove', () => {
  const ava = employee('e1');
  const liam = employee('e2');

  it('reports no change when the target is where the shift already sits', () => {
    const s = shift('s1', '2026-08-05', '09:00', '17:00', 'e1');
    const verdict = evaluateMove(s, { date: '2026-08-05', assigneeId: 'e1' }, {
      shifts: [s],
      employees: [ava],
    });
    expect(verdict).toMatchObject({ changed: false, blocked: null });
  });

  it('allows a clean move to another day and another person', () => {
    const s = shift('s1', '2026-08-05', '09:00', '17:00', 'e1');
    const verdict = evaluateMove(s, { date: '2026-08-06', assigneeId: 'e2' }, {
      shifts: [s],
      employees: [ava, liam],
      availability: { e2: availability(openDays()) },
    });
    expect(verdict.changed).toBe(true);
    expect(verdict.blocked).toBeNull();
    expect(verdict.warnings).toEqual([]);
  });

  it('blocks a move that overlaps the target person’s own shift', () => {
    const moving = shift('s1', '2026-08-05', '09:00', '17:00', 'e1');
    const held = shift('s2', '2026-08-06', '12:00', '20:00', 'e2');
    const verdict = evaluateMove(moving, { date: '2026-08-06', assigneeId: 'e2' }, {
      shifts: [moving, held],
      employees: [ava, liam],
    });
    expect(verdict.blocked).toMatch(/overlapping shift/i);
  });

  it('ignores the shift’s own slot when moving it, but not when copying it', () => {
    const s = shift('s1', '2026-08-05', '09:00', '17:00', 'e1');
    const context = { shifts: [s], employees: [ava] };
    // Moving the shift one hour earlier on the same day cannot collide
    // with itself.
    expect(evaluateMove({ ...s }, { date: '2026-08-05', assigneeId: 'e1' }, context).blocked).toBeNull();
    // A copy is a second shift in the same hours, which does collide.
    expect(
      evaluateMove(s, { date: '2026-08-05', assigneeId: 'e1' }, context, { copy: true }).blocked
    ).toMatch(/overlapping/i);
  });

  it('blocks a drop onto an archived or unknown person', () => {
    const s = shift('s1', '2026-08-05', '09:00', '17:00');
    expect(
      evaluateMove(s, { date: '2026-08-05', assigneeId: 'e9' }, { shifts: [s], employees: [ava] }).blocked
    ).toMatch(/no longer on the team/i);
    expect(
      evaluateMove(s, { date: '2026-08-05', assigneeId: 'e2' }, {
        shifts: [s],
        employees: [ava, { ...liam, active: false }],
      }).blocked
    ).toMatch(/archived/i);
  });

  it('reports no change, not a block, for a shift already held by someone off the team', () => {
    // A worked shift keeps a deleted or archived assignee for history, so
    // the Move dialog opens on it at its own spot. Nothing has been asked
    // for yet, so nothing is refused; moving the day is still refused.
    const gone = shift('s1', '2026-08-05', '09:00', '17:00', 'e9');
    expect(evaluateMove(gone, { date: '2026-08-05', assigneeId: 'e9' }, { shifts: [gone], employees: [ava] }))
      .toMatchObject({ changed: false, blocked: null });
    expect(
      evaluateMove(gone, { date: '2026-08-06', assigneeId: 'e9' }, { shifts: [gone], employees: [ava] }).blocked
    ).toMatch(/no longer on the team/i);

    const archived = shift('s2', '2026-08-05', '09:00', '17:00', 'e2');
    const context = { shifts: [archived], employees: [ava, { ...liam, active: false }] };
    expect(evaluateMove(archived, { date: '2026-08-05', assigneeId: 'e2' }, context)).toMatchObject({
      changed: false,
      blocked: null,
    });
    expect(evaluateMove(archived, { date: '2026-08-06', assigneeId: 'e2' }, context).blocked).toMatch(
      /archived/i
    );
  });

  it('warns without blocking for time off, availability, and hour limits', () => {
    const s = shift('s1', '2026-08-05', '09:00', '17:00', 'e1');
    const timeOff = evaluateMove(s, { date: '2026-08-06', assigneeId: 'e2' }, {
      shifts: [s],
      employees: [ava, liam],
      availability: {
        e2: { days: openDays(), exceptions: [{ id: 'x1', from: '2026-08-06', to: '2026-08-06', note: 'Leave' }] },
      },
    });
    expect(timeOff.blocked).toBeNull();
    expect(timeOff.warnings[0]).toMatch(/time off then \(Leave\)/);

    const unavailable = evaluateMove(s, { date: '2026-08-06', assigneeId: 'e2' }, {
      shifts: [s],
      employees: [ava, liam],
      availability: { e2: availability(Array.from({ length: 7 }, () => ({ off: true }))) },
    });
    expect(unavailable.blocked).toBeNull();
    expect(unavailable.warnings[0]).toMatch(/unavailable/i);

    const capped = evaluateMove(s, { date: '2026-08-06', assigneeId: 'e2' }, {
      shifts: [s, shift('s2', '2026-08-04', '09:00', '17:00', 'e2')],
      employees: [ava, { ...liam, maxHours: 8 }],
      availability: { e2: availability(openDays()) },
    });
    expect(capped.blocked).toBeNull();
    expect(capped.warnings[0]).toMatch(/over their 8h max/);
  });

  it('warns when a shift with attendance recorded changes day', () => {
    const s = shift('s1', '2026-08-05', '09:00', '17:00', 'e1');
    const context = {
      shifts: [s],
      employees: [ava],
      availability: { e1: availability(openDays()) },
      attendance: { s1: { status: 'present' } },
    };
    expect(evaluateMove(s, { date: '2026-08-06', assigneeId: 'e1' }, context).warnings).toContain(
      'Attendance was already recorded for this shift.'
    );
    // A copy leaves the record with the original.
    expect(
      evaluateMove(s, { date: '2026-08-06', assigneeId: 'e1' }, context, { copy: true }).warnings
    ).toEqual([]);
  });

  it('warns when reassigning hands the recorded attendance to somebody else', () => {
    // The record is keyed by shift, so the new assignee inherits the
    // clock times, the lateness, and the pay they produce.
    const s = shift('s1', '2026-08-05', '09:00', '17:00', 'e1');
    const context = {
      shifts: [s],
      employees: [ava, liam],
      availability: { e1: availability(openDays()), e2: availability(openDays()) },
      attendance: { s1: { status: 'late', clockIn: '09:45', clockOut: '17:00' } },
    };
    expect(evaluateMove(s, { date: '2026-08-05', assigneeId: 'e2' }, context).warnings).toContain(
      'The attendance already recorded for this shift becomes Liam’s.'
    );
    // Dropping it on the open-shifts row takes the record off every
    // timesheet instead of moving it to somebody.
    expect(evaluateMove(s, { date: '2026-08-05', assigneeId: null }, context).warnings).toContain(
      'Unassigning takes the attendance already recorded for this shift off the timesheet.'
    );
    // Still a warning, never a blocker.
    expect(evaluateMove(s, { date: '2026-08-05', assigneeId: 'e2' }, context).blocked).toBeNull();
  });

  it('rejects an invalid target date', () => {
    const s = shift('s1', '2026-08-05', '09:00', '17:00', 'e1');
    expect(evaluateMove(s, { date: '', assigneeId: 'e1' }, { shifts: [s], employees: [ava] }).blocked).toMatch(
      /not a valid date/i
    );
  });
});

describe('store.moveShift and store.copyShift', () => {
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

  it('moves a shift to another day and assignee in one write, and undoes both', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const liam = await store.addEmployee({ name: 'Liam' });
    const created = await store.addShift({
      date: '2026-08-05',
      start: '09:00',
      end: '17:00',
      role: 'Floor',
      assigneeId: ava.id,
      note: 'Bring keys',
      breakMinutes: 30,
    });

    const { shift: moved, undo } = await store.moveShift(created.id, {
      date: '2026-08-07',
      assigneeId: liam.id,
    });
    expect(moved).toMatchObject({ date: '2026-08-07', assigneeId: liam.id, note: 'Bring keys', breakMinutes: 30 });
    expect(backend.peek('shifts')[0]).toMatchObject({ date: '2026-08-07', assigneeId: liam.id });

    await undo();
    expect(store.state.shifts[0]).toMatchObject({ date: '2026-08-05', assigneeId: ava.id });
    expect(backend.peek('shifts')[0]).toMatchObject({ date: '2026-08-05', assigneeId: ava.id });
  });

  it('unassigns a shift moved onto the open row and staffs one moved off it', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const created = await store.addShift({
      date: '2026-08-05',
      start: '09:00',
      end: '17:00',
      role: 'Floor',
      assigneeId: ava.id,
    });

    await store.moveShift(created.id, { date: '2026-08-05', assigneeId: null });
    expect(store.state.shifts[0].assigneeId).toBeNull();

    await store.moveShift(created.id, { date: '2026-08-05', assigneeId: ava.id });
    expect(store.state.shifts[0].assigneeId).toBe(ava.id);
  });

  it('rejects a move to an unknown employee or an invalid day', async () => {
    const created = await store.addShift({
      date: '2026-08-05',
      start: '09:00',
      end: '17:00',
      role: 'Floor',
    });
    await expect(store.moveShift(created.id, { date: '2026-08-05', assigneeId: 'nope' })).rejects.toThrow(
      /Employee not found/
    );
    await expect(store.moveShift(created.id, { date: 'tomorrow' })).rejects.toThrow(/valid date/i);
    expect(store.state.shifts[0]).toMatchObject({ date: '2026-08-05', assigneeId: null });
  });

  it('moves and copies a shift that carries no role label', async () => {
    // Deleting a managed role with "clear everywhere" leaves its shifts
    // labelled "No role", which the grid, the reports, the calendar
    // export, and copyWeek all handle. A move sets the day and the
    // assignee and nothing else, so it has no business refusing them.
    const ava = await store.addEmployee({ name: 'Ava' });
    const role = await store.addRole({ name: 'Floor' });
    const created = await store.addShift({
      date: '2026-08-05',
      start: '09:00',
      end: '17:00',
      role: 'Floor',
      assigneeId: ava.id,
    });
    await store.deleteRole(role.id, { clearRecords: true });
    expect(store.state.shifts[0].role).toBe('');

    const { shift: moved } = await store.moveShift(created.id, {
      date: '2026-08-06',
      assigneeId: ava.id,
    });
    expect(moved).toMatchObject({ date: '2026-08-06', role: '' });

    const { shift: copy } = await store.copyShift(created.id, {
      date: '2026-08-07',
      assigneeId: ava.id,
    });
    expect(copy).toMatchObject({ date: '2026-08-07', role: '' });
  });

  it('copies a shift with its times, role, break, and note, and undoes the copy', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const created = await store.addShift({
      date: '2026-08-05',
      start: '22:00',
      end: '06:00',
      role: 'Night',
      assigneeId: ava.id,
      note: 'Lock up',
      breakMinutes: 20,
    });

    const { shift: copy, undo } = await store.copyShift(created.id, {
      date: '2026-08-06',
      assigneeId: ava.id,
    });
    expect(copy.id).not.toBe(created.id);
    expect(copy).toMatchObject({
      date: '2026-08-06',
      start: '22:00',
      end: '06:00',
      role: 'Night',
      note: 'Lock up',
      breakMinutes: 20,
      assigneeId: ava.id,
    });
    expect(store.state.shifts).toHaveLength(2);

    await undo();
    expect(store.state.shifts.map((s) => s.id)).toEqual([created.id]);
    expect(backend.peek('shifts')).toHaveLength(1);
  });

  it('leaves attendance and swaps with the original when copying', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const liam = await store.addEmployee({ name: 'Liam' });
    const created = await store.addShift({
      date: '2026-08-05',
      start: '09:00',
      end: '17:00',
      role: 'Floor',
      assigneeId: ava.id,
    });
    await store.recordAttendance(created.id, { status: 'present', clockIn: '09:00', clockOut: '17:00' });
    await store.requestSwap({ shiftId: created.id, toEmployeeId: liam.id, reason: '' });

    const { shift: copy } = await store.copyShift(created.id, { date: '2026-08-06', assigneeId: ava.id });
    expect(store.state.attendance[copy.id]).toBeUndefined();
    expect(store.state.swaps.filter((s) => s.shiftId === copy.id)).toEqual([]);
    expect(store.state.attendance[created.id]?.status).toBe('present');
  });
});
