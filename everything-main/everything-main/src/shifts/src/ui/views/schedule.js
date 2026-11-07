import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import {
  addDays,
  addMonths,
  dayShort,
  formatDate,
  formatHours,
  formatMonth,
  formatTime,
  formatTimeRange,
  isOvernight,
  isoToday,
  monthShort,
  parseISO,
  startOfMonth,
  startOfWeek,
  weekDates,
} from '../../lib/time.js';
import {
  availabilityStatus,
  coverageGaps,
  evaluateMove,
  findConflicts,
  hoursStatus,
  shiftsOn,
  timeOffOn,
  weeklyMinutes,
  AVAILABILITY,
} from '../../core/scheduling.js';
import { formatMoney, laborCost } from '../../core/payroll.js';
import { hasRules, ruleViolations, scheduleRuleViolations } from '../../core/rules.js';
import {
  describeFilter,
  isFiltered,
  rowMatchesFilter,
  shiftMatchesFilter,
} from '../../core/filters.js';
import { avatar, buttonize, emptyState, isMobileViewport, segmented } from '../components.js';
import { openShiftEditor } from '../editors.js';
import { applyMove, moveContext, openMoveDialog } from '../move.js';
import { openFillDialog } from '../fill.js';
import { costOptions, costPanel } from '../cost.js';
import {
  clearScheduleFilter,
  filterBar,
  filterFlag,
  matchesSearch,
  scheduleFilterState,
  scheduleSearch,
} from '../schedule-filter.js';
import { roleByName } from '../roles.js';
import { openCalendarExportDialog } from '../calendar-export.js';
import { openCoverageEditor } from '../coverage.js';
import { openShareDialog } from '../share.js';
import { confirmDialog } from '../modal.js';
import { toast } from '../toast.js';

/** One-line description of a gap, e.g. "1 more Barista (5 PM – 7 PM)". */
export function describeGap(gap) {
  const req = gap.requirement;
  return `${gap.missing} more ${req.role}${req.start ? ` (${formatTimeRange(req.start, req.end)})` : ''}`;
}

function weekLabel(weekStart) {
  const start = parseISO(weekStart);
  const end = parseISO(addDays(weekStart, 6));
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  const left = `${monthShort(start.getMonth())} ${start.getDate()}${
    sameYear ? '' : `, ${start.getFullYear()}`
  }`;
  const right = sameMonth
    ? `${end.getDate()}`
    : `${monthShort(end.getMonth())} ${end.getDate()}`;
  return `${left} – ${right}, ${end.getFullYear()}`;
}

/**
 * The assignee's time-off entry overlapping the shift, or null. Checks
 * the next day too for overnight shifts, like the editor's warning.
 */
function shiftTimeOff(state, shift, employee) {
  if (!employee) return null;
  const record = state.availability[employee.id];
  return (
    timeOffOn(record, shift.date) ??
    (isOvernight(shift.start, shift.end) ? timeOffOn(record, addDays(shift.date, 1)) : null)
  );
}

/**
 * The shift being dragged across the grid, if any. A drag never survives
 * a re-render (nothing writes mid-drag), so one module-level slot is
 * enough, and it is the only way to know what is moving: the dataTransfer
 * payload is unreadable until the drop under protected mode.
 */
let dragging = null;

/** Alt (Option) or Ctrl held at the drop: copy instead of move. */
const wantsCopy = (e) => e.altKey || e.ctrlKey;

function draggedShift(ctx) {
  return dragging ? (ctx.store.state.shifts.find((s) => s.id === dragging.shiftId) ?? null) : null;
}

function endDrag() {
  dragging = null;
  document.body.classList.remove('dragging-shift');
  for (const node of document.querySelectorAll('.is-dragging, .is-drop-ok, .is-drop-blocked')) {
    node.classList.remove('is-dragging', 'is-drop-ok', 'is-drop-blocked');
  }
}

/**
 * Makes one grid cell a drop target for `target` (its day and its row's
 * person, null on the open-shifts row). The cell says which of the two
 * it is before the button is released: accented for a clean landing,
 * red for one that will be refused. A refused drop still reports why,
 * so the answer isn't a cursor the user has to interpret.
 */
