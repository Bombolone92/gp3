import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { downloadTextFile } from '../../lib/download.js';
import {
  addDays,
  formatElapsed,
  formatTime,
  formatHours,
  formatTimeRange,
  isOvernight,
  isoDate,
  isoToday,
  nowTime,
  parseISO,
  relativeDayLabel,
  startOfWeek,
} from '../../lib/time.js';
import { shiftBreakMinutes, shiftsOn } from '../../core/scheduling.js';
import {
  ATTENDANCE_STATUS,
  clockInRecord,
  clockOutRecord,
  elapsedMinutes,
  isInProgress,
  isRunningNow,
  lateMinutes,
  summarizeAttendance,
  workedMinutes,
} from '../../core/attendance.js';
import { timesheetCSV, timesheetRows } from '../../core/timesheet.js';
import { avatar, emptyState, field, liveText, segmented, showFormError, statCard } from '../components.js';
import { openModal } from '../modal.js';
import { toast, undoToast } from '../toast.js';

function openExportDialog(ctx) {
  const { store } = ctx;
  const today = isoToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const endOfMonth = (() => {
    const d = parseISO(today);
    return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  })();

  const fromInput = el('input', { class: 'input', type: 'date', value: startOfWeek(today) });
  const toInput = el('input', { class: 'input', type: 'date', value: addDays(startOfWeek(today), 6) });
  const preview = el('p', { class: 'export-preview' });
  const errorBox = el('div', { style: { display: 'contents' } });

  const PRESETS = [
    { label: 'This week', from: startOfWeek(today), to: addDays(startOfWeek(today), 6) },
    { label: 'Last week', from: addDays(startOfWeek(today), -7), to: addDays(startOfWeek(today), -1) },
    { label: '1st to 15th', from: monthStart, to: `${today.slice(0, 8)}15` },
    { label: '16th to month end', from: `${today.slice(0, 8)}16`, to: endOfMonth },
  ];

  /** A date input reports '' when cleared, which is not a bound at all. */
  const validRange = () =>
    Boolean(fromInput.value && toInput.value && toInput.value >= fromInput.value);

  function refreshPreview() {
    errorBox.replaceChildren();
    // Count only what the download would actually accept. An open-ended
    // range totals up every shift on record, and a backwards one reads
    // as an empty week rather than a range entered the wrong way round.
    if (!validRange()) {
      preview.textContent = 'Pick a valid date range.';
      return;
    }
    const rows = timesheetRows(store.state, fromInput.value, toInput.value);
    const people = new Set(rows.map((r) => r.employeeId)).size;
    preview.textContent =
      rows.length === 0
        ? 'No assigned shifts in this range.'
        : `${rows.length} shift${rows.length === 1 ? '' : 's'} across ${people} employee${people === 1 ? '' : 's'}.`;
  }

  fromInput.addEventListener('change', refreshPreview);
  toInput.addEventListener('change', refreshPreview);
  refreshPreview();

  const modal = openModal({
    title: 'Export timesheet',
    content: [
      el(
        'div',
        { class: 'preset-row' },
        PRESETS.map((p) =>
          el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: () => {
                fromInput.value = p.from;
                toInput.value = p.to;
                refreshPreview();
              },
            },
            p.label
          )
        )
      ),
      el('div', { class: 'form-grid keep-2col' }, field('From', fromInput), field('Until', toInput)),
      preview,
      errorBox,
    ],
    footer: [
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
      el(
        'button',
        {
          class: 'btn btn-primary',
          onClick: () => {
            const from = fromInput.value;
            const to = toInput.value;
            if (!validRange()) {
              showFormError(errorBox, 'Pick a valid date range.');
              return;
            }
            if (timesheetRows(store.state, from, to).length === 0) {
              showFormError(errorBox, 'There are no assigned shifts in this range.');
              return;
            }
            downloadTextFile(`timesheet-${from}_${to}.csv`, timesheetCSV(store.state, from, to), 'text/csv');
            toast('Timesheet downloaded');
            modal.close();
          },
        },
        icon('download', 15),
        'Download CSV'
      ),
    ],
  });
}

/**
 * The one setting attendance has: how long after the scheduled start a
 * clock-in still counts as on time.
 */
