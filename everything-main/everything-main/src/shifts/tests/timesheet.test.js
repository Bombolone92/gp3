import { describe, it, expect } from 'vitest';
import { employeeSummaries, timesheetCSV, timesheetRows } from '../src/core/timesheet.js';

const state = {
  employees: [
    { id: 'e1', name: 'Ava Chen' },
    { id: 'e2', name: 'Liam "Lee" Torres, Jr.' }, // exercises CSV escaping
  ],
  shifts: [
    { id: 's1', date: '2026-08-03', start: '09:00', end: '17:00', role: 'Floor', assigneeId: 'e1' },
    { id: 's2', date: '2026-08-03', start: '22:00', end: '06:00', role: 'Night', assigneeId: 'e2' },
    { id: 's3', date: '2026-08-04', start: '09:00', end: '13:00', role: 'Floor', assigneeId: 'e1' },
    { id: 's4', date: '2026-08-04', start: '09:00', end: '13:00', role: 'Open', assigneeId: null }, // open: excluded
    { id: 's5', date: '2026-08-20', start: '09:00', end: '13:00', role: 'Floor', assigneeId: 'e1' }, // out of range
  ],
  attendance: {
    s1: { status: 'late', clockIn: '09:20', clockOut: '17:00' },
    s2: { status: 'present', clockIn: '22:00', clockOut: '06:00' },
    s3: { status: 'absent', clockIn: '', clockOut: '' },
  },
};

describe('timesheetRows', () => {
  const rows = timesheetRows(state, '2026-08-03', '2026-08-09');

  it('includes assigned shifts in range, sorted by date and start', () => {
    expect(rows.map((r) => [r.date, r.role])).toEqual([
      ['2026-08-03', 'Floor'],
      ['2026-08-03', 'Night'],
      ['2026-08-04', 'Floor'],
    ]);
  });

  it('derives hours and lateness, including overnight clock-outs', () => {
    const [late, night, absent] = rows;
    expect(late).toMatchObject({ scheduledHours: 8, workedHours: 7.67, minutesLate: 20, status: 'late' });
    expect(night).toMatchObject({ scheduledHours: 8, workedHours: 8, minutesLate: 0 });
    expect(absent).toMatchObject({ status: 'absent', workedHours: '', clockIn: '', minutesLate: '' });
  });
});

describe('employeeSummaries', () => {
  it('totals hours and statuses per employee', () => {
    const summaries = employeeSummaries(timesheetRows(state, '2026-08-03', '2026-08-09'));
    expect(summaries).toHaveLength(2);
    const ava = summaries.find((s) => s.employee === 'Ava Chen');
    expect(ava).toMatchObject({ shifts: 2, scheduledHours: 12, workedHours: 7.67, late: 1, absent: 1 });
  });

  it('keeps two employees with the same name separate', () => {
    const twins = {
      employees: [
        { id: 'a', name: 'Sam Lee' },
        { id: 'b', name: 'Sam Lee' },
      ],
      shifts: [
        { id: 's1', date: '2026-08-03', start: '09:00', end: '17:00', role: 'Floor', assigneeId: 'a' },
        { id: 's2', date: '2026-08-04', start: '09:00', end: '13:00', role: 'Floor', assigneeId: 'b' },
      ],
      attendance: {},
    };
    const summaries = employeeSummaries(timesheetRows(twins, '2026-08-03', '2026-08-09'));
    expect(summaries).toHaveLength(2);
    expect(summaries.map((s) => s.scheduledHours).sort()).toEqual([4, 8]);
  });
});

describe('timesheetCSV', () => {
  const csv = timesheetCSV(state, '2026-08-03', '2026-08-09');

  it('emits a detail table, a blank line, and a summary table', () => {
    const blocks = csv.split('\r\n\r\n');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].split('\r\n')[0]).toMatch(/^Date,Employee,Role/);
    expect(blocks[1].split('\r\n')[0]).toMatch(/^Employee,Shifts/);
  });

  it('escapes quotes and commas in fields', () => {
    expect(csv).toContain('"Liam ""Lee"" Torres, Jr."');
    // The unescaped raw name must never appear bare.
    expect(csv).not.toMatch(/^Liam "Lee"/m);
  });

  it('neutralizes formula injection in user-entered fields', () => {
    const hostile = {
      employees: [{ id: 'e1', name: '=HYPERLINK("http://evil.test","pay")' }],
      shifts: [
        { id: 's1', date: '2026-08-03', start: '09:00', end: '17:00', role: '@cmd', assigneeId: 'e1' },
      ],
      attendance: {},
    };
    const out = timesheetCSV(hostile, '2026-08-03', '2026-08-09');
    expect(out).toContain(`'=HYPERLINK`);
    expect(out).toContain(`'@cmd`);
    expect(out).not.toMatch(/,=HYPERLINK/);
    // Generated numeric fields stay plain (scheduled hours: 8).
    expect(out).toMatch(/,8,/);
  });
});
