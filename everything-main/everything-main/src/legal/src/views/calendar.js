/**
 * Calendar: day, week, month, and agenda views of events, plus task due
 * dates and statute of limitations dates as all-day layers. Events can be
 * dragged to a new time or day, resized from their bottom edge, and moved
 * with Alt+Arrow keys.
 */
import '../styles/calendar-tasks.css';
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { segmented, checkbox, emptyState } from '../ui/components.js';
import { setQuery, navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { openEventDialog, openTaskDialog, EVENT_KINDS } from './dialogs.js';
import { groupBy } from '../core/derive.js';
import { colorFor, matterLabel } from '../core/format.js';
import { today as todayISO, addDays, daysInRange, isISODate, formatDate, formatTime, timeToMinutes, weekday, startOfMonth, addMonths } from '../core/dates.js';
import { layoutDay, viewRange, monthGrid, stepDate, viewTitle, moveEvent, resizeEvent, snap, DAY_MINUTES } from '../core/cal-layout.js';

const HOUR = 48; // pixels per hour
const PPM = HOUR / 60;
const GUTTER = 66;
const LONG_PRESS = 400; // ms a finger rests on an event before it can be dragged
const LAYERS_KEY = 'legal.calendar.layers';
const VIEW_KEY = 'legal.calendar.view';
const KIND_TONE = Object.fromEntries(EVENT_KINDS.map((k) => [k.id, k.tone]));
const KIND_LABEL = Object.fromEntries(EVENT_KINDS.map((k) => [k.id, k.label]));

function loadLayers() {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYERS_KEY) || 'null');
    if (raw && typeof raw === 'object') return { users: {}, tasks: true, sol: true, colorBy: 'person', ...raw };
  } catch {}
  return { users: {}, tasks: true, sol: true, colorBy: 'person' };
}

function saveLayers(l) {
  try {
    localStorage.setItem(LAYERS_KEY, JSON.stringify(l));
  } catch {}
}

function defaultView() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (['day', 'week', 'month', 'agenda'].includes(v)) return v;
  } catch {}
  return typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches ? 'day' : 'week';
}

