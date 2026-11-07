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

describe('undo deleteShift', () => {
  it('restores the shift, its attendance record, and cancelled swaps', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const liam = await store.addEmployee({ name: 'Liam' });
    const shift = await store.addShift(validShift(ava.id));
    await store.recordAttendance(shift.id, { status: 'present', clockIn: '09:00', clockOut: '17:00' });
    const swap = await store.requestSwap({ shiftId: shift.id, toEmployeeId: liam.id, reason: '' });

    const undo = await store.deleteShift(shift.id);
    expect(store.state.shifts).toHaveLength(0);
    expect(store.state.attendance[shift.id]).toBeUndefined();
    expect(store.state.swaps[0].status).toBe(SWAP_STATUS.CANCELLED);

    await undo();
    expect(store.state.shifts.map((s) => s.id)).toEqual([shift.id]);
    expect(store.state.attendance[shift.id]?.status).toBe('present');
    expect(store.state.swaps.find((s) => s.id === swap.id)?.status).toBe(SWAP_STATUS.PENDING);
    expect(backend.peek('shifts')).toHaveLength(1);
    expect(backend.peek('swaps')[0].status).toBe(SWAP_STATUS.PENDING);
  });
});

describe('undo deleteEmployee', () => {
  it('restores the employee in place with availability, shifts, and swaps', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const liam = await store.addEmployee({ name: 'Liam' });
    const noor = await store.addEmployee({ name: 'Noor' });
    await store.addTimeOff(liam.id, { from: '2026-08-10', to: '2026-08-11', note: 'Trip' });
    const upcoming = await store.addShift(validShift(liam.id));
    const swapShift = await store.addShift({ ...validShift(ava.id), date: '2026-08-06' });
    await store.requestSwap({ shiftId: swapShift.id, toEmployeeId: liam.id, reason: '' });

    const undo = await store.deleteEmployee(liam.id);
    expect(store.state.employees.map((e) => e.name)).toEqual(['Ava', 'Noor']);
    expect(store.state.shifts.find((s) => s.id === upcoming.id).assigneeId).toBeNull();
    expect(store.state.swaps[0].status).toBe(SWAP_STATUS.CANCELLED);

    await undo();
    expect(store.state.employees.map((e) => e.name)).toEqual(['Ava', 'Liam', 'Noor']);
    expect(store.state.availability[liam.id].exceptions).toHaveLength(1);
    expect(store.state.shifts.find((s) => s.id === upcoming.id).assigneeId).toBe(liam.id);
    expect(store.state.swaps[0].status).toBe(SWAP_STATUS.PENDING);
    expect(backend.peek('employees')).toHaveLength(3);
  });

  it('does not reassign shifts that were already open before the delete', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const open = await store.addShift(validShift(null));

    const undo = await store.deleteEmployee(ava.id);
    await undo();
    expect(store.state.shifts.find((s) => s.id === open.id).assigneeId).toBeNull();
  });
});

describe('undo removeTimeOff and clearAttendance', () => {
  it('re-adds a removed time-off entry in sorted position', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    await store.addTimeOff(ava.id, { from: '2026-08-20', to: '2026-08-21' });
    const early = await store.addTimeOff(ava.id, { from: '2026-08-10', to: '2026-08-11' });

    const undo = await store.removeTimeOff(ava.id, early.id);
    expect(store.state.availability[ava.id].exceptions).toHaveLength(1);

    await undo();
    expect(store.state.availability[ava.id].exceptions.map((x) => x.from)).toEqual([
      '2026-08-10',
      '2026-08-20',
    ]);
  });

  it('restores a cleared attendance record and returns null when there was none', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const shift = await store.addShift(validShift(ava.id));
    await store.recordAttendance(shift.id, { status: 'late', clockIn: '09:20', clockOut: '17:00' });

    const undo = await store.clearAttendance(shift.id);
    expect(store.state.attendance[shift.id]).toBeUndefined();
    await undo();
    expect(store.state.attendance[shift.id]?.status).toBe('late');

    await store.clearAttendance(shift.id);
    expect(await store.clearAttendance(shift.id)).toBeNull();
  });
});

describe('undo lifecycle', () => {
  it('is single level: a newer destructive action invalidates the older undo', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const first = await store.addShift(validShift(ava.id));
    const second = await store.addShift({ ...validShift(ava.id), date: '2026-08-06' });

    const undoFirst = await store.deleteShift(first.id);
    const undoSecond = await store.deleteShift(second.id);

    await expect(undoFirst()).rejects.toThrow(/no longer/i);
    await undoSecond();
    expect(store.state.shifts.map((s) => s.id)).toEqual([second.id]);
  });

  it('cannot be applied twice', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const shift = await store.addShift(validShift(ava.id));
    const undo = await store.deleteShift(shift.id);
    await undo();
    await expect(undo()).rejects.toThrow(/no longer/i);
  });

  it('is invalidated by bulk data replacement', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const shift = await store.addShift(validShift(ava.id));
    const undo = await store.deleteShift(shift.id);
    await store.wipeSampleData();
    await expect(undo()).rejects.toThrow(/no longer/i);
  });
});
