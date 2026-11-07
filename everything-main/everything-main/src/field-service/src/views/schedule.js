/**
 * Schedule: day (one column per team member), week, month and list views.
 * Visits, assessments, tasks and events can be dragged to a new time or
 * day; in the day view, dragging across columns reassigns the work.
 */
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { segmented, avatar, emptyState, field, textInput, textarea, select } from '../ui/components.js';
import { openMenu, openPopover } from '../ui/menu.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { setQuery, navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { agendaItems, filterByMembers, setAgendaComplete, moveAgendaItem, agendaHref } from '../core/agenda.js';
import {
  addDays,
  addMonths,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  daysInRange,
  formatDate,
  formatTime,
  formatTimeRange,
  timeToMinutes,
  minutesToTime,
  parseISODate,
  isISODate,
} from '../core/dates.js';
import { clientName, shortAddress, directionsUrl, routeUrl } from '../core/format.js';
import { teamNames, assigneePicker, clientPicker } from './common.js';
import { visitDialog } from './visit-dialog.js';
import { agendaRow } from './home.js';
import { openVisits } from '../core/status.js';
import { layoutOverlaps } from '../core/layout.js';

const HOUR_PX = 52;
const SNAP_MIN = 15;
const VIEWS = ['day', 'week', 'month', 'list'];
const TEAM_KEY = 'fieldservice.scheduleTeam';
const VIEW_KEY = 'fieldservice.scheduleView';
let lastDragEnd = 0;

