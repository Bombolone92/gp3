/**
 * Reports: the app's own numbers over any date range, next to the same
 * range before it. Tables rather than charts, because tables suit both
 * the screen and the printout, and every one of them exports as CSV.
 */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { downloadTextFile } from '../../lib/download.js';
import {
  addDays,
  formatDate,
  formatHours,
  isoDate,
  isoToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from '../../lib/time.js';
import { buildReport, previousRange, reportCSV } from '../../core/reports.js';
import { formatMoney } from '../../core/payroll.js';
import { badge, emptyState, field, statCard } from '../components.js';
import { toast } from '../toast.js';

/** The pay-period presets the timesheet export offers, plus longer ones. */
function presets(today) {
  const week = startOfWeek(today);
  const monthStart = startOfMonth(today);
  const lastMonthStart = `${addDays(monthStart, -1).slice(0, 8)}01`;
  const endOfLastMonth = addDays(monthStart, -1);
  const monthEnd = (() => {
    const d = parseISO(today);
    return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  })();
  return [
    { label: 'This week', from: week, to: addDays(week, 6) },
    { label: 'Last week', from: addDays(week, -7), to: addDays(week, -1) },
    { label: '1st to 15th', from: monthStart, to: `${monthStart.slice(0, 8)}15` },
    { label: '16th to month end', from: `${monthStart.slice(0, 8)}16`, to: monthEnd },
    { label: 'This month', from: monthStart, to: monthEnd },
    { label: 'Last month', from: lastMonthStart, to: endOfLastMonth },
    { label: 'Last 90 days', from: addDays(today, -89), to: today },
  ];
}

/**
 * How this period compares with the one before it. `empty` says the
 * previous period holds nothing at all, where a difference the size of
 * the whole figure would read as a trend rather than a starting point.
 */
function delta(current, previous, format, { goodWhenDown = false, empty = false } = {}) {
  if (previous === null || previous === undefined) return null;
  if (empty) return el('span', { class: 'report-delta' }, 'nothing in the period before');
  const difference = current - previous;
  if (Math.abs(difference) < 0.005) {
    return el('span', { class: 'report-delta' }, 'same as before');
  }
  const up = difference > 0;
  const good = goodWhenDown ? !up : up;
  return el(
    'span',
    { class: `report-delta ${good ? 'is-up' : 'is-down'}` },
    up ? '▲' : '▼',
    ` ${format(Math.abs(difference))} vs before`
  );
}

function table(headers, rows, { align = [] } = {}) {
  return el(
    'div',
    { class: 'report-scroll' },
    el(
      'table',
      { class: 'report-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          headers.map((h, i) =>
            el('th', { class: align[i] === 'right' ? 'is-right' : null, scope: 'col' }, h)
          )
        )
      ),
      el(
        'tbody',
        {},
        rows.map((cells) =>
          el(
            'tr',
            {},
            cells.map((cell, i) =>
              el('td', { class: align[i] === 'right' ? 'is-right tnum' : null }, cell)
            )
          )
        )
      )
    )
  );
}

function section(title, node, { onExport = null, note = null } = {}) {
  return el(
    'div',
    { class: 'report-section' },
    el(
      'div',
      { class: 'report-section-head' },
      el('h2', { class: 'section-title' }, title),
      note ? el('span', { class: 'report-note' }, note) : null,
      el('span', { class: 'grow' }),
      onExport
        ? el(
            'button',
            {
              class: 'btn btn-sm print-hidden',
              'aria-label': `Export ${title.toLowerCase()} as CSV`,
              title: 'Export this table as CSV',
              onClick: onExport,
            },
            icon('download', 14),
            'CSV'
          )
        : null
    ),
    node
  );
}

