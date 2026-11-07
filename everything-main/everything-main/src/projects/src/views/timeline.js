import { el, clear } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { record } from '../ui/history.js';
import {
  columnTasks, doneColumnIds, taskSpan, timelineRange, clampToRange,
  shiftTaskDates, clampSpanDelta,
} from '../lib/board.js';
import { todayISO, addDays, diffDays, parseISO, isWeekend, monthLabel, fmtShort, fmtLong, dueStatus } from '../lib/dates.js';
import { openTaskSheet } from '../ui/tasksheet.js';
import { initTimelineDnd } from '../ui/timelinednd.js';
import { emptyState } from '../ui/bits.js';

/**
 * Widest a month label gets ("December 2026" at 11px bold uppercase) plus its
 * 8px of air. A cell narrower than this shows no label rather than a clipped
 * one; at the day widths in use that is only ever a two or three day sliver at
 * the very edge of the range.
 */
const MONTH_LABEL_W = 112;

/**
 * Gantt-lite: one row per dated task, grouped by board column, plus a
 * milestone track. One scroll container handles both axes; task labels
 * stick to the left edge, the date header sticks to the top.
 *
 * Bars are draggable: the body reschedules, the edges resize, and an
 * unscheduled task dropped on the chart gets a due date. Every drop is a
 * normal store mutation, so the optimistic write and retry flow apply.
 */
