/**
 * Self-contained, read-only HTML snapshot of one week's schedule for
 * publishing to static hosting or sending to the team. Every piece of
 * user content is escaped; the only script is a static employee filter.
 */
import {
  dayShort,
  formatDate,
  formatTimeRange,
  isoToday,
  parseISO,
  weekDates,
} from '../lib/time.js';
import { shiftsOn, timeOffOn } from './scheduling.js';
import { describeFilter, isFiltered, rowMatchesFilter, shiftMatchesFilter } from './filters.js';

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         font-size: 14px; color: #1a1a1e; background: #fff; }
  header { padding: 20px 22px 14px; border-bottom: 1px solid #e4e4e8; }
  h1 { margin: 0; font-size: 18px; }
  header p { margin: 4px 0 0; color: #6b6b74; font-size: 13px; }
  .filter { margin-top: 10px; font-size: 13px; color: #55555e; }
  .filtered { margin: 6px 0 0; font-weight: 600; color: #92400e; }
  select { font: inherit; padding: 4px 8px; }
  .wrap { overflow-x: auto; padding: 14px 22px 22px; }
  table { border-collapse: collapse; width: 100%; min-width: 860px; }
  th, td { border: 1px solid #e0e0e4; padding: 6px 8px; text-align: left; vertical-align: top; font-weight: normal; }
  thead th { background: #f4f4f6; font-weight: 600; font-size: 12px; }
  tbody th { width: 140px; background: #fafafa; }
  tbody th b { display: block; font-size: 13px; }
  tbody th span { color: #6b6b74; font-size: 11.5px; }
  .s { margin: 2px 0; font-size: 12px; }
  .s b { display: block; font-variant-numeric: tabular-nums; font-weight: 600; }
  .s i { color: #6b6b74; font-style: normal; }
  .off { color: #6b6b74; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  footer { padding: 0 22px 24px; color: #6b6b74; font-size: 11.5px; }
  @page { size: landscape; margin: 10mm; }
  @media print { .filter { display: none; } .wrap { overflow: visible; } table { min-width: 0; } }
`;

function cellContent(state, employee, day, matches, filter) {
  const shifts = shiftsOn(state.shifts, day).filter((s) => matches(s) && shiftMatchesFilter(s, filter));
  if (shifts.length > 0) {
    return shifts
      .map(
        (s) =>
          `<div class="s"><b>${esc(formatTimeRange(s.start, s.end))}</b><i>${esc(
            [s.role || 'No role', s.breakMinutes > 0 ? `${s.breakMinutes}m break` : null]
              .filter(Boolean)
              .join(' · ')
          )}</i></div>`
      )
      .join('');
  }
  if (!employee) return '';
  if (timeOffOn(state.availability[employee.id], day)) return '<div class="off">Time off</div>';
  if (state.availability[employee.id]?.days?.[parseISO(day).getDay()]?.off) {
    return '<div class="off">Off</div>';
  }
  return '';
}

/**
 * Renders the full snapshot page as an HTML string. `filter` is the
 * schedule's own view filter (see core/filters.js): what the manager was
 * looking at is what gets published, and the page says so, so a rota for
 * one role is never mistaken for the whole week.
 */
export function buildWeekSnapshot(state, weekStartISO, { generatedAt = isoToday(), filter = null } = {}) {
  const days = weekDates(weekStartISO);
  const kept = (s) => days.includes(s.date) && shiftMatchesFilter(s, filter);
  const countKept = (matches) => state.shifts.filter((s) => kept(s) && matches(s)).length;
  // A named person keeps their row even when the filter leaves it empty,
  // which is what rowMatchesFilter is for. The shared rows have no name
  // to be picked by, so they appear only while they hold something.
  const rowKept = (employeeId, matches) =>
    rowMatchesFilter(filter, employeeId, countKept(matches));
  // Archived employees keep their shift history; when they still hold a
  // shift this week, dropping their row would drop the shift from the page.
  const employees = state.employees
    .filter((e) => e.active || state.shifts.some((s) => s.assigneeId === e.id && days.includes(s.date)))
    .filter((e) => rowKept(e.id, (s) => s.assigneeId === e.id));
  const range = `${formatDate(days[0])} – ${formatDate(days[6])}`;
  const hasOpen = countKept((s) => !s.assigneeId) > 0;
  // Shifts whose assignee was deleted keep the assignment for history;
  // like the schedule grid, they get a shared row instead of vanishing.
  const knownIds = new Set(state.employees.map((e) => e.id));
  const isFormer = (s) => s.assigneeId && !knownIds.has(s.assigneeId);
  const hasFormer = countKept(isFormer) > 0;

  const headCells = days
    .map((d) => `<th>${esc(dayShort(parseISO(d).getDay()))} ${parseISO(d).getDate()}</th>`)
    .join('');

  const bodyRows = [
    hasOpen
      ? `<tr data-emp="__open"><th><b>Open shifts</b><span>Unassigned</span></th>${days
          .map((d) => `<td>${cellContent(state, null, d, (s) => !s.assigneeId, filter)}</td>`)
          .join('')}</tr>`
      : '',
    ...employees.map(
      (emp) =>
        `<tr data-emp="${esc(emp.id)}"><th><b>${esc(emp.name)}</b><span>${esc(
          [emp.role || '', emp.active ? '' : 'Archived'].filter(Boolean).join(' · ')
        )}</span></th>${days
          .map((d) => `<td>${cellContent(state, emp, d, (s) => s.assigneeId === emp.id, filter)}</td>`)
          .join('')}</tr>`
    ),
    hasFormer
      ? `<tr data-emp="__former"><th><b>Former employees</b><span>No longer on the team</span></th>${days
          .map((d) => `<td>${cellContent(state, null, d, isFormer, filter)}</td>`)
          .join('')}</tr>`
      : '',
  ].join('');

  const filterOptions = employees
    .map((emp) => `<option value="${esc(emp.id)}">${esc(emp.name)}</option>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Schedule · ${esc(range)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>Team schedule</h1>
<p>${esc(range)} · Updated ${esc(formatDate(generatedAt))}</p>
${isFiltered(filter) ? `<p class="filtered">Showing ${esc(describeFilter(filter, state))}. This is not the whole week.</p>` : ''}
<label class="filter">Show:
<select id="emp-filter"><option value="">Everyone</option>${filterOptions}</select>
</label>
</header>
<div class="wrap">
<table>
<thead><tr><th></th>${headCells}</tr></thead>
<tbody>${bodyRows}</tbody>
</table>
</div>
<footer>Read-only schedule snapshot. Published with Shifts, powered by Puter.</footer>
<script>
document.getElementById('emp-filter').addEventListener('change', function () {
  var v = this.value;
  document.querySelectorAll('tbody tr').forEach(function (tr) {
    tr.style.display = !v || tr.getAttribute('data-emp') === v ? '' : 'none';
  });
});
</script>
</body>
</html>`;
}