function openGraceDialog(ctx) {
  const { store } = ctx;
  const input = el('input', {
    class: 'input',
    type: 'number',
    min: '0',
    max: '120',
    step: '1',
    value: store.state.settings.graceMinutes ?? '',
    placeholder: 'None',
  });
  const errorBox = el('div', { style: { display: 'contents' } });

  const modal = openModal({
    title: 'Attendance settings',
    content: [
      el(
        'p',
        { class: 'share-copy' },
        'Clocking somebody in after their scheduled start marks them late. A grace period is how much of that you let go: within it, or early, counts as present. Changing a status by hand always stands.'
      ),
      field('Grace period (minutes)', input),
      errorBox,
    ],
    footer: [
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
      el(
        'button',
        {
          class: 'btn btn-primary',
          onClick: async (e) => {
            errorBox.replaceChildren();
            const button = e.currentTarget;
            button.disabled = true;
            try {
              await store.setGraceMinutes(input.value);
            } catch (err) {
              button.disabled = false;
              showFormError(errorBox, err.message);
              return;
            }
            modal.close();
            toast(input.value === '' ? 'Grace period turned off' : `Grace period set to ${input.value} min`);
          },
        },
        'Save'
      ),
    ],
  });
}

const STATUS_OPTIONS = [
  { value: ATTENDANCE_STATUS.PRESENT, label: 'Present' },
  { value: ATTENDANCE_STATUS.LATE, label: 'Late' },
  { value: ATTENDANCE_STATUS.ABSENT, label: 'Absent' },
];

