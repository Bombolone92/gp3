/**
 * Calendar: records on a month grid by a date field (spanning to an end
 * date when set). Drag records to another day, add records on a day, and
 * see records that have no date yet.
 */
import { h, announce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { accentColor } from '../lib/colors.js';
import { toDate, shownDate, dateKey, monthName, WEEKDAYS, addDays, addValueDays, addMonths, fromDate, isDateOnly, daysBetween, startOfDay } from '../lib/format.js';
import { runView, searchView } from '../data/query.js';
import { isReadOnly } from '../data/fields.js';
import { cardColorFn } from './cards.js';
import { enableCardDrag } from './drag.js';
import { openPopover } from '../ui/popover.js';
import { openMenu } from '../ui/menu.js';

const MAX_PER_DAY = 4;

export class CalendarView {
  constructor(page, table, view) {
    this.page = page;
    this.base = page.base;
    this.table = table;
    this.view = view;
    const today = new Date();
    this.month = new Date(today.getFullYear(), today.getMonth(), 1);
    this.focusDay = dateKey(today);
    this.head = h('div.cal-toolbar');
    this.grid = h('div.month', { role: 'grid', 'aria-label': 'Month' });
    this.el = h('div.calendar-view', this.head, this.grid);
    enableCardDrag(this.grid, {
      onDrop: (d) => this.drop(d),
      onClick: (id) => this.page.openRecord(id),
      canDrag: () => !isReadOnly(this.dateField() || { type: 'formula' }),
    });
    this.grid.addEventListener('keydown', (e) => this.onKey(e));
    this.grid.addEventListener('dblclick', (e) => {
      const day = e.target.closest('.day');
      if (day && !e.target.closest('.event, button')) this.addOn(day.dataset.drop);
    });
  }

  mounted() {
    this.render();
  }
  destroy() {}
  update() {
    this.render();
  }
  focus() {
    this.grid.querySelector('.day[tabindex="0"]')?.focus();
  }
  recordOrder() {
    return this.ordered || [];
  }

  dateField() {
    return this.table.field(this.view.dateFieldId);
  }

  /** A record's days, as its cells show them (in GMT for GMT fields). */
  span(rec) {
    const f = this.dateField();
    const start = shownDate(this.base.compute.value(this.table, rec, f), f.options?.gmt);
    if (!start) return null;
    const endField = this.table.field(this.view.endFieldId);
    let end = endField ? shownDate(this.base.compute.value(this.table, rec, endField), endField.options?.gmt) : null;
    if (!end || end < start) end = start;
    return { start, end };
  }

  render() {
    const f = this.dateField();
    const m = this.month;
    const nav = h('div.cal-nav',
      h('button.icon-btn', { type: 'button', 'aria-label': this.weekMode ? 'Previous week' : 'Previous month', onclick: () => this.shift(-1) }, icon('chevronLeft', 18)),
      h('button.icon-btn', { type: 'button', 'aria-label': this.weekMode ? 'Next week' : 'Next month', onclick: () => this.shift(1) }, icon('chevronRight', 18)),
      h('button.btn.small', { type: 'button', onclick: () => this.goToday() }, 'Today'));
    const ws = addDays(toDate(this.focusDay), -toDate(this.focusDay).getDay());
    const we = addDays(ws, 6);
    const title = h('h2.cal-month', { 'aria-live': 'polite' }, this.weekMode
      ? `${monthName(ws.getMonth()).slice(0, 3)} ${ws.getDate()} to ${ws.getMonth() === we.getMonth() ? '' : `${monthName(we.getMonth()).slice(0, 3)} `}${we.getDate()}, ${we.getFullYear()}`
      : `${monthName(m.getMonth())} ${m.getFullYear()}`);
    if (!f) {
      this.hits = [];
      this.head.replaceChildren(title);
      this.grid.replaceChildren(h('div.empty', h('div.empty-icon', icon('vCalendar', 22)), h('h2', 'Choose a date field'), h('p', 'Pick a date field from the toolbar to place records on the calendar.'),
        h('button.btn.primary', { type: 'button', onclick: () => {
          this.base.transact(() => {
            const id = this.base.addField(this.table.id, { name: 'Date', type: 'date' });
            this.base.updateView(this.table.id, this.view.id, { dateFieldId: id });
          }, 'Add Date field');
        } }, icon('plus', 16), 'Add a Date field')));
      return;
    }
    const result = runView(this.base, this.table, this.view);
    const colorOf = cardColorFn(this.page, this.table, this.view);
    const hits = this.query ? new Set(searchView(this.base, this.table, this.view, result.records, this.query).map((x) => x.recordId)) : null;
    // Matching records with a date, by date, on screen or not.
    this.hits = [];
    const first = this.weekMode ? toDate(this.focusDay) : new Date(m);
    const offset = first.getDay();
    const start = addDays(first, -offset);
    const shownWeeks = this.weekMode ? 1 : Math.ceil((offset + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) / 7);
    const days = new Map();
    const undated = [];
    for (const rec of result.records) {
      const s = this.span(rec);
      if (!s) {
        undated.push(rec);
        continue;
      }
      if (hits?.has(rec.id)) this.hits.push({ id: rec.id, start: startOfDay(s.start), end: startOfDay(s.end) });
      // Only the days on screen, however long the span.
      const n = daysBetween(s.start, s.end);
      const from = Math.max(0, daysBetween(s.start, start));
      const to = Math.min(n, daysBetween(s.start, start) + shownWeeks * 7 - 1);
      for (let i = from; i <= to; i++) {
        const k = dateKey(addDays(s.start, i));
        if (!days.has(k)) days.set(k, []);
        days.get(k).push({ rec, first: i === 0, last: i === n });
      }
    }
    this.hits.sort((a, b) => a.start - b.start);
    this.range = { start, end: addDays(start, shownWeeks * 7 - 1) };
    this.ordered = result.records.map((r) => r.id);
    const unBtn = undated.length ? h('button.btn.small.ghost', { type: 'button', 'aria-haspopup': 'dialog' }, icon('inbox', 14), `${undated.length} without a date`) : null;
    unBtn?.addEventListener('click', () => this.showList(unBtn, 'Records without a date', undated));
    const mode = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Calendar range' },
      ...[['month', 'Month'], ['week', 'Week']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String((this.view.calMode || 'month') === k), onclick: () => this.base.updateView(this.table.id, this.view.id, { calMode: k }, { undoable: false }) }, l)));
    this.head.replaceChildren(...[nav, title, h('div.grow'), unBtn, mode].filter(Boolean));

    const todayKey = dateKey(new Date());
    const rows = [h('div.month-row.month-head', { role: 'row' }, WEEKDAYS.map((w) => h('div.month-wd', { role: 'columnheader', 'aria-label': w }, w.slice(0, 3))))];
    let d = start;
    const weeks = shownWeeks;
    const perDay = this.weekMode ? 200 : MAX_PER_DAY;
    for (let w = 0; w < weeks; w++) {
      const row = h('div.month-row', { role: 'row' });
      for (let i = 0; i < 7; i++) {
        const day = new Date(d);
        const key = dateKey(day);
        const list = days.get(key) || [];
        const inMonth = this.weekMode || day.getMonth() === m.getMonth();
        const cell = h('div.day', {
          role: 'gridcell',
          tabindex: key === this.focusDay ? '0' : '-1',
          'aria-label': `${monthName(day.getMonth())} ${day.getDate()}, ${list.length} record${list.length === 1 ? '' : 's'}`,
          class: `day${inMonth ? '' : ' other'}${key === todayKey ? ' today' : ''}`,
          dataset: { drop: key },
        });
        const cards = h('div.day-events', { dataset: { cards: 'unordered' } });
        for (const ev of list.slice(0, perDay)) cards.append(this.eventEl(ev, colorOf(ev.rec), hits));
        if (list.length > perDay) {
          const more = h('button.day-more', { type: 'button' }, `${list.length - perDay} more`);
          more.addEventListener('click', () => this.showList(more, `${monthName(day.getMonth())} ${day.getDate()}`, list.map((x) => x.rec)));
          cards.append(more);
        }
        cell.append(h('div.day-head', h('span.day-num', String(day.getDate())), h('button.icon-btn.day-add', { type: 'button', tabindex: '-1', 'aria-label': `Add a record on ${monthName(day.getMonth())} ${day.getDate()}`, onclick: () => this.addOn(key) }, icon('plus', 14))), cards);
        row.append(cell);
        d = addDays(d, 1);
      }
      rows.push(row);
    }
    this.grid.style.setProperty('--weeks', String(weeks));
    this.grid.classList.toggle('week', this.weekMode);
    this.grid.replaceChildren(...rows);
  }

  eventEl(ev, color, hits) {
    const rec = ev.rec;
    const name = this.base.recordName(this.table.id, rec.id);
    const el = h('button.event', { type: 'button', dataset: { id: rec.id }, 'aria-label': name, 'aria-keyshortcuts': isReadOnly(this.dateField()) ? null : 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown', class: `event${ev.first ? ' first' : ''}${ev.last ? ' last' : ''}${hits?.has(rec.id) ? ' search-hit' : ''}` }, h('span.event-name', name));
    if (color) el.style.setProperty('--ev', accentColor(color));
    const f = this.dateField();
    const v = this.base.compute.value(this.table, rec, f);
    if (ev.first && v && !isDateOnly(v) && f.options?.includeTime) {
      const t = shownDate(v, f.options?.gmt);
      el.prepend(h('span.event-time', `${t.getHours() % 12 || 12}${t.getMinutes() ? `:${String(t.getMinutes()).padStart(2, '0')}` : ''}${t.getHours() < 12 ? 'a' : 'p'}`));
    }
    return el;
  }

  showList(anchor, title, recs) {
    const list = h('div.menu', { role: 'menu', 'aria-label': title }, h('div.menu-header', title), recs.slice(0, 200).map((r) => h('button.menu-item', { type: 'button', role: 'menuitem', onclick: () => {
      pop.close();
      this.page.openRecord(r.id);
    } }, h('span.menu-label', this.base.recordName(this.table.id, r.id)))));
    const pop = openPopover(anchor, list, { label: title });
  }

  get weekMode() {
    return this.view.calMode === 'week';
  }

  shift(n) {
    if (this.weekMode) {
      const d = addDays(toDate(this.focusDay), n * 7);
      this.focusDay = dateKey(d);
      this.month = new Date(d.getFullYear(), d.getMonth(), 1);
    } else {
      this.month = addMonths(this.month, n);
      this.focusDay = dateKey(new Date(this.month));
    }
    this.render();
  }

  goToday() {
    const t = new Date();
    this.month = new Date(t.getFullYear(), t.getMonth(), 1);
    this.focusDay = dateKey(t);
    this.render();
    this.focus();
  }

  addOn(key) {
    const f = this.dateField();
    if (!f || isReadOnly(f)) return;
    const d = toDate(key);
    if (f.options?.includeTime) d.setHours(9, 0, 0, 0);
    // 9:00 as the cell shows it: in GMT for GMT fields.
    const v = f.options?.includeTime && f.options?.gmt ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 9)).toISOString() : fromDate(d, f.options?.includeTime);
    this.page.addRecord({ [f.id]: v });
  }

  drop({ id, zone, from }) {
    const f = this.dateField();
    if (!f || isReadOnly(f)) return;
    const rec = this.table.record(id);
    const s = rec && this.span(rec);
    if (!s) return;
    // Shift by how far the grabbed day moved (a span can be grabbed by any day).
    const target = toDate(zone);
    const delta = daysBetween(from ? toDate(from) : s.start, target);
    if (!delta) return;
    const cells = {};
    const shift = (field) => {
      const v = rec.c[field.id];
      if (!v) return;
      const dt = addValueDays(v, delta, field.options?.gmt);
      cells[field.id] = isDateOnly(v) ? dateKey(dt) : dt.toISOString();
    };
    shift(f);
    const endField = this.table.field(this.view.endFieldId);
    if (endField && !isReadOnly(endField)) shift(endField);
    this.base.setCells(this.table.id, [{ id, cells }], 'Move to date');
    announce(`Moved to ${monthName(target.getMonth())} ${target.getDate()}`);
  }

  onKey(e) {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const ev = e.target.closest?.('.event');
    if (ev && e.altKey && moves[e.key] !== undefined) {
      e.preventDefault();
      this.moveEvent(ev, moves[e.key]);
      return;
    }
    const day = e.target.closest?.('.day');
    if (!day || e.target !== day) return;
    if (moves[e.key] !== undefined) {
      e.preventDefault();
      const next = addDays(toDate(day.dataset.drop), moves[e.key]);
      this.focusDay = dateKey(next);
      if (next.getMonth() !== this.month.getMonth() || (this.weekMode && !this.grid.querySelector(`.day[data-drop="${this.focusDay}"]`))) {
        this.month = new Date(next.getFullYear(), next.getMonth(), 1);
        this.render();
      } else {
        this.grid.querySelectorAll('.day[tabindex="0"]').forEach((x) => x.setAttribute('tabindex', '-1'));
      }
      const cell = this.grid.querySelector(`.day[data-drop="${this.focusDay}"]`);
      cell?.setAttribute('tabindex', '0');
      cell?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const ev = day.querySelector('.event');
      if (ev) ev.focus();
      else this.addOn(day.dataset.drop);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      this.shift(e.key === 'PageUp' ? -1 : 1);
      this.focus();
    } else if (e.key === 'ContextMenu') {
      e.preventDefault();
      const r = day.getBoundingClientRect();
      openMenu({ x: r.left + 10, y: r.top + 20 }, [{ label: 'Add record on this day', icon: 'plus', onSelect: () => this.addOn(day.dataset.drop) }]);
    }
  }

  /** Move a focused event n days, as dragging it there would, and follow it. */
  moveEvent(ev, n) {
    const f = this.dateField();
    if (!f || isReadOnly(f)) {
      announce(`${f?.name || 'This date'} is computed and can't be moved`);
      return;
    }
    const id = ev.dataset.id;
    const from = ev.closest('.day').dataset.drop;
    const to = dateKey(addDays(toDate(from), n));
    this.drop({ id, zone: to, from });
    this.focusDay = to;
    if (!this.grid.querySelector(`.day[data-drop="${to}"]`)) {
      this.month = new Date(toDate(to).getFullYear(), toDate(to).getMonth(), 1);
      this.render();
    }
    this.grid.querySelectorAll('.day[tabindex="0"]').forEach((x) => x.setAttribute('tabindex', '-1'));
    const day = this.grid.querySelector(`.day[data-drop="${to}"]`);
    day?.setAttribute('tabindex', '0');
    (day?.querySelector(`.event[data-id="${CSS.escape(id)}"]`) || day)?.focus();
  }

  setSearch(query, { keep = false } = {}) {
    query ||= '';
    // The match that was current, by record: an edit has already redrawn the view.
    const prev = keep ? this.hitId : null;
    // After an edit the view has already drawn this search.
    const drawn = keep && query === this.query;
    this.query = query;
    if (!drawn) this.render();
    const hits = this.hits || [];
    let i = prev ? hits.findIndex((x) => x.id === prev) : -1;
    // A new search starts from the dates on screen.
    if (!keep && this.range) i = hits.findIndex((x) => x.end >= this.range.start);
    this.hitIndex = i >= 0 ? i : Math.min(keep ? this.hitIndex || 0 : 0, Math.max(0, hits.length - 1));
    if (!keep) this.showHit(false);
    this.hitId = this.hits[this.hitIndex]?.id;
    return { total: hits.length, index: this.hitIndex };
  }

  stepSearch(d) {
    const n = this.hits?.length || 0;
    if (!n) return { total: 0, index: 0 };
    this.hitIndex = (this.hitIndex + d + n) % n;
    this.showHit(true);
    this.hitId = this.hits[this.hitIndex]?.id;
    return { total: n, index: this.hitIndex };
  }

  /** Go to the current match's month (or week) when it is not on screen. */
  showHit(focus) {
    const hit = this.hits?.[this.hitIndex];
    if (!hit) return;
    if (hit.end < this.range.start || hit.start > this.range.end) {
      this.focusDay = dateKey(hit.start);
      this.month = new Date(hit.start.getFullYear(), hit.start.getMonth(), 1);
      this.render();
    }
    if (!focus) return;
    // A day showing too many records has it under "N more".
    const day = this.grid.querySelector(`.day[data-drop="${dateKey(hit.start < this.range.start ? this.range.start : hit.start)}"]`);
    (this.grid.querySelector(`.event[data-id="${CSS.escape(hit.id)}"]`) || day?.querySelector('.day-more') || day)?.focus();
  }
}
