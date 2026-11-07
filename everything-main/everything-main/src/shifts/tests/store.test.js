import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { SWAP_STATUS } from '../src/core/swaps.js';

let backend;
let store;

const validShift = (assigneeId = null) => ({
  date: '2026-08-05',
  start: '09:00',
  end: '17:00',
  role: 'Floor',
  assigneeId,
});

beforeEach(async () => {
  backend = createMemoryBackend();
  store = createStore(backend, {
    now: () => '2026-08-04T09:00:00.000Z',
    today: () => '2026-08-04',
  });
  await store.init();
});

describe('initialization', () => {
  it('starts empty and marks itself loaded', () => {
    expect(store.state.loaded).toBe(true);
    expect(store.state.employees).toEqual([]);
    expect(store.state.shifts).toEqual([]);
  });

  it('hydrates persisted collections on init', async () => {
    const emp = await store.addEmployee({ name: 'Ava', role: 'Lead' });
    await store.addShift(validShift(emp.id));

    const rehydrated = createStore(backend);
    await rehydrated.init();
    expect(rehydrated.state.employees).toHaveLength(1);
    expect(rehydrated.state.shifts).toHaveLength(1);
    expect(rehydrated.state.availability[emp.id].days).toHaveLength(7);
  });
});

describe('employees', () => {
  it('adds employees with default availability and persists both', async () => {
    const emp = await store.addEmployee({ name: '  Ava  ', role: 'Lead' });
    expect(emp.name).toBe('Ava');
    expect(store.state.availability[emp.id].days).toHaveLength(7);
    expect(backend.peek('employees')).toHaveLength(1);
    expect(backend.peek('availability')[emp.id]).toBeTruthy();
  });

  it('rejects blank names', async () => {
    await expect(store.addEmployee({ name: '   ' })).rejects.toThrow(/name/i);
  });

  it('normalizes and validates weekly hour limits', async () => {
    const emp = await store.addEmployee({ name: 'Ava', targetHours: '32', maxHours: '' });
    expect(emp.targetHours).toBe(32);
    expect(emp.maxHours).toBeNull();

    await expect(store.addEmployee({ name: 'Bo', maxHours: '200' })).rejects.toThrow(/168/);
    await expect(store.addEmployee({ name: 'Bo', targetHours: 40, maxHours: 32 })).rejects.toThrow(
      /below target/i
    );
    await expect(store.updateEmployee(emp.id, { maxHours: 30 })).rejects.toThrow(/below target/i);
    await store.updateEmployee(emp.id, { maxHours: 40 });
    expect(store.state.employees[0].maxHours).toBe(40);
  });

  it('deleting an employee opens their upcoming shifts and cancels their pending swaps', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const liam = await store.addEmployee({ name: 'Liam' });
    const shift = await store.addShift(validShift(ava.id));
    await store.requestSwap({ shiftId: shift.id, toEmployeeId: liam.id, reason: '' });

    await store.deleteEmployee(ava.id);

    expect(store.state.employees.map((e) => e.name)).toEqual(['Liam']);
    expect(store.state.shifts[0].assigneeId).toBeNull();
    expect(store.state.swaps[0].status).toBe(SWAP_STATUS.CANCELLED);
    expect(store.state.availability[ava.id]).toBeUndefined();
  });

  it('deleting an employee keeps past and attendance-recorded shifts assigned', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const past = await store.addShift({ ...validShift(ava.id), date: '2026-08-01' });
    const workedToday = await store.addShift({ ...validShift(ava.id), date: '2026-08-04' });
    const upcoming = await store.addShift(validShift(ava.id)); // 2026-08-05
    await store.recordAttendance(workedToday.id, { status: 'present', clockIn: '09:00', clockOut: '17:00' });

    await store.deleteEmployee(ava.id);

    const byId = (id) => store.state.shifts.find((s) => s.id === id);
    expect(byId(past.id).assigneeId).toBe(ava.id);
    expect(byId(workedToday.id).assigneeId).toBe(ava.id);
    expect(byId(upcoming.id).assigneeId).toBeNull();
    expect(store.state.attendance[workedToday.id].status).toBe('present');
  });
});

