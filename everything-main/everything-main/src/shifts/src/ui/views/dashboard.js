import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import {
  addDays,
  formatDate,
  formatDateLong,
  formatElapsed,
  formatHours,
  formatTime,
  formatTimeRange,
  isoToday,
  nowTime,
  relativeDayLabel,
  startOfWeek,
  weekDates,
} from '../../lib/time.js';
import {
  coverageGaps,
  hoursStatus,
  shiftNetMinutes,
  shiftsOn,
  suggestAssignees,
  weeklyMinutes,
} from '../../core/scheduling.js';
import { describeGap } from './schedule.js';
import { budgetStatus, formatMoney, laborCost } from '../../core/payroll.js';
import { costOptions } from '../cost.js';
import { pendingSwaps } from '../../core/swaps.js';
import {
  ATTENDANCE_STATUS,
  clockInRecord,
  clockOutRecord,
  elapsedMinutes,
  isInProgress,
  isRunningNow,
  summarizeAttendance,
} from '../../core/attendance.js';
import {
  attendanceBadge,
  avatar,
  badge,
  buttonize,
  emptyState,
  liveText,
  statCard,
  suggestionList,
  swapStatusBadge,
} from '../components.js';
import { openEmployeeEditor, openShiftEditor } from '../editors.js';
import { openModal } from '../modal.js';
import { buildSeedData } from '../../core/seed.js';
import { toast } from '../toast.js';

/**
 * Two-tap gap filling: the flagged requirement becomes a shift proposal
 * and the ranked candidates get a one-tap Assign that creates the shift
 * already staffed. Adding it as an open shift stays available.
 */
function openFillGapDialog(ctx, gap) {
  const { store } = ctx;
  const state = store.state;
  const proposal = {
    date: gap.date,
    start: gap.requirement.start ?? '09:00',
    end: gap.requirement.end ?? '17:00',
    role: gap.requirement.role,
    assigneeId: null,
  };
  const suggestions = suggestAssignees(proposal, {
    employees: state.employees,
    shifts: state.shifts,
    availability: state.availability,
    rules: state.settings.rules,
  });

  // Every candidate offers the same submit, so disabling just the button
  // that was pressed left the rest of them live. A gap asking for one
  // person, and a connection slow enough that a dimmed button looks like
  // nothing happened, was two clicks away from two shifts. Lock the
  // whole dialog instead; dimming all of it at once is also the clearest
  // sign that the first click did land.
  let submitting = false;

  async function create(assigneeId, button) {
    if (submitting) return;
    submitting = true;
    const buttons = [...modal.body.querySelectorAll('button')];
    for (const b of buttons) b.disabled = true;
    try {
      await store.addShift({ ...proposal, assigneeId });
      const employee = state.employees.find((e) => e.id === assigneeId);
      toast(employee ? `Shift assigned to ${employee.name}` : 'Open shift added to the schedule');
      modal.close();
    } catch (err) {
      submitting = false;
      for (const b of buttons) b.disabled = false;
      button.focus();
      toast(err.message, 'error');
    }
  }

  const modal = openModal({
    title: `Fill: ${describeGap(gap)}`,
    content: [
      el(
        'p',
        { class: 'share-copy' },
        `${formatDateLong(gap.date)} · ${formatTimeRange(proposal.start, proposal.end)} · ${proposal.role}`
      ),
      suggestions.length === 0
        ? el('p', { class: 'coverage-empty' }, 'Nobody is a clean fit right now: everyone is off, booked, or would go over their max hours.')
        : suggestionList(suggestions, (s, button) => create(s.employee.id, button)),
      el(
        'button',
        { class: 'btn btn-block', onClick: (e) => create(null, e.currentTarget) },
        icon('plus', 15),
        'Add as open shift instead'
      ),
    ],
  });
}

/**
 * Clock in or out for a shift that is happening today, from the page a
 * manager already has open. The status comes from how late the stamp is
 * (see clockInRecord); everything else is left to the Attendance view.
 */
