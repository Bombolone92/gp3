import { describe, it, expect } from 'vitest';
import { defaultAvailability, suggestAssignees, AVAILABILITY } from '../src/core/scheduling.js';

// 2026-08-05 is a Wednesday.
const openShift = {
  id: 'open1',
  date: '2026-08-05',
  start: '10:00',
  end: '16:00',
  role: 'Barista',
  assigneeId: null,
};

const employee = (id, name, extra = {}) => ({
  id,
  name,
  role: '',
  active: true,
  targetHours: null,
  maxHours: null,
  ...extra,
});

/** Availability that is open 9-17 every day unless overridden. */
function availabilityFor(overrides = {}) {
  return { ...defaultAvailability(), ...overrides };
}

describe('suggestAssignees hard blockers', () => {
  it('excludes inactive, time off, conflicts, unavailability, and over-max candidates', () => {
    const employees = [
      employee('e1', 'Active Ava'),
      employee('e2', 'Archived Bo', { active: false }),
      employee('e3', 'Vacation Cam'),
      employee('e4', 'Busy Dee'),
      employee('e5', 'Off-day Ed'),
      employee('e6', 'Maxed Fay', { maxHours: 10 }),
    ];
    const availability = {
      e3: availabilityFor({
        exceptions: [{ id: 'x1', from: '2026-08-04', to: '2026-08-06', note: '' }],
      }),
      e5: availabilityFor({
        days: defaultAvailability().days.map((d, i) => (i === 3 ? { ...d, off: true } : d)),
      }),
    };
    const shifts = [
      openShift,
      // Dee already works an overlapping shift that day.
      { id: 's1', date: '2026-08-05', start: '09:00', end: '12:00', role: 'Floor', assigneeId: 'e4' },
      // Fay has 8h earlier in the week; this 6h shift would pass her 10h max.
      { id: 's2', date: '2026-08-03', start: '09:00', end: '17:00', role: 'Floor', assigneeId: 'e6' },
    ];

    const result = suggestAssignees(openShift, { employees, shifts, availability });
    expect(result.map((s) => s.employee.name)).toEqual(['Active Ava']);
  });

  it('excludes time off on the landing day of an overnight shift', () => {
    const overnight = { ...openShift, start: '22:00', end: '04:00' };
    const employees = [employee('e1', 'Ava')];
    const availability = {
      e1: availabilityFor({
        days: defaultAvailability().days.map((d) => ({ ...d, start: '00:00', end: '23:59' })),
        exceptions: [{ id: 'x1', from: '2026-08-06', to: '2026-08-06', note: '' }],
      }),
    };
    expect(suggestAssignees(overnight, { employees, shifts: [], availability })).toEqual([]);
  });
});

describe('suggestAssignees ranking', () => {
  it('orders by availability, then target deficit, then role match', () => {
    const employees = [
      employee('e1', 'Partial Pat', { targetHours: 40 }),
      employee('e2', 'Small-deficit Sam', { targetHours: 10 }),
      employee('e3', 'Big-deficit Bella', { targetHours: 30 }),
      employee('e4', 'Role-match Remy', { role: 'Barista' }),
      employee('e5', 'No-signal Nia'),
    ];
    // Pat can only cover part of the shift window.
    const availability = {
      e1: availabilityFor({
        days: defaultAvailability().days.map((d) => ({ ...d, start: '12:00', end: '18:00' })),
      }),
    };

    const result = suggestAssignees(
      openShift,
      { employees, shifts: [openShift], availability },
      5
    );
    expect(result.map((s) => s.employee.name)).toEqual([
      'Big-deficit Bella',
      'Small-deficit Sam',
      'Role-match Remy',
      'No-signal Nia',
      'Partial Pat',
    ]);
    expect(result[0].reasons).toContain('30h below target');
    expect(result[2].reasons).toContain('Role matches');
    expect(result[4].status).toBe(AVAILABILITY.PARTIAL);
  });

  it('caps the list and counts existing hours net of breaks', () => {
    const employees = Array.from({ length: 5 }, (_, i) =>
      employee(`e${i}`, `Person ${i}`, { targetHours: 20 })
    );
    const shifts = [
      openShift,
      // Person 0 already has 4h scheduled this week, so their deficit is smaller.
      { id: 'w1', date: '2026-08-03', start: '09:00', end: '13:00', role: 'Floor', assigneeId: 'e0' },
    ];
    const result = suggestAssignees(openShift, { employees, shifts, availability: {} });
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.employee.id)).not.toContain('e0');
  });
});
