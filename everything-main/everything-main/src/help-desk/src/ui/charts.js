/**
 * Small canvas charts for reports: line, column, horizontal bar and heatmap.
 * Each chart is a <figure> with a title, a legend, a canvas that redraws at
 * the device pixel ratio when its box or the theme changes, a tooltip that
 * follows the pointer or the arrow keys, and a "View as table" toggle that
 * exposes the same numbers to everyone.
 *
 * Colors are CSS custom property names (e.g. '--chart-1'), read at draw
 * time so light, dark and system themes stay in sync.
 */
import { h, clear, uid } from './dom.js';
import { icon } from './icons.js';

const nf = new Intl.NumberFormat();

function cssVar(name, fallback = '#888') {
  if (!name) return fallback;
  if (!name.startsWith('--')) return name;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** A "nice" axis maximum and step for a value range starting at zero. */
export function niceScale(max, ticks = 4) {
  if (!(max > 0)) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const niceStep = step < 1 ? 1 : step;
  return { max: Math.ceil(max / niceStep) * niceStep, step: niceStep };
}

/** Which of `count` x labels to draw so they do not overlap. */
export function labelStride(count, width, labelWidth = 56) {
  if (count <= 1) return 1;
  const fit = Math.max(1, Math.floor(width / labelWidth));
  return Math.max(1, Math.ceil(count / fit));
}

const themeListeners = new Set();
let themeWired = false;
function onTheme(fn) {
  if (!themeWired && typeof window !== 'undefined') {
    themeWired = true;
    const fire = () => themeListeners.forEach((f) => f());
    window.addEventListener('themechange', fire);
    window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', fire);
  }
  themeListeners.add(fn);
  return () => themeListeners.delete(fn);
}

/**
 * spec:
 *   kind: 'line' | 'column' | 'hbar' | 'heatmap'
 *   title, summary (accessible text), height
 *   labels: x (or y for hbar) category labels; tooltipLabels optional
 *   series: [{ name, color: '--chart-1', values: [] }]  (hbar: colors per bar via `colors`)
 *   stacked: column only
 *   format(v): value formatter
 *   rows, cols, values[r][c]: heatmap
 *   empty: text when there is no data
 */
export function createChart(spec) {
  const titleId = uid('chart-title');
  const descId = uid('chart-desc');
  const tableId = uid('chart-table');
  const canvas = h('canvas.chart-canvas', { tabindex: '0', role: 'img', 'aria-labelledby': titleId, 'aria-describedby': descId });
  const tip = h('div.chart-tip', { hidden: true, role: 'status', 'aria-live': 'polite' });
  const plot = h('div.chart-plot', canvas, tip);
  const legend = h('ul.chart-legend', { 'aria-hidden': 'true' });
  const desc = h(`p#${descId}.sr-only`);
  const tableWrap = h(`div#${tableId}.chart-table-wrap`, { hidden: true });
  const emptyEl = h('div.chart-empty', { hidden: true });
  const toggle = h('button.btn.btn-ghost.btn-sm.chart-toggle', {
    type: 'button', 'aria-expanded': 'false', 'aria-controls': tableId,
    onclick: () => {
      const show = tableWrap.hidden;
      tableWrap.hidden = !show;
      plot.hidden = show || isEmpty();
      toggle.setAttribute('aria-expanded', String(show));
      clear(toggle);
      toggle.append(icon(show ? 'chart-column' : 'list', { size: 14 }), show ? 'View as chart' : 'View as table');
      if (!show) schedule();
    },
  }, icon('list', { size: 14 }), 'View as table');
  const titleEl = h(`h3#${titleId}.chart-title`, spec.title);
  const fig = h('figure.chart', { 'data-kind': spec.kind },
    h('figcaption.chart-head', h('div.chart-head-text', titleEl, spec.subtitle ? h('p.chart-subtitle', spec.subtitle) : null), toggle),
    legend, plot, emptyEl, tableWrap, desc);

  let current = spec;
  let active = null; // index (or [row, col] for heatmap)
  let geometry = null;
  let frame = 0;
  let width = 0;

  const fmt = (v) => (current.format ? current.format(v) : nf.format(v));

  function isEmpty() {
    if (current.kind === 'heatmap') return !(current.values || []).some((r) => r.some((v) => v > 0));
    return !(current.series || []).some((s) => s.values.some((v) => v > 0));
  }

  function paintStatic() {
    titleEl.textContent = current.title;
    desc.textContent = current.summary || '';
    clear(legend);
    if (current.kind === 'heatmap') {
      legend.append(h('li', h('span.chart-swatch.heat-low'), 'Fewer'), h('li', h('span.chart-swatch', { style: { background: cssVar(current.color || '--chart-1') } }), 'More'));
    } else if (current.kind === 'hbar') {
      legend.hidden = true;
    } else {
      legend.hidden = (current.series || []).length < 2;
      for (const s of current.series || []) legend.append(h('li', h('span.chart-swatch', { style: { background: cssVar(s.color) } }), s.name));
    }
    const empty = isEmpty();
    emptyEl.hidden = !empty;
    emptyEl.textContent = current.empty || 'No data for this period';
    plot.hidden = empty || !tableWrap.hidden;
    paintTable();
  }

  function paintTable() {
    clear(tableWrap);
    const table = h('table.table.chart-table');
    if (current.kind === 'heatmap') {
      table.append(h('caption.sr-only', current.title), h('thead', h('tr', h('th', { scope: 'col' }, ''), current.cols.map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', current.rows.map((r, ri) => h('tr', h('th', { scope: 'row' }, r), current.values[ri].map((v) => h('td.num', nf.format(v)))))));
    } else {
      const series = current.series || [];
      table.append(h('caption.sr-only', current.title), h('thead', h('tr', h('th', { scope: 'col' }, current.categoryLabel || ''), series.map((s) => h('th.num', { scope: 'col' }, s.name)))),
        h('tbody', (current.labels || []).map((l, i) => h('tr', h('th', { scope: 'row' }, (current.tooltipLabels || current.labels)[i] ?? l), series.map((s) => h('td.num', s.values[i] === null || s.values[i] === undefined ? '-' : fmt(s.values[i])))))));
    }
    tableWrap.append(table);
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  function setupCanvas() {
    const w = plot.clientWidth;
    const hgt = current.height || (current.kind === 'heatmap' ? 7 * 26 + 30 : current.kind === 'hbar' ? Math.max(1, (current.labels || []).length) * 34 + 8 : 220);
    if (!w) return null;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${hgt}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    return { ctx, w, h: hgt };
  }

  function font(ctx, size = 11, weight = 400) {
    const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
    ctx.font = `${weight} ${size}px ${family}`;
  }

  function drawAxes(ctx, area, scale) {
    const grid = cssVar('--chart-grid', '#e5e7eb');
    const muted = cssVar('--text-subtle', '#888');
    font(ctx, 11);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= scale.max + 1e-9; v += scale.step) {
      const y = area.y + area.h - (v / scale.max) * area.h;
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(area.x, Math.round(y) + 0.5);
      ctx.lineTo(area.x + area.w, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.fillText(current.axisFormat ? current.axisFormat(v) : nf.format(v), area.x - 8, y);
    }
  }

  function drawXLabels(ctx, area, n, xAt) {
    const muted = cssVar('--text-subtle', '#888');
    const stride = labelStride(n, area.w);
    font(ctx, 11);
    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < n; i += stride) ctx.fillText(current.labels[i], xAt(i), area.y + area.h + 8);
  }

  function draw() {
    if (plot.hidden) return;
    const c = setupCanvas();
    if (!c) return;
    const { ctx, w } = c;
    if (current.kind === 'line' || current.kind === 'column') drawXY(ctx, w, c.h);
    else if (current.kind === 'hbar') drawHbar(ctx, w);
    else drawHeat(ctx, w);
  }

  function axisWidth(ctx, max) {
    font(ctx, 11);
    return Math.ceil(ctx.measureText(current.axisFormat ? current.axisFormat(max) : nf.format(max)).width) + 14;
  }

  function drawXY(ctx, w, hgt) {
    const series = current.series || [];
    const n = (current.labels || []).length;
    const stacked = current.kind === 'column' && current.stacked;
    let max = 0;
    for (let i = 0; i < n; i++) {
      if (stacked) max = Math.max(max, series.reduce((s, x) => s + (x.values[i] || 0), 0));
      else for (const s of series) max = Math.max(max, s.values[i] || 0);
    }
    if (current.maxValue) max = Math.max(max, current.maxValue);
    const scale = current.fixedMax ? { max: current.fixedMax, step: current.fixedMax / 4 } : niceScale(max);
    const left = axisWidth(ctx, scale.max);
    const area = { x: left, y: 10, w: Math.max(10, w - left - 8), h: hgt - 10 - 26 };
    drawAxes(ctx, area, scale);
    const band = area.w / Math.max(1, n);
    const xAt = (i) => (current.kind === 'line' ? area.x + (n === 1 ? area.w / 2 : (i / (n - 1)) * area.w) : area.x + band * i + band / 2);
    const yAt = (v) => area.y + area.h - (v / scale.max) * area.h;
    if (active !== null && typeof active === 'number') {
      ctx.fillStyle = cssVar('--bg-hover', '#f3f4f6');
      const x = xAt(active);
      const bw = current.kind === 'line' ? Math.max(8, Math.min(28, area.w / Math.max(1, n - 1))) : band;
      ctx.fillRect(x - bw / 2, area.y, bw, area.h);
    }
    if (current.kind === 'line') {
      for (const s of series) {
        const color = cssVar(s.color);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < n; i++) {
          const v = s.values[i];
          if (v === null || v === undefined) {
            started = false;
            continue;
          }
          const x = xAt(i);
          const y = yAt(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (n <= 40 || active !== null) {
          for (let i = 0; i < n; i++) {
            const v = s.values[i];
            if (v === null || v === undefined) continue;
            if (n > 40 && i !== active) continue;
            ctx.fillStyle = i === active ? color : cssVar('--surface', '#fff');
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(xAt(i), yAt(v), i === active ? 4.5 : 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }
    } else {
      const groups = stacked ? 1 : series.length;
      const inner = Math.max(2, Math.min(36, band * 0.72));
      const bw = Math.max(1, inner / groups - (groups > 1 ? 2 : 0));
      for (let i = 0; i < n; i++) {
        let base = 0;
        series.forEach((s, si) => {
          const v = s.values[i] || 0;
          if (!v) return;
          ctx.fillStyle = cssVar(s.color);
          const x = stacked ? xAt(i) - inner / 2 : xAt(i) - inner / 2 + si * (bw + 2);
          const y0 = yAt(base);
          const y1 = yAt(base + v);
          roundRect(ctx, x, y1, stacked ? inner : bw, Math.max(1, y0 - y1), stacked && base > 0 ? 0 : 2);
          if (stacked) base += v;
        });
      }
    }
    drawXLabels(ctx, area, n, xAt);
    geometry = { kind: 'xy', area, n, xAt, yAt, band };
  }

  function drawHbar(ctx, w) {
    const values = current.series[0].values;
    const labels = current.labels;
    const n = labels.length;
    const max = Math.max(1, ...values);
    font(ctx, 12, 500);
    const labelW = Math.min(w * 0.4, Math.max(...labels.map((l) => ctx.measureText(l).width)) + 16);
    const valueW = Math.max(...values.map((v) => ctx.measureText(fmt(v)).width)) + 12;
    const area = { x: labelW, y: 4, w: Math.max(10, w - labelW - valueW), rowH: 34 };
    for (let i = 0; i < n; i++) {
      const y = area.y + i * area.rowH;
      if (i === active) {
        ctx.fillStyle = cssVar('--bg-hover', '#f3f4f6');
        ctx.fillRect(0, y, w, area.rowH);
      }
      ctx.fillStyle = cssVar('--text', '#111');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      font(ctx, 12, 500);
      ctx.fillText(labels[i], 4, y + area.rowH / 2, labelW - 12);
      ctx.fillStyle = cssVar('--bg-muted', '#eee');
      roundRect(ctx, area.x, y + 9, area.w, area.rowH - 18, 3);
      ctx.fillStyle = cssVar(current.colors?.[i] || current.series[0].color);
      const bw = (values[i] / max) * area.w;
      if (bw > 0) roundRect(ctx, area.x, y + 9, Math.max(3, bw), area.rowH - 18, 3);
      ctx.fillStyle = cssVar('--text-muted', '#666');
      ctx.textAlign = 'right';
      font(ctx, 12, 600);
      ctx.fillText(fmt(values[i]), w - 4, y + area.rowH / 2);
    }
    geometry = { kind: 'hbar', area, n };
  }

  function drawHeat(ctx, w) {
    const rows = current.rows;
    const cols = current.cols;
    const values = current.values;
    font(ctx, 11);
    const labelW = Math.max(...rows.map((r) => ctx.measureText(r).width)) + 12;
    const area = { x: labelW, y: 4, w: Math.max(10, w - labelW - 4) };
    const cw = area.w / cols.length;
    const ch = 26;
    const max = Math.max(1, ...values.flat());
    const base = cssVar(current.color || '--chart-1');
    const empty = cssVar('--bg-muted', '#eee');
    for (let r = 0; r < rows.length; r++) {
      ctx.fillStyle = cssVar('--text-muted', '#666');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(rows[r], labelW - 8, area.y + r * ch + ch / 2);
      for (let c = 0; c < cols.length; c++) {
        const v = values[r][c];
        const x = area.x + c * cw;
        const y = area.y + r * ch;
        ctx.fillStyle = empty;
        roundRect(ctx, x + 1, y + 1, cw - 2, ch - 2, 3);
        if (v > 0) {
          ctx.globalAlpha = 0.18 + 0.82 * (v / max);
          ctx.fillStyle = base;
          roundRect(ctx, x + 1, y + 1, cw - 2, ch - 2, 3);
          ctx.globalAlpha = 1;
        }
        if (Array.isArray(active) && active[0] === r && active[1] === c) {
          ctx.strokeStyle = cssVar('--text', '#111');
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
        }
      }
    }
    ctx.fillStyle = cssVar('--text-subtle', '#888');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const stride = labelStride(cols.length, area.w, 30);
    for (let c = 0; c < cols.length; c += stride) ctx.fillText(cols[c], area.x + c * cw + cw / 2, area.y + rows.length * ch + 6);
    geometry = { kind: 'heat', area, cw, ch, rows: rows.length, cols: cols.length };
  }

  function roundRect(ctx, x, y, w, hh, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, hh, Math.min(r, w / 2, hh / 2));
    else ctx.rect(x, y, w, hh);
    ctx.fill();
  }

  /* Tooltip */
  function showTip(clientX, clientY, fromKeyboard = false) {
    if (active === null || !geometry) {
      tip.hidden = true;
      return;
    }
    clear(tip);
    if (geometry.kind === 'heat') {
      const [r, c] = active;
      tip.append(h('strong', `${current.rows[r]} ${current.cols[c]}`), h('div', `${fmt(current.values[r][c])} ${current.unit || ''}`.trim()));
    } else {
      const i = active;
      tip.append(h('strong', (current.tooltipLabels || current.labels)[i]));
      for (const s of current.series) {
        const v = s.values[i];
        tip.append(h('div.chart-tip-row', current.kind === 'hbar' ? null : h('span.chart-swatch', { style: { background: cssVar(s.color) } }), h('span', current.kind === 'hbar' ? '' : `${s.name}`), h('strong', v === null || v === undefined ? '-' : fmt(v))));
      }
    }
    tip.hidden = false;
    const rect = plot.getBoundingClientRect();
    let x;
    let y;
    if (fromKeyboard || clientX === undefined) {
      if (geometry.kind === 'xy') {
        x = geometry.xAt(active);
        y = 12;
      } else if (geometry.kind === 'hbar') {
        x = geometry.area.x + 40;
        y = geometry.area.y + active * geometry.area.rowH + geometry.area.rowH;
      } else {
        x = geometry.area.x + active[1] * geometry.cw + geometry.cw / 2;
        y = geometry.area.y + active[0] * geometry.ch + geometry.ch + 4;
      }
    } else {
      x = clientX - rect.left;
      y = clientY - rect.top + 14;
    }
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(rect.width - tw, x - tw / 2))}px`;
    tip.style.top = `${Math.max(0, y)}px`;
  }

  function hitTest(clientX, clientY) {
    if (!geometry) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (geometry.kind === 'xy') {
      const { area, n } = geometry;
      if (x < area.x - 10 || x > area.x + area.w + 10 || n === 0) return null;
      if (current.kind === 'line') return n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((x - area.x) / area.w) * (n - 1))));
      return Math.max(0, Math.min(n - 1, Math.floor((x - area.x) / geometry.band)));
    }
    if (geometry.kind === 'hbar') {
      const i = Math.floor((y - geometry.area.y) / geometry.area.rowH);
      return i >= 0 && i < geometry.n ? i : null;
    }
    const c = Math.floor((x - geometry.area.x) / geometry.cw);
    const r = Math.floor((y - geometry.area.y) / geometry.ch);
    return r >= 0 && r < geometry.rows && c >= 0 && c < geometry.cols ? [r, c] : null;
  }

  canvas.addEventListener('pointermove', (e) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (JSON.stringify(hit) !== JSON.stringify(active)) {
      active = hit;
      draw();
    }
    showTip(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerleave', () => {
    active = null;
    tip.hidden = true;
    draw();
  });
  canvas.addEventListener('blur', () => {
    active = null;
    tip.hidden = true;
    draw();
  });
  canvas.addEventListener('keydown', (e) => {
    if (!geometry) return;
    const key = e.key;
    if (key === 'Escape') {
      active = null;
      tip.hidden = true;
      draw();
      return;
    }
    if (geometry.kind === 'heat') {
      // Nothing chosen yet: the first key lands on the first cell (End on
      // the last of the first row) rather than one step past it.
      const fresh = !Array.isArray(active);
      let [r, c] = fresh ? [0, 0] : active;
      if (fresh) {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return;
        if (key === 'End') c = geometry.cols - 1;
      } else if (key === 'ArrowRight') c = Math.min(geometry.cols - 1, c + 1);
      else if (key === 'ArrowLeft') c = Math.max(0, c - 1);
      else if (key === 'ArrowDown') r = Math.min(geometry.rows - 1, r + 1);
      else if (key === 'ArrowUp') r = Math.max(0, r - 1);
      else if (key === 'Home') c = 0;
      else if (key === 'End') c = geometry.cols - 1;
      else return;
      e.preventDefault();
      active = [r, Math.max(0, c)];
    } else {
      const n = geometry.n;
      let i = typeof active === 'number' ? active : -1;
      const next = geometry.kind === 'hbar' ? ['ArrowDown', 'ArrowUp'] : ['ArrowRight', 'ArrowLeft'];
      if (key === next[0]) i = Math.min(n - 1, i + 1);
      else if (key === next[1]) i = Math.max(0, i < 0 ? 0 : i - 1);
      else if (key === 'Home') i = 0;
      else if (key === 'End') i = n - 1;
      else return;
      e.preventDefault();
      active = i;
    }
    draw();
    showTip(undefined, undefined, true);
  });

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    if (plot.clientWidth !== width) {
      width = plot.clientWidth;
      schedule();
    }
  }) : null;
  ro?.observe(plot);
  const offTheme = onTheme(() => {
    paintStatic();
    schedule();
  });

  paintStatic();
  schedule();

  return {
    el: fig,
    update(next) {
      current = { ...current, ...next };
      active = null;
      tip.hidden = true;
      paintStatic();
      schedule();
    },
    destroy() {
      ro?.disconnect();
      offTheme();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