describe('shifts', () => {
  it('rejects invalid shifts and assignments to unknown employees', async () => {
    await expect(store.addShift({ ...validShift(), end: '09:00' })).rejects.toThrow(/end time/i);
    await expect(store.addShift(validShift('ghost'))).rejects.toThrow(/employee/i);
  });

  it('updates a shift and re-validates the merged result', async () => {
    const shift = await store.addShift(validShift());
    await expect(store.updateShift(shift.id, { start: '17:00' })).rejects.toThrow(/end time/i);
    await store.updateShift(shift.id, { start: '10:00' });
    expect(store.state.shifts[0].start).toBe('10:00');
    expect(backend.peek('shifts')[0].start).toBe('10:00');
  });

  it('keeps a former employee’s shift editable without reassigning it', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const shift = await store.addShift(validShift(ava.id));
    // An attended shift keeps its assignee through deletion.
    await store.recordAttendance(shift.id, { status: 'present', clockIn: '09:00', clockOut: '17:00' });
    await store.deleteEmployee(ava.id);
    expect(store.state.shifts[0].assigneeId).toBe(ava.id);

    // The editor sends the whole record back, former assignee included.
    await store.updateShift(shift.id, { ...validShift(ava.id), end: '17:30' });
    expect(store.state.shifts[0].end).toBe('17:30');
    expect(store.state.shifts[0].assigneeId).toBe(ava.id);

    // Moving it to someone who does not exist is still refused.
    await expect(store.updateShift(shift.id, { assigneeId: 'ghost' })).rejects.toThrow(/employee/i);
  });

  it('deleting a shift removes its attendance and cancels pending swaps', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const liam = await store.addEmployee({ name: 'Liam' });
    const shift = await store.addShift(validShift(ava.id));
    await store.recordAttendance(shift.id, { status: 'present' });
    await store.requestSwap({ shiftId: shift.id, toEmployeeId: liam.id });

    await store.deleteShift(shift.id);

    expect(store.state.shifts).toEqual([]);
    expect(store.state.attendance[shift.id]).toBeUndefined();
    expect(store.state.swaps[0].status).toBe(SWAP_STATUS.CANCELLED);
  });
});

describe('time off', () => {
  let ava;

  beforeEach(async () => {
    ava = await store.addEmployee({ name: 'Ava' });
  });

  it('adds sorted entries and persists them', async () => {
    await store.addTimeOff(ava.id, { from: '2026-09-01', to: '2026-09-03', note: 'Trip' });
    await store.addTimeOff(ava.id, { from: '2026-08-10', to: '2026-08-10' });

    const entries = store.state.availability[ava.id].exceptions;
    expect(entries.map((x) => x.from)).toEqual(['2026-08-10', '2026-09-01']);
    expect(backend.peek('availability')[ava.id].exceptions).toHaveLength(2);
  });

  it('validates dates and range order', async () => {
    await expect(store.addTimeOff(ava.id, { from: 'nope', to: '2026-08-10' })).rejects.toThrow(/dates/i);
    await expect(store.addTimeOff(ava.id, { from: '2026-08-11', to: '2026-08-10' })).rejects.toThrow(/end on or after/i);
  });

  it('removes entries and rejects unknown ids', async () => {
    const entry = await store.addTimeOff(ava.id, { from: '2026-08-10', to: '2026-08-12' });
    await store.removeTimeOff(ava.id, entry.id);
    expect(store.state.availability[ava.id].exceptions).toEqual([]);
    await expect(store.removeTimeOff(ava.id, 'ghost')).rejects.toThrow(/not found/i);
  });

  it('keeps existing entries when the weekly pattern changes', async () => {
    await store.addTimeOff(ava.id, { from: '2026-08-10', to: '2026-08-12' });
    const days = store.state.availability[ava.id].days.map((d) => ({ ...d, off: true }));
    await store.setAvailability(ava.id, days);
    expect(store.state.availability[ava.id].exceptions).toHaveLength(1);
  });
});