function attachDropTarget(ctx, cell, target) {
  const clear = () => cell.classList.remove('is-drop-ok', 'is-drop-blocked');

  cell.addEventListener('dragover', (e) => {
    const shift = draggedShift(ctx);
    if (!shift) return;
    const copy = wantsCopy(e);
    const verdict = evaluateMove(shift, target, moveContext(ctx.store.state), { copy });
    if (!verdict.changed) {
      clear();
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = copy ? 'copy' : 'move';
    cell.classList.toggle('is-drop-ok', !verdict.blocked);
    cell.classList.toggle('is-drop-blocked', Boolean(verdict.blocked));
  });

  // dragleave also fires stepping onto a chip inside the cell, which
  // would flicker the highlight off and on under the pointer.
  cell.addEventListener('dragleave', (e) => {
    if (!cell.contains(e.relatedTarget)) clear();
  });

  cell.addEventListener('drop', (e) => {
    e.preventDefault();
    const shift = draggedShift(ctx);
    const copy = wantsCopy(e);
    endDrag();
    if (shift) applyMove(ctx, shift, target, { copy });
  });
}

/**
 * Scrolls the week sideways while a drag hovers near either edge. Seven
 * columns plus the sticky name column fill a laptop viewport, so without
 * this the days off screen cannot be reached with a chip in hand.
 */
function autoScrollWhileDragging(scroller) {
  const EDGE = 76;
  const STEP = 16;
  let frame = null;
  let direction = 0;

  function tick() {
    scroller.scrollLeft += direction * STEP;
    frame = direction === 0 ? null : requestAnimationFrame(tick);
  }
  function stop() {
    direction = 0;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  // dragover bubbles out of the cells whether or not they accept the
  // drop, so the scroller sees every move of the pointer over the week.
  scroller.addEventListener('dragover', (e) => {
    if (!dragging) return;
    const rect = scroller.getBoundingClientRect();
    direction =
      e.clientX < rect.left + EDGE ? -1 : e.clientX > rect.right - EDGE ? 1 : 0;
    if (direction !== 0 && frame === null) frame = requestAnimationFrame(tick);
    else if (direction === 0) stop();
  });
  for (const event of ['dragleave', 'drop', 'dragend']) {
    scroller.addEventListener(event, stop);
  }
  return scroller;
}

function shiftChip(ctx, shift, employee, conflicted, { movable = false } = {}) {
  const timeOff = shiftTimeOff(ctx.store.state, shift, employee);
  const tooltip = [
    timeOff ? `Scheduled during time off${timeOff.note ? ` (${timeOff.note})` : ''}` : null,
    shift.breakMinutes > 0 ? `${shift.breakMinutes} min unpaid break` : null,
    shift.note || null,
    movable ? 'Drag to another day or person (hold Alt to copy), or press M' : null,
  ]
    .filter(Boolean)
    .join('\n');
  const isOpen = !shift.assigneeId;
  // Open shifts have no employee color, so the role's color (when the
  // managed role has one) carries the accent instead.
  const roleColor = isOpen ? roleByName(ctx.store.state, shift.role)?.color : null;
  // Nothing ties a cell of this grid back to the row and column it sits
  // in, so read on its own a chip was "7 AM–3 PM Opening": no hint of
  // who works it or which day it falls on, and the warning triangle went
  // unsaid because its explanation lives in a mouse-only tooltip. Spell
  // the whole thing out, the way the Add button in the same cell does.
  const label = [
    employee ? employee.name : shift.assigneeId ? 'Former employee' : 'Open shift',
    formatDate(shift.date),
    `${formatTime(shift.start)} to ${formatTime(shift.end)}${
      isOvernight(shift.start, shift.end) ? ' the next day' : ''
    }`,
    shift.role || 'No role',
    shift.breakMinutes > 0 ? `${shift.breakMinutes} min unpaid break` : null,
    conflicted ? 'overlaps another shift' : null,
    timeOff ? 'scheduled during time off' : null,
    // Dragging is a pointer gesture, so the same reach has to be spoken
    // to anyone who cannot make it. M opens the move dialog, which does
    // both halves of a drag as plain fields.
    movable ? 'press M to move it' : null,
  ]
    .filter(Boolean)
    .join(', ');
  const moveProps = movable
    ? {
        draggable: 'true',
        'aria-keyshortcuts': 'M',
        onDragstart: (e) => {
          dragging = { shiftId: shift.id };
          e.dataTransfer.effectAllowed = 'copyMove';
          // Some plain text is required for the drag to start at all in
          // Firefox, and it is what lands if the chip is dropped outside
          // the app (a note, a chat message).
          e.dataTransfer.setData('text/plain', label);
          e.currentTarget.classList.add('is-dragging');
          document.body.classList.add('dragging-shift');
        },
        onDragend: endDrag,
        onKeydown: (e) => {
          if (e.key === 'm' || e.key === 'M') {
            e.preventDefault();
            openMoveDialog(ctx, { shift });
          }
        },
        // Right-click reaches the same place as M, for a pointer user
        // who would rather pick a day than drag to it.
        onContextmenu: (e) => {
          e.preventDefault();
          openMoveDialog(ctx, { shift });
        },
      }
    : {};

  return el(
    'button',
    {
      class: `shift-chip${isOpen ? ' is-open' : ''}`,
      style: employee ? { '--emp': employee.color } : roleColor ? { '--emp': roleColor } : {},
      'aria-label': label,
      onClick: () => openShiftEditor(ctx, { shift }),
      title: tooltip || null,
      ...moveProps,
    },
    // The time is what the chip is for, so it wraps rather than
    // truncates: a grid column never holds "6:30 AM – 1:30 PM" on one
    // line. Each part is its own element so a break can only land
    // around the dash, never between a number and its AM/PM.
    el(
      'span',
      { class: 't' },
      conflicted || timeOff ? icon('warning', 12) : null,
      el('span', {}, formatTime(shift.start)),
      el('span', {}, '–'),
      el(
        'span',
        {},
        `${formatTime(shift.end)}${isOvernight(shift.start, shift.end) ? ' +1' : ''}`
      )
    ),
    el(
      'span',
      { class: 'r' },
      [
        shift.role || 'No role',
        isOpen ? 'unassigned' : null,
        shift.breakMinutes > 0 ? `${shift.breakMinutes}m break` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    )
  );
}

function weekGrid(ctx, weekStart, employees, today) {
  const { store, ui } = ctx;
  const state = store.state;
  const filter = scheduleFilterState(ui);
  const search = scheduleSearch(ui);
  const allDays = weekDates(weekStart);

  // The grid asks the same two questions over and over: what is on this
  // day, and what else does this person hold. Answer both in one pass so
  // a cell costs a lookup rather than another walk of every shift ever
  // recorded (rows times days of them, on a grid that redraws after
  // every edit).
  const byDate = new Map(allDays.map((d) => [d, []]));
  const byAssignee = new Map();
  for (const shift of state.shifts) {
    byDate.get(shift.date)?.push(shift);
    if (!shift.assigneeId) continue;
    const held = byAssignee.get(shift.assigneeId);
    if (held) held.push(shift);
    else byAssignee.set(shift.assigneeId, [shift]);
  }
  for (const day of allDays) byDate.set(day, shiftsOn(byDate.get(day), day));
  // Hours, conflicts, coverage, and cost all read this: the filter
  // narrows what is drawn, never what is counted.
  const shiftsFor = (id) => byAssignee.get(id) ?? [];
  const shownOn = (day, matches) =>
    byDate.get(day).filter((s) => matches(s) && shiftMatchesFilter(s, filter));

  /** Role plus the weekly total, colored when outside the employee's limits. */
  function empSub(emp) {
    if (!emp) return el('div', { class: 'emp-sub' }, 'Needs assignment');
    const minutes = weeklyMinutes(shiftsFor(emp.id), emp.id, weekStart);
    const status = hoursStatus(minutes, emp);
    const title =
      status === 'over'
        ? `Over their ${emp.maxHours}h weekly max`
        : status === 'under'
          ? `Below their ${emp.targetHours}h weekly target`
          : null;
    // A rest gap or a fortnight without a day off is invisible in a grid
    // of cells, so the row itself carries the flag. Their own shifts are
    // all the rules need, which keeps this cheap enough to run per row.
    const broken = scheduleRuleViolations(emp.id, shiftsFor(emp.id), allDays, state.settings.rules, {
      name: emp.name,
    });
    return el(
      'div',
      { class: 'emp-sub' },
      `${emp.role || 'No role'} · `,
      el('span', { class: status !== 'ok' ? `hours-${status}` : null, title }, formatHours(minutes)),
      broken.length > 0
        ? el(
            'span',
            {
              class: 'rule-flag',
              role: 'img',
              'aria-label': broken.map((v) => v.message).join(' '),
              title: broken.map((v) => v.message).join('\n'),
            },
            icon('warning', 12)
          )
        : null
    );
  }

  // Header row, with a staffing-gap badge on days that miss coverage.
  // Measured across the whole week whatever the filter says, so the
  // "understaffed days only" toggle has something honest to select on.
  const gapsByDate = new Map();
  for (const gap of coverageGaps(state.shifts, state.settings.coverage, allDays)) {
    if (!gapsByDate.has(gap.date)) gapsByDate.set(gap.date, []);
    gapsByDate.get(gap.date).push(gap);
  }

  const days = filter.understaffedOnly ? allDays.filter((d) => gapsByDate.has(d)) : allDays;
  // The column count drives both the template and the scroll width, so
  // a narrowed week fills the card instead of leaving a gap on the right.
  const grid = el('div', { class: 'schedule-grid', style: { '--cols': String(days.length) } });

  grid.appendChild(el('div', { class: 'sg-head sg-emp' }, ''));
  for (const day of days) {
    const d = parseISO(day);
    const gaps = gapsByDate.get(day);
    grid.appendChild(
      el(
        'div',
        { class: `sg-head${day === today ? ' is-today' : ''}` },
        el('div', {}, dayShort(d.getDay())),
        el(
          'div',
          { class: 'd' },
          String(d.getDate()),
          gaps
            ? el(
                'span',
                {
                  class: 'gap-badge',
                  // role=img so the count is read as what it means rather
                  // than tacked onto the date as a bare digit ("Wed 19 1").
                  role: 'img',
                  'aria-label': `Understaffed: ${gaps.map(describeGap).join(', ')}`,
                  title: `Understaffed: ${gaps.map(describeGap).join(', ')}`,
                },
                String(gaps.reduce((sum, g) => sum + g.missing, 0))
              )
            : null
        )
      )
    );
  }

  // Archived and deleted employees keep their shift history, so weeks
  // where they still hold shifts list them in extra read-only rows;
  // hiding the rows would silently drop those shifts from the grid.
  const weekSet = new Set(days);
  const knownIds = new Set(state.employees.map((e) => e.id));
  const archivedWithShifts = state.employees.filter(
    (e) => !e.active && shiftsFor(e.id).some((s) => weekSet.has(s.date))
  );
  const hasFormer = days.some((day) =>
    byDate.get(day).some((s) => s.assigneeId && !knownIds.has(s.assigneeId))
  );

  const rows = [
    { key: 'open', label: 'Open shifts', employee: null, matches: (s) => !s.assigneeId, canAdd: true },
    ...employees.map((e) => ({
      key: e.id,
      label: e.name,
      employee: e,
      matches: (s) => s.assigneeId === e.id,
      canAdd: true,
    })),
    ...archivedWithShifts.map((e) => ({
      key: e.id,
      label: e.name,
      employee: e,
      archived: true,
      matches: (s) => s.assigneeId === e.id,
    })),
    ...(hasFormer
      ? [
          {
            key: 'former',
            label: 'Former employees',
            employee: null,
            former: true,
            matches: (s) => s.assigneeId && !knownIds.has(s.assigneeId),
          },
        ]
      : []),
  ].filter((row) =>
    rowMatchesFilter(
      filter,
      row.employee?.id ?? null,
      days.reduce((n, day) => n + shownOn(day, row.matches).length, 0)
    )
  );

  if (days.length === 0 || rows.length === 0) {
    return el(
      'div',
      { class: 'card' },
      emptyState({
        iconName: 'filter',
        title: days.length === 0 ? 'No understaffed days this week' : 'Nothing matches the filter',
        message:
          days.length === 0
            ? 'Every day this week meets its coverage requirements.'
            : 'No shifts in this week match what the filter is showing.',
        actions: [
          el(
            'button',
            { class: 'btn btn-primary', onClick: () => clearScheduleFilter(ctx) },
            icon('x', 15),
            'Clear the filter'
          ),
        ],
      })
    );
  }

  /** Rows a search matches, so the name column can be picked out. */
  const found = (row) => Boolean(row.employee) && matchesSearch(row.employee, search);

  for (const row of rows) {
    const emp = row.employee;
    const sub = row.former
      ? el('div', { class: 'emp-sub' }, 'No longer on the team')
      : row.archived
        ? el(
            'div',
            { class: 'emp-sub' },
            `Archived · ${formatHours(weeklyMinutes(shiftsFor(emp.id), emp.id, weekStart))}`
          )
        : empSub(emp);
    grid.appendChild(
      el(
        'div',
        { class: `sg-emp${found(row) ? ' is-found' : ''}` },
        emp
          ? avatar(emp)
          : row.former
            ? avatar(null)
            : el('span', { class: 'avatar', style: { '--emp': 'var(--text-3)' } }, icon('user', 15)),
        el('div', { class: 'emp-info' }, el('div', { class: 'emp-name' }, row.label), sub)
      )
    );

    for (const day of days) {
      const dayShifts = shownOn(day, row.matches);
      const timeOff = emp ? timeOffOn(state.availability[emp.id], day) : null;
      const off = Boolean(emp && (timeOff || state.availability[emp.id]?.days?.[parseISO(day).getDay()]?.off));

      const cell = el('div', {
        class: `sg-cell${day === today ? ' is-today' : ''}${
          off && dayShifts.length === 0 ? ' is-off' : ''
        }${found(row) ? ' is-found' : ''}`,
      });
      // The rows that can be added to are exactly the rows a shift can
      // be moved onto: the open-shifts row and everyone still on the
      // rota. Archived and former employees keep their history as a
      // read-only record, so nothing is dragged into or out of it.
      if (row.canAdd) attachDropTarget(ctx, cell, { date: day, assigneeId: emp?.id ?? null });

      for (const shift of dayShifts) {
        cell.appendChild(
          shiftChip(ctx, shift, emp, findConflicts(shift, shiftsFor(shift.assigneeId)).length > 0, {
            movable: row.canAdd,
          })
        );
      }

      if (off && dayShifts.length === 0) {
        cell.appendChild(
          el(
            'span',
            {
              class: 'off-label',
              // Same reason as the chip above: on its own "Off" says
              // nothing about whose day it is or which day.
              role: 'img',
              'aria-label': `${emp.name}, ${formatDate(day)}, ${
                timeOff ? `time off${timeOff.note ? ` (${timeOff.note})` : ''}` : 'not available'
              }`,
              title: timeOff?.note || null,
            },
            timeOff ? 'Time off' : 'Off'
          )
        );
      } else if (row.canAdd) {
        cell.appendChild(
          el(
            'button',
            {
              class: 'sg-add',
              'aria-label': `Add shift on ${formatDate(day)}${emp ? ` for ${emp.name}` : ''}`,
              onClick: () =>
                openShiftEditor(ctx, { defaults: { date: day, assigneeId: emp?.id ?? '' } }),
            },
            icon('plus', 13),
            'Add'
          )
        );
      }
      grid.appendChild(cell);
    }
  }

  const card = el('div', { class: 'card schedule-scroll' }, grid);
  // Searching is meant to save the scroll, so take the first hit there.
  // The nodes are mounted right after this returns, which is why the
  // measurement waits a frame.
  if (search.trim()) {
    requestAnimationFrame(() => {
      card.querySelector('.sg-emp.is-found')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }
  return withScrollEdge(autoScrollWhileDragging(card));
}

/**
 * The observer watching the grid currently on screen.
 *
 * One was made per render and never disconnected, so each redraw left
 * behind an observer still holding the grid it was watching, and a
 * document reaches its observers through the list observe() puts them
 * on. The schedule redraws after every edit and after every keystroke in
 * the search box, which is a lot of detached weeks to leave lying around
 * on the strength of an engine collecting them. Only the newest grid is
 * ever the live one, so the last observer is let go before the next.
 */
let scrollEdgeObserver = null;

/**
 * Wraps a horizontal scroller and flags it while content sits off to
 * the right, so the stylesheet can fade that edge. Without it a week
 * narrower than its container gives no sign it continues: macOS and iOS
 * hide the scrollbar until something moves, and at some widths the grid
 * cuts flush on a column edge and looks like a complete week.
 */
function withScrollEdge(scroller) {
  const wrap = el('div', { class: 'schedule-scroll-wrap' }, scroller);
  const sync = () =>
    wrap.classList.toggle(
      'has-more',
      scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft > 1
    );
  scroller.addEventListener('scroll', sync, { passive: true });
  // Watched rather than measured once: the container width follows the
  // window, and a wide enough one swallows the whole week. The observer
  // also fires on the first layout, which is when the sizes exist.
  scrollEdgeObserver?.disconnect();
  scrollEdgeObserver = new ResizeObserver(sync);
  scrollEdgeObserver.observe(scroller);
  return wrap;
}

/**
 * Month overview: a compact calendar for forward planning. Per day it
 * shows the shift count, open-shift count, a coverage-gap dot, and a
 * time-off badge; clicking a day (or a week's gutter) jumps to the week
 * grid at that date. Strictly read-only at this zoom.
 */
/** Every day a month grid draws, including the leading and trailing week. */
function monthDays(monthStart) {
  const monthEnd = addDays(addMonths(monthStart, 1), -1);
  const days = [];
  for (let week = startOfWeek(monthStart); week <= monthEnd; week = addDays(week, 7)) {
    days.push(...weekDates(week));
  }
  return days;
}

function monthGrid(ctx, monthStart, today) {
  const { store, ui } = ctx;
  const state = store.state;
  const filter = scheduleFilterState(ui);
  const monthEnd = addDays(addMonths(monthStart, 1), -1);
  const gridStart = startOfWeek(monthStart);
  const weeks = [];
  for (let w = gridStart; w <= monthEnd; w = addDays(w, 7)) weeks.push(w);
  const allDays = weeks.flatMap((w) => weekDates(w));

  const perDay = new Map(allDays.map((d) => [d, { count: 0, open: 0 }]));
  for (const shift of state.shifts) {
    const entry = perDay.get(shift.date);
    if (!entry || !shiftMatchesFilter(shift, filter)) continue;
    entry.count += 1;
    if (!shift.assigneeId) entry.open += 1;
  }

  const gapsByDate = new Map();
  for (const gap of coverageGaps(state.shifts, state.settings.coverage, allDays)) {
    if (!gapsByDate.has(gap.date)) gapsByDate.set(gap.date, []);
    gapsByDate.get(gap.date).push(gap);
  }

  const active = state.employees.filter(
    (e) => e.active && (filter.employees.length === 0 || filter.employees.includes(e.id))
  );
  const awayOn = (day) => active.filter((e) => timeOffOn(state.availability[e.id], day)).length;

  function jumpTo(day) {
    ui.scheduleView = 'week';
    ui.scheduleWeekStart = startOfWeek(day);
    ui.scheduleDay = day;
    ctx.refresh();
  }

  const grid = el('div', { class: 'month-grid' });
  grid.appendChild(el('div', { class: 'mg-head' }, ''));
  for (const dow of [1, 2, 3, 4, 5, 6, 0]) {
    grid.appendChild(el('div', { class: 'mg-head' }, dayShort(dow)));
  }

  for (const week of weeks) {
    grid.appendChild(
      el(
        'button',
        {
          class: 'mg-week',
          title: `Open the week of ${formatDate(week)}`,
          'aria-label': `Open the week of ${formatDate(week)}`,
          onClick: () => jumpTo(week),
        },
        icon('chevron-right', 14)
      )
    );
    for (const day of weekDates(week)) {
      const { count, open } = perDay.get(day);
      const gaps = gapsByDate.get(day);
      const away = awayOn(day);
      const outside = day < monthStart || day > monthEnd;
      // A month has to keep its shape, so "understaffed days only" fades
      // the days that are covered rather than removing them.
      const muted = filter.understaffedOnly && !gaps;
      grid.appendChild(
        el(
          'button',
          {
            class: `mg-cell${outside ? ' is-out' : ''}${day === today ? ' is-today' : ''}${
              muted ? ' is-muted' : ''
            }`,
            'aria-label': `${formatDate(day)}: ${count} shift${count === 1 ? '' : 's'}${
              open ? `, ${open} open` : ''
            }${gaps ? ', understaffed' : ''}${away ? `, ${away} away` : ''}`,
            onClick: () => jumpTo(day),
          },
          el('span', { class: 'num' }, String(parseISO(day).getDate())),
          el(
            'span',
            { class: 'mg-badges' },
            count > 0 ? el('span', { class: 'mg-count', title: `${count} shift${count === 1 ? '' : 's'}` }, String(count)) : null,
            open > 0 ? el('span', { class: 'mg-open', title: `${open} open shift${open === 1 ? '' : 's'}` }, `${open} open`) : null,
            gaps
              ? el('span', {
                  class: 'mg-gap',
                  title: `Understaffed: ${gaps.map(describeGap).join(', ')}`,
                })
              : null,
            away > 0
              ? el(
                  'span',
                  { class: 'mg-away', title: `${away} ${away === 1 ? 'person' : 'people'} away` },
                  icon('plane', 10),
                  String(away)
                )
              : null
          )
        )
      );
    }
  }

  return el('div', { class: 'card month-scroll' }, grid);
}

function dayView(ctx, weekStart, today) {
  const { store, ui } = ctx;
  const state = store.state;
  const filter = scheduleFilterState(ui);
  const search = scheduleSearch(ui);
  const allDays = weekDates(weekStart);

  // Measured across the whole week whatever else the filter says, the
  // same way the week grid measures it.
  const gapsByDate = new Map();
  for (const gap of coverageGaps(state.shifts, state.settings.coverage, allDays)) {
    if (!gapsByDate.has(gap.date)) gapsByDate.set(gap.date, []);
    gapsByDate.get(gap.date).push(gap);
  }
  // "Understaffed days only" narrows which days there are, which on a
  // phone means the day pills: the week grid drops the same columns.
  // Without this the toggle flew the "filtered" flag over a day list it
  // had not touched.
  const days = filter.understaffedOnly ? allDays.filter((d) => gapsByDate.has(d)) : allDays;

  if (days.length === 0) {
    return el(
      'div',
      { class: 'card' },
      emptyState({
        iconName: 'filter',
        title: 'No understaffed days this week',
        message: 'Every day this week meets its coverage requirements.',
        actions: [
          el(
            'button',
            { class: 'btn btn-primary', onClick: () => clearScheduleFilter(ctx) },
            icon('x', 15),
            'Clear the filter'
          ),
        ],
      })
    );
  }

  const selected = days.includes(ui.scheduleDay)
    ? ui.scheduleDay
    : days.includes(today)
      ? today
      : days[0];
  ui.scheduleDay = selected;

  const picker = el(
    'div',
    { class: 'day-picker' },
    el(
      'div',
      { class: 'days' },
      days.map((day) => {
        const d = parseISO(day);
        const gaps = gapsByDate.get(day);
        return el(
          'button',
          {
            class: `day-pill${day === selected ? ' is-selected' : ''}${day === today ? ' is-today' : ''}`,
            'aria-pressed': String(day === selected),
            'aria-label': `${formatDate(day)}${gaps ? ', understaffed' : ''}`,
            title: gaps ? `Understaffed: ${gaps.map(describeGap).join(', ')}` : null,
            // Picking a day re-renders the view; keep focus on the pill.
            dataset: { focusKey: `sched:day:${day}` },
            onClick: () => {
              ui.scheduleDay = day;
              ctx.refresh();
            },
          },
          el('span', { class: 'dow' }, dayShort(d.getDay())),
          el('span', { class: 'num' }, String(d.getDate())),
          gaps ? el('span', { class: 'day-pill-gap' }) : null
        );
      })
    )
  );

  const dayGaps = gapsByDate.get(selected) ?? [];
  const gapNote =
    dayGaps.length > 0
      ? el(
          'div',
          { class: 'form-note', style: { marginBottom: '10px' } },
          icon('warning', 15),
          `Understaffed: ${dayGaps.map(describeGap).join(', ')}`
        )
      : null;

  const dayShifts = shiftsOn(state.shifts, selected).filter((s) => shiftMatchesFilter(s, filter));
  const filtered = isFiltered(filter);
  const list =
    dayShifts.length === 0
      ? el(
          'div',
          { class: 'card' },
          filtered
            ? emptyState({
                iconName: 'filter',
                title: 'Nothing matches the filter',
                message: 'No shifts on this day match what the filter is showing.',
                actions: [
                  el(
                    'button',
                    { class: 'btn btn-primary', onClick: () => clearScheduleFilter(ctx) },
                    icon('x', 15),
                    'Clear the filter'
                  ),
                ],
              })
            : emptyState({
                iconName: 'calendar',
                title: 'No shifts this day',
                actions: [
                  el(
                    'button',
                    { class: 'btn btn-primary', onClick: () => openShiftEditor(ctx, { defaults: { date: selected } }) },
                    icon('plus', 16),
                    'Add shift'
                  ),
                ],
              })
        )
      : el(
          'div',
          { class: 'card row-list' },
          dayShifts.map((shift) => {
            // Look across the whole roster: archived employees keep their
            // shifts and should appear by name, not as "Former employee".
            const emp = state.employees.find((e) => e.id === shift.assigneeId);
            const conflicted = findConflicts(shift, state.shifts).length > 0;
            const timeOff = shiftTimeOff(state, shift, emp);
            return el(
              'div',
              {
                ...buttonize(() => openShiftEditor(ctx, { shift })),
                class: `item-row is-clickable${
                  emp && matchesSearch(emp, search) ? ' is-found' : ''
                }`,
              },
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
                )
              ),
              el(
                'div',
                { class: 'item-actions' },
                conflicted ? el('span', { class: 'badge badge-warning' }, 'Conflict') : null,
                timeOff
                  ? el('span', { class: 'badge badge-warning', title: timeOff.note || null }, 'Time off')
                  : null,
                emp && !emp.active ? el('span', { class: 'badge' }, 'Archived') : null,
                !shift.assigneeId ? el('span', { class: 'badge badge-accent' }, 'Open') : null
              )
            );
          })
        );

  return el('div', {}, picker, gapNote, list);
}

export function renderSchedule(ctx) {
  const { store, ui } = ctx;
  const state = store.state;
  const today = isoToday();
  const weekStart = ui.scheduleWeekStart ?? startOfWeek(today);
  ui.scheduleWeekStart = weekStart;
  const view = ui.scheduleView === 'month' ? 'month' : 'week';
  const monthStart = ui.scheduleMonth ?? startOfMonth(weekStart);
  ui.scheduleMonth = monthStart;

  const employees = state.employees.filter((e) => e.active);
  const isMobile = isMobileViewport();
  const filter = scheduleFilterState(ui);
  const filterOn = isFiltered(filter) || Boolean(scheduleSearch(ui).trim());
  // A filter that is on stays visible: hiding both the bar and its
  // controls is how somebody ends up printing a third of a week.
  if (filterOn) ui.scheduleFilterOpen = true;

  const visibleDays = weekDates(weekStart);

  function shiftWeek(delta) {
    if (delta === 0) {
      ui.scheduleWeekStart = startOfWeek(today);
      ui.scheduleDay = today;
      ctx.refresh();
      return;
    }
    ui.scheduleWeekStart = addDays(weekStart, delta * 7);
    // Carry the selected weekday across with the week. The day view falls
    // back to Monday for any day outside the week on screen, so stepping
    // from a Thursday to the next Thursday otherwise took two taps.
    if (ui.scheduleDay) ui.scheduleDay = addDays(ui.scheduleDay, delta * 7);
    ctx.refresh();
  }

  function shiftMonth(delta) {
    ui.scheduleMonth = delta === 0 ? startOfMonth(today) : addMonths(monthStart, delta);
    ctx.refresh();
  }

  function setView(next) {
    if (next === view) return;
    ui.scheduleView = next;
    // Month zoom starts on the month of the week that was on screen, and
    // zooming back in lands in the month being browsed rather than
    // snapping to whichever week the user left behind: planning three
    // months out and pressing Week should not throw them back to today.
    if (next === 'month') {
      ui.scheduleMonth = startOfMonth(weekStart);
    } else if (startOfMonth(weekStart) !== monthStart) {
      const target = startOfMonth(today) === monthStart ? today : monthStart;
      ui.scheduleWeekStart = startOfWeek(target);
      ui.scheduleDay = target;
    }
    ctx.refresh();
  }

  async function copyPreviousWeek() {
    const targetHasShifts = state.shifts.some((s) => visibleDays.includes(s.date));
    if (targetHasShifts) {
      const ok = await confirmDialog({
        title: 'Merge into this week?',
        message:
          'Last week’s shifts are added to this week. Existing shifts stay, and exact duplicates are skipped.',
        confirmLabel: 'Copy shifts',
      });
      if (!ok) return;
    }
    try {
      // The count below has to be of the copies alone. Measured over the
      // week instead, it swept up whatever was already standing there and
      // pinned it on the copy: "5 shifts copied. 3 may need attention"
      // reads as three of those five, and a week that arrived with three
      // problems of its own still has exactly three.
      const before = new Set(state.shifts.map((s) => s.id));
      const { copied, skipped } = await store.copyWeek(addDays(weekStart, -7), weekStart);
      // Re-check the copies the same way the shift editor would.
      const rules = state.settings.rules;
      const rulesOn = hasRules(rules);
      const flagged = state.shifts.filter(
        (s) =>
          !before.has(s.id) &&
          s.assigneeId &&
          (findConflicts(s, state.shifts).length > 0 ||
            availabilityStatus(s, state.availability[s.assigneeId]) !== AVAILABILITY.AVAILABLE ||
            // A copied week repeats last week's pattern, which is how a
            // run of days without a break gets extended.
            (rulesOn && ruleViolations(s, s.assigneeId, state.shifts, rules).length > 0))
      ).length;
      const parts = [];
      if (copied > 0) parts.push(`${copied} shift${copied === 1 ? '' : 's'} copied`);
      if (skipped > 0) parts.push(`${skipped} duplicate${skipped === 1 ? '' : 's'} skipped`);
      if (copied === 0) {
        toast(parts.length ? `Nothing new to copy: ${parts.join(', ')}.` : 'Nothing to copy.');
      } else {
        toast(`${parts.join(', ')}${flagged ? `. ${flagged} may need attention.` : '.'}`);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const openThisWeek = state.shifts.filter((s) => !s.assigneeId && visibleDays.includes(s.date)).length;

  // The week's projected labor cost, its budget, and the breakdown all
  // live in a panel of their own now (see ui/cost.js); the month view
  // keeps the one-line note, since a month has no weekly budget to
  // measure itself against.
  const monthCost =
    view === 'month'
      ? laborCost(state.shifts, state.employees, monthDays(monthStart), costOptions(state.settings))
      : null;
  const costNote =
    monthCost === null || monthCost.ratedCount === 0
      ? null
      : el(
          'span',
          {
            class: 'print-hidden',
            title:
              monthCost.ratedCount < monthCost.employeeCount
                ? `Only ${monthCost.ratedCount} of ${monthCost.employeeCount} scheduled people have an hourly rate; the total covers just those.`
                : 'Estimated from net scheduled hours times each hourly rate.',
          },
          ` · ${formatMoney(monthCost.cost, state.settings.currency)} est. labor${
            monthCost.ratedCount < monthCost.employeeCount
              ? ` (${monthCost.ratedCount} of ${monthCost.employeeCount} have rates)`
              : ''
          }`
        );

  const body =
    state.employees.length === 0
      ? el(
          'div',
          { class: 'card' },
          emptyState({
            iconName: 'users',
            title: 'No employees yet',
            message: 'Add employees before building the schedule.',
            actions: [
              el('button', { class: 'btn btn-primary', onClick: () => ctx.navigate('team') }, 'Go to Team'),
            ],
          })
        )
      : view === 'month'
        ? monthGrid(ctx, monthStart, today)
        : isMobile
          ? dayView(ctx, weekStart, today)
          : weekGrid(ctx, weekStart, employees, today);

  // Default date for a new shift, always inside the range on screen. The
  // remembered day selection can point at another week after navigating,
  // and the day list above has just settled which day it is showing, so
  // this is read after the body is built rather than before it.
  const newShiftDate =
    view === 'month'
      ? startOfMonth(today) === monthStart
        ? today
        : monthStart
      : visibleDays.includes(ui.scheduleDay)
        ? ui.scheduleDay
        : visibleDays.includes(today)
          ? today
          : weekStart;
  // The shell's floating button adds a shift from any view. On this one
  // it sits beside a New shift button of our own, so hand it the date
  // that button uses rather than letting the two disagree.
  ui.scheduleNewShiftDate = newShiftDate;

  return el(
    'div',
    {},
    el(
      'div',
      { class: 'view-header' },
      el(
        'div',
        {},
        el('h1', {}, 'Schedule'),
        view === 'month'
          ? el('p', { class: 'subtitle tnum' }, formatMonth(monthStart), costNote, filterFlag(ctx))
          : el('p', { class: 'subtitle tnum' }, weekLabel(weekStart), filterFlag(ctx))
      ),
      el(
        'div',
        { class: 'view-actions' },
        // Every control in this bar re-renders the view it lives in, which
        // rebuilds the control itself. The stable keys hand focus back to
        // the equivalent button so a keyboard user paging through weeks
        // is not dropped at the top of the page on every press (see
        // render() in app.js).
        segmented(
          [
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ],
          view,
          setView,
          { focusKeyPrefix: 'sched:view' }
        ),
        el(
          'div',
          { class: 'week-nav' },
          el(
            'button',
            {
              class: 'btn btn-icon',
              'aria-label': view === 'month' ? 'Previous month' : 'Previous week',
              dataset: { focusKey: 'sched:prev' },
              onClick: () => (view === 'month' ? shiftMonth(-1) : shiftWeek(-1)),
            },
            icon('chevron-left', 16)
          ),
          el(
            'button',
            {
              class: 'btn',
              dataset: { focusKey: 'sched:today' },
              onClick: () => (view === 'month' ? shiftMonth(0) : shiftWeek(0)),
            },
            'Today'
          ),
          el(
            'button',
            {
              class: 'btn btn-icon',
              'aria-label': view === 'month' ? 'Next month' : 'Next week',
              dataset: { focusKey: 'sched:next' },
              onClick: () => (view === 'month' ? shiftMonth(1) : shiftWeek(1)),
            },
            icon('chevron-right', 16)
          )
        ),
        view === 'week'
          ? el(
              'button',
              {
                class: 'btn',
                title: 'Copy last week’s shifts into this week',
                dataset: { focusKey: 'sched:copy' },
                onClick: copyPreviousWeek,
              },
              icon('copy', 15),
              'Copy last week'
            )
          : null,
        // Offered only where there is something to fill, with the reason
        // in the tooltip: a button that can only refuse is worse than a
        // button that says why it is quiet.
        view === 'week'
          ? el(
              'button',
              {
                class: 'btn',
                disabled: openThisWeek === 0 || employees.length === 0,
                title:
                  employees.length === 0
                    ? 'Add employees before staffing shifts'
                    : openThisWeek === 0
                      ? 'Every shift this week already has someone on it'
                      : `Propose someone for each of the ${openThisWeek} open shift${
                          openThisWeek === 1 ? '' : 's'
                        } this week`,
                dataset: { focusKey: 'sched:fill' },
                onClick: () => openFillDialog(ctx, weekStart),
              },
              icon('user-plus', 15),
              'Fill open shifts'
            )
          : null,
        el(
          'button',
          {
            class: `btn btn-icon${filterOn ? ' is-active' : ''}`,
            'aria-label': 'Filter and search',
            'aria-expanded': String(Boolean(ui.scheduleFilterOpen)),
            title: filterOn
              ? `Filter and search · ${describeFilter(filter, state) || 'searching'}`
              : 'Filter and search',
            dataset: { focusKey: 'sched:filter' },
            onClick: () => {
              ui.scheduleFilterOpen = !ui.scheduleFilterOpen;
              ctx.refresh();
            },
          },
          icon('filter', 16)
        ),
        el(
          'button',
          {
            class: 'btn btn-icon',
            'aria-label': 'Coverage and working-time limits',
            title: 'Coverage and working-time limits',
            onClick: () => openCoverageEditor(ctx),
          },
          icon('users', 16)
        ),
        view === 'week'
          ? el(
              'button',
              {
                class: 'btn btn-icon print-hidden',
                'aria-label': 'Print schedule',
                title: 'Print schedule',
                onClick: () => window.print(),
              },
              icon('printer', 16)
            )
          : null,
        view === 'week'
          ? el(
              'button',
              {
                class: 'btn btn-icon',
                'aria-label': 'Share schedule',
                title: 'Share schedule',
                onClick: () => openShareDialog(ctx, weekStart),
              },
              icon('share', 16)
            )
          : null,
        el(
          'button',
          {
            class: 'btn btn-icon',
            'aria-label': 'Export to calendar (.ics)',
            title: 'Export to calendar (.ics)',
            onClick: () => openCalendarExportDialog(ctx),
          },
          icon('calendar-check', 16)
        ),
        el(
          'button',
          {
            class: 'btn btn-primary',
            onClick: () => openShiftEditor(ctx, { defaults: { date: newShiftDate } }),
          },
          icon('plus', 16),
          'New shift'
        )
      )
    ),
    ui.scheduleFilterOpen && state.employees.length > 0 ? filterBar(ctx) : null,
    view === 'week' && state.employees.length > 0 ? costPanel(ctx, visibleDays) : null,
    body
  );
}
