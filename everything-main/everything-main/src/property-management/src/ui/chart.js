/**
 * Minimal, dependency-free SVG charts.
 *
 * columnChart: grouped columns over categories (e.g. months), one axis,
 * hairline grid, 4px rounded data ends, 2px gaps, hover tooltip per band,
 * and a "view as table" toggle for screen readers and exact values.
 */
import { h, uniqueId } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  for (const k of kids) if (k) n.append(k);
  return n;
};

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Rounded-top bar path anchored to the baseline. */
function barPath(x, y, w, hgt) {
  const r = Math.min(4, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}

/**
 * categories: [{ label, values: [n, n] }]; series: [{ name, color }]
 * format(n) for values; short(n) for axis ticks.
 */
export function columnChart({ title, categories, series, format, short, height = 240 }) {
  const id = uniqueId('chart');
  const wrap = h('div.chart');
  const tip = h('div.chart-tip', { role: 'presentation', hidden: true });
  let asTable = false;
  const top = Math.max(0, ...categories.flatMap((c) => c.values));
  const max = niceMax(top);
  // With nothing to show, a scale would only repeat "$0"; keep the baseline.
  const ticks = top > 0 ? [0, max / 4, max / 2, (3 * max) / 4, max] : [0];

  let width = 640;
  function drawSvg() {
    const W = Math.max(280, width);
    const padL = 48;
    const padB = 26;
    const padT = 8;
    const plotW = W - padL - 8;
    const plotH = height - padB - padT;
    const band = plotW / Math.max(1, categories.length);
    const n = series.length;
    const barW = Math.min(24, (band * 0.7 - (n - 1) * 2) / n);
    const groupW = n * barW + (n - 1) * 2;
    const root = svg('svg', { viewBox: `0 0 ${W} ${height}`, width: W, height, class: 'chart-svg', role: 'img', 'aria-labelledby': `${id}-t` });
    root.append(svg('title', { id: `${id}-t` }, document.createTextNode(title)));
    for (const t of ticks) {
      const y = padT + plotH - (t / max) * plotH;
      root.append(svg('line', { x1: padL, x2: W - 8, y1: y, y2: y, class: 'chart-grid' }));
      const label = svg('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-axis' });
      label.textContent = short(t);
      root.append(label);
    }
    categories.forEach((c, i) => {
      const bx = padL + i * band;
      const gx = bx + (band - groupW) / 2;
      const g = svg('g', { class: 'chart-band' });
      g.append(svg('rect', { x: bx, y: padT, width: band, height: plotH, class: 'chart-hit' }));
      c.values.forEach((v, s) => {
        const bh = (v / max) * plotH;
        if (bh <= 0) return;
        g.append(svg('path', { d: barPath(gx + s * (barW + 2), padT + plotH - bh, barW, bh), fill: series[s].color }));
      });
      const lab = svg('text', { x: bx + band / 2, y: height - 8, 'text-anchor': 'middle', class: 'chart-axis' });
      lab.textContent = c.label;
      g.append(lab);
      g.addEventListener('pointerenter', () => showTip(c, bx + band / 2, W));
      g.addEventListener('pointerleave', () => (tip.hidden = true));
      root.append(g);
    });
    root.append(svg('line', { x1: padL, x2: W - 8, y1: padT + plotH, y2: padT + plotH, class: 'chart-base' }));
    return root;
  }

  function showTip(c, x, W) {
    tip.replaceChildren(
      h('div.chart-tip-title', c.full || c.label),
      ...series.map((s, i) => h('div.chart-tip-row', h('span.swatch', { style: { background: s.color } }), h('span.grow', s.name), h('span.money', format(c.values[i])))),
    );
    tip.hidden = false;
    // Centered on the month, but kept inside the chart: on a phone the
    // first and last months' tips would otherwise run off the screen.
    const box = tip.offsetParent;
    const cw = box?.clientWidth || 0;
    const tw = tip.offsetWidth;
    if (!cw || !tw) {
      tip.style.left = `${(x / W) * 100}%`;
      return;
    }
    tip.style.left = `${Math.max(tw / 2, Math.min(cw - tw / 2, (x / W) * cw))}px`;
  }

  function table() {
    return h(
      'div.table-wrap',
      { tabindex: '0', role: 'region', 'aria-label': `${title} as a table` },
      h(
        'table.table',
        h('caption.sr-only', title),
        h('thead', h('tr', h('th', { scope: 'col' }, 'Period'), series.map((s) => h('th.r', { scope: 'col' }, s.name)))),
        h('tbody', categories.map((c) => h('tr', h('th', { scope: 'row' }, c.full || c.label), c.values.map((v) => h('td.r.money', format(v)))))),
      ),
    );
  }

  function draw() {
    wrap.replaceChildren(
      h(
        'div.chart-top',
        series.length > 1 ? h('div.legend', series.map((s) => h('span', { style: { '--c': s.color } }, s.name))) : h('div'),
        h('button.btn.sm.ghost', { type: 'button', 'aria-pressed': String(asTable), onClick: () => ((asTable = !asTable), draw()) }, asTable ? 'View chart' : 'View as table'),
      ),
      asTable ? table() : h('div.chart-plot', drawSvg(), tip),
    );
  }
  draw();
  // Render at the real pixel width so text stays at its intended size.
  if (typeof ResizeObserver === 'function') {
    let raf = 0;
    new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (!w || Math.abs(w - width) < 4) return;
      width = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => !asTable && draw());
    }).observe(wrap);
  }
  return wrap;
}

/** Horizontal bar list: label, value text, single-hue bar. */
export function barList(rows, { format, color = 'var(--series-1)', empty = 'No data for this period.' } = {}) {
  if (!rows.length) return h('div.section-empty', empty);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h(
    'ul.bar-list',
    { role: 'list' },
    rows.map((r) =>
      h(
        'li.bar-item',
        h('span.truncate', r.label),
        h('span.money', { style: { fontWeight: '600' } }, format(r.value), r.sub ? h('span.subtle', { style: { fontWeight: '400' } }, ` · ${r.sub}`) : null),
        h('span.bar-track', { 'aria-hidden': 'true' }, h('span.bar-fill', { style: { width: `${Math.max(1, (r.value / max) * 100)}%`, '--c': r.color || color, display: 'block' } })),
      ),
    ),
  );
}