describe('copyWeek', () => {
  let ava;

  beforeEach(async () => {
    ava = await store.addEmployee({ name: 'Ava' });
    // Source week: Mon Aug 3 and Wed Aug 5, 2026.
    await store.addShift({ date: '2026-08-03', start: '09:00', end: '17:00', role: 'Open', assigneeId: ava.id });
    await store.addShift({ date: '2026-08-05', start: '12:00', end: '20:00', role: 'Close', assigneeId: null });
  });

  it('clones shifts onto the same weekdays of the target week', async () => {
    const result = await store.copyWeek('2026-08-03', '2026-08-10');
    expect(result).toEqual({ copied: 2, skipped: 0 });

    const copied = store.state.shifts.filter((s) => s.date >= '2026-08-10');
    expect(copied.map((s) => [s.date, s.start, s.role, s.assigneeId])).toEqual([
      ['2026-08-10', '09:00', 'Open', ava.id],
      ['2026-08-12', '12:00', 'Close', null],
    ]);
    expect(new Set(store.state.shifts.map((s) => s.id)).size).toBe(4); // fresh ids
    expect(backend.peek('shifts')).toHaveLength(4);
  });

  it('skips exact duplicates so copying twice is safe', async () => {
    await store.copyWeek('2026-08-03', '2026-08-10');
    const second = await store.copyWeek('2026-08-03', '2026-08-10');
    expect(second).toEqual({ copied: 0, skipped: 2 });
    expect(store.state.shifts).toHaveLength(4);
  });

  it('accepts any date within a week, not just the Monday', async () => {
    const result = await store.copyWeek('2026-08-06', '2026-08-13');
    expect(result.copied).toBe(2);
  });

  it('drops assignments to employees that no longer exist', async () => {
    await store.deleteEmployee(ava.id); // opens the source shift
    // Manually re-point one source shift at a ghost id to simulate stale data.
    store.state.shifts[0].assigneeId = 'ghost';
    const result = await store.copyWeek('2026-08-03', '2026-08-10');
    expect(result.copied).toBe(2);
    const copied = store.state.shifts.filter((s) => s.date >= '2026-08-10');
    expect(copied.every((s) => s.assigneeId === null)).toBe(true);
  });

  it('drops assignments to archived employees', async () => {
    // Ava's Aug 3 shift predates the injected "today", so archiving
    // keeps it assigned to her; the copy must still arrive unassigned.
    await store.archiveEmployee(ava.id);
    expect(store.state.shifts.find((s) => s.date === '2026-08-03').assigneeId).toBe(ava.id);

    const result = await store.copyWeek('2026-08-03', '2026-08-10');
    expect(result.copied).toBe(2);
    const copied = store.state.shifts.filter((s) => s.date >= '2026-08-10');
    expect(copied.every((s) => s.assigneeId === null)).toBe(true);
  });

  it('refuses same-week and empty-week copies', async () => {
    await expect(store.copyWeek('2026-08-03', '2026-08-04')).rejects.toThrow(/same week/i);
    await expect(store.copyWeek('2026-07-20', '2026-08-10')).rejects.toThrow(/no shifts/i);
  });
});

describe('swaps', () => {
  let ava, liam, shift;

  beforeEach(async () => {
    ava = await store.addEmployee({ name: 'Ava' });
    liam = await store.addEmployee({ name: 'Liam' });
    shift = await store.addShift(validShift(ava.id));
  });

  it('prevents duplicate pending requests for the same shift', async () => {
    await store.requestSwap({ shiftId: shift.id, toEmployeeId: liam.id });
    await expect(store.requestSwap({ shiftId: shift.id, toEmployeeId: liam.id })).rejects.toThrow(
      /pending/i
    );
  });

  it('approving a swap reassigns the shift and stamps resolution', async () => {
    const swap = await store.requestSwap({ shiftId: shift.id, toEmployeeId: liam.id });
    await store.approveSwap(swap.id);

    expect(store.state.shifts[0].assigneeId).toBe(liam.id);
    const resolved = store.state.swaps[0];
    expect(resolved.status).toBe(SWAP_STATUS.APPROVED);
    expect(resolved.resolvedAt).toBe('2026-08-04T09:00:00.000Z');
    expect(backend.peek('shifts')[0].assigneeId).toBe(liam.id);
  });

  it('declining a swap leaves the assignment untouched', async () => {
    const swap = await store.requestSwap({ shiftId: shift.id, toEmployeeId: liam.id });
    await store.declineSwap(swap.id);
    expect(store.state.shifts[0].assigneeId).toBe(ava.id);
    expect(store.state.swaps[0].status).toBe(SWAP_STATUS.DECLINED);
  });

  it('refuses to approve when the shift was reassigned after the request', async () => {
    const swap = await store.requestSwap({ shiftId: shift.id, toEmployeeId: liam.id });
    await store.updateShift(shift.id, { assigneeId: liam.id });
    await expect(store.approveSwap(swap.id)).rejects.toThrow(/reassigned/);
  });

  it('refuses to approve an already-resolved request without moving the shift', async () => {
    const swap = await store.requestSwap({ shiftId: shift.id, toEmployeeId: liam.id });
    await store.declineSwap(swap.id);

    await expect(store.approveSwap(swap.id)).rejects.toThrow(/already been resolved/i);
    expect(store.state.shifts[0].assigneeId).toBe(ava.id);
    expect(backend.peek('shifts')[0].assigneeId).toBe(ava.id);
  });
});

describe('attendance', () => {
  it('records and clears attendance', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const shift = await store.addShift(validShift(ava.id));

    await store.recordAttendance(shift.id, { status: 'late', clockIn: '09:20' });
    expect(store.state.attendance[shift.id].status).toBe('late');
    expect(backend.peek('attendance')[shift.id].clockIn).toBe('09:20');

    await store.clearAttendance(shift.id);
    expect(store.state.attendance[shift.id]).toBeUndefined();
  });

  it('rejects unknown statuses and unknown shifts', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const shift = await store.addShift(validShift(ava.id));
    await expect(store.recordAttendance(shift.id, { status: 'vibing' })).rejects.toThrow(/status/i);
    await expect(store.recordAttendance('ghost', { status: 'present' })).rejects.toThrow(/shift/i);
  });
});

