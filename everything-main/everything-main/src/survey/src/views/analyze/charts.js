/**
 * Small, fast charts for survey results. Most are plain HTML (flex bars),
 * which lays out and wraps labels better than SVG at any width and costs
 * nothing to render; the donut is SVG.
 *
 * Color rules (see the dataviz guidance this follows):
 *   - one series is one hue (--chart-1) for every bar; bar length already
 *     shows magnitude, so color never repeats it;
 *   - categorical identity (donut slices) takes hues in a fixed order, never
 *     cycled; more than six slices folds into a bar chart instead;
 *   - ordered categories (grid columns, worst to best) use one hue stepped
 *     light to dark;
 *   - text is never drawn in a series color: labels use text tokens, and a
 *     swatch beside the text carries identity.
 * Every chart is role="img" with a sentence summary, and its numbers are
 * always also in a table next to it, so hover is a convenience, not a gate.
 */
import { h } from '../../lib/dom.js';
import { fmtNum } from '../../lib/format.js';

/** Categorical slots that pass the palette checks together, in order. */
export const CATEGORICAL = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-7)'];

// A share that would round to 0 or 100 without being either says so: one
// pick in 20,000 is not "0.0%" beside choices nobody picked.
export const fmtPctShort = (p) =>
  p > 0 && p < 0.05 ? '<0.1%' : p < 100 && p >= 99.95 ? '>99.9%' : `${(Math.round(p * 10) / 10).toFixed(p >= 100 || p === 0 ? 0 : 1)}%`;

/** One step of a single-hue ramp for ordered categories, light to dark. */
export function rampColor(i, n) {
  const lo = 40;
  const share = n <= 1 ? 100 : Math.round(lo + ((100 - lo) * i) / (n - 1));
  return `color-mix(in oklab, var(--chart-2) ${share}%, var(--surface))`;
}

/* ---- Tooltip (one per page, delegated) ---- */

