import { describe, it, expect } from 'vitest';
import { buildReport, datesBetween, previousRange, reportCSV } from '../src/core/reports.js';

const state = {
  employees: [
    { id: 'e1', name: 'Ava', role: 'Lead', active: true, hourlyRate: 20, targetHours: 40 },
    { id: 'e2', name: 'Liam', role: 'Barista', active: true, hourlyRate: 10 },
    { id: 'e3', name: 'Noor', role: 'Barista', active: false, hourlyRate: 12 },
  ],
  shifts: [
    // In range (Aug 17 to Aug 23).
    { id: 's1', date: '2026-08-17', start: '09:00', end: '17:00', role: 'Lead', assigneeId: 'e1', breakMinutes: 30 },
    { id: 's2', date: '2026-08-18', start: '09:00', end: '13:00', role: 'Barista', assigneeId: 'e2' },
    { id: 's3', date: '2026-08-19', start: '09:00', end: '17:00', role: 'Barista', assigneeId: 'e2' },
    { id: 's4', date: '2026-08-20', start: '09:00', end: '17:00', role: 'Barista', assigneeId: 'e3' },
    { id: 's5', date: '2026-08-21', start: '12:00', end: '20:00', role: 'Close', assigneeId: 'gone' },
    { id: 's6', date: '2026-08-22', start: '12:00', end: '20:00', role: 'Close', assigneeId: null },
    // Out of range.
    { id: 's7', date: '2026-08-10', start: '09:00', end: '17:00', role: 'Lead', assigneeId: 'e1' },
  ],
  attendance: {
    // 7h30 scheduled, 8h worked, 15 minutes late.
    s1: { status: 'late', clockIn: '09:15', clockOut: '17:45' },
    s2: { status: 'present', clockIn: '09:00', clockOut: '13:00' },
    s3: { status: 'absent', clockIn: '', clockOut: '' },
  },
  availability: {},
  settings: {
    currency: 'USD',
    coverage: [{ id: 'c1', role: 'Close', days: [0, 1, 2, 3, 4, 5, 6], count: 1, start: null, end: null }],
  },
};

const FROM = '2026-08-17';
const TO = '2026-08-23';