describe('coverage requirements', () => {
  it('adds validated requirements and persists them in settings', async () => {
    const entry = await store.addCoverage({ role: ' Barista ', days: [5, 1, 1], count: '2' });
    expect(entry).toMatchObject({ role: 'Barista', days: [1, 5], count: 2, start: null, end: null });
    expect(backend.peek('settings').coverage).toHaveLength(1);
  });

  it('rejects bad input', async () => {
    await expect(store.addCoverage({ role: ' ', days: [1], count: 1 })).rejects.toThrow(/role/i);
    await expect(store.addCoverage({ role: 'X', days: [], count: 1 })).rejects.toThrow(/day/i);
    await expect(store.addCoverage({ role: 'X', days: [1], count: 0 })).rejects.toThrow(/between 1 and 50/i);
    await expect(store.addCoverage({ role: 'X', days: [1], count: 1, start: '09:00' })).rejects.toThrow(/both/i);
    await expect(
      store.addCoverage({ role: 'X', days: [1], count: 1, start: '17:00', end: '09:00' })
    ).rejects.toThrow(/after its start/i);
  });

  it('removes requirements and wipes them with sample data', async () => {
    const entry = await store.addCoverage({ role: 'X', days: [1], count: 1 });
    await store.removeCoverage(entry.id);
    expect(store.state.settings.coverage).toEqual([]);
    await expect(store.removeCoverage('ghost')).rejects.toThrow(/not found/i);

    await store.loadSampleData({ employees: [], coverage: [{ id: 'c', role: 'Y', days: [1], count: 1 }] });
    expect(store.state.settings.coverage).toHaveLength(1);
    await store.wipeSampleData();
    expect(store.state.settings.coverage).toEqual([]);
  });
});

describe('settings and sample data', () => {
  it('starts with default settings and persists updates', async () => {
    expect(store.state.settings).toEqual({
      onboarded: false,
      sampleData: false,
      coverage: [],
      currency: 'USD',
      roles: [],
      rules: { minRestHours: null, maxDailyHours: null, maxConsecutiveDays: null },
      graceMinutes: null,
      laborBudget: null,
      overtimeThresholdHours: null,
      overtimeMultiplier: null,
    });

    await store.updateSettings({ onboarded: true });
    expect(store.state.settings.onboarded).toBe(true);
    expect(backend.peek('settings').onboarded).toBe(true);

    const rehydrated = createStore(backend);
    await rehydrated.init();
    expect(rehydrated.state.settings).toEqual({
      onboarded: true,
      sampleData: false,
      coverage: [],
      currency: 'USD',
      roles: [],
      rules: { minRestHours: null, maxDailyHours: null, maxConsecutiveDays: null },
      graceMinutes: null,
      laborBudget: null,
      overtimeThresholdHours: null,
      overtimeMultiplier: null,
    });
  });

  it('loadSampleData installs the dataset and flags it', async () => {
    await store.loadSampleData({
      employees: [{ id: 'e1', name: 'Ava', role: '', color: '#000', active: true }],
      shifts: [],
      availability: { e1: { days: [] } },
      swaps: [],
      attendance: {},
    });

    expect(store.state.employees).toHaveLength(1);
    expect(store.state.settings.sampleData).toBe(true);
    expect(store.state.settings.onboarded).toBe(true);
    expect(backend.peek('settings').sampleData).toBe(true);
  });

  it('wipeSampleData clears every record but keeps onboarded', async () => {
    await store.loadSampleData({
      employees: [{ id: 'e1', name: 'Ava', role: '', color: '#000', active: true }],
      shifts: [{ id: 's1', date: '2026-08-05', start: '09:00', end: '17:00', role: 'Floor', assigneeId: 'e1' }],
      availability: { e1: { days: [] } },
      swaps: [],
      attendance: { s1: { status: 'present' } },
    });

    await store.wipeSampleData();

    expect(store.state.employees).toEqual([]);
    expect(store.state.shifts).toEqual([]);
    expect(store.state.availability).toEqual({});
    expect(store.state.attendance).toEqual({});
    expect(store.state.settings.sampleData).toBe(false);
    expect(store.state.settings.onboarded).toBe(true);
    expect(backend.peek('employees')).toEqual([]);
  });
});

describe('subscriptions', () => {
  it('notifies on every mutation and supports unsubscribe', async () => {
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    await store.addEmployee({ name: 'Ava' });
    await store.addShift(validShift());
    expect(calls).toBe(2);
    unsubscribe();
    await store.addEmployee({ name: 'Liam' });
    expect(calls).toBe(2);
  });
});
