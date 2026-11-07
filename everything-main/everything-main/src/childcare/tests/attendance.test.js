import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { attendanceName, checkIn, checkOut, moveRoom, markAbsent, statusOf, currentRoom, minutesPresent, roomRatios, removeEvent, updateEvent, staffClockIn, daySummary, indexDay } from '../src/core/attendance.js';

const DAY = '2026-10-12';
async function store() {
  const s = createStore({ backend: createMemoryBackend(), flushDelay: 10_000 });
  await s.init();
  return s;
}
const rec = (s, id) => s.get(attendanceName(DAY), `s-${id}`);

describe('attendance', () => {
  it('tracks a day from check-in through a room move to check-out', async () => {
    const s = await store();
    checkIn(s, DAY, 'k1', { roomId: 'r1', at: '08:00', person: 'Mom' });
    expect(statusOf(rec(s, 'k1'))).toBe('in');
    moveRoom(s, DAY, 'k1', 'r2', { at: '10:00' });
    expect(currentRoom(rec(s, 'k1'))).toBe('r2');
    checkOut(s, DAY, 'k1', { at: '16:30', person: 'Dad' });
    const r = rec(s, 'k1');
    expect(statusOf(r)).toBe('out');
    expect(currentRoom(r)).toBeNull();
    expect(r.events.map((e) => e.type)).toEqual(['in', 'move', 'out']);
    expect(r.events[2]).toMatchObject({ roomId: 'r2', person: 'Dad' });
    expect(minutesPresent(r)).toBe(8 * 60 + 30);
  });

  it('counts an open stay up to now, and several stays in a day', async () => {
    const s = await store();
    checkIn(s, DAY, 'k1', { roomId: 'r1', at: '08:00' });
    expect(minutesPresent(rec(s, 'k1'), '09:15')).toBe(75);
    expect(minutesPresent(rec(s, 'k1'))).toBe(0);
    checkOut(s, DAY, 'k1', { at: '11:00' });
    checkIn(s, DAY, 'k1', { roomId: 'r1', at: '13:00' });
    checkOut(s, DAY, 'k1', { at: '14:00' });
    expect(minutesPresent(rec(s, 'k1'))).toBe(240);
  });

  it('marks absences and clears them on arrival', async () => {
    const s = await store();
    markAbsent(s, DAY, 'k1', { reason: 'Sick' });
    expect(statusOf(rec(s, 'k1'))).toBe('absent');
    checkIn(s, DAY, 'k1', { roomId: 'r1', at: '10:00' });
    expect(rec(s, 'k1').absent).toBeNull();
    expect(statusOf(rec(s, 'k1'))).toBe('in');
  });

  it('corrects times and removes mistaken taps', async () => {
    const s = await store();
    checkIn(s, DAY, 'k1', { roomId: 'r1', at: '08:00' });
    checkOut(s, DAY, 'k1', { at: '09:00' });
    updateEvent(s, DAY, 's-k1', 0, { at: '07:30' });
    expect(rec(s, 'k1').events.map((e) => e.at)).toEqual(['07:30', '09:00']);
    // A mistyped time never reorders events: the child stays checked out.
    updateEvent(s, DAY, 's-k1', 1, { at: '07:00' });
    expect(statusOf(rec(s, 'k1'))).toBe('out');
    removeEvent(s, DAY, 's-k1', 0);
    removeEvent(s, DAY, 's-k1', 0);
    expect(rec(s, 'k1')).toBeNull();
  });

  it('computes live ratios per room', async () => {
    const s = await store();
    const rooms = [{ id: 'r1', ratio: 4 }, { id: 'r2', ratio: 10 }, { id: 'r3', ratio: 6 }];
    for (let i = 0; i < 5; i++) checkIn(s, DAY, `k${i}`, { roomId: 'r1', at: '08:00' });
    checkIn(s, DAY, 'k9', { roomId: 'r2', at: '08:00' });
    staffClockIn(s, DAY, 't1', { roomId: 'r1', at: '07:00' });
    const { rows, total } = roomRatios(rooms, s.all(attendanceName(DAY)));
    expect(rows[0]).toMatchObject({ students: 5, staff: 1, needed: 2, ok: false, label: '5' });
    expect(rows[1]).toMatchObject({ students: 1, staff: 0, ok: false });
    expect(rows[2]).toMatchObject({ students: 0, ok: true });
    expect(total).toEqual({ students: 6, staff: 1 });
    staffClockIn(s, DAY, 't2', { roomId: 'r1', at: '07:00' });
    expect(roomRatios(rooms, s.all(attendanceName(DAY))).rows[0]).toMatchObject({ ok: true, label: '2.5' });
  });

  it('summarizes a day for a set of children', async () => {
    const s = await store();
    checkIn(s, DAY, 'a', { roomId: 'r', at: '08:00' });
    markAbsent(s, DAY, 'b', { reason: 'Sick' });
    const kids = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(daySummary(kids, s.all(attendanceName(DAY)))).toEqual({ in: 1, out: 0, absent: 1, none: 1 });
    expect(indexDay(s.all(attendanceName(DAY))).students.size).toBe(2);
  });
});
