/**
 * Vesting forecast charts: a column per month.
 *
 * Two plots rather than one, deliberately. Monthly vesting and the cumulative
 * position are both share counts, but they differ by orders of magnitude - a
 * month vesting 50,000 shares against a cumulative 4,000,000 - and drawing
 * them together needs two y-scales, which makes one of the two unreadable and
 * the pair impossible to compare. Same x, one scale each, switched between.
 *
 * Marks are the house's: thin columns rising from a hairline baseline, rounded
 * at the data end, a 2px surface gap between them, values in text tokens
 * rather than in the fill. Identity never rides on color alone - the caption
 * carries the figures, and every column names itself on hover.
 */

import { el } from '../ui/dom.js';
import { shares, sharesCompact, pct, monthLabel } from '../lib/format.js';
import { monthColumns as columns, monthAxis as axis } from './months.js';

/**
 * Shares vesting per month. `forecast` is lib/captable.js's vestingForecast
 * result; an empty one is the caller's business, not this chart's.
 */
export function monthlyVestingChart(forecast) {
  const { rows, peak } = forecast;
  const max = peak?.vesting || 0;
  const summary = `Shares vesting per month over ${rows.length} months: `
    + rows.map((r) => `${monthLabel(r.month)} ${shares(r.vesting)}`).join(', ');
  return el('div.month-chart', { role: 'img', 'aria-label': summary },
    columns(rows, {
      fillOf: (r) => (max > 0 ? r.vesting / max : 0),
      describe: (r) => `${monthLabel(r.month)}: ${shares(r.vesting)} vesting`,
    }),
    axis(rows));
}

/**
 * Cumulative vested against everything on a schedule: each column is the whole
 * granted amount, filled to what has vested by the end of that month.
 */
export function cumulativeVestingChart(forecast) {
  const { rows, granted } = forecast;
  const summary = `Cumulative vested against ${shares(granted)} on a vesting schedule: `
    + rows.map((r) => `${monthLabel(r.month)} ${pct(granted > 0 ? r.vested / granted : 0, 0)}`).join(', ');
  return el('div', {},
    el('div.month-chart', { role: 'img', 'aria-label': summary },
      columns(rows, {
        track: true,
        fillOf: (r) => (granted > 0 ? r.vested / granted : 0),
        describe: (r) => `${monthLabel(r.month)}: ${shares(r.vested)} of ${shares(granted)} vested `
          + `(${pct(granted > 0 ? r.vested / granted : 0, 0)})`,
      }),
      axis(rows)),
    /* Two encodings, so they are named: the fill is vested, the track behind
       it is everything still on a schedule. */
    el('div.dilution-legend', { style: { marginTop: '10px' } },
      el('span.key', {}, el('i', { style: { background: 'var(--accent)' } }), 'Vested'),
      el('span.key', {}, el('i', { style: { background: 'var(--surface-3)' } }),
        `On a schedule (${sharesCompact(granted)})`)));
}
