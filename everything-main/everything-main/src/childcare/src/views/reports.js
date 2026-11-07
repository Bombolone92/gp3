/**
 * Reports: attendance, staff hours, activities, health, families, enrollment,
 * and billing. Every report is a table that prints cleanly and exports to CSV.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, emptyState, searchBox, textInput, spinner } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { app, isManager } from '../app.js';
import { personName, formatHours, formatDecimalHours, matches } from '../core/format.js';
import { sortByName, sortRooms, guardiansOf, immunizationSummary, upcomingBirthdays, statusMeta } from '../core/people.js';
import { attendanceName, firstIn, lastOut, minutesPresent, indexDay } from '../core/attendance.js';
import { activityName, describe, TYPE, ACTIVITY_TYPES } from '../core/activities.js';
import { allAccounts } from '../core/billing.js';
import { PAYMENT_METHODS } from '../core/settings.js';
import { addDays, daysInRange, formatDate, formatTime, ageLabel, startOfMonth, ageInMonths } from '../core/dates.js';
import { toCSV, downloadText } from '../core/csv.js';
import { money } from './common.js';

const S = () => app.store;
const room = (id) => S().get('rooms', id)?.name || '';
const kid = (id) => S().get('students', id);
const guardianLine = (g) => [personName(g), g.relation ? `(${g.relation})` : '', g.phone].filter(Boolean).join(' ');

const REPORTS = [
  // Attendance
  {
    id: 'signin',
    group: 'Attendance',
    title: 'Sign-in sheet',
    desc: 'One day\'s arrivals and departures with who dropped off and picked up, for licensing records.',
    range: 'day',
    async run({ from }) {
      const recs = (await S().read([attendanceName(from)]))[attendanceName(from)];
      const idx = indexDay(recs).students;
      const kids = sortByName(S().all('students').filter((s) => s.status === 'active'));
      return {
        headers: ['Child', 'Room', 'In', 'Dropped off by', 'Out', 'Picked up by', 'Initials'],
        rows: kids.map((s) => {
          const r = idx.get(s.id);
          const inEv = r?.events?.find((e) => e.type === 'in');
          const outEv = [...(r?.events || [])].reverse().find((e) => e.type === 'out');
          return [personName(s), room(s.roomId), r?.absent && !r.events?.length ? `Absent${r.absent.reason ? `: ${r.absent.reason}` : ''}` : inEv ? formatTime(inEv.at) : '', inEv?.person || '', outEv ? formatTime(outEv.at) : '', outEv?.person || '', ''];
        }),
      };
    },
  },
  {
    id: 'attendance',
    group: 'Attendance',
    title: 'Attendance summary',
    desc: 'Days present, absences, and hours for each child over a date range.',
    range: 'range',
    async run({ from, to }) {
      const names = daysInRange(from, to).map(attendanceName);
      const data = await S().read(names);
      const by = new Map();
      for (const n of names)
        for (const r of data[n] || []) {
          if (r.kind === 'staff' || !r.studentId) continue;
          const row = by.get(r.studentId) || { days: 0, absent: 0, mins: 0 };
          if (r.events?.length) row.days++;
          else if (r.absent) row.absent++;
          row.mins += minutesPresent(r);
          by.set(r.studentId, row);
        }
      const kids = sortByName(S().all('students').filter((s) => s.status === 'active' || by.has(s.id)));
      return {
        headers: ['Child', 'Room', 'Days present', 'Absences', 'Hours', 'Average per day'],
        rows: kids.map((s) => {
          const r = by.get(s.id) || { days: 0, absent: 0, mins: 0 };
          return [personName(s), room(s.roomId), r.days, r.absent, formatDecimalHours(r.mins), r.days ? formatHours(r.mins / r.days) : ''];
        }),
      };
    },
  },
  {
    id: 'absences',
    group: 'Attendance',
    title: 'Absences',
    desc: 'Every absence with its reason and who reported it.',
    range: 'range',
    async run({ from, to }) {
      const names = daysInRange(from, to).map(attendanceName);
      const data = await S().read(names);
      const rows = [];
      for (const n of names)
        for (const r of data[n] || []) if (r.absent && !r.events?.length && r.studentId) rows.push([formatDate(n.slice(11)), personName(kid(r.studentId)), room(r.roomId || kid(r.studentId)?.roomId), r.absent.reason || '', r.absent.note || '', r.absent.byFamily ? `${r.absent.by || 'Family'} (family)` : r.absent.by || '']);
      return { headers: ['Date', 'Child', 'Room', 'Reason', 'Note', 'Reported by'], rows };
    },
  },
  {
    id: 'timecards',
    group: 'Staff',
    title: 'Staff hours',
    desc: 'Hours worked by each staff member, for payroll.',
    manager: true,
    range: 'range',
    async run({ from, to }) {
      const names = daysInRange(from, to).map(attendanceName);
      const data = await S().read(names);
      const by = new Map();
      for (const n of names)
        for (const r of data[n] || []) {
          if (r.kind !== 'staff') continue;
          const row = by.get(r.staffId) || { days: 0, mins: 0 };
          if (r.events?.length) row.days++;
          row.mins += minutesPresent(r);
          by.set(r.staffId, row);
        }
      return {
        headers: ['Staff', 'Title', 'Days worked', 'Hours', 'Decimal hours'],
        rows: sortByName(S().all('staff').filter((m) => m.active !== false || by.has(m.id))).map((m) => {
          const r = by.get(m.id) || { days: 0, mins: 0 };
          return [personName(m), m.title || '', r.days, formatHours(r.mins), formatDecimalHours(r.mins)];
        }),
      };
    },
  },
  {
    id: 'timeclock',
    group: 'Staff',
    title: 'Staff time clock',
    desc: 'Every clock in and out, by day.',
    manager: true,
    range: 'range',
    async run({ from, to }) {
      const names = daysInRange(from, to).map(attendanceName);
      const data = await S().read(names);
      const rows = [];
      for (const n of names)
        for (const r of data[n] || []) {
          if (r.kind !== 'staff') continue;
          const m = S().get('staff', r.staffId);
          rows.push([formatDate(n.slice(11)), personName(m), formatTime(firstIn(r)) || '', formatTime(lastOut(r)) || '', formatDecimalHours(minutesPresent(r))]);
        }
      return { headers: ['Date', 'Staff', 'In', 'Out', 'Hours'], rows };
    },
  },
  {
    id: 'certifications',
    group: 'Staff',
    title: 'Certifications',
    desc: 'Staff certifications and when they expire.',
    manager: true,
    async run() {
      const rows = [];
      for (const m of sortByName(S().all('staff').filter((x) => x.active !== false))) for (const c of m.certifications || []) rows.push([personName(m), c.name, c.expires ? formatDate(c.expires) : 'No expiry', c.expires && c.expires < app.today() ? 'Expired' : '']);
      return { headers: ['Staff', 'Certification', 'Expires', 'Status'], rows };
    },
  },
  // Daily care
  {
    id: 'activity',
    group: 'Daily care',
    title: 'Activity log',
    desc: 'Every activity logged, with time, child, and details.',
    range: 'range',
    maxDays: 31,
    async run({ from, to }) {
      const names = daysInRange(from, to).map(activityName);
      const data = await S().read(names);
      const rows = [];
      for (const n of names) for (const a of (data[n] || []).sort((x, y) => x.at.localeCompare(y.at))) rows.push([formatDate(a.day), formatTime(a.at), personName(kid(a.studentId)), room(a.roomId), TYPE[a.type]?.label || a.type, describe(a), a.note || '', a.by || '', a.staffOnly ? 'Yes' : '']);
      return { headers: ['Date', 'Time', 'Child', 'Room', 'Type', 'Details', 'Note', 'Logged by', 'Staff only'], rows };
    },
  },
  {
    id: 'activity-counts',
    group: 'Daily care',
    title: 'Activities by room',
    desc: 'How many of each activity each room logged.',
    range: 'range',
    maxDays: 31,
    async run({ from, to }) {
      const names = daysInRange(from, to).map(activityName);
      const data = await S().read(names);
      const by = new Map();
      for (const n of names)
        for (const a of data[n] || []) {
          const k = a.roomId || 'none';
          if (!by.has(k)) by.set(k, {});
          by.get(k)[a.type] = (by.get(k)[a.type] || 0) + 1;
        }
      return { headers: ['Room', ...ACTIVITY_TYPES.map((t) => t.short || t.label)], rows: [...by].map(([r, c]) => [room(r) || 'No room', ...ACTIVITY_TYPES.map((t) => c[t.id] || 0)]) };
    },
  },
  {
    id: 'meals',
    group: 'Daily care',
    title: 'Meals served',
    desc: 'Meals and bottles by day and meal, for food program claims.',
    range: 'range',
    maxDays: 31,
    async run({ from, to }) {
      const names = daysInRange(from, to).map(activityName);
      const data = await S().read(names);
      const meals = app.settings().mealTypes;
      const rows = [];
      for (const n of names) {
        const list = (data[n] || []).filter((a) => a.type === 'meal');
        if (!list.length) continue;
        const count = (m) => new Set(list.filter((a) => a.details?.kind !== 'bottle' && a.details?.meal === m).map((a) => a.studentId)).size;
        rows.push([formatDate(n.slice(11)), ...meals.map(count), list.filter((a) => a.details?.kind === 'bottle').length]);
      }
      return { headers: ['Date', ...meals, 'Bottles'], rows };
    },
  },
  {
    id: 'incidents',
    group: 'Daily care',
    title: 'Incidents',
    desc: 'Incident reports with action taken and family notification.',
    range: 'range',
    maxDays: 92,
    async run({ from, to }) {
      const names = daysInRange(from, to).map(activityName);
      const data = await S().read(names);
      const rows = [];
      for (const n of names) for (const a of data[n] || []) if (a.type === 'incident') rows.push([formatDate(a.day), formatTime(a.at), personName(kid(a.studentId)), a.details?.kind || '', a.details?.location || '', a.note || '', a.details?.action || '', a.details?.notified || '', a.by || '']);
      return { headers: ['Date', 'Time', 'Child', 'What happened', 'Where', 'Description', 'Action taken', 'Family notified', 'Reported by'], rows };
    },
  },
  {
    id: 'medications',
    group: 'Daily care',
    title: 'Medications given',
    desc: 'Every dose given, with time and staff member.',
    range: 'range',
    maxDays: 92,
    async run({ from, to }) {
      const names = daysInRange(from, to).map(activityName);
      const data = await S().read(names);
      const rows = [];
      for (const n of names) for (const a of data[n] || []) if (a.type === 'meds') rows.push([formatDate(a.day), formatTime(a.at), personName(kid(a.studentId)), a.details?.medication || '', a.details?.dose || '', a.by || '', a.note || '']);
      return { headers: ['Date', 'Time', 'Child', 'Medication', 'Dose', 'Given by', 'Note'], rows };
    },
  },
  // Children and families
  {
    id: 'allergies',
    group: 'Children',
    title: 'Allergies and medical needs',
    desc: 'Allergies, medications, conditions, and dietary needs for every enrolled child.',
    async run() {
      const kids = sortByName(S().all('students').filter((s) => s.status === 'active' && (s.allergies || s.medications || s.conditions || s.dietary)));
      return { headers: ['Child', 'Room', 'Allergies', 'Medications', 'Conditions', 'Dietary needs'], rows: kids.map((s) => [personName(s), room(s.roomId), s.allergies || '', s.medications || '', s.conditions || '', s.dietary || '']) };
    },
  },
  {
    id: 'emergency',
    group: 'Children',
    title: 'Emergency contacts',
    desc: 'Every enrolled child with their emergency contacts and doctor, ready to print.',
    async run() {
      const kids = sortByName(S().all('students').filter((s) => s.status === 'active'));
      return {
        headers: ['Child', 'Room', 'Birthday', 'Allergies', 'Emergency contacts', 'Approved pickups', 'Doctor'],
        rows: kids.map((s) => {
          const fam = guardiansOf(S().all('guardians'), s.id);
          return [personName(s), room(s.roomId), s.birthday ? formatDate(s.birthday) : '', s.allergies || '', fam.filter((g) => g.emergency).map(guardianLine).join('; '), fam.filter((g) => g.canPickup).map((g) => personName(g)).join(', '), [s.doctor?.name, s.doctor?.phone].filter(Boolean).join(' ')];
        }),
      };
    },
  },
  {
    id: 'contacts',
    group: 'Children',
    title: 'Family contacts',
    desc: 'Parents and guardians with phone and email.',
    async run() {
      const rows = [];
      for (const g of sortByName(S().all('guardians'))) rows.push([personName(g), g.relation || '', (g.studentIds || []).map((id) => personName(kid(id))).join(', '), g.phone || '', g.email || '', g.canPickup ? 'Yes' : '', g.emergency ? 'Yes' : '', g.memberUuid ? 'Yes' : '']);
      return { headers: ['Name', 'Relation', 'Children', 'Phone', 'Email', 'Can pick up', 'Emergency', 'Uses app'], rows };
    },
  },
  {
    id: 'ages',
    group: 'Children',
    title: 'Ages and birthdays',
    desc: 'Every enrolled child\'s age and next birthday.',
    async run() {
      const today = app.today();
      const kids = S().all('students').filter((s) => s.status === 'active').sort((a, b) => (ageInMonths(a.birthday, today) ?? 0) - (ageInMonths(b.birthday, today) ?? 0));
      const next = new Map(upcomingBirthdays(kids, 366, today).map((b) => [b.student.id, b.date]));
      return { headers: ['Child', 'Room', 'Birthday', 'Age', 'Next birthday'], rows: kids.map((s) => [personName(s), room(s.roomId), s.birthday ? formatDate(s.birthday) : '', ageLabel(s.birthday, today), next.get(s.id) ? formatDate(next.get(s.id)) : '']) };
    },
  },
  {
    id: 'immunizations',
    group: 'Children',
    title: 'Immunizations',
    desc: 'Recorded doses for every enrolled child.',
    async run() {
      const rows = [];
      for (const s of sortByName(S().all('students').filter((x) => x.status === 'active'))) {
        const imm = immunizationSummary(s);
        if (!imm.length) rows.push([personName(s), 'No records', '', '']);
        for (const v of imm) rows.push([personName(s), v.vaccine, v.dates.length, v.dates.map((d) => formatDate(d)).join(', ')]);
      }
      return { headers: ['Child', 'Vaccine', 'Doses', 'Dates'], rows };
    },
  },
  {
    id: 'enrollment',
    group: 'Enrollment',
    title: 'Room enrollment',
    desc: 'Capacity, enrolled children, open spots, and the waitlist for each room.',
    async run() {
      const kids = S().all('students');
      return {
        headers: ['Room', 'Ages', 'Capacity', 'Enrolled', 'Open spots', 'Waitlist'],
        rows: sortRooms(S().all('rooms')).map((r) => {
          const enrolled = kids.filter((s) => s.roomId === r.id && s.status === 'active').length;
          return [r.name, r.ageRange || '', r.capacity || '', enrolled, r.capacity ? Math.max(0, r.capacity - enrolled) : '', kids.filter((s) => s.roomId === r.id && s.status === 'waitlist').length];
        }),
      };
    },
  },
  {
    id: 'waitlist',
    group: 'Enrollment',
    title: 'Waitlist and inquiries',
    desc: 'Families waiting for a spot, with desired start dates.',
    async run() {
      const list = S().all('students').filter((s) => s.status === 'waitlist' || s.status === 'inquiry').sort((a, b) => String(a.inquiry?.firstContact || '').localeCompare(String(b.inquiry?.firstContact || '')));
      return { headers: ['Child', 'Status', 'Age', 'Room', 'First contact', 'Toured', 'Wants to start', 'Family'], rows: list.map((s) => [personName(s), statusMeta(s.status).label, ageLabel(s.birthday), room(s.roomId), s.inquiry?.firstContact ? formatDate(s.inquiry.firstContact) : '', s.inquiry?.toured ? formatDate(s.inquiry.toured) : '', s.inquiry?.desiredStart ? formatDate(s.inquiry.desiredStart) : '', guardiansOf(S().all('guardians'), s.id).map(guardianLine).join('; ')]) };
    },
  },
  // Billing
  {
    id: 'balances',
    group: 'Billing',
    title: 'Balances',
    desc: 'What each family owes and how overdue it is.',
    manager: true,
    async run() {
      const accounts = allAccounts(S().all('invoices'), S().all('payments'), app.today());
      // Deleted children's statements stay on record, and in this report.
      const known = new Set(S().all('students').map((s) => s.id));
      const gone = [...accounts.keys()].filter((id) => !known.has(id)).map((id) => [null, accounts.get(id)]);
      const row = ([s, a]) => [personName(s), money(a.billed), money(a.paid), money(a.balance), money(a.overdue)];
      return { headers: ['Child', 'Billed', 'Paid', 'Balance', 'Overdue'], rows: [...sortByName(S().all('students').filter((s) => accounts.has(s.id))).map((s) => [s, accounts.get(s.id)]), ...gone].map(row) };
    },
  },
  {
    id: 'payments',
    group: 'Billing',
    title: 'Payments received',
    desc: 'Payments by date and method.',
    manager: true,
    range: 'range',
    async run({ from, to }) {
      // Credits and discounts lower a balance but are not money received.
      const list = S().all('payments').filter((p) => p.kind !== 'credit' && p.date >= from && p.date <= to).sort((a, b) => a.date.localeCompare(b.date));
      const method = (id) => PAYMENT_METHODS.find((m) => m.id === id)?.label || id || '';
      return { headers: ['Date', 'Child', 'Method', 'Reference', 'Amount'], rows: list.map((p) => [formatDate(p.date), personName(kid(p.studentId)), method(p.method), p.reference || '', money(p.amountCents)]), total: money(list.reduce((s, p) => s + p.amountCents, 0)) };
    },
  },
];

export function render(ctx) {
  const id = ctx.query.r;
  const report = REPORTS.find((r) => r.id === id && (!r.manager || isManager()));
  return report ? renderReport(ctx, report) : renderIndex(ctx);
}

function renderIndex() {
  let q = '';
  const list = h('div');
  const draw = () => {
    const groups = new Map();
    for (const r of REPORTS) {
      if (r.manager && !isManager()) continue;
      if (!matches(`${r.title} ${r.desc} ${r.group}`, q)) continue;
      if (!groups.has(r.group)) groups.set(r.group, []);
      groups.get(r.group).push(r);
    }
    list.replaceChildren(
      ...[...groups].map(([g, items]) => h('section.report-group', h('h2', g), h('div.report-cards', items.map((r) => h('a.report-card', { href: `#/reports?r=${r.id}` }, h('span.person-name', r.title), h('span.person-sub', r.desc)))))),
      !groups.size ? emptyState({ icon: 'search', title: 'No reports match', compact: true }) : null,
    );
  };
  draw();
  return h('div.page', pageHeader({ title: 'Reports' }), h('div.toolbar', searchBox({ placeholder: 'Search reports', onInput: (v) => ((q = v), draw()) })), list);
}

function renderReport(ctx, report) {
  const today = app.today();
  let from = ctx.query.from || (report.range === 'day' ? ctx.query.date || today : startOfMonth(today));
  let to = ctx.query.to || today;
  const out = h('div.report-out');
  const fromIn = textInput({ type: 'date', value: from, max: today, 'aria-label': report.range === 'day' ? 'Day' : 'From' });
  const toIn = textInput({ type: 'date', value: to, max: today, 'aria-label': 'To' });
  let result = null;
  let runs = 0;
  let building = null; // the latest run, for an Export CSV pressed while it builds
  // The printed header names the range on screen, which changes after the page is drawn.
  const printRange = h('span.print-only');

  async function run() {
    if (report.range === 'range' && report.maxDays && daysInRange(from, to).length > report.maxDays) {
      from = addDays(to, -(report.maxDays - 1));
      fromIn.value = from;
      toast(`This report covers up to ${report.maxDays} days at a time.`, { type: 'info' });
    }
    printRange.textContent = report.range ? ` · ${formatDate(from)}${report.range === 'range' ? ` to ${formatDate(to)}` : ''}` : '';
    // Dates can change while a report builds: only the latest run may show,
    // and the CSV never exports a range other than the one on screen.
    const my = ++runs;
    result = null;
    out.replaceChildren(h('div.row.subtle', spinner(), 'Building report'));
    let built;
    try {
      built = await report.run({ from, to });
    } catch (err) {
      if (my !== runs) return;
      console.error(err);
      out.replaceChildren(emptyState({ icon: 'alert', title: 'This report could not be built', text: err.message || 'Check your connection and try again.', compact: true }));
      return;
    }
    if (my !== runs) return;
    result = built;
    out.replaceChildren(
      result.rows.length
        ? h(
            'div.table-wrap',
            { tabindex: '0', role: 'region', 'aria-label': report.title },
            h('table.table.report-table', h('caption.sr-only', report.title), h('thead', h('tr', result.headers.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', result.rows.map((r) => h('tr', r.map((c) => h('td', String(c ?? '')))))), result.total ? h('tfoot', h('tr', h('th', { colspan: result.headers.length - 1 }, 'Total'), h('th', result.total))) : null),
          )
        : emptyState({ icon: 'clipboard', title: 'Nothing to report', text: report.range ? 'Try a different date range.' : '', compact: true }),
      h('p.subtle.small.mt', `${result.rows.length} rows`),
    );
  }

  const apply = () => {
    from = fromIn.value || from;
    to = report.range === 'day' ? from : toIn.value || to;
    if (to < from) [from, to] = [to, from];
    setQuery({ from, to: report.range === 'range' ? to : null });
    building = run();
  };
  fromIn.addEventListener('change', apply);
  toIn.addEventListener('change', apply);

  // Pressed while the report builds: export it once it is on screen.
  const csv = async () => {
    for (let b = null; !result && b !== building; ) await (b = building);
    if (!result) return;
    downloadText(`${report.id}-${from}${report.range === 'range' ? `-to-${to}` : ''}.csv`, toCSV([result.headers, ...result.rows]));
  };

  building = run();
  return {
    title: report.title,
    node: h(
      'div.page.wide-page',
      pageHeader({
        title: report.title,
        crumbs: [{ label: 'Reports', href: '#/reports' }],
        subtitle: h('span', report.desc, printRange),
        actions: [h('button.btn', { type: 'button', onClick: csv }, icon('download', 16), 'Export CSV'), h('button.btn', { type: 'button', onClick: () => window.print() }, icon('printer', 16), 'Print')],
      }),
      report.range
        ? h(
            'div.toolbar.no-print',
            report.range === 'day' ? [h('label.small', 'Day'), fromIn] : [h('label.small', 'From'), fromIn, h('label.small', 'to'), toIn],
            report.range === 'range'
              ? h(
                  'div.chips',
                  [
                    ['This month', startOfMonth(today), today],
                    ['Last 7 days', addDays(today, -6), today],
                    ['Last 30 days', addDays(today, -29), today],
                  ].map(([label, f, t]) => h('button.chip', { type: 'button', onClick: () => ((fromIn.value = f), (toIn.value = t), apply()) }, label)),
                )
              : null,
          )
        : null,
      out,
    ),
  };
}

