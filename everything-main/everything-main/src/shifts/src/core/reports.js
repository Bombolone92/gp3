/**
 * Reports over any date range: the numbers the app already computes,
 * aggregated for a period instead of a week, and paired with the same
 * period before it so a figure reads as a trend.
 *
 * Pure, like the rest of core/: the view arranges these tables, it does
 * not do arithmetic. Archived and deleted employees appear whenever they
 * worked in the period, labelled the way timesheets label them, so
 * history stays complete.
 */
import { addDays } from '../lib/time.js';
import { workedMinutes, ATTENDANCE_STATUS } from './attendance.js';
import { coverageGaps } from './scheduling.js';
import { shiftBreakMinutes, shiftNetMinutes } from './shift-time.js';
import { laborCost } from './payroll.js';
import { employeeSummaries, timesheetRows, toCSV } from './timesheet.js';

/** Every ISO date in an inclusive range. */
export function datesBetween(fromISO, toISO) {
  const dates = [];
  for (let day = fromISO; day <= toISO; day = addDays(day, 1)) dates.push(day);
  return dates;
}

/**
 * The period of equal length ending the day before this one: what a
 * report compares itself against.
 */
export function previousRange(fromISO, toISO) {
  const length = datesBetween(fromISO, toISO).length;
  const to = addDays(fromISO, -1);
  return { from: addDays(to, -(length - 1)), to };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Worked minutes actually recorded for a shift, net of its unpaid
 * break; null when attendance was not taken, 0 for an absence.
 */
function recordedMinutes(shift, record) {
  if (!record) return null;
  if (record.status === ATTENDANCE_STATUS.ABSENT) return 0;
  const gross = workedMinutes(record.clockIn, record.clockOut);
  return gross === null ? null : Math.max(0, gross - shiftBreakMinutes(shift));
}

/**
 * Everything one period's report needs:
 *
 *   { from, to, days, people, roles, attendance, coverage, open, totals }
 *
 * `people` is one row per employee who held a shift in the period,
 * sorted by name, with hours scheduled against hours worked, attendance
 * counts, lateness, and pay. `roles` is the same period by role, with
 * projected cost. Nothing here is rounded except where it is money or
 * a displayed hour count.
 */
export function buildReport(state, fromISO, toISO) {
  const dates = datesBetween(fromISO, toISO);
  const rows = timesheetRows(state, fromISO, toISO);
  const byId = new Map(state.employees.map((e) => [e.id, e]));

  const lateByEmployee = new Map();
  for (const row of rows) {
    const late = row.minutesLate === '' ? 0 : row.minutesLate;
    lateByEmployee.set(row.employeeId, (lateByEmployee.get(row.employeeId) ?? 0) + late);
  }

  const people = employeeSummaries(rows).map((entry) => {
    const employee = byId.get(entry.employeeId);
    const recorded = entry.present + entry.late + entry.absent;
    return {
      ...entry,
      name: entry.employee,
      // The same labels timesheets use, so one report and one export
      // never disagree about who somebody is.
      label: !employee ? 'Former employee' : employee.active ? null : 'Archived',
      recorded,
      lateMinutes: lateByEmployee.get(entry.employeeId) ?? 0,
      showUpRate: recorded === 0 ? null : (entry.present + entry.late) / recorded,
    };
  });

  const cost = laborCost(state.shifts, state.employees, dates, {
    thresholdHours: state.settings?.overtimeThresholdHours ?? null,
    multiplier: state.settings?.overtimeMultiplier ?? null,
  });
  const roleNames = new Map(cost.byRole.map((r) => [r.key, r]));
  const shiftsByRole = new Map();
  for (const shift of state.shifts) {
    if (!shift.assigneeId || shift.date < fromISO || shift.date > toISO) continue;
    const role = String(shift.role ?? '').trim() || 'No role';
    shiftsByRole.set(role, (shiftsByRole.get(role) ?? 0) + 1);
  }
  const roles = [...roleNames.values()].map((entry) => ({
    role: entry.key,
    minutes: entry.minutes,
    cost: entry.cost,
    shifts: shiftsByRole.get(entry.key) ?? 0,
  }));

  const assigned = state.shifts.filter(
    (s) => s.assigneeId && s.date >= fromISO && s.date <= toISO
  );
  let scheduledMinutes = 0;
  let workedTotal = 0;
  const counts = { present: 0, late: 0, absent: 0, notRecorded: 0 };
  let lateMinutesTotal = 0;
  for (const shift of assigned) {
    scheduledMinutes += shiftNetMinutes(shift);
    const record = state.attendance[shift.id];
    if (!record) counts.notRecorded += 1;
    else if (counts[record.status] !== undefined) counts[record.status] += 1;
    const worked = recordedMinutes(shift, record);
    if (worked !== null) workedTotal += worked;
  }
  for (const value of lateByEmployee.values()) lateMinutesTotal += value;

  const gaps = coverageGaps(state.shifts, state.settings?.coverage, dates);
  const gapsByRole = new Map();
  for (const gap of gaps) {
    const entry = gapsByRole.get(gap.requirement.role) ?? { role: gap.requirement.role, days: 0, missing: 0 };
    entry.days += 1;
    entry.missing += gap.missing;
    gapsByRole.set(gap.requirement.role, entry);
  }

  const openShifts = state.shifts.filter(
    (s) => !s.assigneeId && s.date >= fromISO && s.date <= toISO
  );
  const recorded = counts.present + counts.late + counts.absent;

  return {
    from: fromISO,
    to: toISO,
    days: dates.length,
    people,
    roles: roles.sort((a, b) => b.cost - a.cost || b.minutes - a.minutes || a.role.localeCompare(b.role)),
    attendance: {
      ...counts,
      recorded,
      rate: recorded === 0 ? null : (counts.present + counts.late) / recorded,
      lateMinutes: lateMinutesTotal,
    },
    coverage: {
      gapDays: new Set(gaps.map((g) => g.date)).size,
      missing: gaps.reduce((sum, g) => sum + g.missing, 0),
      byRole: [...gapsByRole.values()].sort((a, b) => b.missing - a.missing || a.role.localeCompare(b.role)),
    },
    open: {
      count: openShifts.length,
      minutes: openShifts.reduce((sum, s) => sum + shiftNetMinutes(s), 0),
    },
    totals: {
      shifts: assigned.length,
      people: people.length,
      scheduledMinutes,
      workedMinutes: workedTotal,
      cost: cost.cost,
      overtimeCost: cost.overtimeCost,
      overtimeMinutes: cost.overtimeMinutes,
      pay: people.reduce((sum, p) => sum + (p.pay === '' ? 0 : p.pay), 0),
      ratedCount: cost.ratedCount,
      employeeCount: cost.employeeCount,
    },
  };
}

const SECTIONS = {
  hours: {
    headers: ['Employee', 'Status', 'Shifts', 'Scheduled hours', 'Worked hours', 'Difference'],
    rows: (report) =>
      report.people.map((p) => [
        p.name,
        p.label ?? 'Active',
        p.shifts,
        p.scheduledHours,
        p.workedHours,
        round2(p.workedHours - p.scheduledHours),
      ]),
  },
  cost: {
    headers: ['Employee', 'Status', 'Scheduled hours', 'Worked hours', 'Pay'],
    // Only the people this section can put a figure against, which is
    // what its table shows. The button beside that table offers to
    // export it, and an export carrying rows the table left out is a
    // different report wearing the same name.
    rows: (report) =>
      report.people
        .filter((p) => p.pay !== '')
        .map((p) => [p.name, p.label ?? 'Active', p.scheduledHours, p.workedHours, p.pay]),
  },
  roles: {
    headers: ['Role', 'Shifts', 'Hours', 'Projected cost'],
    rows: (report) =>
      report.roles.map((r) => [r.role, r.shifts, round2(r.minutes / 60), round2(r.cost)]),
  },
  attendance: {
    headers: ['Employee', 'Recorded', 'Present', 'Late', 'Absent', 'Not recorded', 'Show-up rate', 'Minutes late'],
    rows: (report) =>
      report.people.map((p) => [
        p.name,
        p.recorded,
        p.present,
        p.late,
        p.absent,
        p.notRecorded,
        p.showUpRate === null ? '' : `${Math.round(p.showUpRate * 100)}%`,
        p.lateMinutes,
      ]),
  },
  coverage: {
    headers: ['Role', 'Days short', 'People short'],
    rows: (report) => report.coverage.byRole.map((g) => [g.role, g.days, g.missing]),
  },
};

export const REPORT_SECTIONS = Object.keys(SECTIONS);

/** One section of a report as CSV, for the download beside its table. */
export function reportCSV(report, section) {
  const spec = SECTIONS[section];
  if (!spec) throw new Error(`Unknown report section: ${section}`);
  return `${toCSV(spec.headers, spec.rows(report))}\r\n`;
}
