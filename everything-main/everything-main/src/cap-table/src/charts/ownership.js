/**
 * Ownership chart: a horizontal stacked bar (part-to-whole) plus a legend
 * that carries every value - identity never rides on color alone.
 *
 * Series colors come from the validated categorical slots in fixed order;
 * past MAX_SLOTS the tail folds into a single muted "Other" segment rather
 * than generating new hues. Segments are separated by a 2px surface gap.
 */

import { el } from '../ui/dom.js';
import { pct, shares } from '../lib/format.js';

const MAX_SLOTS = 7;

const slotColor = (i) => `var(--series-${i + 1})`;

/**
 * Fold rows past the slot budget into one "Other" row.
 *
 * The smallest rows fold, wherever they sit in the list, and the kept rows
 * stay in their own order. Folding by position hid the biggest slices:
 * holder rows arrive sorted by size with the unallocated pool appended
 * last, and class rows in creation order with the pseudo-classes after
 * them - so a nine-holder cap table put an 11% pool into "Other (2)" beside
 * a 0.5% warrant holder, under a card saying the chart includes the pool.
 */
export function foldRows(rows, max = MAX_SLOTS) {
  if (rows.length <= max + 1) return rows.map((r, i) => ({ ...r, color: slotColor(Math.min(i, 7)) }));
  const size = (r) => Number(r.shares) || 0;
  const ranked = rows.map((_, i) => i).sort((a, b) => size(rows[b]) - size(rows[a]) || a - b);
  const kept = new Set(ranked.slice(0, max));
  const head = rows.filter((_, i) => kept.has(i)).map((r, i) => ({ ...r, color: slotColor(i) }));
  const tail = rows.filter((_, i) => !kept.has(i));
  head.push({
    name: `Other (${tail.length})`,
    shares: tail.reduce((a, r) => a + r.shares, 0),
    pct: tail.reduce((a, r) => a + r.pct, 0),
    color: 'var(--series-mute)',
    folded: true,
  });
  return head;
}

/**
 * rows: [{ name, shares, pct }] - pct as 0..1 fractions summing to ~1.
 * `formatValue` renders the per-row figure and `label` names what the whole
 * is; the same part-to-whole chart serves share counts and exit proceeds,
 * which are money and are not ownership.
 * Returns a DOM node: stacked bar + legend.
 */
export function ownershipChart(rows, { formatValue = shares, label = 'Ownership' } = {}) {
  if (!rows.length) return el('p.muted.small', {}, 'Nothing issued yet.');
  const series = foldRows(rows);

  const bar = el('div.own-bar', { role: 'img', 'aria-label': seriesSummary(label, series) },
    series.map((r) => el('span.own-seg', {
      style: { flexGrow: String(Math.max(r.pct, 0.004) * 1000), background: r.color },
      title: `${r.name}: ${pct(r.pct)}`,
    }))
  );

  /* The count and the percentage share a wrapper so they travel together.
     As three loose items the row wrapped one at a time, and a narrow card
     left the percentage stranded on a line of its own. */
  const legend = el('div.own-legend', {},
    series.map((r) => el('div.own-legend-row', {},
      el('span.swatch', { style: { background: r.color }, 'aria-hidden': 'true' }),
      el('span.name', {}, r.name),
      el('span.figures', {},
        el('span.shares', {}, formatValue(r.shares)),
        el('span.val', {}, pct(r.pct)))
    ))
  );

  return el('div', {}, bar, legend);
}

function seriesSummary(label, series) {
  return `${label}: ` + series.map((r) => `${r.name} ${pct(r.pct)}`).join(', ');
}
