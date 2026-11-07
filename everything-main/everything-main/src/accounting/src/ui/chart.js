/**
 * Small canvas charts for the home page: grouped columns and a donut.
 *
 * Canvas, not SVG: one element per chart however many marks it draws, redrawn
 * only on resize or theme change, at device pixel ratio. Identity is never
 * color alone: every chart has an HTML legend (with values, for the donut), a
 * hover tooltip, a text summary for screen readers, and a "View as table"
 * toggle that swaps the plot for a real table.
 *
 * Marks follow the house specs: columns at most 24px wide with a 4px rounded
 * data end and a square base, a 2px surface gap between touching marks,
 * hairline solid gridlines, text in text colors (never the series color).
 */
import { el, nextId } from './dom.js';
import { formatMoney, currentCurrency } from '../lib/money.js';

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function seriesColor(i) {
  return `--chart-${(i % 8) + 1}`;
}

let compactFmt = null;
let compactKey = '';
function compact(cents) {
  // Axis labels in the company currency, shortened: $12K, 3,4 Mio. EUR, ...
  const currency = currentCurrency();
  if (compactKey !== currency) {
    try { compactFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }); } catch { compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }); }
    compactKey = currency;
  }
  return compactFmt.format(cents / 100);
}

function niceMax(v) {
  if (v <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function setupCanvas(canvas, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function roundTop(ctx, x, y, w, h, r) {
  // Rounded at the data end only; square where the column meets the baseline.
  const rr = Math.min(r, w / 2, Math.abs(h));
  if (h >= 0) {
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y - h - rr);
    ctx.arcTo(x + w, y - h, x + w - rr, y - h, rr);
    ctx.lineTo(x + rr, y - h);
    ctx.arcTo(x, y - h, x, y - h - rr, rr);
  }
  ctx.closePath();
}

function legendNode(items) {
  return el('ul.chart-legend', { 'aria-hidden': 'true' }, items.map((it) => el('li', {},
    el('span.chart-swatch', { style: { background: `var(${it.color})` } }),
    el('span', {}, it.label),
    it.value !== undefined ? el('span.chart-legend-value', {}, it.value) : null)));
}

function tableNode(caption, head, rows) {
  return el('table.grid.chart-table', {},
    el('caption.sr-only', {}, caption),
    el('thead', {}, el('tr', {}, head.map((h, i) => el(`th${i ? '.num' : ''}`, { scope: 'col' }, h)))),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, i) => (i ? el('td.num', {}, c) : el('th', { scope: 'row', style: { textAlign: 'left', fontWeight: 500 } }, c)))))));
}

/** Shell shared by both charts: legend, plot, tooltip, table toggle. */
function frame({ title, legend, summary, table, height }) {
  const canvas = el('canvas', { role: 'img', 'aria-label': summary });
  const tip = el('div.chart-tip', { hidden: true, 'aria-hidden': 'true' });
  const plot = el('div.chart-plot', { style: { height: `${height}px` } }, canvas, tip);
  const tableWrap = el('div.chart-table-wrap', { hidden: true }, table);
  const toggle = el('button.btn-link.chart-toggle', { type: 'button', 'aria-pressed': 'false' }, 'View as table');
  toggle.addEventListener('click', () => {
    const on = tableWrap.hidden;
    tableWrap.hidden = !on;
    plot.hidden = on;
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? 'View as chart' : 'View as table';
  });
  const root = el('figure.chart', {},
    el('figcaption.sr-only', {}, title),
    legend,
    plot,
    tableWrap,
    el('div.chart-foot', {}, toggle));
  return { root, canvas, tip, plot };
}

function observe(root, draw) {
  let raf = 0;
  let dpr = null;
  const cleanup = () => {
    ro.disconnect();
    document.removeEventListener('themechange', redraw);
    dpr?.removeEventListener('change', onDpr);
  };
  // A chart that has left the page lets go of its observers on the next
  // resize, theme change, or pixel ratio change instead of watching the
  // whole document for removal.
  const redraw = () => {
    if (!root.isConnected) { cleanup(); return; }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };
  // Moving the window to a screen with another pixel ratio (or zooming)
  // redraws at the new ratio, so the chart stays sharp.
  const watchDpr = () => {
    dpr?.removeEventListener('change', onDpr);
    dpr = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dpr.addEventListener('change', onDpr);
  };
  function onDpr() {
    redraw();
    if (root.isConnected) watchDpr();
  }
  const ro = new ResizeObserver(redraw);
  ro.observe(root);
  document.addEventListener('themechange', redraw);
  watchDpr();
}

