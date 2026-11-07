/**
 * Sample data for onboarding: a small café team with availability, two weeks
 * of shifts, swap requests, and attendance history, all relative to today.
 */
import { addDays, isoToday, startOfWeek } from '../lib/time.js';
import { EMPLOYEE_COLORS } from './store.js';

const TEAM = [
  { id: 'emp_ava', name: 'Ava Chen', role: 'Shift Lead', targetHours: 38, maxHours: 40, hourlyRate: 22, email: 'ava@example.com', phone: '+1 555 0101' },
  { id: 'emp_liam', name: 'Liam Torres', role: 'Barista', targetHours: 32, maxHours: 40, hourlyRate: 17.5, email: 'liam@example.com', phone: '+1 555 0102' },
  { id: 'emp_noor', name: 'Noor Haddad', role: 'Barista', targetHours: 32, maxHours: 40, hourlyRate: 17.5, email: 'noor@example.com' },
  { id: 'emp_max', name: 'Max Kowalski', role: 'Server', targetHours: 30, maxHours: 40, hourlyRate: 16, phone: '+1 555 0104' },
  { id: 'emp_ines', name: 'Ines Fontaine', role: 'Server', targetHours: 32, maxHours: 36, hourlyRate: 16.5, email: 'ines@example.com', phone: '+1 555 0105' },
  // Theo has no rate on purpose: the cost totals show how partial data is
  // flagged. He has no contact details either, so the profile page shows
  // how that reads.
  { id: 'emp_theo', name: 'Theo Brandt', role: 'Kitchen', targetHours: 36, maxHours: 38 },
];

function day(off, start = '08:00', end = '18:00') {
  return off ? { off: true, start: '09:00', end: '17:00' } : { off: false, start, end };
}

// Index 0 = Sunday.
const AVAILABILITY = {
  emp_ava: [day(true), day(false, '07:00', '16:00'), day(false, '07:00', '16:00'), day(false, '07:00', '16:00'), day(false, '07:00', '16:00'), day(false, '07:00', '14:00'), day(true)],
  emp_liam: [day(false, '08:00', '20:00'), day(false, '06:00', '14:00'), day(false, '06:00', '14:00'), day(true), day(false, '06:00', '14:00'), day(false, '06:00', '14:00'), day(false, '08:00', '20:00')],
  emp_noor: [day(true), day(false, '12:00', '22:00'), day(false, '12:00', '22:00'), day(false, '12:00', '22:00'), day(true), day(false, '12:00', '22:00'), day(false, '10:00', '22:00')],
  emp_max: [day(false, '09:00', '21:00'), day(true), day(false, '10:00', '18:00'), day(false, '10:00', '18:00'), day(false, '10:00', '18:00'), day(false, '10:00', '20:00'), day(false, '09:00', '21:00')],
  emp_ines: [day(false, '08:00', '16:00'), day(false, '08:00', '16:00'), day(true), day(false, '08:00', '16:00'), day(false, '08:00', '16:00'), day(true), day(false, '08:00', '16:00')],
  emp_theo: [day(false, '10:00', '22:00'), day(false, '10:00', '22:00'), day(false, '10:00', '22:00'), day(false, '10:00', '22:00'), day(false, '10:00', '22:00'), day(false, '10:00', '22:00'), day(true)],
};

// Weekly shift pattern:
// [dayOffset from Monday, start, end, role, employee|null, unpaid break minutes]
const WEEK_PATTERN = [
  [0, '07:00', '15:00', 'Opening', 'emp_ava', 30],
  [0, '06:30', '13:30', 'Barista', 'emp_liam'],
  [0, '12:00', '20:00', 'Close', 'emp_noor', 30],
  [0, '08:00', '16:00', 'Floor', 'emp_ines', 30],
  [1, '07:00', '15:00', 'Opening', 'emp_ava', 30],
  [1, '06:30', '13:30', 'Barista', 'emp_liam'],
  [1, '12:00', '20:00', 'Close', 'emp_noor', 30],
  [1, '10:00', '18:00', 'Floor', 'emp_max', 30],
  [1, '11:00', '19:00', 'Kitchen', 'emp_theo', 30],
  [2, '07:00', '15:00', 'Opening', 'emp_ava', 30],
  [2, '12:00', '20:00', 'Close', 'emp_noor', 30],
  [2, '10:00', '18:00', 'Floor', 'emp_max', 30],
  [2, '11:00', '19:00', 'Kitchen', 'emp_theo', 30],
  [3, '07:00', '15:00', 'Opening', 'emp_ava', 30],
  [3, '06:30', '13:30', 'Barista', 'emp_liam'],
  [3, '08:00', '16:00', 'Floor', 'emp_ines', 30],
  [3, '12:00', '20:00', 'Close', null, 30],
  [4, '07:00', '14:00', 'Opening', 'emp_ava'],
  [4, '06:30', '13:30', 'Barista', 'emp_liam'],
  [4, '12:00', '20:00', 'Close', 'emp_noor', 30],
  [4, '10:00', '18:00', 'Floor', 'emp_max', 30],
  [4, '11:00', '19:00', 'Kitchen', 'emp_theo', 30],
  [5, '09:00', '17:00', 'Brunch', 'emp_max', 30],
  [5, '08:00', '16:00', 'Floor', 'emp_ines', 30],
  [5, '10:00', '18:00', 'Kitchen', 'emp_theo', 30],
  [5, '12:00', '20:00', 'Close', null, 30],
  [6, '09:00', '17:00', 'Brunch', 'emp_liam', 30],
  [6, '10:00', '18:00', 'Kitchen', 'emp_theo', 30],
];

