/**
 * A column per month: the shared marks behind the vesting forecast and the
 * option-pool runway.
 *
 * The house's chart style, in one place so both read identically: thin columns
 * rising from a hairline baseline, rounded at the data end, a 2px surface gap
 * between them, no y-axis. The figures live in the caption above and in each
 * column's own title, because a forecast is read by its shape and its numbers,
 * not off gridlines - and identity never rides on colour alone.
 */

import { el } from '../ui/dom.js';
import { monthLabel } from '../lib/format.js';

/* One label every quarter: a couple of dozen of them collide, and the quarters
   are the marks a reader actually navigates by. */
const LABEL_EVERY = 3;

/**
 * Columns for `rows`. `fillOf(row)` is the fraction of the column that is
 * filled (0 draws nothing - an empty month should read as empty, not as a
 * stub), `describe(row)` is the text the column names itself with, and
 * `track` draws the whole behind the part for a part-to-whole reading.
 */
export function monthColumns(rows, { fillOf, describe, track = false }) {
  return el('div.month-cols', {},
    rows.map((row) => el('div.month-col', { title: describe(row) },
      track ? el('div.month-track') : null,
      el('div.month-bar', {
        style: { height: `${Math.max(0, Math.min(1, fillOf(row))) * 100}%` },
      }))));
}

/** The quarter labels under the columns, on the same grid so they line up. */
export function monthAxis(rows) {
  return el('div.month-axis', { 'aria-hidden': 'true' },
    rows.map((row, i) => el('span', {},
      i % LABEL_EVERY === 0 ? monthLabel(row.month) : '')));
}
