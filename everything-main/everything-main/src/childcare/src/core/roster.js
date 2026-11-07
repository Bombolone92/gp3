/** Roster import and export as CSV: one row per child, with up to two family members. */
import { parseCSV, toCSV, findColumn } from './csv.js';
import { personName } from './format.js';
import { guardiansOf } from './people.js';
import { newId } from './ids.js';

const HEADERS = ['First name', 'Last name', 'Preferred name', 'Birthday', 'Status', 'Room', 'Start date', 'Allergies', 'Medications', 'Dietary needs', 'Family 1 name', 'Family 1 relation', 'Family 1 email', 'Family 1 phone', 'Family 2 name', 'Family 2 relation', 'Family 2 email', 'Family 2 phone'];

export function exportRosterCSV({ students, guardians, rooms }) {
  const roomName = (id) => rooms.find((r) => r.id === id)?.name || '';
  const rows = [HEADERS];
  for (const s of students) {
    const fam = guardiansOf(guardians, s.id).slice(0, 2);
    const g = (i) => (fam[i] ? [personName(fam[i]), fam[i].relation || '', fam[i].email || '', fam[i].phone || ''] : ['', '', '', '']);
    rows.push([s.firstName, s.lastName, s.preferredName || '', s.birthday || '', s.status || '', roomName(s.roomId), s.startDate || '', s.allergies || '', s.medications || '', s.dietary || '', ...g(0), ...g(1)]);
  }
  return toCSV(rows);
}

/** "3/7/2022", "2022-03-07", "7.3.2022" (day first when the first part > 12). */
export function parseDate(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const m = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/.exec(s);
  if (!m) return '';
  let [, a, b, c] = m;
  let y;
  let mo;
  let d;
  if (a.length === 4) [y, mo, d] = [a, b, c];
  else {
    // Two-digit years more than ten years ahead are last century: "3/7/95" is 1995, not 2095.
    y = c.length === 2 ? String((Number(c) > (new Date().getFullYear() % 100) + 10 ? 1900 : 2000) + Number(c)) : c;
    if (Number(a) > 12) [d, mo] = [a, b];
    else [mo, d] = [a, b];
  }
  const out = `${y.padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${out}T00:00:00`);
  return Number.isNaN(dt.getTime()) || dt.getMonth() + 1 !== Number(mo) ? '' : out;
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return { firstName: parts.slice(0, -1).join(' ') || parts[0], lastName: parts.length > 1 ? parts[parts.length - 1] : '' };
}

/**
 * Parse a roster CSV. Rooms are matched by name (case-insensitive) and
 * created when new. Resolves { students, guardians, rooms (new), skipped }.
 */
export function importRosterCSV(text, { rooms = [] } = {}) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { students: [], guardians: [], rooms: [], skipped: 0 };
  const [head, ...data] = rows;
  const col = (...aliases) => findColumn(head, aliases);
  const c = {
    first: col('first name', 'firstname', 'child first name', 'first'),
    last: col('last name', 'lastname', 'child last name', 'last', 'surname'),
    name: col('name', 'child name', 'student name', 'child', 'student'),
    preferred: col('preferred name', 'nickname'),
    birthday: col('birthday', 'birth date', 'date of birth', 'dob', 'birthdate'),
    status: col('status'),
    room: col('room', 'classroom', 'class'),
    start: col('start date', 'enrollment date', 'start'),
    allergies: col('allergies', 'allergy'),
    meds: col('medications', 'medication'),
    dietary: col('dietary needs', 'dietary', 'diet'),
  };
  const fam = [1, 2].map((n) => ({
    name: col(`family ${n} name`, `parent ${n} name`, `guardian ${n} name`, n === 1 ? 'parent name' : 'second parent name', n === 1 ? 'parent' : 'parent 2'),
    relation: col(`family ${n} relation`, `parent ${n} relation`, `guardian ${n} relation`),
    email: col(`family ${n} email`, `parent ${n} email`, `guardian ${n} email`, n === 1 ? 'parent email' : 'parent 2 email', n === 1 ? 'email' : 'second parent email'),
    phone: col(`family ${n} phone`, `parent ${n} phone`, `guardian ${n} phone`, n === 1 ? 'parent phone' : 'parent 2 phone', n === 1 ? 'phone' : 'second parent phone'),
  }));
  // Undo the apostrophe toCSV adds before =, +, - and @, so an exported roster imports unchanged.
  const get = (row, i) => (i >= 0 ? String(row[i] ?? '').trim().replace(/^'(?=[=+\-@])/, '') : '');
  const roomByName = new Map(rooms.map((r) => [r.name.toLowerCase(), r]));
  const newRooms = [];
  const students = [];
  const guardians = [];
  const byEmail = new Map();
  let skipped = 0;
  const STATUSES = ['active', 'waitlist', 'inquiry', 'inactive', 'graduated'];
  for (const row of data) {
    let first = get(row, c.first);
    let last = get(row, c.last);
    if (!first && c.name >= 0) {
      const n = splitName(get(row, c.name));
      if (n) ({ firstName: first, lastName: last } = n);
    }
    if (!first) {
      skipped++;
      continue;
    }
    let roomId = null;
    const rn = get(row, c.room);
    if (rn) {
      let r = roomByName.get(rn.toLowerCase());
      if (!r) {
        r = { id: newId(), name: rn, ratio: 0, capacity: 0, order: rooms.length + newRooms.length };
        roomByName.set(rn.toLowerCase(), r);
        newRooms.push(r);
      }
      roomId = r.id;
    }
    const status = get(row, c.status).toLowerCase();
    const s = {
      id: newId(),
      firstName: first,
      lastName: last,
      preferredName: get(row, c.preferred),
      birthday: parseDate(get(row, c.birthday)),
      status: STATUSES.includes(status) ? status : 'active',
      roomId,
      startDate: parseDate(get(row, c.start)),
      allergies: get(row, c.allergies),
      medications: get(row, c.meds),
      dietary: get(row, c.dietary),
      plans: [],
      schedule: [1, 2, 3, 4, 5],
    };
    students.push(s);
    fam.forEach((f, i) => {
      const n = splitName(get(row, f.name));
      if (!n) return;
      const email = get(row, f.email).toLowerCase();
      // Siblings on separate rows share one family member record.
      const existing = email ? byEmail.get(email) : null;
      if (existing) {
        existing.studentIds.push(s.id);
        return;
      }
      const g = { id: newId(), ...n, relation: get(row, f.relation) || 'Parent', email, phone: get(row, f.phone), studentIds: [s.id], canPickup: true, emergency: true, primary: i === 0, billing: i === 0 };
      if (email) byEmail.set(email, g);
      guardians.push(g);
    });
  }
  return { students, guardians, rooms: newRooms, skipped };
}