/**
 * Grouped columns. categories: ['Jan', ...]; series: [{ name, values: [cents] }].
 */
export function columnChart({ title, categories, series, height = 220, colors = null, onSelect = null }) {
  const colorOf = (i) => (colors ? colors[i] : seriesColor(i));
  const legend = series.length > 1 ? legendNode(series.map((s, i) => ({ label: s.name, color: colorOf(i) }))) : null;
  const totals = series.map((s) => s.values.reduce((a, b) => a + b, 0));
  const summary = `${title}. ${series.map((s, i) => `${s.name} total ${formatMoney(totals[i])}`).join('; ')}.`;
  const table = tableNode(title, ['Period', ...series.map((s) => s.name)], categories.map((c, ci) => [c, ...series.map((s) => formatMoney(s.values[ci]))]));
  const f = frame({ title, legend, summary, table, height });
  let hover = -1;
  let geom = null;

  const draw = () => {
    const w = f.plot.clientWidth;
    if (!w) return;
    const ctx = setupCanvas(f.canvas, w, height);
    const ink = cssVar('--text-3');
    const grid = cssVar('--chart-grid');
    const surface = cssVar('--surface');
    // At least $100, so an empty chart (or one of a few cents) gets whole-dollar
    // ticks instead of five labels that all round to $0.
    const max = niceMax(Math.max(10000, ...series.flatMap((s) => s.values)));
    const min = Math.min(0, ...series.flatMap((s) => s.values));
    const floor = min < 0 ? -niceMax(-min) : 0;
    const left = 46;
    const right = 8;
    const top = 8;
    const bottom = 24;
    const ph = height - top - bottom;
    const pw = w - left - right;
    const y = (v) => top + ph * (1 - (v - floor) / (max - floor));
    ctx.font = `11.5px ${cssVar('--font')}`;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const v = floor + ((max - floor) * t) / ticks;
      const yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(w - right, yy);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.textAlign = 'right';
      ctx.fillText(compact(v), left - 8, yy);
    }
    const band = pw / categories.length;
    const n = series.length;
    const gap = 2;
    const barW = Math.max(3, Math.min(24, (band * 0.7 - gap * (n - 1)) / n));
    const groupW = barW * n + gap * (n - 1);
    geom = { left, band, top, ph };
    if (hover >= 0) {
      ctx.fillStyle = cssVar('--surface-3');
      ctx.fillRect(left + band * hover, top, band, ph);
    }
    categories.forEach((c, ci) => {
      const gx = left + band * ci + (band - groupW) / 2;
      series.forEach((s, si) => {
        const v = s.values[ci] || 0;
        if (!v) return;
        const x = gx + si * (barW + gap);
        const y0 = y(0);
        const y1 = y(v);
        ctx.fillStyle = cssVar(colorOf(si));
        ctx.beginPath();
        if (v >= 0) roundTop(ctx, x, y1, barW, y0 - y1, 4);
        else roundTop(ctx, x, y0, barW, -(y1 - y0), 4);
        ctx.fill();
      });
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      if (categories.length <= 12 || ci % Math.ceil(categories.length / 12) === 0) ctx.fillText(c, left + band * ci + band / 2, height - bottom / 2 + 2);
    });
    // Baseline.
    ctx.strokeStyle = cssVar('--line-strong');
    ctx.beginPath();
    ctx.moveTo(left, Math.round(y(0)) + 0.5);
    ctx.lineTo(w - right, Math.round(y(0)) + 0.5);
    ctx.stroke();
    void surface;
  };

  f.plot.addEventListener('mousemove', (e) => {
    if (!geom) return;
    const r = f.plot.getBoundingClientRect();
    const x = e.clientX - r.left;
    const i = Math.floor((x - geom.left) / geom.band);
    const next = i >= 0 && i < categories.length ? i : -1;
    if (next !== hover) {
      hover = next;
      draw();
    }
    if (hover < 0) { f.tip.hidden = true; return; }
    f.tip.replaceChildren(
      el('div.chart-tip-title', {}, categories[hover]),
      ...series.map((s, si) => el('div.chart-tip-row', {}, el('span.chart-swatch', { style: { background: `var(${colorOf(si)})` } }), el('span', {}, s.name), el('span.chart-tip-value', {}, formatMoney(s.values[hover] || 0)))));
    f.tip.hidden = false;
    const tx = Math.min(Math.max(8, x + 12), r.width - f.tip.offsetWidth - 8);
    f.tip.style.left = `${tx}px`;
    f.tip.style.top = '8px';
  });
  f.plot.addEventListener('mouseleave', () => { hover = -1; f.tip.hidden = true; draw(); });
  if (onSelect) {
    f.plot.style.cursor = 'pointer';
    f.plot.addEventListener('click', () => { if (hover >= 0) onSelect(hover); });
  }
  observe(f.root, draw);
  requestAnimationFrame(draw);
  return f.root;
}

