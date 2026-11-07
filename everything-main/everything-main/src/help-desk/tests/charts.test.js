import { describe, it, expect } from 'vitest';
import { createChart, niceScale, labelStride } from '../src/ui/charts.js';

describe('chart scales', () => {
  it('rounds axis maximums to friendly steps', () => {
    expect(niceScale(0)).toEqual({ max: 4, step: 1 });
    expect(niceScale(7)).toEqual({ max: 8, step: 2 });
    expect(niceScale(37)).toEqual({ max: 40, step: 10 });
    expect(niceScale(3)).toEqual({ max: 3, step: 1 });
    expect(niceScale(950).max).toBe(1000);
  });

  it('thins out labels that would overlap', () => {
    expect(labelStride(7, 600)).toBe(1);
    expect(labelStride(90, 600)).toBe(9);
    expect(labelStride(1, 10)).toBe(1);
  });
});

describe('createChart', () => {
  const spec = {
    kind: 'column',
    title: 'Created and solved',
    summary: '3 created, 1 solved',
    categoryLabel: 'Day',
    labels: ['Mon', 'Tue'],
    series: [
      { name: 'Created', color: '--chart-1', values: [1, 2] },
      { name: 'Solved', color: '--chart-2', values: [0, 1] },
    ],
  };

  it('gives the canvas an accessible name and description', () => {
    const c = createChart(spec);
    document.body.append(c.el);
    const canvas = c.el.querySelector('canvas');
    expect(canvas.getAttribute('role')).toBe('img');
    expect(document.getElementById(canvas.getAttribute('aria-labelledby')).textContent).toBe('Created and solved');
    expect(document.getElementById(canvas.getAttribute('aria-describedby')).textContent).toBe('3 created, 1 solved');
    expect(c.el.querySelectorAll('.chart-legend li')).toHaveLength(2);
    c.destroy();
    c.el.remove();
  });

  it('offers the same numbers as a table', () => {
    const c = createChart(spec);
    document.body.append(c.el);
    const toggle = c.el.querySelector('.chart-toggle');
    const wrap = c.el.querySelector('.chart-table-wrap');
    expect(wrap.hidden).toBe(true);
    toggle.click();
    expect(wrap.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const rows = [...wrap.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
    expect(rows).toEqual([['Mon', '1', '0'], ['Tue', '2', '1']]);
    c.destroy();
    c.el.remove();
  });

  it('shows an empty message when every value is zero', () => {
    const c = createChart({ ...spec, series: [{ name: 'Created', color: '--chart-1', values: [0, 0] }], empty: 'Nothing yet' });
    expect(c.el.querySelector('.chart-empty').hidden).toBe(false);
    expect(c.el.querySelector('.chart-empty').textContent).toBe('Nothing yet');
    expect(c.el.querySelector('.chart-plot').hidden).toBe(true);
    c.update({ series: [{ name: 'Created', color: '--chart-1', values: [0, 4] }] });
    expect(c.el.querySelector('.chart-empty').hidden).toBe(true);
    c.destroy();
  });

  it('starts keyboard exploration of a heatmap at its first cell', async () => {
    // jsdom draws nothing: a 2D context that does nothing lets the chart lay itself out.
    const real = HTMLCanvasElement.prototype.getContext;
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
    HTMLCanvasElement.prototype.getContext = () => ctx;
    const c = createChart({ kind: 'heatmap', title: 'Hours', rows: ['Mon', 'Tue'], cols: ['1', '2'], values: [[0, 3], [1, 0]] });
    document.body.append(c.el);
    Object.defineProperty(c.el.querySelector('canvas').parentElement, 'clientWidth', { value: 400, configurable: true });
    c.update?.({ kind: 'heatmap', title: 'Hours', rows: ['Mon', 'Tue'], cols: ['1', '2'], values: [[0, 3], [1, 0]] });
    await new Promise((r) => setTimeout(r, 50));
    HTMLCanvasElement.prototype.getContext = real;
    const canvas = c.el.querySelector('canvas');
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    const tip = c.el.querySelector('.chart-tip, [role="tooltip"], .tip');
    expect(tip.textContent).toMatch(/^Mon/);
    c.el.remove();
  });

  it('builds heatmap tables with row and column headers', () => {
    const c = createChart({ kind: 'heatmap', title: 'Hours', rows: ['Mon', 'Tue'], cols: ['1', '2'], values: [[0, 3], [1, 0]] });
    const ths = [...c.el.querySelectorAll('.chart-table tbody th')].map((th) => th.textContent);
    expect(ths).toEqual(['Mon', 'Tue']);
    expect(c.el.querySelectorAll('.chart-table tbody td')).toHaveLength(4);
    c.destroy();
  });
});
