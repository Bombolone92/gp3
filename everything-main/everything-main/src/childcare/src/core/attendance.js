/**
 * Attendance: one record per child (and per staff member) per day, in the
 * day's partition "attendance:YYYY-MM-DD". A record keeps the day's events
 * in order, so the current state is simply the last event.
 *
 *   { id: 's-<studentId>', kind: 'student', studentId, roomId,
 *     events: [{ type: 'in' | 'out' | 'move', at: 'HH:MM', roomId, by, person, note }],
 *     absent: { reason, note, by, at } | null }
 *   { id: 't-<staffId>', kind: 'staff', staffId, roomId, events: [...] }
 *
 * Deterministic ids mean two devices checking in the same child edit the
 * same record instead of creating duplicates.
 */
import { partition } from './keys.js';
import { timeToMinutes } from './dates.js';

export const attendanceName = (day) => partition('attendance', day);
export const studentRecordId = (studentId) => `s-${studentId}`;
export const staffRecordId = (staffId) => `t-${staffId}`;

export function nowHHMM(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 'in' | 'out' | 'absent' | 'none' */
export function statusOf(rec) {
  if (!rec) return 'none';
  const last = lastPresence(rec);
  if (last) return last.type === 'out' ? 'out' : 'in';
  return rec.absent ? 'absent' : 'none';
}

/** The last check-in or check-out. A room move changes the room, not whether someone is here. */
function lastPresence(rec) {
  const ev = rec?.events || [];
  for (let i = ev.length - 1; i >= 0; i--) if (ev[i].type === 'in' || ev[i].type === 'out') return ev[i];
  return null;
}

/** The room a checked-in person is in right now (null when not in). */
export function currentRoom(rec) {
  if (statusOf(rec) !== 'in') return null;
  const ev = rec.events;
  for (let i = ev.length - 1; i >= 0; i--) if (ev[i].type === 'in' || ev[i].type === 'move') return ev[i].roomId || rec.roomId || null;
  return rec.roomId || null;
}

export function firstIn(rec) {
  return (rec?.events || []).find((e) => e.type === 'in')?.at || null;
}

export function lastOut(rec) {
  const ev = rec?.events || [];
  for (let i = ev.length - 1; i >= 0; i--) if (ev[i].type === 'out') return ev[i].at;
  return null;
}

/**
 * Minutes present over the day. An open stay counts up to `untilHHMM`
 * (now, for today) or not at all when no end is given.
 */
export function minutesPresent(rec, untilHHMM = null) {
  let total = 0;
  let start = null;
  for (const e of rec?.events || []) {
    if (e.type === 'in' && start === null) start = timeToMinutes(e.at);
    else if (e.type === 'out' && start !== null) {
      total += Math.max(0, timeToMinutes(e.at) - start);
      start = null;
    }
  }
  if (start !== null && untilHHMM) total += Math.max(0, timeToMinutes(untilHHMM) - start);
  return total;
}

function upsert(store, day, id, base, mutate) {
  const name = attendanceName(day);
  const cur = store.get(name, id);
  const next = cur ? structuredClone(cur) : { id, events: [], absent: null, ...base };
  mutate(next);
  return store.put(name, next);
}

export function checkIn(store, day, studentId, { roomId, at = nowHHMM(), by = '', person = '', note = '' } = {}) {
  return upsert(store, day, studentRecordId(studentId), { kind: 'student', studentId, roomId }, (r) => {
    r.absent = null;
    if (roomId) r.roomId = roomId;
    r.events.push(clean({ type: 'in', at, roomId: roomId || r.roomId, by, person, note }));
  });
}

export function checkOut(store, day, studentId, { at = nowHHMM(), by = '', person = '', note = '' } = {}) {
  return upsert(store, day, studentRecordId(studentId), { kind: 'student', studentId }, (r) => {
    r.events.push(clean({ type: 'out', at, roomId: currentRoom(r) || r.roomId, by, person, note }));
  });
}

export function moveRoom(store, day, studentId, roomId, { at = nowHHMM(), by = '' } = {}) {
  return upsert(store, day, studentRecordId(studentId), { kind: 'student', studentId }, (r) => {
    r.roomId = roomId;
    r.events.push(clean({ type: 'move', at, roomId, by }));
  });
}

export function markAbsent(store, day, studentId, { reason = '', note = '', by = '', at = nowHHMM() } = {}) {
  return upsert(store, day, studentRecordId(studentId), { kind: 'student', studentId }, (r) => {
    r.absent = clean({ reason, note, by, at });
  });
}

export function clearAbsent(store, day, studentId) {
  return upsert(store, day, studentRecordId(studentId), { kind: 'student', studentId }, (r) => {
    r.absent = null;
  });
}

/** Remove one event (a mistaken tap). */
export function removeEvent(store, day, recordId, index) {
  const name = attendanceName(day);
  const cur = store.get(name, recordId);
  if (!cur) return null;
  const next = structuredClone(cur);
  next.events.splice(index, 1);
  if (!next.events.length && !next.absent) {
    store.remove(name, recordId);
    return null;
  }
  return store.put(name, next);
}

export function updateEvent(store, day, recordId, index, changes) {
  const name = attendanceName(day);
  const cur = store.get(name, recordId);
  if (!cur || !cur.events[index]) return null;
  const next = structuredClone(cur);
  // Events keep their order: the last one says whether the child is here,
  // and a mistyped time must not turn a check-out into a check-in.
  // A cleared time field must not erase the time: the stay would stop counting.
  const { at, ...rest } = changes;
  next.events[index] = clean({ ...next.events[index], ...rest, ...(at ? { at } : {}) });
  return store.put(name, next);
}

export function staffClockIn(store, day, staffId, { roomId = null, at = nowHHMM(), by = '' } = {}) {
  return upsert(store, day, staffRecordId(staffId), { kind: 'staff', staffId, roomId }, (r) => {
    if (roomId) r.roomId = roomId;
    r.events.push(clean({ type: 'in', at, roomId: roomId || r.roomId, by }));
  });
}

export function staffClockOut(store, day, staffId, { at = nowHHMM(), by = '' } = {}) {
  return upsert(store, day, staffRecordId(staffId), { kind: 'staff', staffId }, (r) => {
    r.events.push(clean({ type: 'out', at, roomId: currentRoom(r) || r.roomId, by }));
  });
}

export function staffMoveRoom(store, day, staffId, roomId, { at = nowHHMM(), by = '' } = {}) {
  return upsert(store, day, staffRecordId(staffId), { kind: 'staff', staffId }, (r) => {
    r.roomId = roomId;
    r.events.push(clean({ type: 'move', at, roomId, by }));
  });
}

function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== '' && v !== null && v !== undefined) out[k] = v;
  return out;
}

