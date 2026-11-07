import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { SWAP_STATUS } from '../src/core/swaps.js';

let backend;
let store;

const validShift = (assigneeId = null, date = '2026-08-05') => ({
  date,
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

describe('archiveEmployee', () => {
  it('deactivates the employee, opens upcoming shifts, and cancels their pending swaps', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const liam = await store.addEmployee({ name: 'Liam' });
    await store.addTimeOff(ava.id, { from: '2026-08-10', to: '2026-08-11', note: 'Trip' });
    const upcoming = await store.addShift(validShift(ava.id));
    const past = await store.addShift(validShift(ava.id, '2026-08-01'));
    const attended = await store.addShift(validShift(ava.id, '2026-08-06'));
    await store.recordAttendance(attended.id, { status: 'present', clockIn: '09:00', clockOut: '17:00' });
    await store.requestSwap({ shiftId: upcoming.id, toEmployeeId: liam.id, reason: '' });

    await store.archiveEmployee(ava.id);

    const employee = store.state.employees.find((e) => e.id === ava.id);
    expect(employee.active).toBe(false);
    // Profile, availability, and history all survive.
    expect(store.state.availability[ava.id].exceptions).toHaveLength(1);
    expect(store.state.shifts.find((s) => s.id === past.id).assigneeId).toBe(ava.id);
    expect(store.state.shifts.find((s) => s.id === attended.id).assigneeId).toBe(ava.id);
    // Upcoming unattended work is freed and pending swaps close.
    expect(store.state.shifts.find((s) => s.id === upcoming.id).assigneeId).toBeNull();
    expect(store.state.swaps[0].status).toBe(SWAP_STATUS.CANCELLED);
    expect(backend.peek('employees').find((e) => e.id === ava.id).active).toBe(false);
  });

  it('refuses to hand an archived employee a new shift, but keeps the ones they hold', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const liam = await store.addEmployee({ name: 'Liam' });
    const past = await store.addShift(validShift(ava.id, '2026-08-01'));
    const open = await store.addShift(validShift(null, '2026-08-06'));
    await store.archiveEmployee(ava.id);

    // Every path that puts somebody on a shift asks the same question.
    await expect(store.addShift(validShift(ava.id))).rejects.toThrow(/archived/);
    await expect(
      store.addRepeatingShifts(validShift(ava.id), { weekdays: [3], until: '2026-08-12' })
    ).rejects.toThrow(/archived/);
    await expect(store.updateShift(open.id, { ...open, assigneeId: ava.id })).rejects.toThrow(/archived/);
    await expect(store.moveShift(open.id, { date: open.date, assigneeId: ava.id })).rejects.toThrow(/archived/);
    await expect(store.copyShift(past.id, { date: '2026-08-07', assigneeId: ava.id })).rejects.toThrow(/archived/);
    await expect(store.assignShifts([{ shiftId: open.id, assigneeId: ava.id }])).rejects.toThrow(/archived/);
    expect(store.state.shifts.find((s) => s.id === open.id).assigneeId).toBeNull();

    // The worked shift stays hers, and editing it does not have to
    // reassign it: re-sending her id is not a new assignment.
    const edited = await store.updateShift(past.id, { ...past, note: 'Covered the bar' });
    expect(edited).toMatchObject({ assigneeId: ava.id, note: 'Covered the bar' });
    // Moving her worked shift onto somebody active is still a move.
    const { shift } = await store.moveShift(past.id, { date: past.date, assigneeId: liam.id });
    expect(shift.assigneeId).toBe(liam.id);

    // Restored, she can be scheduled again.
    await store.unarchiveEmployee(ava.id);
    const fresh = await store.addShift(validShift(ava.id));
    expect(fresh.assigneeId).toBe(ava.id);
  });

  it('refuses to archive twice and supports undo', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const upcoming = await store.addShift(validShift(ava.id));

    const undo = await store.archiveEmployee(ava.id);
    await expect(store.archiveEmployee(ava.id)).rejects.toThrow(/already archived/i);

    await undo();
    expect(store.state.employees[0].active).toBe(true);
    expect(store.state.shifts.find((s) => s.id === upcoming.id).assigneeId).toBe(ava.id);
  });
});

describe('unarchiveEmployee', () => {
  it('reactivates an archived employee and persists it', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    await store.archiveEmployee(ava.id);
    await store.unarchiveEmployee(ava.id);
    expect(store.state.employees[0].active).toBe(true);
    expect(backend.peek('employees')[0].active).toBe(true);

    await expect(store.unarchiveEmployee(ava.id)).rejects.toThrow(/not archived/i);
  });

  it('does not bring back shifts that were opened by archiving', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const upcoming = await store.addShift(validShift(ava.id));
    await store.archiveEmployee(ava.id);
    await store.unarchiveEmployee(ava.id);
    expect(store.state.shifts.find((s) => s.id === upcoming.id).assigneeId).toBeNull();
  });
});