export function renderReports(ctx) {
  const { store, ui } = ctx;
  const state = store.state;
  const today = isoToday();
  const currency = state.settings.currency ?? 'USD';

  const range = ui.reportRange ?? {
    from: startOfMonth(today),
    to: today,
  };
  ui.reportRange = range;

  function setRange(from, to) {
    ui.reportRange = { from, to };
    ctx.refresh();
  }

  const valid = Boolean(range.from && range.to && range.to >= range.from);
  const report = valid ? buildReport(state, range.from, range.to) : null;
  const before = valid ? previousRange(range.from, range.to) : null;
  const previous = valid ? buildReport(state, before.from, before.to) : null;

  const fromInput = el('input', {
    class: 'input',
    type: 'date',
    value: range.from,
    'aria-label': 'From',
    dataset: { focusKey: 'reports:from' },
    onChange: (e) => setRange(e.target.value, range.to),
  });
  const toInput = el('input', {
    class: 'input',
    type: 'date',
    value: range.to,
    'aria-label': 'Until',
    dataset: { focusKey: 'reports:to' },
    onChange: (e) => setRange(range.from, e.target.value),
  });

  const rangePicker = el(
    'div',
    { class: 'card report-range print-hidden' },
    el(
      'div',
      { class: 'preset-row' },
      presets(today).map((p) =>
        el(
          'button',
          {
            class: `btn btn-sm${p.from === range.from && p.to === range.to ? ' is-active' : ''}`,
            dataset: { focusKey: `reports:preset:${p.label}` },
            onClick: () => setRange(p.from, p.to),
          },
          p.label
        )
      )
    ),
    el('div', { class: 'form-grid keep-2col' }, field('From', fromInput), field('Until', toInput))
  );

  if (!valid) {
    return el(
      'div',
      {},
      el(
        'div',
        { class: 'view-header' },
        el('div', {}, el('h1', {}, 'Reports'), el('p', { class: 'subtitle' }, 'Pick a valid range'))
      ),
      rangePicker,
      el('div', { class: 'card' }, emptyState({ iconName: 'chart', title: 'That range runs backwards', message: 'The end date has to fall on or after the start date.' }))
    );
  }

  const download = (name, section) => () => {
    downloadTextFile(
      `${name}-${report.from}_${report.to}.csv`,
      reportCSV(report, section),
      'text/csv'
    );
    toast('Table downloaded');
  };

  const hoursRows = report.people.map((p) => [
    el(
      'span',
      { class: 'report-name' },
      p.name,
      p.label ? badge(p.label) : null
    ),
    String(p.shifts),
    formatHours(p.scheduledHours * 60),
    p.workedHours === 0 && p.recorded === 0 ? '–' : formatHours(p.workedHours * 60),
    p.recorded === 0
      ? '–'
      : el(
          'span',
          { class: p.workedHours > p.scheduledHours ? 'hours-over' : null },
          `${p.workedHours >= p.scheduledHours ? '+' : ''}${
            Math.round((p.workedHours - p.scheduledHours) * 10) / 10
          }h`
        ),
  ]);

  const costRows = report.people
    .filter((p) => p.pay !== '')
    .map((p) => [
      el('span', { class: 'report-name' }, p.name, p.label ? badge(p.label) : null),
      formatHours(p.scheduledHours * 60),
      formatHours(p.workedHours * 60),
      formatMoney(p.pay, currency),
    ]);

  const roleRows = report.roles.map((r) => [
    r.role,
    String(r.shifts),
    formatHours(r.minutes),
    r.cost > 0 ? formatMoney(r.cost, currency) : '–',
  ]);

  const attendanceRows = report.people
    .filter((p) => p.recorded > 0 || p.notRecorded > 0)
    .map((p) => [
      el('span', { class: 'report-name' }, p.name, p.label ? badge(p.label) : null),
      String(p.recorded),
      String(p.late),
      String(p.absent),
      String(p.notRecorded),
      p.showUpRate === null ? '–' : `${Math.round(p.showUpRate * 100)}%`,
      p.lateMinutes > 0 ? `${p.lateMinutes} min` : '–',
    ]);

  const coverageRows = report.coverage.byRole.map((g) => [
    g.role,
    String(g.days),
    String(g.missing),
  ]);

  const rangeLabel = `${formatDate(report.from)} – ${formatDate(report.to)} · ${report.days} days`;
  const nothingBefore = previous.totals.shifts === 0 && previous.open.count === 0;

  return el(
    'div',
    {},
    el(
      'div',
      { class: 'view-header' },
      el(
        'div',
        {},
        el('h1', {}, 'Reports'),
        el(
          'p',
          { class: 'subtitle tnum' },
          rangeLabel,
          el(
            'span',
            { class: 'report-note' },
            ` · compared with ${formatDate(before.from)} – ${formatDate(before.to)}`
          )
        )
      ),
      el(
        'div',
        { class: 'view-actions' },
        el(
          'button',
          {
            class: 'btn btn-icon',
            'aria-label': 'Print this report',
            title: 'Print this report',
            onClick: () => window.print(),
          },
          icon('printer', 16)
        )
      )
    ),
    rangePicker,
    el(
      'div',
      { class: 'stat-grid' },
      statCard({
        label: 'Scheduled hours',
        value: formatHours(report.totals.scheduledMinutes),
        sub: delta(
          report.totals.scheduledMinutes / 60,
          previous.totals.scheduledMinutes / 60,
          (n) => `${Math.round(n * 10) / 10}h`,
          { empty: nothingBefore }
        ),
        iconName: 'clock',
      }),
      statCard({
        label: 'Worked hours',
        value: report.totals.workedMinutes === 0 ? '–' : formatHours(report.totals.workedMinutes),
        sub: delta(
          report.totals.workedMinutes / 60,
          previous.totals.workedMinutes / 60,
          (n) => `${Math.round(n * 10) / 10}h`,
          { empty: nothingBefore }
        ),
        iconName: 'clipboard',
      }),
      report.totals.ratedCount > 0
        ? statCard({
            label: 'Pay',
            value: formatMoney(report.totals.pay, currency),
            sub: delta(report.totals.pay, previous.totals.pay, (n) => formatMoney(n, currency), {
              empty: nothingBefore,
            }),
            iconName: 'banknote',
          })
        : null,
      statCard({
        label: 'Show-up rate',
        value: report.attendance.rate === null ? '–' : `${Math.round(report.attendance.rate * 100)}%`,
        sub:
          report.attendance.rate === null
            ? 'Nothing recorded'
            : delta(
                report.attendance.rate * 100,
                previous.attendance.rate === null ? null : previous.attendance.rate * 100,
                (n) => `${Math.round(n)} points`
              ),
        iconName: 'users',
      }),
      statCard({
        label: 'Open shifts left',
        value: String(report.open.count),
        sub: delta(report.open.count, previous.open.count, (n) => `${Math.round(n)}`, {
          goodWhenDown: true,
          empty: nothingBefore,
        }),
        iconName: 'calendar',
      })
    ),
    report.totals.shifts === 0 && report.open.count === 0
      ? el(
          'div',
          { class: 'card' },
          emptyState({
            iconName: 'chart',
            title: 'Nothing happened in this range',
            message: 'No shifts fall between these dates. Try a different range.',
          })
        )
      : el(
          'div',
          {},
          section(
            'Hours per employee',
            hoursRows.length === 0
              ? el('p', { class: 'coverage-empty' }, 'No assigned shifts in this range.')
              : table(
                  ['Employee', 'Shifts', 'Scheduled', 'Worked', 'Difference'],
                  hoursRows,
                  { align: [null, 'right', 'right', 'right', 'right'] }
                ),
            { onExport: download('hours', 'hours'), note: 'Scheduled against what attendance recorded' }
          ),
          section(
            'Pay per employee',
            costRows.length === 0
              ? el('p', { class: 'coverage-empty' }, 'Nobody with an hourly rate worked in this range.')
              : table(['Employee', 'Scheduled', 'Worked', 'Pay'], costRows, {
                  align: [null, 'right', 'right', 'right'],
                }),
            {
              onExport: download('pay', 'cost'),
              note: 'Worked time where it was recorded, scheduled time otherwise; absences pay nothing',
            }
          ),
          section(
            'Cost per role',
            roleRows.length === 0
              ? el('p', { class: 'coverage-empty' }, 'No assigned shifts in this range.')
              : table(['Role', 'Shifts', 'Hours', 'Projected cost'], roleRows, {
                  align: [null, 'right', 'right', 'right'],
                }),
            {
              onExport: download('cost-by-role', 'roles'),
              note:
                report.totals.overtimeMinutes > 0
                  ? `Projected from the schedule, including ${formatMoney(
                      report.totals.overtimeCost,
                      currency
                    )} of overtime`
                  : 'Projected from the schedule, net of unpaid breaks',
            }
          ),
          section(
            'Attendance',
            attendanceRows.length === 0
              ? el('p', { class: 'coverage-empty' }, 'No attendance recorded in this range.')
              : table(
                  ['Employee', 'Recorded', 'Late', 'Absent', 'Not recorded', 'Show-up', 'Late by'],
                  attendanceRows,
                  { align: [null, 'right', 'right', 'right', 'right', 'right', 'right'] }
                ),
            { onExport: download('attendance', 'attendance') }
          ),
          section(
            'Coverage gaps',
            coverageRows.length === 0
              ? el(
                  'p',
                  { class: 'coverage-empty' },
                  (state.settings.coverage ?? []).length === 0
                    ? 'No coverage requirements are set, so nothing was measured.'
                    : 'Every day in this range met its requirements.'
                )
              : table(['Role', 'Days short', 'People short'], coverageRows, {
                  align: [null, 'right', 'right'],
                }),
            {
              onExport: coverageRows.length > 0 ? download('coverage-gaps', 'coverage') : null,
              note:
                report.open.count > 0
                  ? `${report.open.count} open shift${report.open.count === 1 ? '' : 's'} (${formatHours(
                      report.open.minutes
                    )}) were never staffed`
                  : 'Every shift in this range was staffed',
            }
          )
        )
  );
}