export function render(ctx) {
  const store = app.store;
  const isPhone = matchMedia('(max-width: 767px)').matches;
  let savedView = null;
  try {
    savedView = localStorage.getItem(VIEW_KEY);
  } catch {}
  const state = {
    view: VIEWS.includes(ctx.query.view) ? ctx.query.view : VIEWS.includes(savedView) ? savedView : isPhone ? 'list' : 'week',
    date: isISODate(ctx.query.date) ? ctx.query.date : app.today(),
    // Only people still on the team: a saved choice of someone since
    // removed would show an empty calendar with nothing ticked.
    team: loadTeamFilter().filter((id) => id === 'unassigned' || (store.get('team', id) && store.get('team', id).active !== false)),
    showUnscheduled: false,
  };

  const toolbar = h('div.sched-toolbar');
  const board = h('div.sched-board');
  const side = h('aside.sched-side', { hidden: true, 'aria-label': 'Unscheduled jobs' });
  const live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });
  let focusAfterDraw = null;

  function persist() {
    setQuery({ view: state.view, date: state.date === app.today() ? '' : state.date });
    try {
      localStorage.setItem(VIEW_KEY, state.view);
      localStorage.setItem(TEAM_KEY, JSON.stringify(state.team));
    } catch {}
  }

  function range() {
    const ws = app.settings().weekStart || 0;
    if (state.view === 'day') return [state.date, state.date];
    if (state.view === 'week') {
      const s = startOfWeek(state.date, ws);
      return [s, addDays(s, 6)];
    }
    if (state.view === 'month') {
      const first = startOfMonth(state.date);
      const s = startOfWeek(first, ws);
      const e = addDays(startOfWeek(endOfMonth(state.date), ws), 6);
      return [s, e];
    }
    return [state.date, addDays(state.date, 29)];
  }

  function shift(dir) {
    const step = { day: 1, week: 7, list: 30 }[state.view];
    state.date = state.view === 'month' ? addMonths(startOfMonth(state.date), dir) : addDays(state.date, dir * step);
    draw();
  }

  function title() {
    const [s, e] = range();
    if (state.view === 'day') return formatDate(state.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (state.view === 'month') return formatDate(state.date, { month: 'long', year: 'numeric' });
    const sameMonth = s.slice(0, 7) === e.slice(0, 7);
    const sameYear = s.slice(0, 4) === e.slice(0, 4);
    if (sameMonth) return `${formatDate(s, { month: 'long', day: 'numeric' })} to ${parseISODate(e).getDate()}, ${e.slice(0, 4)}`;
    if (sameYear) return `${formatDate(s, { month: 'short', day: 'numeric' })} to ${formatDate(e, { month: 'short', day: 'numeric' })}, ${e.slice(0, 4)}`;
    return `${formatDate(s)} to ${formatDate(e)}`;
  }

  /** "Mon, Oct 12", "Oct 11 to 17", "Sep 27 to Oct 3", "Oct 2026": no year but the month's. */
  function shortTitle() {
    const [s, e] = range();
    const md = { month: 'short', day: 'numeric' };
    if (state.view === 'day') return formatDate(state.date, { weekday: 'short', ...md });
    if (state.view === 'month') return formatDate(state.date, { month: 'short', year: 'numeric' });
    return `${formatDate(s, md)} to ${s.slice(0, 7) === e.slice(0, 7) ? parseISODate(e).getDate() : formatDate(e, md)}`;
  }

  // The toolbar is rebuilt on every change; put keyboard focus back on the
  // same control (say, the view switcher after an arrow key).
  const focusKey = (el) => `${el.tagName}|${el.getAttribute('aria-label') || ''}|${el.textContent.trim()}`;
  function drawToolbar() {
    const had = toolbar.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    drawToolbarNow();
    if (had) [...toolbar.querySelectorAll('button, a, input, select')].find((el) => focusKey(el) === had)?.focus();
  }

  function drawToolbarNow() {
    const unscheduled = unscheduledJobs().length;
    const team = store.all('team').filter((m) => m.active !== false);
    const teamLabel = state.team.length ? `${state.team.length} selected` : 'Everyone';
    toolbar.replaceChildren(
      h(
        'div.row.sched-nav',
        h('button.btn.hide-mobile', { type: 'button', onClick: () => ((state.date = app.today()), draw()) }, 'Today'),
        h(
          'div.btn-group',
          h('button.btn.icon-only', { type: 'button', 'aria-label': `Previous ${state.view === 'list' ? '30 days' : state.view}`, onClick: () => shift(-1) }, icon('chevron-left', 18)),
          h('button.btn.icon-only', { type: 'button', 'aria-label': `Next ${state.view === 'list' ? '30 days' : state.view}`, onClick: () => shift(1) }, icon('chevron-right', 18)),
        ),
        // Phones get a shorter title, so the date is not cut off.
        h('h1.sched-title', h('span.hide-mobile', title()), h('span.show-mobile', shortTitle())),
        h('label.sr-only', { for: 'sched-date' }, 'Go to date'),
        h('input.input.sm.sched-date#sched-date', {
          type: 'date',
          value: state.date,
          title: 'Go to date',
          onChange: (e) => {
            if (e.target.value) {
              state.date = e.target.value;
              draw();
            }
          },
        }),
      ),
      h('div.spacer'),
      h(
        'div.row.sched-tools',
        h('button.btn.show-mobile', { type: 'button', onClick: () => ((state.date = app.today()), draw()) }, 'Today'),
        segmented({
          label: 'Calendar view',
          value: state.view,
          items: [
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'list', label: 'List' },
          ],
          onChange: (v) => {
            state.view = v;
            draw();
          },
        }),
        team.length
          ? h(
              'button.btn',
              {
                type: 'button',
                'aria-haspopup': 'dialog',
                'aria-label': `Team filter: ${teamLabel}`,
                onClick: (e) => teamFilterPopover(e.currentTarget),
              },
              icon('users', 16),
              h('span.hide-mobile', teamLabel),
              icon('chevron-down', 14),
            )
          : null,
        h(
          'button.btn',
          {
            type: 'button',
            'aria-pressed': String(state.showUnscheduled),
            'aria-label': `Unscheduled jobs${unscheduled ? `, ${unscheduled}` : ''}`,
            onClick: () => {
              state.showUnscheduled = !state.showUnscheduled;
              draw();
            },
          },
          icon('inbox', 16),
          h('span.hide-mobile', 'Unscheduled'),
          unscheduled ? h('span.tab-count', String(unscheduled)) : null,
        ),
        h(
          'button.btn.primary',
          { type: 'button', 'aria-label': 'New', onClick: (e) => newMenu(e.currentTarget, { date: state.date }) },
          icon('plus', 16),
          h('span.hide-mobile', 'New'),
        ),
      ),
    );
  }

  function teamFilterPopover(anchor) {
    const team = store.all('team').filter((m) => m.active !== false);
    openPopover(
      anchor,
      () =>
        h(
          'div',
          { role: 'group', 'aria-label': 'Show work for' },
          h('div.menu-label', 'Show work for'),
          [...team, { id: 'unassigned', name: 'Unassigned', color: '#8a94a3' }].map((m) =>
            h(
              'label.menu-item',
              h('input', {
                type: 'checkbox',
                checked: !state.team.length || state.team.includes(m.id),
                onChange: (e) => {
                  const all = [...team.map((x) => x.id), 'unassigned'];
                  let sel = state.team.length ? state.team.filter((x) => all.includes(x)) : [...all];
                  sel = e.target.checked ? [...new Set([...sel, m.id])] : sel.filter((x) => x !== m.id);
                  state.team = sel.length === all.length ? [] : sel;
                  persist();
                  drawBoard();
                  drawToolbar();
                },
              }),
              m.id === 'unassigned' ? h('span.avatar.sm.client', icon('user', 12)) : avatar(m.name, { color: m.color, size: 'sm' }),
              h('span.grow', m.name),
            ),
          ),
          h('div.menu-sep'),
          h(
            'button.menu-item',
            {
              type: 'button',
              onClick: () => {
                state.team = [];
                persist();
                drawBoard();
                drawToolbar();
              },
            },
            icon('users', 16),
            'Show everyone',
          ),
        ),
      { label: 'Filter by team member' },
    );
  }

  function items() {
    const [s, e] = range();
    const all = agendaItems(store, { from: s, to: e });
    if (!state.team.includes('unassigned')) return filterByMembers(all, state.team);
    // Unassigned, as in the day view's column: nobody active is on it.
    const active = new Set(store.all('team').filter((m) => m.active !== false).map((m) => m.id));
    const picked = new Set(state.team);
    return all.filter((it) => it.assignees.some((a) => picked.has(a)) || !it.assignees.some((a) => active.has(a)));
  }

  /**
   * The agenda item for a key ("v:job:visit", "a:request", "e:event"),
   * built from its one record rather than the whole calendar. Dated or not:
   * jobs dragged in from the Unscheduled panel have no date yet.
   */
  function findItem(key) {
    const [kind, id] = String(key).split(':');
    const coll = { v: 'jobs', a: 'requests', e: 'events' }[kind];
    const rec = coll ? store.get(coll, id) : null;
    if (!rec) return null;
    return agendaItems({ all: (c) => (c === coll ? [rec] : []) }, { includeUndated: true }).find((x) => x.key === key) || null;
  }

  function unscheduledJobs() {
    return store.all('jobs').filter((j) => !j.archived && !j.closedAt && (j.visits || []).some((v) => !v.date && !v.completedAt));
  }

  // ---- Views --------------------------------------------------------------

  function drawBoard() {
    board.className = `sched-board view-${state.view}`;
    if (state.view === 'list') board.replaceChildren(listView());
    else if (state.view === 'month') board.replaceChildren(monthView());
    else board.replaceChildren(timeGrid());
    drawSide();
  }

  function listView() {
    const all = items();
    if (!all.length) return h('section.card', emptyState({ icon: 'calendar-check', title: 'Nothing scheduled', text: 'No visits, assessments, tasks or events in the next 30 days.', headingLevel: 2 }));
    const byDate = new Map();
    for (const it of all) {
      if (!byDate.has(it.date)) byDate.set(it.date, []);
      byDate.get(it.date).push(it);
    }
    return h(
      'div.stack',
      [...byDate].map(([date, list]) =>
        h(
          'section.card',
          { 'aria-label': formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' }) },
          h(
            'div.card-head',
            h('h2.grow', formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' }), date === app.today() ? h('span.pill.accent.plain', { style: { marginLeft: '8px' } }, 'Today') : null),
            h('span.subtle', `${list.filter((i) => i.completed).length} of ${list.length} done`),
          ),
          h('div.card-body.flush', h('ul.list.agenda-list', list.map((it) => h('li', { dataset: { key: it.key } }, agendaRow(it))))),
        ),
      ),
    );
  }

  function monthView() {
    const [s, e] = range();
    const days = daysInRange(s, e);
    const all = items();
    const byDate = new Map();
    for (const it of all) {
      if (!byDate.has(it.date)) byDate.set(it.date, []);
      byDate.get(it.date).push(it);
    }
    const month = state.date.slice(0, 7);
    const ws = app.settings().weekStart || 0;
    const heads = Array.from({ length: 7 }, (_, i) => formatDate(addDays('2026-10-11', (i + ws) % 7), { weekday: 'short' }));
    // A table, not a grid: each day's buttons are reached with Tab, and a
    // grid would promise arrow-key moves between cells that it lacks.
    const grid = h(
      'div.month-grid',
      { role: 'table', 'aria-label': formatDate(state.date, { month: 'long', year: 'numeric' }) },
      h('div.month-head', { role: 'row' }, heads.map((d) => h('div', { role: 'columnheader' }, d))),
    );
    for (let w = 0; w < days.length / 7; w++) {
      const row = h('div.month-row', { role: 'row' });
      for (const d of days.slice(w * 7, w * 7 + 7)) {
        const list = byDate.get(d) || [];
        const cell = h(
          `div.month-cell${d.slice(0, 7) !== month ? '.other' : ''}${d === app.today() ? '.today' : ''}`,
          { role: 'cell', dataset: { date: d } },
          h(
            'button.month-day',
            {
              type: 'button',
              'aria-label': `${formatDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}, ${list.length} item${list.length === 1 ? '' : 's'}`,
              onClick: () => {
                state.date = d;
                state.view = 'day';
                draw();
              },
            },
            String(parseISODate(d).getDate()),
          ),
          list.slice(0, 3).map((it) => chip(it, { compact: true })),
          list.length > 3
            ? h(
                'button.month-more',
                {
                  type: 'button',
                  onClick: () => {
                    state.date = d;
                    state.view = 'day';
                    draw();
                  },
                },
                `${list.length - 3} more`,
              )
            : null,
        );
        cell.addEventListener('dblclick', (e) => {
          if (e.target === cell) newMenu(cell, { date: d });
        });
        enableDrop(cell, { date: d });
        row.append(cell);
      }
      grid.append(row);
    }
    return h('section.card.month-card', grid);
  }

  /** Day and week views: a vertical time grid. */
  function timeGrid() {
    const [s, e] = range();
    const days = daysInRange(s, e);
    const all = items();
    const wd = app.settings().workday || { start: '07:00', end: '18:00' };
    let startH = Math.min(6, Math.floor((timeToMinutes(wd.start) ?? 420) / 60));
    let endH = Math.max(20, Math.ceil((timeToMinutes(wd.end) ?? 1080) / 60));
    for (const it of all) {
      if (!it.start) continue;
      startH = Math.min(startH, Math.floor(timeToMinutes(it.start) / 60));
      // Its drawn end: an item with no end time takes an hour.
      endH = Math.max(endH, Math.ceil((timeToMinutes(it.start) + itemLength(it)) / 60));
    }
    endH = Math.min(24, endH);

    // Columns: one per day (week) or one per team member (day).
    let columns;
    if (state.view === 'day') {
      const team = store.all('team').filter((m) => m.active !== false && (!state.team.length || state.team.includes(m.id)));
      columns = team.map((m) => ({ key: m.id, date: state.date, member: m, label: m.name, items: all.filter((it) => it.assignees.includes(m.id)) }));
      // Work with nobody active on it (assignees removed or made inactive) has no column of its own.
      const activeIds = new Set(store.all('team').filter((m) => m.active !== false).map((m) => m.id));
      const unassigned = all.filter((it) => !it.assignees.some((a) => activeIds.has(a)));
      if (!state.team.length || state.team.includes('unassigned')) columns.push({ key: 'unassigned', date: state.date, member: null, label: 'Unassigned', items: unassigned });
      if (!columns.length) columns = [{ key: 'all', date: state.date, member: null, label: 'Everyone', items: all }];
    } else {
      columns = days.map((d) => ({ key: d, date: d, label: d, items: all.filter((it) => it.date === d) }));
    }

    const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
    const height = hours.length * HOUR_PX;
    const today = app.today();

    const head = h(
      'div.tg-head',
      h('div.tg-gutter'),
      columns.map((c) =>
        state.view === 'day'
          ? h(
              'div.tg-colhead',
              c.member ? avatar(c.member.name, { color: c.member.color, size: 'sm' }) : h('span.avatar.sm.client', icon('user', 12)),
              h('span.truncate', c.label),
              h('span.subtle.tg-count', String(c.items.length)),
              routeLink(c),
            )
          : h(
              `button.tg-colhead.day${c.date === today ? '.today' : ''}`,
              {
                type: 'button',
                'aria-label': `Open ${formatDate(c.date, { weekday: 'long', month: 'long', day: 'numeric' })} in day view`,
                onClick: () => {
                  state.date = c.date;
                  state.view = 'day';
                  draw();
                },
              },
              h('span.tg-dow', formatDate(c.date, { weekday: 'short' })),
              h('span.tg-dom', String(parseISODate(c.date).getDate())),
            ),
      ),
    );

    // "Anytime" row for items with no time.
    const anyRow = h(
      'div.tg-anytime',
      h('div.tg-gutter.tg-any-label', 'Anytime'),
      columns.map((c) => {
        const cell = h('div.tg-any-cell', { dataset: state.view === 'day' ? { member: c.member?.id || '' } : {} }, c.items.filter((it) => !it.start).map((it) => chip(it, { compact: true })));
        enableDrop(cell, { date: c.date, member: c.member, anytime: true });
        return cell;
      }),
    );

    const gutter = h(
      'div.tg-gutter.tg-times',
      { style: { height: `${height}px` } },
      hours.map((hr) => h('div.tg-hour-label', { style: { top: `${(hr - startH) * HOUR_PX}px` } }, hr === 0 ? '' : formatTime(`${String(hr).padStart(2, '0')}:00`).replace(':00', ''))),
    );

    const cols = columns.map((c) => {
      const col = h(`div.tg-col${c.date === today && state.view === 'week' ? '.today' : ''}`, {
        style: { height: `${height}px` },
        dataset: { date: c.date, member: c.member?.id || '' },
      });
      // Work hours shading.
      const ws = ((timeToMinutes(wd.start) ?? 420) / 60 - startH) * HOUR_PX;
      const we = ((timeToMinutes(wd.end) ?? 1080) / 60 - startH) * HOUR_PX;
      col.append(h('div.tg-offhours', { style: { top: '0', height: `${Math.max(0, ws)}px` } }), h('div.tg-offhours', { style: { top: `${we}px`, bottom: '0' } }));
      const timed = c.items.filter((it) => it.start);
      for (const { it, left, width } of layoutOverlaps(timed)) {
        const top = ((timeToMinutes(it.start) - startH * 60) / 60) * HOUR_PX;
        const endMin = it.end ? timeToMinutes(it.end) : timeToMinutes(it.start) + 60;
        const hgt = Math.max(22, ((endMin - timeToMinutes(it.start)) / 60) * HOUR_PX - 2);
        const node = chip(it, { block: true });
        node.style.top = `${top}px`;
        node.style.height = `${hgt}px`;
        node.style.left = `calc(${left * 100}% + 2px)`;
        node.style.width = `calc(${width * 100}% - 4px)`;
        enableDrag(node, it, { startH, colEl: col });
        col.append(node);
      }
      // Click on empty space to create at that time.
      col.addEventListener('click', (e) => {
        if (performance.now() - lastDragEnd < 400) return;
        if (e.target !== col && !e.target.classList.contains('tg-offhours')) return;
        const y = e.clientY - col.getBoundingClientRect().top;
        const min = Math.floor(((y / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN + startH * 60;
        newMenu(e.target, { date: c.date, time: minutesToTime(min), member: c.member?.id }, e);
      });
      return col;
    });

    // Now line.
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const nowTop = ((nowMin - startH * 60) / 60) * HOUR_PX;
    cols.forEach((col, i) => {
      if (columns[i].date === today && nowTop >= 0 && nowTop <= height) col.append(h('div.tg-now', { style: { top: `${nowTop}px` }, 'aria-hidden': 'true' }));
    });

    const body = h('div.tg-body', { dataset: { startH: String(startH) } }, gutter, cols);
    const wrap = h(
      `section.card.tg${state.view === 'day' ? '.tg-day' : ''}`,
      { style: { '--cols': String(columns.length) } },
      h('div.tg-scroll', head, anyRow, body),
    );
    // Scroll to the start of the workday (or now) once mounted.
    requestAnimationFrame(() => {
      const scroller = wrap.querySelector('.tg-scroll');
      if (!scroller) return;
      // Show the first item of the day (or the workday start), whichever is earlier.
      const firstMin = Math.min(timeToMinutes(wd.start) ?? 420, ...all.filter((x) => x.start).map((x) => timeToMinutes(x.start)));
      const target = Math.max(0, ((firstMin / 60) - startH - 0.25) * HOUR_PX);
      scroller.scrollTop = target;
    });
    return wrap;
  }

  /** Driving route through one person's stops for the day, in time order. */
  function routeLink(c) {
    const props = c.items
      .filter((it) => it.start && !it.completed)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((it) => lookup.property(lookup.client(it.clientId), it.propertyId))
      .filter(Boolean);
    const url = routeUrl(props, app.settings().company.address || '');
    return url ? h('a.icon-btn.sm', { href: url, target: '_blank', rel: 'noopener noreferrer', title: `Route for ${c.label}`, 'aria-label': `Driving route for ${c.label}, ${props.length} stops` }, icon('route', 15)) : null;
  }

  // ---- Chips (calendar items) ----------------------------------------------

  function chip(it, { compact = false, block = false } = {}) {
    const member = lookup.member(it.assignees[0]);
    const color = member?.color || '#7b8594';
    const client = lookup.client(it.clientId);
    // The week's day headings sit apart from the items, so say the day.
    const day = state.view === 'week' ? `${formatDate(it.date, { weekday: 'long', month: 'long', day: 'numeric' })}, ` : '';
    const label = `${it.title}${client ? `, ${clientName(client)}` : ''}, ${day}${it.start ? formatTimeRange(it.start, it.end) : 'anytime'}${it.completed ? ', completed' : ''}`;
    const node = h(
      `button.chip-item${block ? '.block' : ''}${compact ? '.compact' : ''}${it.completed ? '.done' : ''}`,
      {
        type: 'button',
        style: { '--c': color },
        'aria-label': label,
        dataset: { kind: it.kind, key: it.key },
        onClick: (e) => {
          e.stopPropagation();
          if (node.dataset.dragged) {
            delete node.dataset.dragged;
            return;
          }
          itemPopover(node, it);
        },
      },
      it.completed ? icon('circle-check', 13) : it.kind === 'task' ? icon('square', 12) : null,
      h(
        'span.chip-text',
        block && it.start ? h('span.chip-time', formatTime(it.start)) : compact && it.start ? h('span.chip-time', formatTime(it.start).replace(':00', '')) : null,
        h('span.chip-title', it.title),
        block && client ? h('span.chip-sub', clientName(client)) : null,
        block && it.assignees.length > 1 ? h('span.chip-sub', teamNames(it.assignees)) : null,
      ),
    );
    if (!block) {
      // Compact chips (month, anytime) can be dragged between days.
      node.draggable = true;
      node.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-agenda', it.key);
        // In the day view, whose column it leaves ('' for Unassigned).
        const from = node.closest('[data-member]')?.dataset.member;
        if (from !== undefined) e.dataTransfer.setData('text/x-agenda-from', from);
        e.dataTransfer.effectAllowed = 'move';
      });
    }
    return node;
  }

  function enableDrop(cell, target) {
    cell.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('text/x-agenda')) return;
      e.preventDefault();
      cell.classList.add('drop-target');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('drop-target');
      const key = e.dataTransfer.getData('text/x-agenda');
      // Undated too: jobs dragged in from the Unscheduled panel.
      const it = findItem(key);
      if (!it) return;
      const changes = { date: target.date };
      if (target.anytime) Object.assign(changes, { start: '', end: '' });
      // Dropping on a day (month view, anytime row) changes the date only,
      // and in the day view hands the item to that column's person.
      moveWithUndo(it, changes, state.view === 'day' && target.member !== undefined ? memberSwap(e, target.member?.id || '') : undefined);
    });
  }

  const DAY_MIN = 24 * 60;
  /** Minutes an item lasts (an hour when it has no end). 23:59 is the end of the day. */
  const itemLength = (it) => Math.max(SNAP_MIN, (it.end === '23:59' ? DAY_MIN : (timeToMinutes(it.end) ?? timeToMinutes(it.start) + 60)) - timeToMinutes(it.start));

  /** Pointer drag for timed blocks: move (body) or resize (bottom edge). */
  function enableDrag(node, it, { startH, colEl }) {
    const handle = h('span.chip-resize', { 'aria-hidden': 'true' });
    node.append(handle);
    // While a touch drag is under way, the finger must not scroll the page.
    let holding = false;
    node.addEventListener('touchmove', (e) => holding && e.cancelable && e.preventDefault(), { passive: false });
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const resizing = e.target === handle;
      // Where a swipe scrolls the grid (touch, pen), a drag starts only after
      // a press and hold, so swiping across a block scrolls instead of moving it.
      let ready = e.pointerType === 'mouse' || getComputedStyle(node).touchAction === 'none';
      const holdTimer = ready
        ? 0
        : setTimeout(() => {
            ready = holding = true;
            node.classList.add('dragging');
          }, 350);
      const startY = e.clientY;
      const startX = e.clientX;
      const origTop = parseFloat(node.style.top);
      const origH = parseFloat(node.style.height);
      let moved = false;
      let done = false;
      let target = { col: colEl, date: it.date, member: colEl.dataset.member };
      const cols = [...board.querySelectorAll('.tg-col')];
      // Capture right away so a release anywhere ends the gesture.
      try {
        node.setPointerCapture(e.pointerId);
      } catch {}
      // The grid can scroll mid-drag (wheel, or the edge scrolling below):
      // count that too, so the block stays under the pointer.
      const scroller = node.closest('.tg-scroll');
      const scroll0 = scroller?.scrollTop || 0;
      let last = null;
      let edgeFrame = 0;
      const place = () => {
        const dy = last.y - startY + (scroller?.scrollTop || 0) - scroll0;
        const snap = (SNAP_MIN / 60) * HOUR_PX;
        if (resizing) {
          node.style.height = `${Math.max(snap, Math.round((origH + dy) / snap) * snap)}px`;
          return;
        }
        node.style.top = `${Math.max(0, Math.round((origTop + dy) / snap) * snap)}px`;
        const over = cols.find((c) => {
          const r = c.getBoundingClientRect();
          return last.x >= r.left && last.x < r.right;
        });
        if (over && over !== target.col) {
          target = { col: over, date: over.dataset.date, member: over.dataset.member };
          node.style.transform = `translateX(${over.getBoundingClientRect().left - colEl.getBoundingClientRect().left}px)`;
        }
      };
      // Held near the top or bottom of the grid: scroll it, faster the closer.
      const edgeScroll = () => {
        edgeFrame = requestAnimationFrame(edgeScroll);
        const r = scroller.getBoundingClientRect();
        if (!r.height) return;
        const top = scroller.querySelector('.tg-anytime')?.getBoundingClientRect().bottom ?? r.top;
        const zone = 40;
        const step = last.y < top + zone ? -(top + zone - last.y) : last.y > r.bottom - zone ? last.y - (r.bottom - zone) : 0;
        if (step) scroller.scrollTop += Math.max(-zone, Math.min(zone, step)) / 3;
      };
      const onScroll = () => moved && place();
      const onMove = (ev) => {
        last = { x: ev.clientX, y: ev.clientY };
        if (!ready) {
          // Moving before the hold is a swipe: leave it to the browser.
          if (Math.abs(ev.clientY - startY) >= 8 || Math.abs(ev.clientX - startX) >= 8) onUp({ type: 'pointercancel' });
          return;
        }
        if (!moved && Math.abs(ev.clientY - startY) < 4 && Math.abs(ev.clientX - startX) < 4) return;
        if (!moved) {
          moved = true;
          node.classList.add('dragging');
          if (scroller) {
            scroller.addEventListener('scroll', onScroll);
            edgeScroll();
          }
        }
        place();
      };
      const onUp = (ev) => {
        if (done) return;
        done = true;
        clearTimeout(holdTimer);
        holding = false;
        cancelAnimationFrame(edgeFrame);
        scroller?.removeEventListener('scroll', onScroll);
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', onUp);
        node.removeEventListener('pointercancel', onUp);
        node.removeEventListener('lostpointercapture', onUp);
        if (!moved || ev?.type === 'pointercancel') {
          if (moved) draw();
          else node.classList.remove('dragging');
          return;
        }
        lastDragEnd = performance.now();
        node.dataset.dragged = '1';
        node.classList.remove('dragging');
        const lenMin = Math.round(((parseFloat(node.style.height) + 2) / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;
        const len = itemLength(it);
        // Keep the whole item inside the day so it keeps its length.
        const topMin = Math.min(Math.round(((parseFloat(node.style.top) / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN + startH * 60, DAY_MIN - len);
        const changes = resizing
          ? { date: it.date, start: it.start, end: minutesToTime(timeToMinutes(it.start) + Math.max(SNAP_MIN, lenMin)) }
          : { date: target.date, start: minutesToTime(topMin), end: minutesToTime(topMin + len) };
        const memberChanged = state.view === 'day' && !resizing && target.member !== colEl.dataset.member;
        // Let go where it started (a nudge while clicking): nothing to save.
        if (!memberChanged && (resizing ? changes.end === it.end : changes.date === it.date && changes.start === it.start)) {
          Object.assign(node.style, { top: `${origTop}px`, height: `${origH}px`, transform: '' });
          return;
        }
        moveWithUndo(it, changes, memberChanged ? { from: colEl.dataset.member, to: target.member } : undefined);
      };
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
      node.addEventListener('pointercancel', onUp);
      node.addEventListener('lostpointercapture', onUp);
    });
    // Keyboard: Alt+Arrow moves by 15 minutes or a day.
    node.addEventListener('keydown', (e) => {
      if (!e.altKey) return;
      let changes = null;
      const len = itemLength(it);
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const from = timeToMinutes(it.start);
        // Stop at either end of the day rather than squeezing the item.
        const s = Math.min(Math.max(0, from + (e.key === 'ArrowUp' ? -SNAP_MIN : SNAP_MIN)), DAY_MIN - len);
        if (s === from) return e.preventDefault();
        changes = { date: it.date, start: minutesToTime(s), end: minutesToTime(s + len) };
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        changes = { date: addDays(it.date, e.key === 'ArrowLeft' ? -1 : 1) };
      }
      if (changes) {
        e.preventDefault();
        // Moved past the days on show: go along with it, keeping it focused.
        const [from, to] = range();
        if (changes.date < from || changes.date > to) {
          state.date = changes.date;
          persist();
        }
        focusAfterDraw = it.key;
        moveAgendaItem(store, it, changes);
        live.textContent = `Moved to ${formatDate(changes.date)} ${changes.start ? formatTime(changes.start) : ''}`;
      }
    });
  }

  /** The hand-over for a day-view drop: from the column it came from (if any) to this one. */
  function memberSwap(e, to) {
    const from = [...e.dataTransfer.types].includes('text/x-agenda-from') ? e.dataTransfer.getData('text/x-agenda-from') : '';
    return from === to ? undefined : { from, to };
  }

  /**
   * Move an item, optionally handing it from one person to another
   * (swap: { from, to } member ids; '' means the Unassigned column).
   * Other people on the visit stay assigned.
   */
  function moveWithUndo(it, changes, swap) {
    const before = { date: it.date, start: it.start, end: it.end };
    const beforeAssignees = [...it.assignees];
    moveAgendaItem(store, it, changes);
    let toName = '';
    if (swap) {
      const ids = it.assignees.filter((a) => a !== swap.from);
      if (swap.to && !ids.includes(swap.to)) ids.push(swap.to);
      reassign(it, ids);
      toName = swap.to ? lookup.member(swap.to)?.name || '' : 'unassigned';
    }
    const when = `${formatDate(changes.date, { weekday: 'short', month: 'short', day: 'numeric' })}${changes.start ? ' at ' + formatTime(changes.start) : ''}`;
    toast(`Moved to ${when}${toName ? `, ${toName}` : ''}`, {
      action: {
        label: 'Undo',
        run: () => {
          const moved = findItem(it.key);
          if (moved) {
            moveAgendaItem(store, moved, before);
            if (swap) reassign(moved, beforeAssignees);
          }
        },
      },
    });
  }

  function reassign(it, ids) {
    if (it.kind === 'visit') store.patch('jobs', it.jobId, (j) => ((j.visits = j.visits.map((v) => (v.id === it.visitId ? { ...v, assignees: ids } : v))), j));
    else if (it.kind === 'assessment') store.patch('requests', it.requestId, (r) => ((r.assessment = { ...r.assessment, assignees: ids }), r));
    else store.patch('events', it.eventId, { assignees: ids });
  }

  function itemPopover(anchor, it) {
    const client = lookup.client(it.clientId);
    const property = client ? lookup.property(client, it.propertyId) : null;
    const href = agendaHref(it);
    const dir = directionsUrl(property);
    const kindLabel = { visit: 'Visit', assessment: 'Assessment', task: 'Task', event: 'Event' }[it.kind];
    openPopover(
      anchor,
      ({ close }) =>
        h(
          'div.item-pop',
          h('div.item-pop-kind', kindLabel, it.number ? ` · Job #${it.number}` : ''),
          h('div.item-pop-title', it.title),
          h(
            'div.item-pop-meta',
            h('div.row', icon('clock', 15), `${formatDate(it.date, { weekday: 'short', month: 'short', day: 'numeric' })}, ${formatTimeRange(it.start, it.end)}`),
            client ? h('div.row', icon('user', 15), h('a', { href: `#/clients/${client.id}`, onClick: () => close() }, clientName(client))) : null,
            property ? h('div.row', icon('pin', 15), h('span.truncate', shortAddress(property)), dir ? h('a', { href: dir, target: '_blank', rel: 'noopener noreferrer' }, 'Directions') : null) : null,
            h('div.row', icon('users', 15), teamNames(it.assignees)),
          ),
          h(
            'div.row.item-pop-actions',
            h(
              `button.btn.sm${it.completed ? '' : '.primary'}`,
              {
                type: 'button',
                onClick: () => {
                  // Back to the item once the schedule redraws.
                  focusAfterDraw = it.key;
                  setAgendaComplete(store, it, !it.completed);
                  close();
                  toast(it.completed ? 'Marked not done' : 'Marked complete');
                },
              },
              icon(it.completed ? 'undo' : 'check', 14),
              it.completed ? 'Not done' : 'Complete',
            ),
            // Focus the item first: the dialog hands focus back to it when it closes.
            it.kind === 'visit' ? h('button.btn.sm', { type: 'button', onClick: () => (close(), anchor.focus(), visitDialog(it.jobId, it.visitId)) }, icon('pencil', 14), 'Edit') : null,
            it.kind === 'task' || it.kind === 'event' ? h('button.btn.sm', { type: 'button', onClick: () => (close(), anchor.focus(), eventDialog({ eventId: it.eventId })) }, icon('pencil', 14), 'Edit') : null,
            href ? h('a.btn.sm', { href, onClick: () => close() }, it.kind === 'visit' ? 'Open job' : 'Open request') : null,
          ),
        ),
      { label: it.title, width: 320 },
    );
  }

  function drawSide() {
    side.hidden = !state.showUnscheduled;
    board.parentElement?.classList.toggle('with-side', state.showUnscheduled);
    if (!state.showUnscheduled) return;
    const jobs = unscheduledJobs();
    side.replaceChildren(
      h(
        'section.card',
        h('div.card-head', h('h2.grow', 'Unscheduled', h('span.count', ` ${jobs.length}`)), h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Close unscheduled list', onClick: () => ((state.showUnscheduled = false), draw()) }, icon('x', 16))),
        h(
          'div.card-body.flush',
          jobs.length
            ? h(
                'ul.list',
                jobs.map((j) => {
                  const v = j.visits.find((x) => !x.date && !x.completedAt);
                  const li = h(
                    'li',
                    h(
                      'div.list-item.unsched-item',
                      { draggable: 'true', title: 'Drag onto the calendar to schedule' },
                      icon('grip', 16, 'subtle'),
                      h('div.grow', { style: { minWidth: '0' } }, h('a.title.truncate', { href: `#/jobs/${j.id}`, style: { display: 'block', color: 'var(--text)' } }, `#${j.number} ${j.title || 'Untitled'}`), h('div.meta.truncate', clientName(lookup.client(j.clientId)))),
                      h('button.btn.sm', { type: 'button', onClick: () => visitDialog(j.id, v.id, { date: state.date }) }, 'Schedule'),
                    ),
                  );
                  li.firstChild.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/x-agenda', `v:${j.id}:${v.id}`);
                    e.dataTransfer.effectAllowed = 'move';
                  });
                  return li;
                }),
              )
            : h('div.section-empty', 'Every job has a date.'),
        ),
      ),
    );
  }

  function draw() {
    persist();
    drawToolbar();
    drawBoard();
    live.textContent = `Showing ${state.view} view, ${title()}`;
  }

  // Drop targets for unscheduled jobs in time grids: drop onto a column.
  board.addEventListener('dragover', (e) => {
    const col = e.target.closest?.('.tg-col');
    if (!col || ![...e.dataTransfer.types].includes('text/x-agenda')) return;
    e.preventDefault();
    col.classList.add('drop-target');
  });
  board.addEventListener('dragleave', (e) => e.target.closest?.('.tg-col')?.classList.remove('drop-target'));
  board.addEventListener('drop', (e) => {
    const col = e.target.closest?.('.tg-col');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('drop-target');
    const key = e.dataTransfer.getData('text/x-agenda');
    const it = findItem(key);
    if (!it) return;
    const y = e.clientY - col.getBoundingClientRect().top;
    const startH = Number(col.closest('.tg-body')?.dataset.startH ?? 6);
    const len = it.start ? itemLength(it) : 60;
    // Keep the whole item inside the day so it keeps its length.
    const min = Math.min(Math.floor(((y / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN + startH * 60, DAY_MIN - len);
    moveWithUndo(it, { date: col.dataset.date, start: minutesToTime(min), end: minutesToTime(min + len) }, state.view === 'day' ? memberSwap(e, col.dataset.member || '') : undefined);
  });

  /** Redraw in place for a change: same scroll position, same focused item. */
  function refresh() {
    const scroller = board.querySelector('.tg-scroll');
    const top = scroller?.scrollTop;
    // Redrawing replaces every item: keep keyboard focus on the same one.
    const el = board.contains(document.activeElement) ? document.activeElement : null;
    const holder = el?.closest('[data-key]');
    const key = focusAfterDraw || holder?.dataset.key;
    // Which control within the item (a list row has a link and a checkbox).
    const controls = (node) => [...node.querySelectorAll('a, button, input')];
    const at = holder && holder !== el ? controls(holder).indexOf(el) : -1;
    const other = !key && el ? focusKey(el) : null;
    focusAfterDraw = null;
    drawToolbar();
    drawBoard();
    if (key) {
      const item = [...board.querySelectorAll('[data-key]')].find((x) => x.dataset.key === key);
      (item && at >= 0 ? controls(item)[at] : item)?.focus();
    } else if (other) [...board.querySelectorAll('button, a, input')].find((x) => focusKey(x) === other)?.focus();
    if (top !== undefined) requestAnimationFrame(() => board.querySelector('.tg-scroll') && (board.querySelector('.tg-scroll').scrollTop = top));
  }

  const unsub = store.subscribe((c) => {
    if (['jobs', 'requests', 'events', 'team', 'clients', 'settings'].some((k) => c.has(k))) refresh();
  });
  ctx.onDispose(unsub);

  // Left open, the page keeps the now line moving and today current.
  let shownToday = app.today();
  const clock = setInterval(() => {
    const today = app.today();
    if (today !== shownToday) {
      if (state.date === shownToday) state.date = today;
      shownToday = today;
      return refresh();
    }
    const body = board.querySelector('.tg-body');
    if (!body) return;
    const now = new Date();
    const top = ((now.getHours() * 60 + now.getMinutes() - Number(body.dataset.startH) * 60) / 60) * HOUR_PX;
    for (const line of body.querySelectorAll('.tg-now')) {
      line.style.top = `${top}px`;
      line.hidden = top > parseFloat(line.parentElement.style.height);
    }
  }, 60000);
  ctx.onDispose(() => clearInterval(clock));

  draw();
  return { node: h('div.page.full.schedule-page', toolbar, h('div.sched-layout', board, side), live), title: 'Schedule' };
}

function loadTeamFilter() {
  try {
    const v = JSON.parse(localStorage.getItem(TEAM_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** "New" menu on the schedule and the global create menu. */
function newMenu(anchor, { date, time, member } = {}) {
  const q = new URLSearchParams();
  if (date) q.set('date', date);
  if (time) q.set('time', time);
  if (member && member !== 'unassigned') q.set('member', member);
  const label = date ? `${formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}${time ? ' at ' + formatTime(time) : ''}` : '';
  openMenu(anchor, [
    label ? { heading: label } : null,
    { label: 'Job', icon: 'hammer', run: () => navigate(`/jobs/new?${q}`) },
    { label: 'Task', icon: 'square-check', run: () => eventDialog({ kind: 'task', date, time, member }) },
    { label: 'Calendar event', icon: 'calendar-plus', run: () => eventDialog({ kind: 'event', date, time, member }) },
    { label: 'Request with assessment', icon: 'inbox', run: () => navigate('/requests/new') },
  ]);
}

/** Create or edit a task or calendar event. */
export function eventDialog({ eventId = null, kind = 'task', date, time, member, clientId = null } = {}) {
  const store = app.store;
  const existing = eventId ? store.get('events', eventId) : null;
  const ev = existing
    ? structuredClone(existing)
    : {
        kind,
        title: '',
        date: date || app.today(),
        start: time || (kind === 'event' ? '09:00' : ''),
        end: time ? minutesToTime(timeToMinutes(time) + 60) : kind === 'event' ? '10:00' : '',
        assignees: member && member !== 'unassigned' ? [member] : [],
        clientId,
        notes: '',
        completedAt: null,
      };
  const titleInput = textInput({ value: ev.title, placeholder: ev.kind === 'task' ? 'e.g. Order materials' : 'e.g. Team meeting', required: true });
  const kindSel = select({ value: ev.kind, options: [{ value: 'task', label: 'Task' }, { value: 'event', label: 'Calendar event' }] });
  const dateIn = textInput({ type: 'date', value: ev.date || '' });
  const anytime = h('input', { type: 'checkbox', checked: !ev.start });
  const start = textInput({ type: 'time', value: ev.start || '09:00', step: 900, disabled: !ev.start || null });
  const end = textInput({ type: 'time', value: ev.end || '10:00', step: 900, disabled: !ev.start || null });
  anytime.addEventListener('change', () => (start.disabled = end.disabled = anytime.checked));
  const notes = textarea({ value: ev.notes || '', rows: 3 });
  const team = assigneePicker(ev.assignees, () => {});
  let cid = ev.clientId;
  const picker = clientPicker({ value: cid, onChange: (c) => (cid = c?.id || null) });
  const done = h('input', { type: 'checkbox', checked: !!ev.completedAt });

  openDialog({
    title: existing ? `Edit ${ev.kind === 'task' ? 'task' : 'event'}` : ev.kind === 'task' ? 'New task' : 'New calendar event',
    body: h(
      'div.stack',
      h('div.form-grid', field('Title', titleInput, { span2: true }), field('Type', kindSel), field('Date', dateIn)),
      h('label.check', anytime, 'Anytime (no set time)'),
      h('div.form-grid', field('Start', start), field('End', end)),
      h('div.field', h('span.field-label', 'Assigned to'), team),
      h('div.field', h('span.field-label', 'Client (optional)'), picker),
      field('Notes', notes),
      existing ? h('label.check', done, 'Completed') : null,
    ),
    footer: ({ close }) => [
      existing
        ? h(
            'button.btn.ghost.subtle-danger',
            {
              type: 'button',
              onClick: async () => {
                close();
                if (!(await confirmDialog({ title: 'Delete this item?', message: `"${existing.title}" will be removed from the schedule.`, confirmLabel: 'Delete', danger: true }))) return;
                const removed = store.remove('events', existing.id);
                toast('Deleted', { action: { label: 'Undo', run: () => store.restore('events', removed) } });
              },
            },
            'Delete',
          )
        : null,
      h('div.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            if (!titleInput.value.trim()) {
              titleInput.setAttribute('aria-invalid', 'true');
              titleInput.focus();
              return;
            }
            if (!dateIn.value) {
              dateIn.setAttribute('aria-invalid', 'true');
              dateIn.focus();
              toast('Pick a date.', { type: 'error' });
              return;
            }
            if (!anytime.checked && start.value && end.value && end.value <= start.value) {
              end.setAttribute('aria-invalid', 'true');
              end.focus();
              toast('The end time must be after the start time.', { type: 'error' });
              return;
            }
            store.put('events', {
              ...ev,
              kind: kindSel.value,
              title: titleInput.value.trim(),
              date: dateIn.value,
              start: anytime.checked ? '' : start.value,
              end: anytime.checked ? '' : end.value,
              notes: notes.value,
              clientId: cid,
              completedAt: existing ? (done.checked ? ev.completedAt || new Date().toISOString() : null) : null,
            });
            toast(existing ? 'Saved' : `${kindSel.value === 'task' ? 'Task' : 'Event'} added to the schedule`);
            close();
          },
        },
        existing ? 'Save' : 'Add to schedule',
      ),
    ],
  });
}

export { openVisits, uniqueId };