describe('ranges', () => {
  it('lists every day of an inclusive range', () => {
    expect(datesBetween('2026-08-17', '2026-08-19')).toEqual(['2026-08-17', '2026-08-18', '2026-08-19']);
    expect(datesBetween('2026-08-17', '2026-08-17')).toEqual(['2026-08-17']);
  });

  it('finds the period of equal length ending the day before', () => {
    expect(previousRange('2026-08-17', '2026-08-23')).toEqual({ from: '2026-08-10', to: '2026-08-16' });
    expect(previousRange('2026-08-01', '2026-08-31')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(previousRange('2026-08-17', '2026-08-17')).toEqual({ from: '2026-08-16', to: '2026-08-16' });
  });
});

describe('buildReport', () => {
  const report = buildReport(state, FROM, TO);

  it('covers only the range asked for', () => {
    expect(report).toMatchObject({ from: FROM, to: TO, days: 7 });
    // Five assigned shifts in range; the Aug 10 one is outside it.
    expect(report.totals.shifts).toBe(5);
  });

  it('totals scheduled hours net of breaks, and worked hours from attendance', () => {
    // 7.5 + 4 + 8 + 8 (Noor) + 8 (former) = 35.5 hours.
    expect(report.totals.scheduledMinutes).toBe(35.5 * 60);
    // Ava clocked 8h30 with a 30 minute break, Liam 4h, and the
    // absence counts as zero.
    expect(report.totals.workedMinutes).toBe(8 * 60 + 4 * 60);
  });

  it('lists everyone who held a shift, labelling archived and former people', () => {
    const byName = new Map(report.people.map((p) => [p.name, p]));
    expect([...byName.keys()].sort()).toEqual(['Ava', 'Former employee', 'Liam', 'Noor']);
    expect(byName.get('Noor').label).toBe('Archived');
    expect(byName.get('Former employee').label).toBe('Former employee');
    expect(byName.get('Ava').label).toBeNull();
  });

  it('carries per-person hours, attendance counts, lateness, and show-up rate', () => {
    const ava = report.people.find((p) => p.name === 'Ava');
    expect(ava).toMatchObject({ shifts: 1, scheduledHours: 7.5, workedHours: 8, late: 1, recorded: 1 });
    expect(ava.lateMinutes).toBe(15);
    expect(ava.showUpRate).toBe(1);

    const liam = report.people.find((p) => p.name === 'Liam');
    expect(liam).toMatchObject({ shifts: 2, present: 1, absent: 1, recorded: 2 });
    expect(liam.showUpRate).toBe(0.5);
  });

  it('prices pay per person and projected cost per role', () => {
    const ava = report.people.find((p) => p.name === 'Ava');
    // Eight paid hours at 20: the clocked 8h30 less the unpaid break.
    expect(ava.pay).toBe(160);
    const barista = report.roles.find((r) => r.role === 'Barista');
    expect(barista).toMatchObject({ shifts: 3, minutes: 20 * 60 });
    // Liam's 12 hours at 10 plus Noor's 8 at 12; the rate follows the
    // person, not the role.
    expect(barista.cost).toBe(120 + 96);
    // A deleted employee has no rate to price, but their hours still count.
    const close = report.roles.find((r) => r.role === 'Close');
    expect(close).toMatchObject({ shifts: 1, cost: 0, minutes: 8 * 60 });
  });

  it('applies the overtime rule to projected role cost when one is set', () => {
    const withOvertime = buildReport(
      { ...state, settings: { ...state.settings, overtimeThresholdHours: 10, overtimeMultiplier: 2 } },
      FROM,
      TO
    );
    // Liam works 12 hours in the week: 10 at 10, 2 at 20.
    const barista = withOvertime.roles.find((r) => r.role === 'Barista');
    expect(barista.cost).toBe(10 * 10 + 2 * 20 + 96);
    expect(withOvertime.totals.overtimeMinutes).toBe(2 * 60);
  });

  it('summarizes attendance across the period', () => {
    expect(report.attendance).toMatchObject({ present: 1, late: 1, absent: 1, notRecorded: 2, recorded: 3 });
    expect(report.attendance.rate).toBeCloseTo(2 / 3);
    expect(report.attendance.lateMinutes).toBe(15);
  });

  it('counts coverage gaps and the open shifts nobody took', () => {
    // The Close requirement is met on the two days Close shifts exist.
    expect(report.coverage.gapDays).toBe(5);
    expect(report.coverage.byRole[0]).toMatchObject({ role: 'Close', days: 5, missing: 5 });
    expect(report.open).toEqual({ count: 1, minutes: 8 * 60 });
  });

  it('reports an empty period without inventing rows', () => {
    const quiet = buildReport(state, '2026-09-01', '2026-09-07');
    expect(quiet.people).toEqual([]);
    expect(quiet.roles).toEqual([]);
    expect(quiet.totals).toMatchObject({ shifts: 0, scheduledMinutes: 0, workedMinutes: 0, pay: 0 });
    expect(quiet.attendance.rate).toBeNull();
  });
});

describe('reportCSV', () => {
  const report = buildReport(state, FROM, TO);

  it('writes one table per section with a header row', () => {
    const hours = reportCSV(report, 'hours');
    expect(hours.split('\r\n')[0]).toBe('Employee,Status,Shifts,Scheduled hours,Worked hours,Difference');
    expect(hours).toContain('Ava,Active,1,7.5,8,0.5');
    expect(hours).toContain('Noor,Archived');

    expect(reportCSV(report, 'attendance').split('\r\n')[0]).toContain('Show-up rate');
    expect(reportCSV(report, 'roles')).toContain('Barista');
    expect(reportCSV(report, 'coverage')).toContain('Close,5,5');
  });

  it('exports the pay table it sits beside, not everybody', () => {
    // Somebody without an hourly rate has no pay figure, so the table
    // leaves them out; the CSV button beside it has to agree.
    const noRate = buildReport(
      {
        ...state,
        employees: [
          { id: 'e1', name: 'Ava', active: true, hourlyRate: 20 },
          { id: 'e2', name: 'Liam', active: true },
        ],
        shifts: [
          { id: 's1', date: FROM, start: '09:00', end: '17:00', role: 'Lead', assigneeId: 'e1' },
          { id: 's2', date: FROM, start: '09:00', end: '17:00', role: 'Lead', assigneeId: 'e2' },
        ],
        attendance: {},
      },
      FROM,
      TO
    );
    const csv = reportCSV(noRate, 'cost');
    expect(csv).toContain('Ava,Active');
    expect(csv).not.toContain('Liam');
    // The hours table still accounts for everybody who worked.
    expect(reportCSV(noRate, 'hours')).toContain('Liam');
  });

  it('refuses a section it does not have', () => {
    expect(() => reportCSV(report, 'nonsense')).toThrow(/Unknown report section/);
  });

  it('escapes a name that would otherwise break the file open', () => {
    const risky = buildReport(
      {
        ...state,
        employees: [{ id: 'e1', name: '=cmd(),"x"', active: true, hourlyRate: 10 }],
        shifts: [{ id: 's1', date: FROM, start: '09:00', end: '17:00', role: 'Lead', assigneeId: 'e1' }],
        attendance: {},
      },
      FROM,
      TO
    );
    const csv = reportCSV(risky, 'hours');
    expect(csv).toContain('"\'=cmd(),""x"""');
  });
});
