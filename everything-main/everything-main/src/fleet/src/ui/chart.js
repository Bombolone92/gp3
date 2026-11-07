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

/**
 * Centre the tooltip over x (in viewBox units of width W), kept inside
 * the plot so the first and last columns' tips are not cut off on phones.
 */
function placeTip(tip, x, W) {
  const pw = tip.parentNode?.clientWidth || 0;
  const half = tip.offsetWidth / 2;
  if (!pw || !half) {
    tip.style.left = `${(x / W) * 100}%`;
    return;
  }
  tip.style.left = `${Math.max(half, Math.min(pw - half, (x / W) * pw))}px`;
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
export function columnChart({ title, categories, series, format, short, height = 240, stacked = false }) {
  const id = uniqueId('chart');
  const wrap = h('div.chart');
  const tip = h('div.chart-tip', { role: 'presentation', hidden: true });
  let asTable = false;
  const dataMax = Math.max(0, ...(stacked ? categories.map((c) => c.values.reduce((a, b) => a + b, 0)) : categories.flatMap((c) => c.values)));
  const max = niceMax(dataMax);
  // With nothing to show, only the zero line is labelled (not "$0" five times).
  const ticks = dataMax > 0 ? [0, max / 4, max / 2, (3 * max) / 4, max] : [0];

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
    const barW = stacked ? Math.min(36, band * 0.6) : Math.min(24, (band * 0.7 - (n - 1) * 2) / n);
    const groupW = stacked ? barW : n * barW + (n - 1) * 2;
    const root = svg('svg', { viewBox: `0 0 ${W} ${height}`, width: W, height, class: 'chart-svg', role: 'img', 'aria-labelledby': `${id}-t` });
    root.append(svg('title', { id: `${id}-t` }, document.createTextNode(title)));
    const seen = new Set();
    for (const t of ticks) {
      const y = padT + plotH - (t / max) * plotH;
      root.append(svg('line', { x1: padL, x2: W - 8, y1: y, y2: y, class: 'chart-grid' }));
      // Tiny ranges round several ticks to the same text; label each once.
      const text = short(t);
      if (seen.has(text)) continue;
      seen.add(text);
      const label = svg('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-axis' });
      label.textContent = text;
      root.append(label);
    }
    categories.forEach((c, i) => {
      const bx = padL + i * band;
      const gx = bx + (band - groupW) / 2;
      const g = svg('g', { class: 'chart-band' });
      g.append(svg('rect', { x: bx, y: padT, width: band, height: plotH, class: 'chart-hit' }));
      if (stacked) {
        // Segments bottom to top with a 1px surface gap; only the top one is rounded.
        let base = padT + plotH;
        const top = c.values.reduce((last, v, s) => (v > 0 ? s : last), -1);
        c.values.forEach((v, s) => {
          const bh = (v / max) * plotH;
          if (bh <= 0) return;
          const y = base - bh;
          const d = s === top ? barPath(gx, y, barW, bh) : `M${gx},${base}V${y}H${gx + barW}V${base}Z`;
          g.append(svg('path', { d, fill: series[s].color, class: 'chart-seg' }));
          base = y;
        });
      } else {
        c.values.forEach((v, s) => {
          const bh = (v / max) * plotH;
          if (bh <= 0) return;
          g.append(svg('path', { d: barPath(gx + s * (barW + 2), padT + plotH - bh, barW, bh), fill: series[s].color }));
        });
      }
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
      stacked && series.length > 1 ? h('div.chart-tip-row.total', h('span.grow', 'Total'), h('span.money', format(c.values.reduce((a, b) => a + b, 0)))) : null,
    );
    tip.hidden = false;
    placeTip(tip, x, W);
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

  let toggle = null;
  function draw() {
    // The toggle is rebuilt; keep focus on it for keyboard users.
    const refocus = toggle !== null && document.activeElement === toggle;
    toggle = h('button.btn.sm.ghost', { type: 'button', 'aria-pressed': String(asTable), onClick: () => ((asTable = !asTable), draw()) }, asTable ? 'View chart' : 'View as table');
    wrap.replaceChildren(
      h('div.chart-top', series.length > 1 ? h('div.legend', series.map((s) => h('span', { style: { '--c': s.color } }, s.name))) : h('div'), toggle),
      asTable ? table() : h('div.chart-plot', drawSvg(), tip),
    );
    if (refocus) toggle.focus({ preventScroll: true });
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

/** Horizontal bar list: label, value text, single-hue bar. format(value, row). */
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
        h('span.money', { style: { fontWeight: '600' } }, format(r.value, r), r.sub ? h('span.subtle', { style: { fontWeight: '400' } }, ` · ${r.sub}`) : null),
        h('span.bar-track', { 'aria-hidden': 'true' }, h('span.bar-fill', { style: { width: `${Math.max(1, (r.value / max) * 100)}%`, '--c': r.color || color, display: 'block' } })),
      ),
    ),
  );
}

/**
 * Line chart for a trend (fuel economy, meter usage). points: [{ label,
 * full?, value | null }]. Gaps where value is null.
 */
