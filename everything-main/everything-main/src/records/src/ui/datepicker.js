/**
 * A month calendar for picking a date. Arrow keys move by day and week,
 * Page Up/Down by month, Enter picks, Escape closes.
 */
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { toDate, dateKey, monthName, WEEKDAYS, addDays, addMonths } from '../lib/format.js';

export function calendar({ value, onPick, weekStart = 0 }) {
  let selected = toDate(value);
  let focusDay = selected || new Date();
  let month = new Date(focusDay.getFullYear(), focusDay.getMonth(), 1);
  const title = h('div.cal-title', { 'aria-live': 'polite' });
  const grid = h('div.cal-grid', { role: 'grid' });
  const prev = h('button.icon-btn', { type: 'button', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('chevronLeft', 16));
  const next = h('button.icon-btn', { type: 'button', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('chevronRight', 16));
  const today = h('button.btn.small.ghost', { type: 'button', onclick: () => pick(new Date()) }, 'Today');
  const el = h('div.calendar', h('div.cal-head', prev, title, next), grid, h('div.cal-foot', today));

  // Focus stays on the month button, so pressing it again keeps paging.
  function shift(n) {
    month = addMonths(month, n);
    focusDay = new Date(month.getFullYear(), month.getMonth(), Math.min(focusDay.getDate(), 28));
    render();
  }

  // A day in the next month (or Today) brings its month into view.
  function pick(d) {
    const inGrid = grid.contains(document.activeElement);
    selected = d;
    focusDay = d;
    month = new Date(d.getFullYear(), d.getMonth(), 1);
    onPick?.(d);
    render(inGrid);
  }

  function render(focus = false) {
    title.textContent = `${monthName(month.getMonth())} ${month.getFullYear()}`;
    grid.replaceChildren();
    const head = h('div.cal-row', { role: 'row' });
    for (let i = 0; i < 7; i++) {
      const wd = WEEKDAYS[(i + weekStart) % 7];
      head.append(h('div.cal-wd', { role: 'columnheader', 'aria-label': wd }, wd.slice(0, 2)));
    }
    grid.append(head);
    const first = new Date(month);
    const offset = (first.getDay() - weekStart + 7) % 7;
    let d = addDays(first, -offset);
    const todayKey = dateKey(new Date());
    const selKey = selected ? dateKey(selected) : null;
    const focusKey = dateKey(focusDay);
    for (let w = 0; w < 6; w++) {
      const row = h('div.cal-row', { role: 'row' });
      for (let i = 0; i < 7; i++) {
        const day = new Date(d);
        const key = dateKey(day);
        const btn = h('button.cal-day', {
          type: 'button',
          role: 'gridcell',
          tabindex: key === focusKey ? '0' : '-1',
          'aria-selected': String(key === selKey),
          'aria-label': `${monthName(day.getMonth())} ${day.getDate()}, ${day.getFullYear()}`,
          class: `cal-day${day.getMonth() !== month.getMonth() ? ' other' : ''}${key === todayKey ? ' today' : ''}${key === selKey ? ' selected' : ''}`,
          onclick: () => pick(day),
        }, String(day.getDate()));
        row.append(btn);
        d = addDays(d, 1);
      }
      grid.append(row);
    }
    if (focus && grid.isConnected) grid.querySelector('[tabindex="0"]')?.focus();
  }

  grid.addEventListener('keydown', (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (moves[e.key] !== undefined) {
      e.preventDefault();
      focusDay = addDays(focusDay, moves[e.key]);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      focusDay = addMonths(focusDay, e.key === 'PageUp' ? -1 : 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusDay = addDays(focusDay, -((focusDay.getDay() - weekStart + 7) % 7));
    } else if (e.key === 'End') {
      e.preventDefault();
      focusDay = addDays(focusDay, 6 - ((focusDay.getDay() - weekStart + 7) % 7));
    } else return;
    month = new Date(focusDay.getFullYear(), focusDay.getMonth(), 1);
    render(true);
  });

  render();
  return {
    el,
    set(v) {
      selected = toDate(v);
      if (selected) {
        focusDay = selected;
        month = new Date(selected.getFullYear(), selected.getMonth(), 1);
      }
      render();
    },
    focus() {
      grid.querySelector('[tabindex="0"]')?.focus();
    },
  };
}