let tip = null;
export function attachTooltips(root) {
  if (!tip) {
    tip = h('div', { class: 'an-tip', role: 'presentation', hidden: true });
    document.body.append(tip);
  }
  const show = (target, x, y) => {
    tip.textContent = target.dataset.tip;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(x - r.width / 2, window.innerWidth - r.width - 8))}px`;
    tip.style.top = `${Math.max(8, y - r.height - 10)}px`;
  };
  const onMove = (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t || !root.contains(t)) {
      tip.hidden = true;
      return;
    }
    show(t, e.clientX, e.clientY);
  };
  const hide = () => tip && (tip.hidden = true);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerleave', hide);
  root.addEventListener('scroll', hide, true);
  return () => {
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerleave', hide);
    root.removeEventListener('scroll', hide, true);
    hide();
  };
}

/* ---- Horizontal bars ---- */

/**
 * rows: [{ label, pct, count }]. Bars scale to the largest share so small
 * differences stay visible; the printed value is always the true share.
 */
export function hbarChart(rows, { label }) {
  const max = Math.max(1, ...rows.map((r) => r.pct));
  return h(
    'div',
    { class: 'an-hbars', role: 'img', 'aria-label': label },
    rows.map((r) =>
      h(
        'div',
        { class: 'an-hbar', 'data-tip': `${r.label}: ${fmtPctShort(r.pct)} (${fmtNum(r.count)})` },
        h('span', { class: `an-hbar-label${r.removed ? ' faint' : ''}`, 'aria-hidden': 'true' }, r.label),
        h('span', { class: 'an-hbar-track', 'aria-hidden': 'true' }, h('span', { class: 'an-hbar-fill', style: { width: `${(r.pct / max) * 100}%` } })),
        h('span', { class: 'an-hbar-value', 'aria-hidden': 'true' }, fmtPctShort(r.pct)),
      ),
    ),
  );
}

/* ---- Columns ---- */

/**
 * rows: [{ label, value, tip }]. Values label the column caps when there
 * are few columns; past `capLimit` the axis maximum and tooltips carry them.
 */
export function columnChart(rows, { label, fmt = (v) => fmtNum(v), capLimit = 12, height = 150, axisLabels = null }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  const showCaps = rows.length <= capLimit;
  return h(
    'div',
    { class: `an-cols-wrap${rows.length > 6 ? ' an-cols-many' : ''}`, role: 'img', 'aria-label': label },
    h(
      'div',
      { class: 'an-cols', style: { '--plot-h': `${height}px` }, 'aria-hidden': 'true' },
      rows.map((r) =>
        h(
          'div',
          { class: 'an-col', 'data-tip': r.tip || `${r.label}: ${fmt(r.value)}` },
          showCaps ? h('span', { class: 'an-col-cap' }, r.value ? fmt(r.value) : '') : null,
          h('span', { class: 'an-col-bar', style: { height: max ? `${(r.value / max) * 100}%` : '0' } }),
        ),
      ),
    ),
    axisLabels
      ? h('div', { class: 'an-axis', 'aria-hidden': 'true' }, axisLabels.map((t) => h('span', null, t)))
      : h('div', { class: 'an-col-labels', 'aria-hidden': 'true' }, rows.map((r) => h('span', { title: r.label }, r.label))),
  );
}

/* ---- Donut ---- */

function arcPath(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1, a0);
  const [x1, y1] = p(r1, a1);
  const [x2, y2] = p(r0, a1);
  const [x3, y3] = p(r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

/** Part-to-whole for up to six slices (single-answer questions only). */
export function donutChart(rows, { label, centerTop = '', centerBottom = '' }) {
  const total = rows.reduce((t, r) => t + r.count, 0);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'an-donut-svg');
  svg.setAttribute('aria-hidden', 'true');
  let a = 0;
  rows.forEach((r, i) => {
    if (!r.count) return;
    const sweep = (r.count / total) * Math.PI * 2;
    const path = document.createElementNS(NS, 'path');
    const end = a + sweep - (rows.filter((x) => x.count).length > 1 ? 0.0001 : 0);
    path.setAttribute('d', sweep >= Math.PI * 2 - 1e-6 ? arcPath(60, 60, 38, 56, 0, Math.PI * 2 - 1e-4) : arcPath(60, 60, 38, 56, a, end));
    path.setAttribute('fill', CATEGORICAL[i % CATEGORICAL.length]);
    // The surface-colored stroke is the 2px gap between touching slices.
    path.setAttribute('stroke', 'var(--surface)');
    path.setAttribute('stroke-width', '2');
    path.dataset.tip = `${r.label}: ${fmtPctShort(r.pct)} (${fmtNum(r.count)})`;
    svg.append(path);
    a += sweep;
  });
  return h(
    'div',
    { class: 'an-donut', role: 'img', 'aria-label': label },
    h('div', { class: 'an-donut-fig' }, svg, h('div', { class: 'an-donut-center', 'aria-hidden': 'true' }, h('strong', null, centerTop), h('span', null, centerBottom))),
    legend(rows.map((r, i) => ({ color: CATEGORICAL[i % CATEGORICAL.length], label: r.label, value: fmtPctShort(r.pct) }))),
  );
}

export function legend(items) {
  return h(
    'ul',
    { class: 'an-legend', 'aria-hidden': 'true' },
    items.map((it) => h('li', null, h('span', { class: 'an-swatch', style: { background: it.color } }), h('span', null, it.label), it.value ? h('span', { class: 'faint' }, it.value) : null)),
  );
}

/* ---- Stacked rows (grids) ---- */

/** rows: [{ label, cells: [{ pct, count }] }], columns: [{ label }]. */
export function stackedRows(rows, columns, { label }) {
  const n = columns.length;
  return h(
    'div',
    { class: 'an-stack', role: 'img', 'aria-label': label },
    rows.map((row) =>
      h(
        'div',
        { class: 'an-stack-row' },
        h('span', { class: `an-stack-label${row.removed ? ' faint' : ''}`, 'aria-hidden': 'true' }, row.label),
        h(
          'span',
          { class: 'an-stack-bar', 'aria-hidden': 'true' },
          row.answered
            ? row.cells.map((c, i) =>
                c.count
                  ? h('span', {
                      class: 'an-stack-seg',
                      style: { flexGrow: String(c.pct), background: rampColor(i, n) },
                      'data-tip': `${row.label}, ${columns[i].label}: ${fmtPctShort(c.pct)} (${fmtNum(c.count)})`,
                    })
                  : null,
              )
            : h('span', { class: 'an-stack-empty' }, 'No answers'),
        ),
      ),
    ),
    legend(columns.map((c, i) => ({ color: rampColor(i, n), label: c.label }))),
  );
}

/* ---- Segmented single bar (0-10 groups) ---- */

/** parts: [{ label, count, color }] in a fixed meaningful order. */
export function segmentBar(parts, { label }) {
  const total = parts.reduce((t, p) => t + p.count, 0) || 1;
  return h(
    'div',
    { class: 'an-seg', role: 'img', 'aria-label': label },
    h(
      'div',
      { class: 'an-seg-bar', 'aria-hidden': 'true' },
      parts.map((p) => (p.count ? h('span', { style: { flexGrow: String(p.count), background: p.color }, 'data-tip': `${p.label}: ${fmtPctShort((p.count / total) * 100)} (${fmtNum(p.count)})` }) : null)),
    ),
    legend(parts.map((p) => ({ color: p.color, label: p.label, value: fmtPctShort((p.count / total) * 100) }))),
  );
}
