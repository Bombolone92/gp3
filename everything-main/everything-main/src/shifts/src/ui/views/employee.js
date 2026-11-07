/**
 * One person's page: the questions a manager actually asks about
 * somebody, answered in one place instead of across four views. Hours
 * this week and this month against their target, what they work next,
 * how their attendance has gone, when they are away, the swaps they are
 * part of, and a way to reach them.
 */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import {
  addDays,
  addMonths,
  daysInMonth,
  formatDate,
  formatDateLong,
  formatHours,
  formatMonth,
  formatTimeRange,
  isoToday,
  relativeDayLabel,
  startOfMonth,
  startOfWeek,
} from '../../lib/time.js';
import {
  hoursStatus,
  shiftNetMinutes,
  timeOffOn,
  weeklyMinutes,
} from '../../core/scheduling.js';
import { lateMinutes, summarizeAttendance, workedMinutes } from '../../core/attendance.js';
import { formatMoney } from '../../core/payroll.js';
import {
  attendanceBadge,
  avatar,
  badge,
  buttonize,
  emptyState,
  statCard,
  swapStatusBadge,
} from '../components.js';
import { openEmployeeEditor, openShiftEditor } from '../editors.js';
import { openCalendarExportDialog } from '../calendar-export.js';
import { confirmDialog } from '../modal.js';
import { toast, undoToast } from '../toast.js';

/** Sum of paid minutes for one person across an inclusive date range. */
function minutesBetween(shifts, employeeId, fromISO, toISO) {
  return shifts
    .filter((s) => s.assigneeId === employeeId && s.date >= fromISO && s.date <= toISO)
    .reduce((sum, s) => sum + shiftNetMinutes(s), 0);
}

/** "12h of 32h target" / "12h", with the status color the grid uses. */
function hoursLine(minutes, employee, { showTarget = true } = {}) {
  const status = hoursStatus(minutes, employee);
  return el(
    'span',
    { class: status !== 'ok' ? `hours-${status}` : null },
    formatHours(minutes),
    showTarget && employee.targetHours != null ? ` of ${employee.targetHours}h target` : ''
  );
}

function contactLinks(employee) {
  const links = [];
  if (employee.email) {
    links.push(
      el(
        'a',
        { class: 'btn btn-sm', href: `mailto:${employee.email}` },
        icon('mail', 15),
        employee.email
      )
    );
  }
  if (employee.phone) {
    links.push(
      el('a', { class: 'btn btn-sm', href: `tel:${employee.phone}` }, icon('phone', 15), employee.phone),
      el(
        'a',
        {
          class: 'btn btn-sm',
          href: `sms:${employee.phone}`,
          'aria-label': `Text ${employee.name}`,
          title: `Text ${employee.name}`,
        },
        icon('message', 15),
        'Text'
      )
    );
  }
  return links;
}