/**
 * Donut. slices: [{ label, value (cents) }] in display order; slices past
 * the eighth fold into "Other".
 */
export function donutChart({ title, slices, height = 200, centerLabel = 'Total', onSelect = null }) {
  let list = slices.filter((s) => s.value > 0);
  if (list.length > 8) {
    const head = list.slice(0, 7);
    const rest = list.slice(7).reduce((a, s) => a + s.value, 0);
    list = [...head, { label: 'Other', value: rest, other: true }];
  }
  const total = list.reduce((a, s) => a + s.value, 0);
  const colorOf = (i) => (list[i].other ? '--chart-other' : seriesColor(i));
  const legend = legendNode(list.map((s, i) => ({ label: s.label, color: colorOf(i), value: formatMoney(s.value) })));
  const summary = `${title}. Total ${formatMoney(total)}. ${list.map((s) => `${s.label} ${formatMoney(s.value)}`).join('; ')}.`;
  const table = tableNode(title, ['Category', 'Amount', 'Share'], list.map((s) => [s.label, formatMoney(s.value), `${total ? Math.round((s.value / total) * 100) : 0}%`]));
  const f = frame({ title, legend: null, summary, table, height });
  f.root.classList.add('chart-donut');
  f.root.insertBefore(el('div.chart-donut-row', {}, f.plot, legend), f.root.querySelector('.chart-table-wrap'));
  let hover = -1;
  let angles = [];

  const draw = () => {
    const size = height;
    f.plot.style.width = `${size}px`;
    const ctx = setupCanvas(f.canvas, size, size);
    const cx = size / 2;
    const cy = size / 2;
    const outer = size / 2 - 4;
    const inner = outer * 0.64;
    let a = -Math.PI / 2;
    angles = [];
    const surface = cssVar('--surface');
    list.forEach((s, i) => {
      const sweep = total ? (s.value / total) * Math.PI * 2 : 0;
      angles.push([a, a + sweep]);
      ctx.beginPath();
      const o = i === hover ? outer + 3 : outer;
      ctx.arc(cx, cy, o, a, a + sweep);
      ctx.arc(cx, cy, inner, a + sweep, a, true);
      ctx.closePath();
      ctx.fillStyle = cssVar(colorOf(i));
      ctx.fill();
      a += sweep;
    });
    // 2px surface gaps between slices.
    if (list.length > 1) {
      ctx.strokeStyle = surface;
      ctx.lineWidth = 2;
      for (const [s] of angles) {
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(s) * (inner - 1), cy + Math.sin(s) * (inner - 1));
        ctx.lineTo(cx + Math.cos(s) * (outer + 4), cy + Math.sin(s) * (outer + 4));
        ctx.stroke();
      }
    }
    ctx.fillStyle = cssVar('--text-3');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `12px ${cssVar('--font')}`;
    const shown = hover >= 0 ? list[hover] : null;
    ctx.fillText(shown ? shown.label.slice(0, 18) : centerLabel, cx, cy - 11);
    ctx.fillStyle = cssVar('--text');
    ctx.font = `600 16px ${cssVar('--font')}`;
    ctx.fillText(compact(shown ? shown.value : total), cx, cy + 9);
  };

  f.plot.addEventListener('mousemove', (e) => {
    const r = f.canvas.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    const d = Math.hypot(x, y);
    let ang = Math.atan2(y, x);
    if (ang < -Math.PI / 2) ang += Math.PI * 2;
    let next = -1;
    if (d > r.width * 0.3 && d < r.width / 2) next = angles.findIndex(([s, en]) => ang >= s && ang < en);
    if (next !== hover) { hover = next; draw(); }
  });
  f.plot.addEventListener('mouseleave', () => { hover = -1; draw(); });
  if (onSelect) {
    f.plot.style.cursor = 'pointer';
    f.plot.addEventListener('click', () => { if (hover >= 0) onSelect(list[hover]); });
  }
  observe(f.root, draw);
  requestAnimationFrame(draw);
  return f.root;
}

export { compact, nextId };