export function buildSeedData(todayISO = isoToday()) {
  const thisMonday = startOfWeek(todayISO);
  const lastMonday = addDays(thisMonday, -7);
  const nextMonday = addDays(thisMonday, 7);
  const createdAt = `${todayISO}T09:00:00.000Z`;

  const employees = TEAM.map((e, i) => ({
    ...e,
    color: EMPLOYEE_COLORS[i % EMPLOYEE_COLORS.length],
    active: true,
    createdAt,
  }));

  const availability = Object.fromEntries(
    Object.entries(AVAILABILITY).map(([id, days]) => [id, { days, exceptions: [] }])
  );
  availability.emp_theo.exceptions.push({
    id: 'off_seed_1',
    from: addDays(thisMonday, 5),
    to: addDays(thisMonday, 6),
    note: 'Moving apartments',
  });

  const shifts = [];
  let n = 0;
  for (const [weekIdx, monday] of [lastMonday, thisMonday, nextMonday].entries()) {
    for (const [offset, start, end, role, assigneeId, breakMinutes] of WEEK_PATTERN) {
      // Keep next week lighter: skip a few slots so open shifts stand out.
      if (weekIdx === 2 && ['Close', 'Brunch'].includes(role) && offset > 3) continue;
      shifts.push({
        id: `shf_seed_${n++}`,
        date: addDays(monday, offset),
        start,
        end,
        role,
        assigneeId,
        note: '',
        breakMinutes: breakMinutes ?? 0,
        createdAt,
      });
    }
  }

  // Attendance for past shifts: mostly present, an occasional late/absence.
  const attendance = {};
  const past = shifts.filter((s) => s.date < todayISO && s.assigneeId);
  past.forEach((s, i) => {
    if (i % 9 === 8) {
      attendance[s.id] = { status: 'absent', clockIn: '', clockOut: '', note: 'Called in sick', recordedAt: createdAt };
    } else if (i % 4 === 3) {
      const [h, m] = s.start.split(':').map(Number);
      const lateBy = 10 + (i % 3) * 5;
      const inMins = h * 60 + m + lateBy;
      const clockIn = `${String(Math.floor(inMins / 60)).padStart(2, '0')}:${String(inMins % 60).padStart(2, '0')}`;
      attendance[s.id] = { status: 'late', clockIn, clockOut: s.end, note: '', recordedAt: createdAt };
    } else {
      attendance[s.id] = { status: 'present', clockIn: s.start, clockOut: s.end, note: '', recordedAt: createdAt };
    }
  });

  // A couple of pending swap requests on upcoming assigned shifts.
  const upcoming = shifts.filter((s) => s.date > todayISO && s.assigneeId);
  const swaps = [];
  if (upcoming.length >= 2) {
    const [a, b] = [upcoming[0], upcoming[Math.min(4, upcoming.length - 1)]];
    const otherFor = (shift) => employees.find((e) => e.id !== shift.assigneeId).id;
    swaps.push(
      {
        id: 'swp_seed_1',
        shiftId: a.id,
        fromEmployeeId: a.assigneeId,
        toEmployeeId: otherFor(a),
        reason: 'Doctor’s appointment',
        status: 'pending',
        createdAt,
        resolvedAt: null,
        shiftSnapshot: { date: a.date, start: a.start, end: a.end, role: a.role },
      },
      {
        id: 'swp_seed_2',
        shiftId: b.id,
        fromEmployeeId: b.assigneeId,
        toEmployeeId: otherFor(b),
        reason: 'Family visit that day',
        status: 'pending',
        createdAt,
        resolvedAt: null,
        shiftSnapshot: { date: b.date, start: b.start, end: b.end, role: b.role },
      }
    );
  }

  // Coverage requirements that leave a couple of visible gaps to explore.
  const coverage = [
    { id: 'cov_seed_1', role: 'Barista', days: [1, 2, 3, 4, 5], count: 1, start: null, end: null },
    { id: 'cov_seed_2', role: 'Close', days: [0, 1, 2, 3, 4, 5, 6], count: 1, start: '17:00', end: '19:00' },
  ];

  // Managed roles covering every label used above; a few carry colors so
  // open shifts on the schedule pick up an accent.
  const roles = [
    { id: 'role_seed_1', name: 'Barista', color: '#0ea5e9' },
    { id: 'role_seed_2', name: 'Brunch', color: null },
    { id: 'role_seed_3', name: 'Close', color: '#8b5cf6' },
    { id: 'role_seed_4', name: 'Floor', color: null },
    { id: 'role_seed_5', name: 'Kitchen', color: '#f97316' },
    { id: 'role_seed_6', name: 'Opening', color: '#10b981' },
    { id: 'role_seed_7', name: 'Server', color: null },
    { id: 'role_seed_8', name: 'Shift Lead', color: null },
  ];

  return { employees, availability, shifts, swaps, attendance, coverage, roles };
}
