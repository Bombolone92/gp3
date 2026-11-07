/**
 * Timesheet export: joins shifts and attendance into payroll-ready rows
 * and renders them as CSV with a per-employee summary block.
 */
import { shiftBreakMinutes, shiftNetMinutes } from './scheduling.js';
import { lateMinutes, workedMinutes, ATTENDANCE_STATUS } from './attendance.js';

const ROW_HEADERS = [
  'Date',
  'Employee',
  'Role',
  'Scheduled start',
  'Scheduled end',
  'Break minutes',
  'Scheduled hours',
  'Status',
  'Clock in',
  'Clock out',
  'Worked hours',
  'Minutes late',
  'Hourly rate',
  'Pay',
];

const SUMMARY_HEADERS = [
  'Employee',
  'Shifts',
  'Scheduled hours',
  'Worked hours',
  'Present',
  'Late',
  'Absent',
  'Not recorded',
  'Pay',
];

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * One row per assigned shift in [fromISO, toISO], sorted by date, start,
 * then employee name. Attendance-derived fields are blank when there is
 * no record; worked time and lateness handle overnight clock-outs.
 * Scheduled and worked hours are net of the shift's unpaid break.
 */
export function timesheetRows(state, fromISO, toISO) {
  const byId = new Map(state.employees.map((e) => [e.id, e]));
  return state.shifts
    .filter((s) => s.assigneeId && s.date >= fromISO && s.date <= toISO)
    .map((shift) => {
      const employee = byId.get(shift.assigneeId);
      const record = state.attendance[shift.id];
      const breakMins = shiftBreakMinutes(shift);
      const absent = record?.status === ATTENDANCE_STATUS.ABSENT;
      const grossWorked = record && !absent ? workedMinutes(record.clockIn, record.clockOut) : null;
      const worked = grossWorked === null ? null : Math.max(0, grossWorked - breakMins);
      const rate = employee?.hourlyRate ?? null;
      // Pay follows the best information available: recorded absences pay
      // nothing, complete clock in/out pays worked time, anything else
      // falls back to the scheduled (net) time.
      const paidMinutes = absent ? 0 : (worked ?? shiftNetMinutes(shift));
      return {
        date: shift.date,
        employeeId: shift.assigneeId,
        employee: employee?.name ?? 'Former employee',
        role: shift.role,
        start: shift.start,
        end: shift.end,
        breakMinutes: breakMins,
        scheduledHours: round2(shiftNetMinutes(shift) / 60),
        status: record?.status ?? 'not recorded',
        clockIn: (!absent && record?.clockIn) || '',
        clockOut: (!absent && record?.clockOut) || '',
        workedHours: worked === null ? '' : round2(worked / 60),
        minutesLate: record && !absent ? lateMinutes(shift, record.clockIn) : '',
        hourlyRate: rate ?? '',
        pay: rate === null ? '' : round2((paidMinutes / 60) * rate),
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.start.localeCompare(b.start) ||
        a.employee.localeCompare(b.employee)
    );
}

/**
 * Per-employee totals over a set of timesheet rows, sorted by name.
 * Keyed by employee id, not name, so two people who happen to share a
 * name never have their payroll totals merged.
 */
export function employeeSummaries(rows) {
  const byId = new Map();
  for (const row of rows) {
    const entry = byId.get(row.employeeId) ?? {
      employeeId: row.employeeId,
      employee: row.employee,
      shifts: 0,
      scheduledHours: 0,
      workedHours: 0,
      present: 0,
      late: 0,
      absent: 0,
      notRecorded: 0,
      pay: '',
    };
    entry.shifts += 1;
    entry.scheduledHours = round2(entry.scheduledHours + row.scheduledHours);
    entry.workedHours = round2(entry.workedHours + (row.workedHours === '' ? 0 : row.workedHours));
    if (row.pay !== '') entry.pay = round2((entry.pay === '' ? 0 : entry.pay) + row.pay);
    if (row.status === 'present') entry.present += 1;
    else if (row.status === 'late') entry.late += 1;
    else if (row.status === 'absent') entry.absent += 1;
    else entry.notRecorded += 1;
    byId.set(row.employeeId, entry);
  }
  return [...byId.values()].sort((a, b) => a.employee.localeCompare(b.employee));
}

function csvField(value) {
  let s = String(value ?? '');
  // Spreadsheets treat cells starting with = + - @ (or a stray tab/CR) as
  // formulas, letting a crafted employee name or role execute on open.
  // The standard mitigation is a leading apostrophe, which Excel and
  // Sheets read as a text marker. Only user-entered strings can start
  // this way; generated numbers pass through untouched.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * A CSV table: header row plus rows, CRLF line endings, and every cell
 * escaped (including the leading-character guard above). Shared with the
 * reports view, which exports a table at a time.
 */
export function toCSV(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n');
}

/** The complete export: detail table, blank line, per-employee summary. */
export function timesheetCSV(state, fromISO, toISO) {
  const rows = timesheetRows(state, fromISO, toISO);
  const detail = toCSV(
    ROW_HEADERS,
    rows.map((r) => [
      r.date,
      r.employee,
      r.role,
      r.start,
      r.end,
      r.breakMinutes,
      r.scheduledHours,
      r.status,
      r.clockIn,
      r.clockOut,
      r.workedHours,
      r.minutesLate,
      r.hourlyRate,
      r.pay,
    ])
  );
  const summary = toCSV(
    SUMMARY_HEADERS,
    employeeSummaries(rows).map((s) => [
      s.employee,
      s.shifts,
      s.scheduledHours,
      s.workedHours,
      s.present,
      s.late,
      s.absent,
      s.notRecorded,
      s.pay,
    ])
  );
  return `${detail}\r\n\r\n${summary}\r\n`;
}