export function renderAttendance(ctx) {
  const { store, ui } = ctx;
  const state = store.state;
  const today = isoToday();
  const date = ui.attendanceDate ?? today;
  ui.attendanceDate = date;

  const employeeById = (id) => state.employees.find((e) => e.id === id);
  const dayShifts = shiftsOn(state.shifts, date).filter((s) => s.assigneeId);

  // Week summary for the week containing the selected date. Records on
  // shifts nobody holds any more (a worked shift that was unassigned
  // afterwards) are left out, the way the list below, the timesheet, and
  // the reports all leave them out: a count that includes a record none
  // of those pages can show is a number nobody can find.
  const weekStart = startOfWeek(date);
  const weekEnd = addDays(weekStart, 6);
  const shiftById = new Map(state.shifts.map((s) => [s.id, s]));
  const weekRecords = Object.entries(state.attendance)
    .map(([shiftId, record]) => ({ record, shift: shiftById.get(shiftId) }))
    .filter((r) => r.shift?.assigneeId && r.shift.date >= weekStart && r.shift.date <= weekEnd)
    .map((r) => r.record);
  const summary = summarizeAttendance(weekRecords);
  // Who is on the clock right now, whichever day is on screen: a night
  // shift clocked in before midnight is still running this morning, and a
  // clock-in nobody ever closed is not somebody on the floor.
  const onNow = state.shifts.filter(
    (s) => s.assigneeId && isRunningNow(s, state.attendance[s.id], today)
  );

  function setDate(next) {
    ui.attendanceDate = next;
    ctx.refresh();
  }

  async function save(shift, patch) {
    const existing = state.attendance[shift.id] ?? {
      status: ATTENDANCE_STATUS.PRESENT,
      clockIn: shift.start,
      clockOut: '',
    };
    const record = { ...existing, ...patch };
    if (patch.status === ATTENDANCE_STATUS.ABSENT) {
      record.clockIn = '';
      record.clockOut = '';
    } else if (patch.status && !record.clockIn) {
      record.clockIn = shift.start;
    }
    try {
      await store.recordAttendance(shift.id, record);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /**
   * One tap that stamps the clock. Clocking in sets the status from how
   * late the stamp is (see clockInRecord); the typed fields below are
   * still there for corrections and for filling in yesterday.
   */
  async function clock(shift, direction) {
    const at = nowTime();
    const existing = state.attendance[shift.id];
    const record =
      direction === 'in'
        ? clockInRecord(shift, existing, at, state.settings.graceMinutes ?? 0)
        : clockOutRecord(existing, at);
    try {
      await store.recordAttendance(shift.id, record);
      const name = employeeById(shift.assigneeId)?.name ?? 'Shift';
      toast(
        direction === 'in'
          ? `${name} clocked in at ${formatTime(at)}${record.status === ATTENDANCE_STATUS.LATE ? ' (late)' : ''}`
          : `${name} clocked out at ${formatTime(at)}`
      );
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /** The clock control for a shift, or null where stamping makes no sense. */
  function clockButton(shift) {
    const record = state.attendance[shift.id];
    if (record?.status === ATTENDANCE_STATUS.ABSENT) return null;
    // A night shift clocks in before midnight and out after it, so the
    // one still running this morning sits on yesterday's row. The live
    // pill beside it says "on now"; the button that ends it has to be
    // there too, or the only way off the clock is typing the time in.
    // Yesterday's day shifts are left out on purpose: one of those still
    // clocked in is a forgotten clock-out, and stamping the minute the
    // button is pressed onto it would record a made-up time.
    const canClockOut =
      isRunningNow(shift, record, today) && (shift.date === today || isOvernight(shift.start, shift.end));
    if (canClockOut) {
      return el(
        'button',
        {
          class: 'btn btn-sm',
          dataset: { focusKey: `att:${shift.id}:clock` },
          onClick: () => clock(shift, 'out'),
        },
        icon('clock', 15),
        'Clock out'
      );
    }
    // Anything else on another day is typed in, not stamped: a clock is
    // only honest about the minute it is pressed.
    if (shift.date !== today) return null;
    if (record?.clockIn && record?.clockOut) return null;
    return el(
      'button',
      {
        class: 'btn btn-sm btn-primary',
        dataset: { focusKey: `att:${shift.id}:clock` },
        onClick: () => clock(shift, 'in'),
      },
      icon('clock', 15),
      'Clock in'
    );
  }

  /** "On now · 2h 15m", ticking while the shift runs. */
  function livePill(shift) {
    const record = state.attendance[shift.id];
    if (!isRunningNow(shift, record, today)) return null;
    return el(
      'span',
      { class: 'live-pill', title: `Clocked in at ${formatTime(record.clockIn)}` },
      el('span', { class: 'live-dot' }),
      'On now · ',
      liveText(() => formatElapsed(elapsedMinutes(record.clockIn, nowTime()) ?? 0))
    );
  }

  function row(shift) {
    const emp = employeeById(shift.assigneeId);
    const record = state.attendance[shift.id];
    const late = record && record.status !== ATTENDANCE_STATUS.ABSENT ? lateMinutes(shift, record.clockIn) : 0;
    // The same total the timesheet exports and pays on, shown where the
    // times are entered. A clock-out before the clock-in is read as the
    // next morning, which is right for a night shift and wildly wrong
    // for a 1:30 PM typed as 01:30. Off screen, that turned a seven-hour
    // day into nineteen paid hours with nothing to notice.
    const clocked =
      record && record.status !== ATTENDANCE_STATUS.ABSENT
        ? workedMinutes(record.clockIn, record.clockOut)
        : null;
    const worked = clocked === null ? null : Math.max(0, clocked - shiftBreakMinutes(shift));

    return el(
      'div',
      { class: 'att-row' },
      el(
        'div',
        { class: 'att-person' },
        avatar(emp),
        el(
          'div',
          { class: 'item-main' },
          el('div', { class: 'item-title' }, emp?.name ?? 'Former employee'),
          el(
            'div',
            { class: 'item-sub tnum' },
            `${formatTimeRange(shift.start, shift.end)} · ${shift.role || 'No role'}${
              late > 0 ? ` · ${late} min late` : ''
            }${worked === null ? '' : ` · ${formatHours(worked)} worked`}`
          ),
          livePill(shift)
        )
      ),
      el(
        'div',
        { class: 'att-controls' },
        // Taking attendance saves and re-renders on every change, so each
        // control is tagged to get focus handed back (see app.js render()).
        clockButton(shift),
        segmented(STATUS_OPTIONS, record?.status, (value) => save(shift, { status: value }), {
          focusKeyPrefix: `att:${shift.id}`,
        }),
        record && record.status !== ATTENDANCE_STATUS.ABSENT
          ? el(
              'div',
              { class: 'att-times' },
              el('input', {
                class: 'input',
                type: 'time',
                value: record.clockIn ?? '',
                'aria-label': 'Clock in',
                dataset: { focusKey: `att:${shift.id}:in` },
                onChange: (e) => save(shift, { clockIn: e.target.value }),
              }),
              el('span', { class: 'sep' }, 'to'),
              el('input', {
                class: 'input',
                type: 'time',
                value: record.clockOut ?? '',
                'aria-label': 'Clock out',
                dataset: { focusKey: `att:${shift.id}:out` },
                onChange: (e) => save(shift, { clockOut: e.target.value }),
              })
            )
          : null,
        record
          ? el(
              'button',
              {
                class: 'btn btn-ghost btn-sm btn-icon',
                'aria-label': 'Clear record',
                title: 'Clear record',
                onClick: async () => {
                  try {
                    const undo = await store.clearAttendance(shift.id);
                    if (undo) undoToast('Attendance record cleared', undo);
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              icon('x', 14)
            )
          : null
      )
    );
  }

  return el(
    'div',
    {},
    el(
      'div',
      { class: 'view-header' },
      el(
        'div',
        {},
        el('h1', {}, 'Attendance'),
        el('p', { class: 'subtitle' }, relativeDayLabel(date, today))
      ),
      el(
        'div',
        { class: 'view-actions' },
        el(
          'button',
          { class: 'btn', onClick: () => ctx.navigate('reports') },
          icon('chart', 15),
          'Reports'
        ),
        el(
          'button',
          { class: 'btn', onClick: () => openExportDialog(ctx) },
          icon('download', 15),
          'Export'
        ),
        el(
          'button',
          {
            class: 'btn btn-icon',
            'aria-label': 'Attendance settings',
            title: `Lateness grace period: ${
              state.settings.graceMinutes ? `${state.settings.graceMinutes} min` : 'none'
            }`,
            onClick: () => openGraceDialog(ctx),
          },
          icon('sliders', 16)
        ),
        el(
          'div',
          { class: 'week-nav' },
          // Stepping a day re-renders the view, which rebuilds these
          // controls; the stable keys hand focus back to the equivalent
          // one so a keyboard user is not dropped at the top of the page
          // on every press (see render() in app.js).
          el(
            'button',
            {
              class: 'btn btn-icon',
              'aria-label': 'Previous day',
              dataset: { focusKey: 'att:prev' },
              onClick: () => setDate(addDays(date, -1)),
            },
            icon('chevron-left', 16)
          ),
          el('input', {
            // Sized in CSS (see .week-nav .date-nav), which also has to
            // widen it where a touch device renders the value larger.
            class: 'input date-nav',
            type: 'date',
            value: date,
            'aria-label': 'Date',
            dataset: { focusKey: 'att:date' },
            onChange: (e) => e.target.value && setDate(e.target.value),
          }),
          el(
            'button',
            {
              class: 'btn btn-icon',
              'aria-label': 'Next day',
              dataset: { focusKey: 'att:next' },
              onClick: () => setDate(addDays(date, 1)),
            },
            icon('chevron-right', 16)
          ),
          date !== today
            ? el(
                'button',
                { class: 'btn', dataset: { focusKey: 'att:today' }, onClick: () => setDate(today) },
                'Today'
              )
            : null
        )
      )
    ),
    el(
      'div',
      { class: 'stat-grid' },
      statCard({
        label: 'On now',
        value: String(onNow.length),
        sub: onNow.length
          ? onNow
              .map((s) => employeeById(s.assigneeId)?.name ?? 'Former employee')
              .slice(0, 2)
              .join(', ') + (onNow.length > 2 ? ` +${onNow.length - 2}` : '')
          : 'Nobody clocked in',
        iconName: 'clock',
      }),
      statCard({ label: 'Recorded this week', value: String(summary.total), iconName: 'clipboard' }),
      statCard({ label: 'Present', value: String(summary.present), iconName: 'circle-check' }),
      statCard({ label: 'Late', value: String(summary.late), iconName: 'clock' }),
      statCard({
        label: 'Show-up rate',
        value: summary.rate === null ? 'N/A' : `${Math.round(summary.rate * 100)}%`,
        sub: `${summary.absent} absent`,
        iconName: 'users',
      })
    ),
    dayShifts.length === 0
      ? el(
          'div',
          { class: 'card' },
          emptyState({
            iconName: 'clipboard',
            title: 'No assigned shifts this day',
            message: 'Attendance is taken per assigned shift. Pick another day or add shifts to the schedule.',
          })
        )
      : el('div', { class: 'card row-list' }, dayShifts.map(row))
  );
}
