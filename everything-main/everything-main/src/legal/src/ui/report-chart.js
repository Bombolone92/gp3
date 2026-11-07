/**
 * Dependency-free SVG charts for reports.
 *
 * columnChart: grouped (or stacked) columns over categories such as months,
 * with a hairline grid, rounded data ends, a hover tooltip per band, a
 * legend, and a "View as table" toggle so exact values are available to
 * everyone, including screen reader users.
 *
 * barList: horizontal bars for ranked lists (by user, by category).
 */
import '../styles/reports.css';
import { h, uniqueId, rafThrottle } from './dom.js';
import { icon } from './icons.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  for (const k of kids) if (k) n.append(k);
  return n;
};

export const seriesColor = (i) => `var(--series-${(i % 4) + 1})`;

/** A round axis maximum: 0, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 times a power of ten. */
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Path for a column with rounded top corners, anchored at the baseline. */
function columnPath(x, y, w, hgt) {
  if (hgt <= 0) return '';
  const r = Math.min(3, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}

/**
 * columnChart({ title, categories: [{ label, values: [n...] }], series: [{ name }],
 *   format(n), short(n), height, stacked })
 */
export function columnChart({ title, categories, series, format = String, short = format, height = 260, stacked = false }) {
  const tableId = uniqueId('chart-table');
  const wrap = h('figure.chart');
  const plot = h('div.chart-plot');
  const tip = h('div.chart-tip', { hidden: true, 'aria-hidden': 'true' });
  const totals = categories.map((c) => (stacked ? c.values.reduce((s, v) => s + Math.max(0, v), 0) : Math.max(0, ...c.values)));
  const max = niceMax(Math.max(0, ...totals));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  const summary = `${title}. ${categories.length} ${categories.length === 1 ? 'period' : 'periods'}, ${series.map((s) => s.name).join(' and ')}. Use View as table for exact values.`;
  let asTable = false;

  function draw() {
    const W = Math.max(300, plot.clientWidth || 640);
    const padL = 56;
    const padR = 8;
    const padT = 10;
    const padB = 28;
    const plotW = W - padL - padR;
    const plotH = height - padT - padB;
    const band = plotW / Math.max(1, categories.length);
    const groups = stacked ? 1 : series.length;
    const colW = Math.max(3, Math.min(34, (band * 0.7) / groups - 2));
    const y = (v) => padT + plotH - (Math.max(0, v) / max) * plotH;
    const root = svg('svg', { width: W, height, viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': summary, class: 'chart-svg' });
    for (const t of ticks) {
      root.append(svg('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: t ? 'chart-grid' : 'chart-axis' }));
      const lbl = svg('text', { x: padL - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'chart-tick' });
      lbl.textContent = short(t);
      root.append(lbl);
    }
    const every = Math.max(1, Math.ceil(categories.length / Math.max(1, Math.floor(plotW / 54))));
    categories.forEach((c, i) => {
      const cx = padL + band * i + band / 2;
      if (i % every === 0) {
        const lbl = svg('text', { x: cx, y: height - 8, 'text-anchor': 'middle', class: 'chart-tick' });
        lbl.textContent = c.label;
        root.append(lbl);
      }
      if (stacked) {
        let acc = 0;
        c.values.forEach((v, si) => {
          const top = y(acc + Math.max(0, v));
          const hgt = y(acc) - top;
          acc += Math.max(0, v);
          if (hgt > 0) root.append(svg('rect', { x: cx - colW / 2, y: top, width: colW, height: hgt, style: `fill:${seriesColor(si)}` }));
        });
      } else {
        const groupW = groups * (colW + 2) - 2;
        c.values.forEach((v, si) => {
          const x = cx - groupW / 2 + si * (colW + 2);
          const top = y(v);
          const d = columnPath(x, top, colW, padT + plotH - top);
          if (d) root.append(svg('path', { d, style: `fill:${seriesColor(si)}` }));
        });
      }
      // Hover band for the tooltip.
      const hit = svg('rect', { x: padL + band * i, y: padT, width: band, height: plotH, class: 'chart-hit' });
      hit.addEventListener('pointerenter', () => showTip(i, cx));
      hit.addEventListener('pointerleave', () => (tip.hidden = true));
      root.append(hit);
    });
    plot.replaceChildren(root, tip);
  }

  function showTip(i, cx) {
    const c = categories[i];
    tip.replaceChildren(
      h('div.chart-tip-title', c.full || c.label),
      ...series.map((s, si) => h('div.chart-tip-row', h('span.chart-key', { style: { background: seriesColor(si) } }), h('span.grow', s.name), h('strong.num', format(c.values[si] || 0)))),
    );
    tip.hidden = false;
    const W = plot.clientWidth;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(4, Math.min(W - tw - 4, cx - tw / 2))}px`;
    tip.style.top = '4px';
  }

  const table = h(
    'table.table-plain.chart-table',
    { id: tableId },
    h('caption.sr-only', title),
    h(
      'thead',
      h(
        'tr',
        h('th', { scope: 'col' }, 'Period'),
        series.map((s) => h('th.r', { scope: 'col' }, s.name)),
      ),
    ),
    h(
      'tbody',
      categories.map((c) =>
        h(
          'tr',
          h('th', { scope: 'row' }, c.full || c.label),
          series.map((s, si) => h('td.r.num', format(c.values[si] || 0))),
        ),
      ),
    ),
  );
  const toggle = h('button.btn.sm.ghost', { type: 'button', 'aria-controls': tableId, 'aria-expanded': 'false' }, icon('list', 15), 'View as table');
  toggle.addEventListener('click', () => {
    asTable = !asTable;
    toggle.setAttribute('aria-expanded', String(asTable));
    toggle.replaceChildren(icon(asTable ? 'chart' : 'list', 15), asTable ? 'View as chart' : 'View as table');
    plot.hidden = asTable;
    table.hidden = !asTable;
  });
  table.hidden = true;

  const legend = h(
    'div.chart-legend',
    series.map((s, si) => h('span.chart-legend-item', h('span.chart-key', { style: { background: seriesColor(si) } }), s.name)),
    h('div.spacer'),
    toggle,
  );
  wrap.append(legend, plot, table);
  if (!categories.length) {
    plot.replaceChildren(h('p.chart-empty', 'No data for this period.'));
  } else {
    // Measure after the figure is in the document.
    requestAnimationFrame(draw);
    if (typeof ResizeObserver === 'function') new ResizeObserver(rafThrottle(draw)).observe(plot);
  }
  return wrap;
}

/**
 * Ranked horizontal bars. rows: [{ label, value, display?, sub?, target? }].
 * A target (same unit as value) draws a marker on the bar.
 */
export function barList({ title, rows, format = String }) {
  const max = niceMax(Math.max(0, ...rows.map((r) => Math.max(r.value || 0, r.target || 0))));
  return h(
    'ul.bar-list',
    { 'aria-label': title },
    rows.map((r) =>
      h(
        'li.bar-row',
        h('div.bar-label', h('span.truncate', r.label), h('span.num.strong', r.display ?? format(r.value))),
        h(
          'div.bar-track',
          { 'aria-hidden': 'true' },
          h('span.bar-fill', { style: { width: `${(Math.max(0, r.value) / max) * 100}%`, background: seriesColor(r.series ?? 0) } }),
          r.target ? h('span.bar-target', { style: { left: `${Math.min(100, (r.target / max) * 100)}%` }, title: 'Target' }) : null,
        ),
        r.sub ? h('div.bar-sub', r.sub) : null,
      ),
    ),
  );
}