/** Index a day's records: { students: Map(studentId -> rec), staff: Map(staffId -> rec) }. */
export function indexDay(records) {
  const students = new Map();
  const staff = new Map();
  for (const r of records || []) {
    if (r.kind === 'staff' && r.staffId) staff.set(r.staffId, r);
    else if (r.studentId) students.set(r.studentId, r);
  }
  return { students, staff };
}

/**
 * Live ratios per room: who is checked in where, compared with the room's
 * required ratio (children per staff member).
 */
export function roomRatios(rooms, dayRecords) {
  const { students, staff } = indexDay(dayRecords);
  const rows = rooms.map((room) => ({ room, students: 0, staff: 0 }));
  const byId = new Map(rows.map((r) => [r.room.id, r]));
  for (const rec of students.values()) {
    const row = byId.get(currentRoom(rec));
    if (row) row.students++;
  }
  for (const rec of staff.values()) {
    const row = byId.get(currentRoom(rec));
    if (row) row.staff++;
  }
  for (const row of rows) {
    const max = Number(row.room.ratio) || 0;
    row.needed = max ? Math.ceil(row.students / max) : 0;
    row.ok = !row.students || (row.staff > 0 && (!max || row.students <= row.staff * max));
    // Children per staff member, written the usual way as 1:N.
    row.label = row.staff ? `${Number((row.students / row.staff).toFixed(1))}` : '';
  }
  const total = rows.reduce((a, r) => ({ students: a.students + r.students, staff: a.staff + r.staff }), { students: 0, staff: 0 });
  return { rows, total };
}

/** Day summary counts for a set of students. */
export function daySummary(students, dayRecords) {
  const { students: idx } = indexDay(dayRecords);
  const out = { in: 0, out: 0, absent: 0, none: 0 };
  for (const s of students) out[statusOf(idx.get(s.id))]++;
  return out;
}
