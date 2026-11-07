/**
 * Children, families, staff, and rooms: lookups and derived facts.
 *
 *   students  { id, firstName, lastName, preferredName, birthday, gender, status,
 *               roomId, startDate, endDate, allergies, medications, dietary, conditions,
 *               doctor: { name, phone }, address, staffNotes, photo, immunizations: [{ vaccine, date }],
 *               plans: [{ planId, amountCents? }], schedule: [0..6], tags,
 *               inquiry: { firstContact, toured, desiredStart, source, notes } }
 *   guardians { id, firstName, lastName, relation, email, phone, studentIds: [],
 *               canPickup, emergency, primary, billing, pin, memberUuid, notes }
 *   staff     { id, firstName, lastName, title, email, phone, roomIds, color, hireDate,
 *               certifications: [{ name, expires }], pin, memberUuid, notes, active }
 *   rooms     { id, name, color, capacity, ratio, ageRange, order }
 */
import { personName, normalize } from './format.js';
import { nextBirthday, diffDays, today as todayISO } from './dates.js';

export const STUDENT_STATUSES = [
  { id: 'active', label: 'Enrolled', tone: 'success' },
  { id: 'waitlist', label: 'Waitlist', tone: 'warning' },
  { id: 'inquiry', label: 'Inquiry', tone: 'info' },
  { id: 'inactive', label: 'Inactive', tone: 'neutral' },
  { id: 'graduated', label: 'Graduated', tone: 'neutral' },
];

export const statusMeta = (id) => STUDENT_STATUSES.find((s) => s.id === id) || STUDENT_STATUSES[0];

export const RELATIONS = ['Mother', 'Father', 'Parent', 'Guardian', 'Grandparent', 'Aunt', 'Uncle', 'Sibling', 'Nanny', 'Family friend', 'Other'];

export const ROOM_COLORS = ['#2563eb', '#0d9488', '#c2410c', '#7c3aed', '#be185d', '#4d7c0f', '#b45309', '#0369a1', '#475569', '#9f1239'];

export function sortByName(list) {
  return [...list].sort((a, b) => personName(a).localeCompare(personName(b)));
}

export function sortRooms(rooms) {
  return [...rooms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
}

export function activeStudents(students) {
  return students.filter((s) => s.status === 'active');
}

export function studentsInRoom(students, roomId) {
  return students.filter((s) => s.roomId === roomId);
}

export function guardiansOf(guardians, studentId) {
  return guardians
    .filter((g) => (g.studentIds || []).includes(studentId))
    .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || personName(a).localeCompare(personName(b)));
}

/** People allowed to pick a child up: family with the flag, plus approved pickups. */
export function pickupPeople(guardians, studentId) {
  return guardiansOf(guardians, studentId).filter((g) => g.canPickup);
}

export function childrenOf(students, guardian) {
  const ids = new Set(guardian?.studentIds || []);
  return students.filter((s) => ids.has(s.id));
}

/** Birthdays in the next `days` days, soonest first: [{ student, date, turning }]. */
export function upcomingBirthdays(students, days = 30, ref = todayISO()) {
  const out = [];
  for (const s of students) {
    if (!s.birthday || s.status !== 'active') continue;
    const date = nextBirthday(s.birthday, ref);
    if (!date) continue;
    const inDays = diffDays(ref, date);
    if (inDays <= days) out.push({ student: s, date, inDays, turning: Number(date.slice(0, 4)) - Number(s.birthday.slice(0, 4)) });
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}

export function hasAllergy(s) {
  return !!String(s?.allergies || '').trim();
}

/** Certifications expiring within `days` (or already expired). */
export function expiringCertifications(staff, days = 30, ref = todayISO()) {
  const out = [];
  for (const m of staff) {
    if (m.active === false) continue;
    for (const c of m.certifications || []) {
      if (!c.expires) continue;
      const left = diffDays(ref, c.expires);
      if (left <= days) out.push({ member: m, cert: c, left });
    }
  }
  return out.sort((a, b) => a.left - b.left);
}

export function searchPeople(list, query) {
  const q = normalize(query).trim();
  if (!q) return list;
  return list.filter((p) => normalize(`${p.firstName} ${p.lastName} ${p.preferredName || ''}`).includes(q));
}

/** A random 4-digit PIN not used by anyone in `taken`. */
export function newPin(taken = []) {
  const used = new Set(taken.filter(Boolean));
  for (let i = 0; i < 200; i++) {
    const b = new Uint32Array(1);
    crypto.getRandomValues(b);
    const pin = String(b[0] % 10000).padStart(4, '0');
    if (!used.has(pin)) return pin;
  }
  return String(Date.now() % 10000).padStart(4, '0');
}

/** Immunization doses recorded, grouped by vaccine: [{ vaccine, dates }]. */
export function immunizationSummary(student) {
  const by = new Map();
  for (const i of student?.immunizations || []) {
    if (!i.vaccine) continue;
    if (!by.has(i.vaccine)) by.set(i.vaccine, []);
    by.get(i.vaccine).push(i.date);
  }
  return [...by].map(([vaccine, dates]) => ({ vaccine, dates: dates.filter(Boolean).sort() }));
}

export const VACCINES = ['DTaP', 'Hep B', 'Hib', 'Polio (IPV)', 'PCV', 'MMR', 'Varicella', 'Hep A', 'Rotavirus', 'Influenza', 'COVID-19'];