export function renderEmployeeProfile(ctx, employeeId) {
  const { store, ui } = ctx;
  const state = store.state;
  const employee = state.employees.find((e) => e.id === employeeId);

  const backButton = el(
    'button',
    { class: 'btn btn-sm back-link', onClick: () => ctx.navigate('team') },
    icon('chevron-left', 15),
    'Team'
  );

  if (!employee) {
    return el(
      'div',
      {},
      el('div', { class: 'view-header' }, el('div', {}, backButton, el('h1', {}, 'Not found'))),
      el(
        'div',
        { class: 'card' },
        emptyState({
          iconName: 'users',
          title: 'This person is no longer on record',
          message: 'They may have been deleted. Their past shifts stay on reports as a former employee.',
          actions: [
            el('button', { class: 'btn btn-primary', onClick: () => ctx.navigate('team') }, 'Back to Team'),
          ],
        })
      )
    );
  }

  // Names the browser tab and the history entry after the person, not
  // the list they came from (see render() in app.js).
  ui.pageTitle = employee.name;

  const today = isoToday();
  const weekStart = startOfWeek(today);
  const monthStart = startOfMonth(today);
  const monthEnd = addDays(addMonths(monthStart, 1), -1);

  const weekMinutes = weeklyMinutes(state.shifts, employee.id, weekStart);
  const monthMinutes = minutesBetween(state.shifts, employee.id, monthStart, monthEnd);
  // A monthly target only exists as a weekly one times the weeks in this
  // particular month, which is 4.4 in a 31-day month and 4 in February.
  const monthWeeks = daysInMonth(monthStart) / 7;
  const monthTargetHours =
    employee.targetHours != null ? Math.round(employee.targetHours * monthWeeks) : null;

  const mine = state.shifts.filter((s) => s.assigneeId === employee.id);
  const upcoming = mine
    .filter((s) => s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .slice(0, 8);

  // Attendance over the last 30 days: enough to see a pattern without
  // turning the page into a log.
  const historyFrom = addDays(today, -29);
  const recent = mine
    .filter((s) => s.date >= historyFrom && s.date <= today && state.attendance[s.id])
    .map((s) => ({ shift: s, record: state.attendance[s.id] }))
    .sort((a, b) => b.shift.date.localeCompare(a.shift.date) || b.shift.start.localeCompare(a.shift.start));
  const attendance = summarizeAttendance(recent.map((r) => r.record));

  const timeOff = [...(state.availability[employee.id]?.exceptions ?? [])]
    .sort((a, b) => b.from.localeCompare(a.from))
    .filter((entry) => entry.to >= addDays(today, -60));

  const swaps = state.swaps
    .filter((s) => s.fromEmployeeId === employee.id || s.toEmployeeId === employee.id)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .slice(0, 6);

  const nameOf = (id) => state.employees.find((e) => e.id === id)?.name ?? 'Former employee';

  async function archive() {
    try {
      const undo = await store.archiveEmployee(employee.id);
      undoToast(`${employee.name} archived`, undo);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function restore() {
    try {
      await store.unarchiveEmployee(employee.id);
      toast(`${employee.name} is back on the team`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /**
   * A handout for one person: the week grid filtered to them, which is
   * exactly what the print stylesheet already lays out. Printing this
   * page instead would hand over their attendance history too.
   */
  function printWeek() {
    ui.scheduleFilter = { roles: [], employees: [employee.id], openOnly: false, understaffedOnly: false };
    ui.scheduleSearch = '';
    ui.scheduleView = 'week';
    ui.scheduleWeekStart = weekStart;
    ctx.navigate('schedule');
    // The route change renders on the next task; print once it has.
    setTimeout(() => window.print(), 120);
  }

  const deletePermanently = async () => {
    const ok = await confirmDialog({
      title: `Delete ${employee.name} permanently?`,
      message:
        'Their availability and time off are deleted and upcoming shifts become open. Past shifts stay on reports, but under “Former employee” instead of their name. Leaving them archived keeps all of it.',
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    try {
      const undo = await store.deleteEmployee(employee.id);
      ctx.navigate('team');
      undoToast(`${employee.name} deleted`, undo);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const contacts = contactLinks(employee);

  return el(
    'div',
    {},
    el(
      'div',
      { class: 'view-header' },
      el(
        'div',
        {},
        backButton,
        el(
          'div',
          { class: 'profile-head' },
          avatar(employee, 'avatar-lg'),
          el(
            'div',
            {},
            el('h1', {}, employee.name),
            el(
              'p',
              { class: 'subtitle' },
              employee.role || 'No role',
              employee.hourlyRate != null
                ? ` · ${formatMoney(employee.hourlyRate, state.settings.currency)}/h`
                : '',
              employee.maxHours != null ? ` · max ${employee.maxHours}h/week` : '',
              employee.active ? null : el('span', { class: 'badge', style: { marginLeft: '8px' } }, 'Archived')
            )
          )
        )
      ),
      el(
        'div',
        { class: 'view-actions' },
        // Archived people are off the rota, and the store refuses to hand
        // them a shift; the Restore button at the end of this row is the
        // way back on. Offering Add shift here as well pre-selected them
        // in an editor that could only refuse to save.
        employee.active
          ? el(
              'button',
              {
                class: 'btn',
                onClick: () =>
                  openShiftEditor(ctx, {
                    defaults: { date: today, assigneeId: employee.id, role: employee.role },
                  }),
              },
              icon('plus', 15),
              'Add shift'
            )
          : null,
        el(
          'button',
          { class: 'btn', onClick: () => openEmployeeEditor(ctx, { employee }) },
          icon('pencil', 15),
          'Edit'
        ),
        el(
          'button',
          { class: 'btn', onClick: () => ctx.navigate(`availability/${employee.id}`) },
          icon('clock', 15),
          'Availability'
        ),
        el(
          'button',
          {
            class: 'btn btn-icon',
            'aria-label': `Export ${employee.name}’s calendar`,
            title: 'Export to calendar (.ics)',
            onClick: () => openCalendarExportDialog(ctx, { employeeId: employee.id }),
          },
          icon('calendar-check', 16)
        ),
        el(
          'button',
          {
            class: 'btn btn-icon',
            'aria-label': `Print ${employee.name}’s week`,
            title: 'Print their week as a handout',
            onClick: printWeek,
          },
          icon('printer', 16)
        ),
        employee.active
          ? el(
              'button',
              {
                class: 'btn btn-icon',
                'aria-label': `Archive ${employee.name}`,
                title: 'Archive: keeps history, frees upcoming shifts',
                onClick: archive,
              },
              icon('archive', 16)
            )
          : el(
              'button',
              { class: 'btn', title: 'Bring them back into scheduling', onClick: restore },
              icon('archive-restore', 15),
              'Restore'
            )
      )
    ),
    contacts.length > 0
      ? el('div', { class: 'profile-contact' }, contacts)
      : el(
          'div',
          { class: 'profile-contact' },
          el('span', { class: 'item-sub' }, 'No phone or email on file.'),
          el(
            'button',
            { class: 'btn btn-sm', onClick: () => openEmployeeEditor(ctx, { employee }) },
            icon('user-plus', 15),
            'Add contact details'
          )
        ),
    el(
      'div',
      { class: 'stat-grid' },
      statCard({
        label: 'This week',
        value: hoursLine(weekMinutes, employee, { showTarget: false }),
        sub:
          employee.targetHours != null
            ? `of ${employee.targetHours}h target`
            : `${mine.filter((s) => s.date >= weekStart && s.date <= addDays(weekStart, 6)).length} shifts`,
        iconName: 'clock',
        onClick: () => ctx.navigate('schedule'),
      }),
      statCard({
        label: formatMonth(monthStart),
        value: formatHours(monthMinutes),
        sub:
          monthTargetHours != null
            ? `of about ${monthTargetHours}h at their weekly target`
            : `${mine.filter((s) => s.date >= monthStart && s.date <= monthEnd).length} shifts`,
        iconName: 'calendar',
      }),
      statCard({
        label: 'Attendance (30d)',
        value: attendance.rate === null ? 'N/A' : `${Math.round(attendance.rate * 100)}%`,
        sub: attendance.total
          ? `${attendance.late} late · ${attendance.absent} absent`
          : 'Nothing recorded yet',
        iconName: 'clipboard',
        onClick: () => ctx.navigate('attendance'),
      }),
      statCard({
        label: 'Upcoming shifts',
        value: String(mine.filter((s) => s.date >= today).length),
        sub: upcoming.length > 0 ? `Next: ${relativeDayLabel(upcoming[0].date, today)}` : 'Nothing scheduled',
        iconName: 'calendar-check',
      })
    ),
    el('h2', { class: 'section-title' }, 'Upcoming shifts'),
    el(
      'div',
      { class: 'card row-list' },
      upcoming.length === 0
        ? emptyState({
            iconName: 'calendar',
            title: 'Nothing scheduled',
            message: employee.active
              ? `${employee.name} has no shifts from today onwards.`
              : `${employee.name} is archived, so nothing is scheduled for them. Restoring them puts them back on the rota.`,
            actions: [
              employee.active
                ? el(
                    'button',
                    {
                      class: 'btn btn-primary',
                      onClick: () =>
                        openShiftEditor(ctx, {
                          defaults: { date: today, assigneeId: employee.id, role: employee.role },
                        }),
                    },
                    icon('plus', 16),
                    'Add shift'
                  )
                : el(
                    'button',
                    { class: 'btn btn-primary', onClick: restore },
                    icon('archive-restore', 16),
                    'Restore'
                  ),
            ],
          })
        : upcoming.map((shift) =>
            el(
              'div',
              { ...buttonize(() => openShiftEditor(ctx, { shift })), class: 'item-row is-clickable' },
              el(
                'div',
                { class: 'item-main' },
                el('div', { class: 'item-title' }, relativeDayLabel(shift.date, today)),
                el(
                  'div',
                  { class: 'item-sub tnum' },
                  `${formatTimeRange(shift.start, shift.end)} · ${shift.role || 'No role'}${
                    shift.breakMinutes > 0 ? ` · ${shift.breakMinutes}m break` : ''
                  }`
                )
              ),
              el(
                'div',
                { class: 'item-actions' },
                timeOffOn(state.availability[employee.id], shift.date)
                  ? badge('Time off', 'warning')
                  : null,
                el('span', { class: 'item-sub tnum' }, formatHours(shiftNetMinutes(shift)))
              )
            )
          )
    ),
    timeOff.length > 0
      ? el(
          'div',
          {},
          el('h2', { class: 'section-title' }, 'Time off'),
          el(
            'div',
            { class: 'card row-list' },
            timeOff.map((entry) =>
              el(
                'div',
                { class: 'item-row' },
                el(
                  'div',
                  { class: 'item-main' },
                  el(
                    'div',
                    { class: 'item-title' },
                    entry.from === entry.to
                      ? formatDateLong(entry.from)
                      : `${formatDate(entry.from)} – ${formatDate(entry.to)}`
                  ),
                  el('div', { class: 'item-sub' }, entry.note || 'No note')
                ),
                el(
                  'div',
                  { class: 'item-actions' },
                  entry.to < today ? badge('Past') : badge(entry.from <= today ? 'Away now' : 'Upcoming', 'warning')
                )
              )
            )
          )
        )
      : null,
    el('h2', { class: 'section-title' }, 'Recent attendance'),
    el(
      'div',
      { class: 'card row-list' },
      recent.length === 0
        ? emptyState({
            iconName: 'clipboard',
            title: 'No attendance recorded',
            message: 'Nothing has been taken for their shifts in the last 30 days.',
          })
        : recent.slice(0, 10).map(({ shift, record }) => {
            const late = record.status === 'absent' ? 0 : lateMinutes(shift, record.clockIn);
            const worked =
              record.status === 'absent' ? null : workedMinutes(record.clockIn, record.clockOut);
            return el(
              'div',
              { class: 'item-row' },
              el(
                'div',
                { class: 'item-main' },
                el('div', { class: 'item-title' }, formatDate(shift.date)),
                el(
                  'div',
                  { class: 'item-sub tnum' },
                  `${formatTimeRange(shift.start, shift.end)} · ${shift.role || 'No role'}${
                    late > 0 ? ` · ${late} min late` : ''
                  }${worked === null ? '' : ` · ${formatHours(Math.max(0, worked - (shift.breakMinutes ?? 0)))} worked`}`
                )
              ),
              el('div', { class: 'item-actions' }, attendanceBadge(record.status))
            );
          })
    ),
    swaps.length > 0
      ? el(
          'div',
          {},
          el('h2', { class: 'section-title' }, 'Swap history'),
          el(
            'div',
            { class: 'card row-list' },
            swaps.map((swap) => {
              const snap = state.shifts.find((s) => s.id === swap.shiftId) ?? swap.shiftSnapshot;
              const outgoing = swap.fromEmployeeId === employee.id;
              return el(
                'div',
                { ...buttonize(() => ctx.navigate('swaps')), class: 'item-row is-clickable' },
                el(
                  'div',
                  { class: 'item-main' },
                  el(
                    'div',
                    { class: 'item-title' },
                    outgoing ? `To ${nameOf(swap.toEmployeeId)}` : `From ${nameOf(swap.fromEmployeeId)}`
                  ),
                  el(
                    'div',
                    { class: 'item-sub tnum' },
                    `${formatDate(snap.date)} · ${formatTimeRange(snap.start, snap.end)} · ${
                      snap.role || 'No role'
                    }`
                  )
                ),
                el(
                  'div',
                  { class: 'item-actions' },
                  swapStatusBadge(swap.status)
                )
              );
            })
          )
        )
      : null,
    employee.active
      ? null
      : el(
          'div',
          { class: 'profile-danger' },
          el(
            'button',
            { class: 'btn btn-danger btn-sm', onClick: deletePermanently },
            icon('trash', 15),
            'Delete permanently'
          ),
          el(
            'span',
            { class: 'item-sub' },
            'Archived keeps their history. Deleting drops their availability and takes their name off past shifts.'
          )
        )
  );
}