export function timelineView({ projectId }) {
  const scroll = el('div.tl-scroll', { tabindex: 0, 'aria-label': 'Project timeline' });
  const unscheduledWrap = el('div');
  const live = el('div.sr-only', { 'aria-live': 'polite' });
  const root = el('div.timeline-wrap', {}, scroll, unscheduledWrap, live);

  const doc = () => store.getDoc(projectId);
  const compact = matchMedia('(max-width: 640px)');
  const announce = (msg) => { live.textContent = msg; };

  // First render centers on today; later ones (every doc change re-renders)
  // put the user's scroll position back instead of yanking them around.
  let hasRendered = false;
  // Grid geometry of the last render — the drag layer converts pixels to
  // days with it, and it changes with the breakpoint and the date window.
  let geo = null;

  const findTask = (taskId) => doc()?.tasks.find((t) => t.id === taskId) ?? null;

  function render() {
    const d = doc();
    if (!d) return;
    const prevScroll = hasRendered ? { left: scroll.scrollLeft, top: scroll.scrollTop } : null;
    // Preserve focus across the rebuild: an Alt+arrow reschedule re-renders
    // the row it just moved, and losing focus would drop the next keypress.
    const focusedId = document.activeElement?.closest?.('.tl-bar')?.dataset?.taskId;
    clear(scroll);
    clear(unscheduledWrap);

    const today = todayISO();
    const doneIds = doneColumnIds(d);
    const dated = d.tasks.filter((t) => taskSpan(t));
    const unscheduled = d.tasks.filter((t) => !taskSpan(t));

    if (!dated.length && !d.milestones.length) {
      geo = null;
      scroll.replaceChildren(emptyState({
        icon: 'timeline',
        title: 'Nothing scheduled yet',
        sub: 'Give tasks a start or due date, or add a milestone, and they appear here.',
      }));
      renderUnscheduled(unscheduled);
      return;
    }

    const range = timelineRange(d.tasks, d.milestones, today);
    const dw = compact.matches ? 26 : 36;
    const labelW = compact.matches ? 132 : 200;
    const chartW = range.days * dw;
    const offset = (iso) => diffDays(range.start, iso) * dw;
    geo = { range, dw, labelW };

    const canvas = el('div.tl-canvas', {
      style: { width: `${labelW + chartW}px`, '--tl-label-w': `${labelW}px`, '--dw': `${dw}px` },
    });

    /* Header: month band + day numbers */
    const monthCells = [];
    for (let i = 0; i < range.days;) {
      const iso = addDays(range.start, i);
      const date = parseISO(iso);
      const daysLeftInMonth = Math.min(
        range.days - i,
        new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() - date.getDate() + 1,
      );
      // The label sticks to the left edge of the chart while its month is in
      // view (see .tl-month-label), so scrolling into the middle of a month
      // never leaves a row of bare day numbers with no month above them. It
      // needs room to sit whole, since nothing clips it any more.
      const room = daysLeftInMonth * dw >= MONTH_LABEL_W;
      monthCells.push(el('div.tl-month', { style: { width: `${daysLeftInMonth * dw}px` } },
        room
          ? el('span.tl-month-label', {}, monthLabel(iso))
          : null));
      i += daysLeftInMonth;
    }
    const dayCells = [];
    for (let i = 0; i < range.days; i++) {
      const iso = addDays(range.start, i);
      const day = parseISO(iso).getDate();
      dayCells.push(el('div.tl-day', {
        className: `tl-day${iso === today ? ' today' : ''}${isWeekend(iso) ? ' weekend' : ''}`,
      }, dw >= 22 ? String(day) : (day % 2 ? String(day) : '')));
    }
    canvas.append(el('div.tl-header', {},
      el('div.tl-corner'),
      el('div.tl-header-days', { style: { width: `${chartW}px` } },
        el('div.tl-months', {}, monthCells),
        el('div.tl-days', {}, dayCells))
    ));

    /* Underlay: weekend stripes, today line, and the drag guide, behind every
       row. It also gives the drag layer the chart's origin in client pixels. */
    const underlay = el('div.tl-underlay', { 'aria-hidden': 'true', style: { left: `${labelW}px`, width: `${chartW}px` } });
    for (let i = 0; i < range.days; i++) {
      const iso = addDays(range.start, i);
      if (isWeekend(iso)) {
        underlay.append(el('div.tl-weekend', { style: { left: `${i * dw}px`, width: `${dw}px` } }));
      }
    }
    underlay.append(el('div.tl-today-line', { style: { left: `${offset(today) + dw / 2}px` } }));
    // Lives in the chart rather than over it, so it scrolls with the day it
    // marks and is clipped by the same box the columns are.
    underlay.append(el('div.tl-drop-line', { hidden: true }));
    canvas.append(underlay);

    /* Milestone track */
    if (d.milestones.length) {
      const track = el('div.tl-milestones', { style: { width: `${chartW}px` } });
      // Outside the clamped window a diamond would sit at a misleading spot;
      // the milestones tab still lists it.
      const shown = [...d.milestones]
        .filter((m) => m.date && clampToRange(m.date, range) === m.date)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      shown.forEach((m, i) => {
        const at = offset(m.date) + dw / 2;
        /* Every name is one absolutely positioned nowrap run, so milestones a
           few days apart — a launch week, which is when a project has most of
           them — printed three labels over the same pixels and none of them
           could be read. Each gets the room up to its neighbour and ellipsizes
           there; the diamond itself never shrinks away, and the full name is
           still in the tooltip and the accessible label. */
        const next = shown[i + 1];
        const room = (next ? offset(next.date) + dw / 2 : chartW) - at - 8;
        track.append(el('button.tl-diamond', {
          type: 'button',
          className: `tl-diamond${m.done ? ' done' : ''}`,
          style: { left: `${at}px`, maxWidth: `${Math.max(room, 14)}px` },
          title: `${m.name}: ${fmtLong(m.date)}`,
          'aria-label': `Milestone ${m.name}, ${fmtLong(m.date)}`,
          onclick: () => { location.hash = `#/p/${projectId}/milestones`; },
        }, el('span.tl-diamond-shape'), el('span.tl-diamond-name', {}, m.name)));
      });
      canvas.append(el('div.tl-row.tl-mrow', {},
        el('div.tl-label.tl-group-label', { html: icon('flag', 14, 2) }, ' Milestones'),
        track
      ));
    }

    /* Task rows, grouped by column */
    for (const col of d.columns) {
      const tasks = columnTasks(d.tasks, col.id).filter((t) => taskSpan(t));
      if (!tasks.length) continue;
      canvas.append(el('div.tl-row.tl-group', {},
        el('div.tl-label.tl-group-label', {}, `${col.name} (${tasks.length})`),
        el('div', { style: { width: `${chartW}px` } })
      ));
      for (const t of tasks) {
        const span = taskSpan(t);
        // Bars are drawn within the clamped window; a span beyond it
        // collapses to a sliver at the edge, with real dates in the title.
        const barStart = clampToRange(span.start, range);
        const barEnd = clampToRange(span.end, range);
        const left = offset(barStart);
        const width = (diffDays(barStart, barEnd) + 1) * dw;
        const isDone = doneIds.has(col.id);
        const status = dueStatus(t.dueDate, isDone, today);
        // A bar the window had to clip does not sit where its dates say, so
        // dragging it would move the task by a number nobody can see.
        const locked = barStart !== span.start || barEnd !== span.end;
        // Edge handles need room for two grab zones plus a body, and they
        // only mean "resize" on a bar whose two edges are two real dates.
        const canResize = !locked && width >= dw * 2;
        const spans = span.start !== span.end;

        const bar = el('button.tl-bar', {
          type: 'button',
          className: `tl-bar${isDone ? ' done' : ''}${status === 'overdue' ? ' overdue' : ''}`
            + `${locked ? '' : ' draggable'}`,
          dataset: { taskId: t.id },
          style: { left: `${left}px`, width: `${Math.max(width, 10)}px`, background: isDone ? null : d.color },
          title: `${t.title}: ${fmtShort(span.start)}${spans ? ` to ${fmtShort(span.end)}` : ''}`,
          'aria-label': `${t.title}, ${fmtLong(span.start)}${spans ? ` to ${fmtLong(span.end)}` : ''}.`
            + (locked ? '' : ' Alt plus left or right arrow reschedules by a day, add Shift to move the due date.')
            + ' Enter to open.',
          onclick: () => openTaskSheet(projectId, t.id),
          onkeydown: (e) => onBarKey(e, t, locked),
        },
          isDone && el('span.tl-bar-check', { html: icon('check', 11, 3) }),
          canResize && el('span.tl-bar-handle.start', { dataset: { edge: 'start' }, 'aria-hidden': 'true' }),
          canResize && el('span.tl-bar-handle.end', { dataset: { edge: 'end' }, 'aria-hidden': 'true' })
        );
        if (locked) bar.dataset.locked = '';

        canvas.append(el('div.tl-row', {},
          el('div.tl-label', { title: t.title }, t.title),
          el('div.tl-chart', { style: { width: `${chartW}px` } }, bar)
        ));
      }
    }

    scroll.append(canvas);
    if (focusedId) {
      scroll.querySelector(`.tl-bar[data-task-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
    }

    if (prevScroll) {
      scroll.scrollLeft = prevScroll.left;
      scroll.scrollTop = prevScroll.top;
    } else {
      // Land with today about a third in from the left. rAF because the
      // view may not be attached (and measurable) yet on first render.
      hasRendered = true;
      requestAnimationFrame(() => {
        scroll.scrollLeft = Math.max(0, offset(today) - (scroll.clientWidth - labelW) / 3);
      });
    }

    renderUnscheduled(unscheduled);
  }

  function renderUnscheduled(tasks) {
    if (!tasks.length) return;
    unscheduledWrap.append(el('section.tl-unscheduled', {},
      el('h2.section-title', { html: icon('circleDashed', 15, 2) }, ` Unscheduled (${tasks.length})`),
      el('p.form-hint', {}, geo
        ? 'Drag one onto the chart to give it a due date, or open it to set both dates.'
        : 'Open a task and set a start or due date to place it on the timeline.'),
      el('div.tl-unscheduled-list', {},
        tasks.map((t) => el('button.tl-unscheduled-item', {
          type: 'button',
          className: `tl-unscheduled-item${geo ? ' draggable' : ''}`,
          dataset: { taskId: t.id },
          title: geo ? `${t.title}. Drag onto the chart to schedule` : t.title,
          onclick: () => openTaskSheet(projectId, t.id),
        }, t.title)))
    ));
  }

  // ---- rescheduling --------------------------------------------------------

  /** Label a drag is about to produce: what the bar will mean when dropped. */
  function preview(taskId, mode, rawDelta) {
    const task = findTask(taskId);
    const span = task && taskSpan(task);
    if (!span) return { delta: 0, label: '' };
    const delta = clampSpanDelta(task, mode, rawDelta);
    const start = mode === 'end' ? span.start : addDays(span.start, delta);
    const end = mode === 'start' ? span.end : addDays(span.end, delta);
    const days = diffDays(start, end) + 1;
    if (start === end) {
      const only = task.startDate && !task.dueDate ? 'Starts ' : task.dueDate && !task.startDate ? 'Due ' : '';
      return { delta, label: `${only}${fmtShort(start)}` };
    }
    return { delta, label: `${fmtShort(start)} → ${fmtShort(end)} · ${days} days` };
  }

  const dayISO = (dayIndex) => addDays(geo.range.start, dayIndex);
  const dayPreview = (dayIndex) => `Due ${fmtShort(dayISO(dayIndex))}`;

  /** Show the drop guide on a day column, or hide it (null). */
  function markDay(dayIndex) {
    const line = scroll.querySelector('.tl-drop-line');
    if (!line) return;
    line.hidden = dayIndex === null || !geo;
    if (!line.hidden) line.style.left = `${dayIndex * geo.dw + geo.dw / 2}px`;
  }

  /**
   * Every reschedule goes through one of these two, so recording the inverse
   * here covers a bar dragged, an edge resized, Alt+arrows, and a backlog
   * chip dropped on a day — one entry per gesture, whichever it was.
   */
  function remember(task, patch, label) {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, task[k] ?? null]));
    record(projectId, {
      label,
      undo: () => store.updateTask(projectId, task.id, before),
      redo: () => store.updateTask(projectId, task.id, patch),
    });
  }

  function commit(taskId, mode, delta) {
    const task = findTask(taskId);
    if (!task) return;
    const patch = shiftTaskDates(task, mode, delta);
    if (!patch) return;
    const title = task.title;
    remember(task, patch, mode === 'move'
      ? `move of “${title}”`
      : `${mode === 'start' ? 'start' : 'due'} date of “${title}”`);
    store.updateTask(projectId, taskId, patch);
    const span = taskSpan(findTask(taskId));
    announce(span.start === span.end
      ? `"${task.title}" moved to ${fmtLong(span.start)}`
      : `"${task.title}" now runs ${fmtLong(span.start)} to ${fmtLong(span.end)}`);
  }

  function schedule(taskId, dayIndex) {
    const task = findTask(taskId);
    if (!task) return;
    const iso = dayISO(dayIndex);
    remember(task, { dueDate: iso }, `due date of “${task.title}”`);
    store.updateTask(projectId, taskId, { dueDate: iso });
    announce(`"${task.title}" is due ${fmtLong(iso)}`);
  }

  function onBarKey(e, task, locked) {
    if (locked || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const delta = e.key === 'ArrowLeft' ? -1 : 1;
    // render() puts focus back on this bar, so holding the key repeats.
    commit(task.id, e.shiftKey ? 'end' : 'move', delta);
  }

  const dnd = initTimelineDnd(root, {
    scroll,
    chartOrigin() {
      const underlay = scroll.querySelector('.tl-underlay');
      if (!underlay || !geo) return null;
      return {
        left: underlay.getBoundingClientRect().left,
        dw: geo.dw,
        days: geo.range.days,
        labelW: geo.labelW,
      };
    },
    preview,
    dayPreview,
    markDay,
    onCommit: commit,
    onSchedule: schedule,
  });

  const onChange = (e) => {
    if (e.detail?.scope === 'doc' && e.detail.projectId === projectId) render();
  };
  // Crossing the compact breakpoint (rotation, window resize) changes day
  // width, so the grid must rebuild; the old scroll offset is meaningless
  // at the new density, so re-center on today.
  const onBreakpoint = () => { hasRendered = false; render(); };
  store.addEventListener('change', onChange);
  compact.addEventListener('change', onBreakpoint);
  root.destroy = () => {
    dnd.destroy();
    store.removeEventListener('change', onChange);
    compact.removeEventListener('change', onBreakpoint);
  };

  render();
  return root;
}
