// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { columnChart } from '../src/ui/chart.js';

const chart = (n) =>
  columnChart({
    title: 'Revenue',
    categories: Array.from({ length: n }, (_, i) => ({ label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'][i % 6], values: [i * 100, i * 50] })),
    series: [
      { name: 'Invoiced', color: 'red' },
      { name: 'Collected', color: 'blue' },
    ],
    format: String,
    short: String,
  });

const monthLabels = (node) => [...node.querySelectorAll('.chart-band text')].filter((t) => t.textContent);

describe('column chart', () => {
  it('labels every column when there is room', () => {
    expect(monthLabels(chart(12))).toHaveLength(12);
  });

  it('skips month labels that would overlap when columns are narrow', () => {
    // 40 columns in the 640px default width: about 15px each, too narrow for "Mar".
    const labels = monthLabels(chart(40));
    expect(labels.length).toBeLessThan(40);
    expect(labels.length).toBeGreaterThanOrEqual(13);
    // Every column still keeps its hover band and bars.
    expect(chart(40).querySelectorAll('.chart-band')).toHaveLength(40);
  });
});
