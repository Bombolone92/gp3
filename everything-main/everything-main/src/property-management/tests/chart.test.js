// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { columnChart } from '../src/ui/chart.js';

const money = (n) => `$${(n / 100).toFixed(0)}`;
const chart = (values) =>
  columnChart({
    title: 'Income',
    categories: values.map((v, i) => ({ label: `M${i}`, values: [v] })),
    series: [{ name: 'Income', color: 'red' }],
    format: money,
    short: money,
  });
const ticks = (node) => [...node.querySelectorAll('.chart-axis')].map((t) => t.textContent).filter((t) => t.startsWith('$'));

describe('column chart', () => {
  it('labels a real scale', () => {
    expect(ticks(chart([0, 40000, 100000]))).toEqual(['$0', '$250', '$500', '$750', '$1000']);
  });

  it('shows only the baseline when every value is zero', () => {
    expect(ticks(chart([0, 0, 0]))).toEqual(['$0']);
  });
});