function clockButton(ctx, shift, record) {
  const { store } = ctx;
  if (record?.status === ATTENDANCE_STATUS.ABSENT) return null;
  if (record?.clockIn && record?.clockOut) return null;
  const out = isInProgress(record);

  async function stamp() {
    const at = nowTime();
    const next = out
      ? clockOutRecord(record, at)
      : clockInRecord(shift, record, at, store.state.settings.graceMinutes ?? 0);
    try {
      await store.recordAttendance(shift.id, next);
      const name = store.state.employees.find((e) => e.id === shift.assigneeId)?.name ?? 'Shift';
      toast(
        out
          ? `${name} clocked out at ${formatTime(at)}`
          : `${name} clocked in at ${formatTime(at)}${next.status === ATTENDANCE_STATUS.LATE ? ' (late)' : ''}`
      );
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return el(
    'button',
    { class: `btn btn-sm${out ? '' : ' btn-primary'}`, onClick: stamp },
    icon('clock', 15),
    out ? 'Clock out' : 'Clock in'
  );
}

function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function renderDashboard(ctx) {
  const { store } = ctx;
  const state = store.state;
  const today = isoToday();

  if (state.employees.length === 0 && state.shifts.length === 0) {
    return el(
      'div',
      {},
      el(
        'div',
        { class: 'view-header' },
        el('div', {}, el('h1', {}, 'Welcome to Shifts'), el('p', { class: 'subtitle' }, formatDateLong(today)))
      ),
      el(
        'div',
        { class: 'card' },
        emptyState({
          iconName: 'users',
          title: 'No team yet',
          message: 'Add your first employee to start scheduling, or explore with sample data.',
          actions: [
            el(
              'button',
              { class: 'btn btn-primary', onClick: () => openEmployeeEditor(ctx) },
              icon('user-plus', 16),
              'Add employee'
            ),
            el(
              'button',
              {
                class: 'btn',
                onClick: async (e) => {
                  const button = e.currentTarget;
                  button.disabled = true;
                  try {
                    await store.loadSampleData(buildSeedData());
                    toast('Sample data loaded. Wipe it anytime from the banner.');
                  } catch (err) {
                    button.disabled = false;
                    toast(err.message, 'error');
                  }
                },
              },
              icon('sparkles', 15),
              'Load sample data'
            ),
          ],
        })
      )
    );
  }

  const week = startOfWeek(today);
  const weekSet = new Set(weekDates(week));
  const todayShifts = shiftsOn(state.shifts, today);
  const pending = pendingSwaps(state.swaps);
  const weekMinutes = state.shifts
    .filter((s) => weekSet.has(s.date) && s.assigneeId)
    .reduce((sum, s) => sum + shiftNetMinutes(s), 0);

  // Last 7 calendar days including today, over assigned shifts only, the
  // same set the Attendance view, the timesheet, and the reports count.
  const shiftById = new Map(state.shifts.map((s) => [s.id, s]));
  const recentRecords = Object.entries(state.attendance)
    .map(([shiftId, record]) => ({ record, shift: shiftById.get(shiftId) }))
    .filter((r) => r.shift?.assigneeId && r.shift.date >= addDays(today, -6) && r.shift.date <= today)
    .map((r) => r.record);
  const attendance = summarizeAttendance(recentRecords);

  const employeeById = (id) => state.employees.find((e) => e.id === id);

  // Staffing gaps from today through the end of next week.
  const gapDates = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const gaps = coverageGaps(state.shifts, state.settings.coverage, gapDates).slice(0, 6);

  // Time off intersecting the current week.
  const weekEnd = addDays(week, 6);
  const away = state.employees
    .filter((e) => e.active)
    .flatMap((employee) =>
      (state.availability[employee.id]?.exceptions ?? [])
        .filter((x) => x.from <= weekEnd && week <= x.to)
        .map((entry) => ({ employee, entry }))
    );

  return el(
    'div',
    {},
    el(
      'div',
      { class: 'view-header' },
      el('div', {}, el('h1', {}, `${greeting()}`), el('p', { class: 'subtitle' }, formatDateLong(today))),
      el(
        'div',
        { class: 'view-actions' },
        el('button', { class: 'btn btn-primary', onClick: () => openShiftEditor(ctx) }, icon('plus', 16), 'New shift')
      )
    ),
    el(
      'div',
      { class: 'stat-grid' },
      statCard({
        label: 'Shifts today',
        value: String(todayShifts.length),
        sub: (() => {
          const open = todayShifts.filter((s) => !s.assigneeId).length;
          const running = state.shifts.filter(
            (s) => s.assigneeId && isRunningNow(s, state.attendance[s.id], today)
          ).length;
          return `${open} open${running ? ` · ${running} on now` : ''}`;
        })(),
        iconName: 'calendar',
        onClick: () => ctx.navigate('schedule'),
      }),
      statCard({
        label: 'Scheduled this week',
        value: formatHours(weekMinutes),
        sub: (() => {
          const active = state.employees.filter((e) => e.active);
          const over = active.filter(
            (e) => hoursStatus(weeklyMinutes(state.shifts, e.id, week), e) === 'over'
          ).length;
          return `${active.length} active employees${over ? ` · ${over} over max hours` : ''}`;
        })(),
        iconName: 'clock',
        onClick: () => ctx.navigate('schedule'),
      }),
      (() => {
        const cost = laborCost(
          state.shifts,
          state.employees,
          weekDates(week),
          costOptions(state.settings)
        );
        if (cost.ratedCount === 0) return null;
        const budget = budgetStatus(cost.cost, state.settings.laborBudget);
        const currency = state.settings.currency;
        return statCard({
          label: 'Projected cost',
          value: formatMoney(cost.cost, currency),
          // The budget is the thing that makes the number mean
          // something, so it comes first when there is one.
          sub: budget.budget
            ? `${
                budget.over
                  ? `${formatMoney(budget.difference, currency)} over`
                  : `${formatMoney(-budget.difference, currency)} left`
              } of ${formatMoney(budget.budget, currency)}`
            : cost.ratedCount < cost.employeeCount
              ? `${cost.ratedCount} of ${cost.employeeCount} have rates`
              : 'This week, net of breaks',
          iconName: 'banknote',
          onClick: () => ctx.navigate('schedule'),
        });
      })(),
      statCard({
        label: 'Pending swaps',
        value: String(pending.length),
        sub: pending.length ? 'Awaiting review' : 'All clear',
        iconName: 'arrow-left-right',
        onClick: () => ctx.navigate('swaps'),
      }),
      statCard({
        label: 'Attendance (7d)',
        value: attendance.rate === null ? 'N/A' : `${Math.round(attendance.rate * 100)}%`,
        sub: attendance.total ? `${attendance.late} late · ${attendance.absent} absent` : 'No records yet',
        iconName: 'clipboard',
        onClick: () => ctx.navigate('attendance'),
      })
    ),
    el('h2', { class: 'section-title' }, 'Today'),
    el(
      'div',
      { class: 'card row-list' },
      todayShifts.length === 0
        ? emptyState({ iconName: 'calendar', title: 'Nothing scheduled today', message: 'Enjoy the quiet, or add a shift.' })
        : todayShifts.map((shift) => {
            const emp = employeeById(shift.assigneeId);
            const record = state.attendance[shift.id];
            const running = isInProgress(record);
            return el(
              'div',
              { class: 'item-row' },
              // The row holds two controls now, so the part that opens the
              // shift is a button of its own rather than the whole row:
              // a button inside a button is not a thing, and dropping the
              // row's own focus would have cost a keyboard user the shift.
              el(
                'button',
                { class: 'item-hit', onClick: () => openShiftEditor(ctx, { shift }) },
                avatar(emp),
                el(
                  'div',
                  { class: 'item-main' },
                  el(
                    'div',
                    { class: 'item-title' },
                    emp ? emp.name : shift.assigneeId ? 'Former employee' : 'Open shift'
                  ),
                  el(
                    'div',
                    { class: 'item-sub tnum' },
                    `${formatTimeRange(shift.start, shift.end)} · ${shift.role || 'No role'}`
                  ),
                  running
                    ? el(
                        'span',
                        { class: 'live-pill' },
                        el('span', { class: 'live-dot' }),
                        'On now · ',
                        liveText(() => formatElapsed(elapsedMinutes(record.clockIn, nowTime()) ?? 0))
                      )
                    : null
                )
              ),
              el(
                'div',
                { class: 'item-actions' },
                shift.assigneeId ? clockButton(ctx, shift, record) : null,
                shift.assigneeId
                  ? attendanceBadge(record?.status)
                  : el('span', { class: 'badge badge-accent' }, 'Open')
              )
            );
          })
    ),
    gaps.length > 0
      ? el(
          'div',
          {},
          el('h2', { class: 'section-title' }, 'Coverage gaps'),
          el(
            'div',
            { class: 'card row-list' },
            gaps.map((gap) =>
              el(
                'div',
                { class: 'item-row' },
                el(
                  'div',
                  { class: 'item-main' },
                  el('div', { class: 'item-title' }, `Needs ${describeGap(gap)}`),
                  el('div', { class: 'item-sub tnum' }, `${relativeDayLabel(gap.date, today)} · ${gap.scheduled} scheduled`)
                ),
                el(
                  'div',
                  { class: 'item-actions' },
                  el(
                    'button',
                    { class: 'btn btn-sm', onClick: () => openFillGapDialog(ctx, gap) },
                    icon('user-plus', 14),
                    'Fill'
                  )
                )
              )
            )
          )
        )
      : null,
    away.length > 0
      ? el(
          'div',
          {},
          el('h2', { class: 'section-title' }, 'Away this week'),
          el(
            'div',
            { class: 'card row-list' },
            away.map(({ employee, entry }) =>
              el(
                'div',
                { class: 'item-row' },
                avatar(employee),
                el(
                  'div',
                  { class: 'item-main' },
                  el('div', { class: 'item-title' }, employee.name),
                  el(
                    'div',
                    { class: 'item-sub tnum' },
                    `${entry.from === entry.to ? formatDate(entry.from) : `${formatDate(entry.from)} – ${formatDate(entry.to)}`}${entry.note ? ` · ${entry.note}` : ''}`
                  )
                ),
                el('div', { class: 'item-actions' }, badge('Time off', 'warning'))
              )
            )
          )
        )
      : null,
    pending.length > 0
      ? el(
          'div',
          {},
          el('h2', { class: 'section-title' }, 'Pending swap requests'),
          el(
            'div',
            { class: 'card row-list' },
            pending.slice(0, 4).map((swap) => {
              const from = employeeById(swap.fromEmployeeId);
              const to = employeeById(swap.toEmployeeId);
              const snap = state.shifts.find((s) => s.id === swap.shiftId) ?? swap.shiftSnapshot;
              return el(
                'div',
                { ...buttonize(() => ctx.navigate('swaps')), class: 'item-row is-clickable' },
                avatar(from),
                el(
                  'div',
                  { class: 'item-main' },
                  el(
                    'div',
                    { class: 'item-title' },
                    // The same word the rest of the app uses for somebody
                    // who has been deleted.
                    `${from?.name ?? 'Former employee'} → ${to?.name ?? 'Former employee'}`
                  ),
                  el(
                    'div',
                    { class: 'item-sub tnum' },
                    `${formatDateLong(snap.date)} · ${formatTimeRange(snap.start, snap.end)} · ${snap.role || 'No role'}`
                  )
                ),
                el('div', { class: 'item-actions' }, swapStatusBadge(swap.status))
              );
            })
          )
        )
      : null
  );
}
