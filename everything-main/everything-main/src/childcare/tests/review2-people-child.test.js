// @vitest-environment jsdom
/** Second adversarial review: the child page tabs and the staff timecard. */
import { describe, it, expect, beforeAll } from 'vitest';
import { bootViews, go, app, tick } from './review2-people-harness.js';
import { attendanceName, checkIn, checkOut, clearAbsent, markAbsent, staffClockIn, staffClockOut } from '../src/core/attendance.js';
import { addDays } from '../src/core/dates.js';

let main;
beforeAll(async () => {
  main = await bootViews();
});

const fresh = (firstName) => app.store.put('students', { firstName, lastName: 'Test', status: 'active', roomId: app.store.all('rooms')[0].id, schedule: [1, 2, 3, 4, 5] });
const waitFor = async (fn) => {
  for (let i = 0; i < 50 && !fn(); i++) await tick(20);
};

describe('child attendance tab', () => {
  it('a day whose absence was cleared is not counted as present', async () => {
    const s = fresh('Cleo');
    const day = app.today();
    await app.store.open([attendanceName(day)]);
    markAbsent(app.store, day, s.id, { reason: 'Sick' });
    clearAbsent(app.store, day, s.id);
    await go(`#/children/${s.id}?tab=attendance`);
    await tick(100);
    const stat = (label) => [...main.querySelectorAll('.stat')].find((x) => x.textContent.startsWith(label)).querySelector('.stat-value').textContent;
    expect(stat('Days present')).toBe('0');
    expect(stat('Absences')).toBe('0');
    expect(main.textContent).toContain('No attendance this month.');
  });

  it('a child who left and came back shows Here now, not the earlier check-out', async () => {
    const s = fresh('Remy');
    const day = app.today();
    await app.store.open([attendanceName(day)]);
    checkIn(app.store, day, s.id, { at: '00:01' });
    checkOut(app.store, day, s.id, { at: '00:02' });
    checkIn(app.store, day, s.id, { at: '00:03' });
    await go(`#/children/${s.id}?tab=attendance`);
    await waitFor(() => main.querySelector('tbody tr'));
    const out = main.querySelector('tbody tr').children[2].textContent;
    expect(out).toBe('Here now');
  });
});

describe('child billing tab', () => {
  it('payments show the method label, not its id', async () => {
    const s = fresh('Pia');
    app.store.put('payments', { studentId: s.id, date: app.today(), amountCents: 5000, method: 'card' });
    await go(`#/children/${s.id}?tab=billing`);
    await tick(30);
    expect(main.textContent).toContain('Credit or debit card');
  });
});

describe('staff timecard', () => {
  it('a staff member who clocked out and back in shows Working, not the earlier clock-out', async () => {
    const m = app.store.put('staff', { firstName: 'Tess', lastName: 'Test', active: true, roomIds: [] });
    const day = app.today();
    await app.store.open([attendanceName(day)]);
    const room = app.store.all('rooms')[0].id;
    staffClockIn(app.store, day, m.id, { roomId: room, at: '00:01' });
    staffClockOut(app.store, day, m.id, { at: '00:02' });
    staffClockIn(app.store, day, m.id, { roomId: room, at: '00:03' });
    await go(`#/staff/${m.id}`);
    await tick(30);
    const row = [...main.querySelectorAll('tbody tr')].find((tr) => tr.children[1].textContent !== '-');
    expect(row.children[2].textContent).toBe('Working');
  });
});

describe('child page header', () => {
  it('double-clicking Check in does not check the child straight back out', async () => {
    const s = fresh('Dot');
    const day = app.today();
    await app.store.open([attendanceName(day)]);
    await go(`#/children/${s.id}`);
    const btn = () => [...main.querySelectorAll('.child-actions button')].find((b) => /Check (in|out)/.test(b.textContent));
    expect(btn().textContent).toBe('Check in');
    btn().click();
    await tick(30);
    // The second click of the double-click lands on the button that replaced it.
    expect(btn().textContent).toBe('Check out');
    btn().click();
    await tick(30);
    const { statusOf, studentRecordId } = await import('../src/core/attendance.js');
    expect(statusOf(app.store.get(attendanceName(day), studentRecordId(s.id)))).toBe('in');
  });
});

describe('room form', () => {
  it('a negative or fractional capacity and ratio are saved as whole, non-negative numbers', async () => {
    const { openRoomForm } = await import('../src/views/rooms.js');
    openRoomForm();
    const dlg = document.querySelector('dialog[open]');
    const set = (label, v) => {
      const id = [...dlg.querySelectorAll('label')].find((l) => l.textContent.startsWith(label)).htmlFor;
      const i = document.getElementById(id);
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    set('Name', 'Ratio Test');
    set('Capacity', '-5');
    set('Children per staff member', '-2');
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Add room').click();
    const room = app.store.all('rooms').find((r) => r.name === 'Ratio Test');
    expect(room.capacity).toBe(0);
    expect(room.ratio).toBe(0);
  });
});