export function render(ctx) {
  const store = app.store;
  const settings = () => app.settings();
  const state = {
    view: ['day', 'week', 'month', 'agenda'].includes(ctx.query.view) ? ctx.query.view : defaultView(),
    date: isISODate(ctx.query.date) ? ctx.query.date : todayISO(),
    miniMonth: null,
    layers: loadLayers(),
    focusId: null, // event to refocus after a keyboard move
    scrollTop: null,
    dragging: false, // a pointer drag is under way; redraws wait for it to end
  };
  state.miniMonth = startOfMonth(state.date);

  const titleEl = h('h1.cal-title');
  const viewSeg = h('div');
  const main = h('div.cal-main');
  const side = h('aside.cal-side', { id: uniqueId('cal-side'), 'aria-label': 'Calendar options' });
  // Narrow screens hide the sidebar; this button shows it above the calendar.
  const sideToggle = h(
    'button.btn.cal-side-toggle',
    {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': side.id,
      onClick: () => {
        const open = !layout.classList.contains('side-open');
        layout.classList.toggle('side-open', open);
        sideToggle.setAttribute('aria-expanded', String(open));
      },
    },
    icon('calendar-range', 16),
    h('span.hide-sm', 'Calendars'),
  );

  const toolbar = h(
    'div.cal-toolbar',
    h('button.btn', { type: 'button', onClick: () => go(todayISO()) }, 'Today'),
    h(
      'div.btn-group',
      h('button.btn.icon-only', { type: 'button', 'aria-label': 'Previous', title: 'Previous', onClick: () => go(stepDate(state.view, state.date, -1)) }, icon('chevron-left', 17)),
      h('button.btn.icon-only', { type: 'button', 'aria-label': 'Next', title: 'Next', onClick: () => go(stepDate(state.view, state.date, 1)) }, icon('chevron-right', 17)),
    ),
    titleEl,
    h('div.spacer'),
    viewSeg,
    sideToggle,
    h('button.btn.primary', { type: 'button', onClick: () => openEventDialog({ date: state.date }) }, icon('plus', 16), h('span.hide-sm', 'New event')),
  );

  function go(date, view = state.view) {
    if (main.querySelector('.cal-scroll')) state.scrollTop = view === state.view ? main.querySelector('.cal-scroll').scrollTop : null;
    state.date = date;
    state.view = view;
    state.miniMonth = startOfMonth(date);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {}
    setQuery({ date: date === todayISO() ? '' : date, view });
    draw();
  }

  // ---- What is visible ----------------------------------------------------------

  const userOn = (id) => state.layers.users[id] !== false;

  function eventVisible(e) {
    const ids = e.attendeeIds || [];
    if (!ids.length) return true;
    return ids.some((id) => !lookup.user(id) || userOn(id));
  }

  function eventColor(e) {
    if (state.layers.colorBy === 'type') return { tone: KIND_TONE[e.kind] || 'accent' };
    const uid = (e.attendeeIds || []).find((id) => lookup.user(id) && userOn(id)) || (e.attendeeIds || [])[0];
    const u = uid && lookup.user(uid);
    return u ? { color: u.color || colorFor(u.id) } : { tone: 'neutral' };
  }

  /** Map of date -> { timed: events[], allDay: items[] } for [from, to]. */
  function collect(from, to) {
    const byDate = groupBy(store.all('events'), 'date');
    const tasksByDate = state.layers.tasks ? groupBy(store.all('tasks'), 'dueDate') : null;
    const solByDate = state.layers.sol ? groupBy(store.all('matters'), 'solDate') : null;
    const out = new Map();
    for (const d of daysInRange(from, to)) {
      const timed = [];
      const allDay = [];
      for (const e of byDate.get(d) || []) {
        if (!eventVisible(e)) continue;
        if (e.allDay || !e.start) allDay.push({ type: 'event', rec: e });
        else timed.push(e);
      }
      for (const m of solByDate?.get(d) || []) if (!m.solSatisfied && m.status !== 'closed') allDay.push({ type: 'sol', rec: m });
      for (const t of tasksByDate?.get(d) || []) if (!t.done && (!t.assigneeId || !lookup.user(t.assigneeId) || userOn(t.assigneeId))) allDay.push({ type: 'task', rec: t });
      timed.sort((a, b) => String(a.start).localeCompare(String(b.start)));
      out.set(d, { timed, allDay });
    }
    return out;
  }

  // ---- Small item renderers ----------------------------------------------------

  function colorAttrs(c) {
    return c.color ? { style: { '--ev': c.color } } : { class: `tone-${c.tone}` };
  }

  function allDayChip(item, { compact = false } = {}) {
    if (item.type === 'event') {
      const e = item.rec;
      return h(
        'button.cal-chip',
        {
          type: 'button',
          ...colorAttrs(eventColor(e)),
          onClick: () => openEventDialog({ event: e }),
          'aria-label': `${e.title}, ${e.allDay || !e.start ? 'all day' : formatTime(e.start)}${e.matterId ? `, ${matterLabel(lookup.matter(e.matterId))}` : ''}`,
        },
        !compact && e.start && !e.allDay ? h('span.cal-chip-time', formatTime(e.start)) : null,
        h('span.truncate', e.title),
      );
    }
    if (item.type === 'task') {
      const t = item.rec;
      return h('button.cal-chip.task', { type: 'button', onClick: () => openTaskDialog({ task: t }), 'aria-label': `Task due: ${t.name}` }, icon('square-check', 13), h('span.truncate', t.name));
    }
    const m = item.rec;
    return h(
      'button.cal-chip.sol',
      { type: 'button', onClick: () => navigate(`/matters/${m.id}`), 'aria-label': `Statute of limitations: ${matterLabel(m)}` },
      icon('flag', 13),
      h('span.truncate', `SOL: ${m.displayNumber || m.description}`),
    );
  }

  // ---- Week and day ------------------------------------------------------------------

  function drawTimeGrid() {
    const [from, to] = viewRange(state.view, state.date, settings().weekStart);
    const days = daysInRange(from, to);
    const data = collect(from, to);
    const today = todayISO();
    const cols = `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))`;

    const head = h(
      'div.cal-head',
      { style: { gridTemplateColumns: cols } },
      h('div.cal-corner'),
      days.map((d) =>
        h(
          `button.cal-dayhead${d === today ? '.today' : ''}`,
          {
            type: 'button',
            onClick: () => go(d, 'day'),
            'aria-label': `${formatDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}, open day view`,
            'aria-current': d === today ? 'date' : null,
          },
          h('span.cal-dow', formatDate(d, { weekday: 'short' })),
          h('span.cal-dnum', String(Number(d.slice(8)))),
        ),
      ),
    );

    const maxAllDay = Math.max(0, ...days.map((d) => data.get(d).allDay.length));
    const allday = h(
      'div.cal-allday',
      { style: { gridTemplateColumns: cols }, hidden: !maxAllDay },
      h('div.cal-allday-label', 'All day'),
      days.map((d) => {
        const items = data.get(d).allDay;
        // Day view has no further view to send "+N more" to, so it lists everything.
        const shown = days.length > 1 ? items.slice(0, 3) : items;
        return h(
          'div.cal-allday-cell',
          { role: 'group', 'aria-label': `All day, ${formatDate(d)}` },
          shown.map((it) => allDayChip(it)),
          items.length > shown.length ? h('button.cal-more', { type: 'button', onClick: () => go(d, 'day') }, `+${items.length - shown.length} more`) : null,
        );
      }),
    );

    const colNodes = [];
    const body = h('div.cal-body', { style: { gridTemplateColumns: cols, height: `${24 * HOUR}px` } });
    const gutter = h(
      'div.cal-gutter',
      { 'aria-hidden': 'true' },
      Array.from({ length: 23 }, (_, i) => h('span.cal-hour-label', { style: { top: `${(i + 1) * HOUR}px` } }, formatTime(`${String(i + 1).padStart(2, '0')}:00`))),
    );
    body.append(gutter);
    const lines = h(
      'div.cal-lines',
      { 'aria-hidden': 'true', style: { left: `${GUTTER}px` } },
      Array.from({ length: 24 }, (_, i) => h('div.cal-line', { style: { top: `${i * HOUR}px` } })),
    );
    body.append(lines);

    const ws = timeToMinutes(settings().workday?.start || '08:00') ?? 480;
    const we = timeToMinutes(settings().workday?.end || '18:00') ?? 1080;

    days.forEach((d, idx) => {
      const col = h(`div.cal-col${d === today ? '.today' : ''}${weekday(d) === 0 || weekday(d) === 6 ? '.weekend' : ''}`, {
        role: 'group',
        'aria-label': formatDate(d, { weekday: 'long', month: 'long', day: 'numeric' }),
        dataset: { date: d, idx: String(idx) },
      });
      col.append(
        h('div.cal-offhours', { 'aria-hidden': 'true', style: { top: '0', height: `${ws * PPM}px` } }),
        h('div.cal-offhours', { 'aria-hidden': 'true', style: { top: `${we * PPM}px`, height: `${(DAY_MINUTES - we) * PPM}px` } }),
      );
      for (const it of layoutDay(data.get(d).timed)) col.append(eventBlock(it, d));
      if (d === today) {
        const now = new Date();
        col.append(h('div.cal-now', { 'aria-hidden': 'true', style: { top: `${(now.getHours() * 60 + now.getMinutes()) * PPM}px` } }));
      }
      col.addEventListener('click', (e) => {
        if (e.target !== col && !e.target.classList.contains('cal-offhours')) return;
        const r = col.getBoundingClientRect();
        const min = Math.floor((e.clientY - r.top) / PPM / 30) * 30;
        openEventDialog({ date: d, start: minToTime(min) });
      });
      colNodes.push(col);
      body.append(col);
    });

    function eventBlock(it, d) {
      const e = it.event;
      const c = eventColor(e);
      const height = Math.max(20, (it.end - it.start) * PPM - 2);
      const m = e.matterId ? lookup.matter(e.matterId) : null;
      const timeText = `${formatTime(e.start)} to ${formatTime(minToTime(it.end))}`;
      const el = h(
        `button.cal-ev${height < 36 ? '.short' : ''}`,
        {
          type: 'button',
          ...colorAttrs(c),
          'aria-label': `${e.title}, ${formatDate(d)}, ${timeText}${e.location ? `, ${e.location}` : ''}${m ? `, ${matterLabel(m)}` : ''}. Alt plus arrow keys to move.`,
          'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight',
          dataset: { id: e.id },
          style: {
            top: `${it.start * PPM}px`,
            height: `${height}px`,
            left: `calc(${(it.col / it.cols) * 100}% + 2px)`,
            width: `calc(${(it.span / it.cols) * 100}% - 4px)`,
          },
        },
        h('span.cal-ev-title', e.title),
        h('span.cal-ev-time', timeText),
        height >= 56 && e.location ? h('span.cal-ev-loc', e.location) : null,
        h('span.cal-ev-resize', { 'aria-hidden': 'true' }),
      );
      wireDrag(el, e, d);
      el.addEventListener('keydown', (ev) => {
        if (!ev.altKey || !ev.key.startsWith('Arrow')) return;
        ev.preventDefault();
        const span = { start: it.start, end: it.end };
        let date = d;
        let start = span.start;
        if (ev.key === 'ArrowUp') start -= 15;
        if (ev.key === 'ArrowDown') start += 15;
        if (ev.key === 'ArrowLeft') date = addDays(d, -1);
        if (ev.key === 'ArrowRight') date = addDays(d, 1);
        // Moving past the edge of the view takes the view along, so the event stays focused.
        if (date < days[0] || date > days[days.length - 1]) {
          state.date = date;
          state.miniMonth = startOfMonth(date);
          setQuery({ date: date === todayISO() ? '' : date, view: state.view });
        }
        state.focusId = e.id;
        commitMove(e, moveEvent(e, date, Math.max(0, start)), false);
      });
      return el;
    }

    /** Pointer drag: move the block, or resize it from the bottom handle. */
    function wireDrag(el, e, d) {
      let justDragged = false;
      let touchPress = false;
      el.addEventListener('pointerdown', (pd) => {
        if (pd.button !== 0) return;
        const resizing = pd.target.classList.contains('cal-ev-resize');
        const startX = pd.clientX;
        const startY = pd.clientY;
        const span0 = layoutDay([e])[0];
        const grab = (pd.clientY - el.getBoundingClientRect().top) / PPM;
        let moved = false;
        let target = { date: d, start: span0.start, end: span0.end };
        // A finger or pen starts a drag only after a long press, so a swipe
        // across an event scrolls the calendar instead of moving the event.
        let armed = pd.pointerType === 'mouse' || !pd.pointerType;
        const touch = !armed;
        touchPress = touch;
        const arm = () => {
          armed = true;
          if (touch) el.classList.add('dragging');
          try {
            el.setPointerCapture(pd.pointerId);
          } catch {}
        };
        const press = armed ? (arm(), null) : setTimeout(arm, LONG_PRESS);
        const blockScroll = (te) => armed && te.cancelable && te.preventDefault();
        el.addEventListener('touchmove', blockScroll, { passive: false });
        const onMove = (pm) => {
          if (pm.pointerId !== pd.pointerId) return;
          if (!armed) {
            if (Math.hypot(pm.clientX - startX, pm.clientY - startY) >= 5) onUp(pm);
            return;
          }
          if (!moved && Math.hypot(pm.clientX - startX, pm.clientY - startY) < 5) return;
          if (!moved) {
            moved = true;
            state.dragging = true;
            el.classList.add('dragging');
            if (!resizing) {
              el.style.left = '2px';
              el.style.width = 'calc(100% - 4px)';
            }
          }
          const r0 = colNodes[0].getBoundingClientRect();
          if (resizing) {
            const end = snap((pm.clientY - r0.top) / PPM);
            target.end = Math.max(target.start + 15, Math.min(DAY_MINUTES, end));
            el.style.height = `${Math.max(20, (target.end - target.start) * PPM - 2)}px`;
          } else {
            const colW = r0.width;
            const idx = Math.max(0, Math.min(colNodes.length - 1, Math.floor((pm.clientX - r0.left) / colW)));
            const len = span0.end - span0.start;
            const start = Math.max(0, Math.min(DAY_MINUTES - len, snap((pm.clientY - r0.top) / PPM - grab)));
            target = { date: colNodes[idx].dataset.date, start, end: start + len };
            if (el.parentNode !== colNodes[idx]) colNodes[idx].append(el);
            el.style.top = `${start * PPM}px`;
          }
          el.querySelector('.cal-ev-time').textContent = `${formatTime(minToTime(target.start))} to ${formatTime(minToTime(target.end))}`;
        };
        function onUp(pu) {
          if (pu.pointerId !== pd.pointerId) return;
          clearTimeout(press);
          touchPress = false;
          el.removeEventListener('touchmove', blockScroll);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          if (!moved) return el.classList.remove('dragging');
          // Every path below redraws, which also shows changes that arrived during the drag.
          state.dragging = false;
          // A cancelled gesture (the browser took over the pointer) puts the event back.
          // So does an event deleted elsewhere during the drag (there is nothing to move).
          if (pu.type === 'pointercancel' || !store.get('events', e.id)) return draw();
          // The click that follows a drag must not open the editor.
          justDragged = true;
          setTimeout(() => (justDragged = false), 0);
          if (resizing) commitMove(e, resizeEvent(e, target.end), true);
          else if (target.date !== d || target.start !== span0.start) commitMove(e, moveEvent(e, target.date, target.start), true);
          else draw();
        }
        // Listen on the window: the block moves between day columns while
        // dragged, and the drop must arrive wherever the pointer is released.
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
      // A long press must not open the touch context menu.
      el.addEventListener('contextmenu', (cm) => touchPress && cm.preventDefault());
      el.addEventListener('click', () => {
        if (justDragged) return;
        openEventDialog({ event: e });
      });
    }

    const scroller = h('div.cal-scroll', h('div.cal-grid', { class: days.length > 1 ? 'multi' : 'single' }, h('div.cal-top', head, allday), body));
    main.replaceChildren(scroller);
    const top = state.scrollTop !== null ? state.scrollTop : Math.max(0, ws * PPM - 8);
    // On first render the view is not attached yet, so scrolling must wait a frame.
    if (scroller.isConnected) scroller.scrollTop = top;
    else requestAnimationFrame(() => (scroller.scrollTop = top));
    state.scrollTop = null;
    if (state.focusId) {
      main.querySelector(`.cal-ev[data-id="${CSS.escape(state.focusId)}"]`)?.focus();
      state.focusId = null;
    }
  }

  function commitMove(e, patch, announce) {
    const prev = { date: e.date, start: e.start, end: e.end };
    const scroller = main.querySelector('.cal-scroll');
    if (scroller) state.scrollTop = scroller.scrollTop;
    store.patch('events', e.id, patch);
    const when = `${formatDate(patch.date || e.date, { weekday: 'short', month: 'short', day: 'numeric' })} at ${formatTime(patch.start || e.start)}`;
    // A resize changes only the end time.
    const text = patch.date ? `Moved "${e.title}" to ${when}` : `"${e.title}" now ends at ${formatTime(patch.end)}`;
    if (announce) toast(text, { action: { label: 'Undo', run: () => store.patch('events', e.id, prev) } });
    else live.textContent = text;
  }

  // ---- Month -----------------------------------------------------------------------------

  function drawMonth() {
    const ws = settings().weekStart;
    const grid = monthGrid(state.date, ws);
    const data = collect(grid[0], grid[grid.length - 1]);
    const month = state.date.slice(0, 7);
    const today = todayISO();
    const node = h(
      'div.cal-month',
      h(
        'div.cal-month-head',
        { 'aria-hidden': 'true' },
        grid.slice(0, 7).map((d) => h('div', formatDate(d, { weekday: 'short' }))),
      ),
      h(
        'div.cal-month-grid',
        grid.map((d) => {
          const { timed, allDay } = data.get(d);
          const items = [...allDay, ...timed.map((e) => ({ type: 'event', rec: e }))];
          const shown = items.slice(0, 3);
          const cell = h(
            `div.cal-mcell${d.slice(0, 7) !== month ? '.outside' : ''}${d === today ? '.today' : ''}`,
            { role: 'group', 'aria-label': formatDate(d, { weekday: 'long', month: 'long', day: 'numeric' }) },
            h(
              'button.cal-mday',
              { type: 'button', onClick: () => go(d, 'day'), 'aria-label': `Open ${formatDate(d, { month: 'long', day: 'numeric' })}`, 'aria-current': d === today ? 'date' : null },
              String(Number(d.slice(8))),
            ),
            h(
              'div.cal-mitems',
              shown.map((it) => allDayChip(it, { compact: false })),
              items.length > 3 ? h('button.cal-more', { type: 'button', onClick: () => go(d, 'day') }, `+${items.length - 3} more`) : null,
            ),
          );
          cell.addEventListener('click', (e) => {
            if (e.target === cell || e.target.classList.contains('cal-mitems')) openEventDialog({ date: d });
          });
          return cell;
        }),
      ),
    );
    main.replaceChildren(node);
  }

  // ---- Agenda ------------------------------------------------------------------------------

  function drawAgenda() {
    const [from, to] = viewRange('agenda', state.date);
    const data = collect(from, to);
    const today = todayISO();
    const days = [];
    for (const [d, { timed, allDay }] of data) {
      if (!timed.length && !allDay.length) continue;
      days.push(
        h(
          'section.agenda-day',
          { 'aria-label': formatDate(d, { weekday: 'long', month: 'long', day: 'numeric' }) },
          h('h2.agenda-date', h('span.agenda-dnum', String(Number(d.slice(8)))), h('span', formatDate(d, { weekday: 'long', month: 'long' }), d === today ? h('span.pill.accent', 'Today') : null)),
          h(
            'ul.agenda-list',
            allDay.map((it) => h('li.agenda-row', h('span.agenda-time', 'All day'), agendaItem(it))),
            timed.map((e) => h('li.agenda-row', h('span.agenda-time', `${formatTime(e.start)}${e.end ? ` to ${formatTime(e.end)}` : ''}`), agendaItem({ type: 'event', rec: e }))),
          ),
        ),
      );
    }
    main.replaceChildren(
      h(
        'div.cal-agenda',
        days.length
          ? days
          : emptyState({
              icon: 'calendar',
              title: 'Nothing scheduled',
              text: 'There are no events, task due dates, or limitation dates in the next 30 days.',
              actions: [h('button.btn.primary', { type: 'button', onClick: () => openEventDialog({ date: state.date }) }, icon('plus', 16), 'New event')],
            }),
      ),
    );
  }

  function agendaItem(it) {
    if (it.type === 'event') {
      const e = it.rec;
      const m = e.matterId ? lookup.matter(e.matterId) : null;
      return h(
        'button.agenda-item',
        { type: 'button', ...colorAttrs(eventColor(e)), onClick: () => openEventDialog({ event: e }) },
        h('span.agenda-swatch', { 'aria-hidden': 'true' }),
        h('span.grow', h('span.agenda-title', e.title), h('span.agenda-sub', [KIND_LABEL[e.kind], e.location, m ? matterLabel(m) : ''].filter(Boolean).join(' · '))),
      );
    }
    if (it.type === 'task') {
      const t = it.rec;
      const m = t.matterId ? lookup.matter(t.matterId) : null;
      return h(
        'button.agenda-item.task',
        { type: 'button', onClick: () => openTaskDialog({ task: t }) },
        icon('square-check', 16),
        h('span.grow', h('span.agenda-title', t.name), h('span.agenda-sub', ['Task due', lookup.userName(t.assigneeId), m ? matterLabel(m) : ''].filter(Boolean).join(' · '))),
      );
    }
    const m = it.rec;
    return h('a.agenda-item.sol', { href: `#/matters/${m.id}` }, icon('flag', 16), h('span.grow', h('span.agenda-title', 'Statute of limitations'), h('span.agenda-sub', matterLabel(m))));
  }

  // ---- Sidebar ---------------------------------------------------------------------------------

  function drawSide() {
    const ws = settings().weekStart;
    const mm = state.miniMonth;
    const grid = monthGrid(mm, ws);
    const today = todayISO();
    const [from, to] = viewRange(state.view, state.date, ws);
    const eventDays = groupBy(store.all('events'), 'date');
    const mini = h(
      'div.mini-cal',
      h(
        'div.mini-head',
        h('span.mini-title', formatDate(mm, { month: 'long', year: 'numeric' })),
        h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Previous month', dataset: { key: 'prev' }, onClick: () => ((state.miniMonth = addMonths(mm, -1)), drawSide()) }, icon('chevron-left', 16)),
        h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Next month', dataset: { key: 'next' }, onClick: () => ((state.miniMonth = addMonths(mm, 1)), drawSide()) }, icon('chevron-right', 16)),
      ),
      h(
        'div.mini-grid',
        grid.slice(0, 7).map((d) => h('span.mini-dow', { 'aria-hidden': 'true' }, formatDate(d, { weekday: 'narrow' }))),
        grid.map((d) =>
          h(
            `button.mini-day${d.slice(0, 7) !== mm.slice(0, 7) ? '.outside' : ''}${d === today ? '.today' : ''}${d >= from && d <= to && state.view !== 'agenda' ? '.in-range' : ''}${d === state.date ? '.selected' : ''}${eventDays.has(d) ? '.has-events' : ''}`,
            {
              type: 'button',
              'aria-label': formatDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
              'aria-current': d === state.date ? 'date' : null,
              dataset: { key: d },
              onClick: () => go(d),
            },
            String(Number(d.slice(8))),
          ),
        ),
      ),
    );
    const L = state.layers;
    const set = (fn) => {
      fn(L);
      saveLayers(L);
      draw();
    };
    const users = lookup.activeUsers();
    const me = app.me();
    // Redrawing replaces every control, so put focus back on the one in use.
    const active = side.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active?.dataset.key || (active?.closest('.seg') ? 'seg' : null);
    side.replaceChildren(
      mini,
      h(
        'section.cal-layers',
        h(
          'div.layers-head',
          h('h2', 'My calendars'),
          users.length > 1 ? h('button.link-btn.small', { type: 'button', dataset: { key: 'mine' }, onClick: () => set((l) => users.forEach((u) => (l.users[u.id] = !me || u.id === me.id))) }, 'Only mine') : null,
        ),
        users.map((u) =>
          h(
            'label.layer',
            { style: { '--ev': u.color || colorFor(u.id) } },
            h('input', { type: 'checkbox', checked: userOn(u.id), dataset: { key: `user-${u.id}` }, onChange: (e) => set((l) => (l.users[u.id] = e.target.checked)) }),
            h('span.layer-swatch', { 'aria-hidden': 'true' }),
            h('span.truncate', u.name),
          ),
        ),
        h('div.layer-sep'),
        h(
          'label.layer.tone-warning',
          h('input', { type: 'checkbox', checked: L.tasks !== false, dataset: { key: 'tasks' }, onChange: (e) => set((l) => (l.tasks = e.target.checked)) }),
          icon('square-check', 15),
          h('span', 'Tasks due'),
        ),
        h(
          'label.layer.tone-danger',
          h('input', { type: 'checkbox', checked: L.sol !== false, dataset: { key: 'sol' }, onChange: (e) => set((l) => (l.sol = e.target.checked)) }),
          icon('flag', 15),
          h('span', 'Statute of limitations'),
        ),
      ),
      h(
        'section.cal-layers',
        h('h2', 'Color events by'),
        segmented({
          label: 'Color events by',
          size: 'sm',
          value: L.colorBy,
          items: [
            { value: 'person', label: 'Person' },
            { value: 'type', label: 'Type' },
          ],
          onChange: (v) => set((l) => (l.colorBy = v)),
        }),
        L.colorBy === 'type'
          ? h(
              'ul.kind-legend',
              EVENT_KINDS.map((k) => h(`li.tone-${k.tone}`, h('span.layer-swatch', { 'aria-hidden': 'true' }), k.label)),
            )
          : null,
      ),
    );
    if (focusKey) (focusKey === 'seg' ? side.querySelector('.seg [aria-checked="true"]') : side.querySelector(`[data-key="${CSS.escape(focusKey)}"]`))?.focus();
  }

  // ---- Frame -------------------------------------------------------------------------------------

  const live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });

  function draw() {
    state.dragging = false; // a redraw replaces any block being dragged
    const ws = settings().weekStart;
    titleEl.textContent = viewTitle(state.view, state.date, ws);
    const segFocused = viewSeg.contains(document.activeElement);
    viewSeg.replaceChildren(
      segmented({
        label: 'Calendar view',
        value: state.view,
        items: [
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'agenda', label: 'Agenda' },
        ],
        onChange: (v) => go(state.date, v),
      }),
    );
    if (segFocused) viewSeg.querySelector('[aria-checked="true"]')?.focus();
    if (state.view === 'month') drawMonth();
    else if (state.view === 'agenda') drawAgenda();
    else drawTimeGrid();
    drawSide();
  }

  draw();
  ctx.watch(['events', 'tasks', 'matters', 'users', 'settings'], () => {
    // Replacing the dragged block would release the pointer and lose the drop.
    if (state.dragging) return;
    const sc = main.querySelector('.cal-scroll');
    if (sc && state.scrollTop === null) state.scrollTop = sc.scrollTop;
    draw();
  });
  // Keep the current-time line moving.
  const tick = setInterval(() => {
    const now = main.querySelector('.cal-now');
    if (!now) return;
    const t = new Date();
    if (now.closest('.cal-col')?.dataset.date !== todayISO()) return draw();
    now.style.top = `${(t.getHours() * 60 + t.getMinutes()) * PPM}px`;
  }, 60000);
  ctx.onDispose(() => clearInterval(tick));

  const layout = h('div.cal-layout', h('section.card.cal-card', { 'aria-label': 'Calendar' }, main), side);
  return {
    title: 'Calendar',
    node: h('div.page.cal-page', h('header.cal-header', toolbar), layout, live),
  };
}

function minToTime(min) {
  const m = Math.max(0, Math.min(DAY_MINUTES - 1, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