export function lineChart({ title, points, format, short = format, height = 200, color = 'var(--series-1)' }) {
  const id = uniqueId('chart');
  const wrap = h('div.chart');
  const tip = h('div.chart-tip', { role: 'presentation', hidden: true });
  const vals = points.map((p) => p.value).filter((v) => v !== null && v !== undefined);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const span = hi - lo || Math.abs(hi) || 1;
  const min = Math.max(0, lo - span * 0.25);
  const max = hi + span * 0.25;
  let width = 640;
  let asTable = false;
  function drawSvg() {
    const W = Math.max(280, width);
    const padL = 48;
    const padB = 26;
    const padT = 10;
    const plotW = W - padL - 12;
    const plotH = height - padB - padT;
    const x = (i) => padL + (points.length < 2 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const y = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;
    const root = svg('svg', { viewBox: `0 0 ${W} ${height}`, width: W, height, class: 'chart-svg', role: 'img', 'aria-labelledby': `${id}-t` });
    root.append(svg('title', { id: `${id}-t` }, document.createTextNode(title)));
    for (let k = 0; k <= 3; k++) {
      const t = min + ((max - min) * k) / 3;
      const yy = y(t);
      root.append(svg('line', { x1: padL, x2: W - 12, y1: yy, y2: yy, class: 'chart-grid' }));
      const label = svg('text', { x: padL - 8, y: yy + 4, 'text-anchor': 'end', class: 'chart-axis' });
      label.textContent = short(t);
      root.append(label);
    }
    let d = '';
    points.forEach((p, i) => {
      if (p.value === null || p.value === undefined) return;
      d += `${d && points[i - 1]?.value != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    });
    root.append(svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 70))));
    points.forEach((p, i) => {
      if (i % every === 0 || i === points.length - 1) {
        const lab = svg('text', { x: x(i), y: height - 8, 'text-anchor': 'middle', class: 'chart-axis' });
        lab.textContent = p.label;
        root.append(lab);
      }
      if (p.value === null || p.value === undefined) return;
      const dot = svg('circle', { cx: x(i), cy: y(p.value), r: 3.5, fill: 'var(--surface)', stroke: color, 'stroke-width': 2 });
      const hit = svg('rect', { x: x(i) - plotW / points.length / 2, y: padT, width: Math.max(8, plotW / points.length), height: plotH, class: 'chart-hit' });
      hit.addEventListener('pointerenter', () => {
        tip.replaceChildren(h('div.chart-tip-title', p.full || p.label), h('div.chart-tip-row', h('span.swatch', { style: { background: color } }), h('span.money', format(p.value))));
        tip.hidden = false;
        placeTip(tip, x(i), W);
      });
      hit.addEventListener('pointerleave', () => (tip.hidden = true));
      root.append(hit, dot);
    });
    return root;
  }
  function table() {
    return h(
      'div.table-wrap',
      { tabindex: '0', role: 'region', 'aria-label': `${title} as a table` },
      h('table.table', h('caption.sr-only', title), h('thead', h('tr', h('th', { scope: 'col' }, 'Point'), h('th.r', { scope: 'col' }, 'Value'))), h('tbody', points.map((p) => h('tr', h('th', { scope: 'row' }, p.full || p.label), h('td.r', p.value == null ? '' : format(p.value)))))),
    );
  }
  let toggle = null;
  function draw() {
    const refocus = toggle !== null && document.activeElement === toggle;
    toggle = h('button.btn.sm.ghost', { type: 'button', 'aria-pressed': String(asTable), onClick: () => ((asTable = !asTable), draw()) }, asTable ? 'View chart' : 'View as table');
    wrap.replaceChildren(
      h('div.chart-top', h('div'), toggle),
      asTable ? table() : vals.length ? h('div.chart-plot', drawSvg(), tip) : h('div.section-empty', 'Not enough data yet.'),
    );
    if (refocus) toggle.focus({ preventScroll: true });
  }
  draw();
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

/**
 * One horizontal bar split into parts (vehicle status mix), with a legend
 * that doubles as the accessible description. parts: [{ label, value, color, href? }]
 */
export function stackBar(parts, { label = 'Breakdown' } = {}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return h(
    'div.stack-bar-wrap',
    h(
      'div.stack-bar',
      { role: 'img', 'aria-label': `${label}: ${shown.map((p) => `${p.label} ${p.value}`).join(', ') || 'none'}` },
      shown.map((p) => h('span.stack-seg', { style: { flexGrow: String(p.value), background: p.color }, title: `${p.label}: ${p.value}` })),
    ),
    h(
      'ul.stack-legend',
      parts.map((p) =>
        h(
          'li',
          h('span.swatch', { style: { background: p.color }, 'aria-hidden': 'true' }),
          p.href ? h('a', { href: p.href }, p.label) : h('span', p.label),
          h('span.num.strong', String(p.value)),
          h('span.subtle.num', total ? `${Math.round((p.value / total) * 100)}%` : ''),
        ),
      ),
    ),
  );
}
