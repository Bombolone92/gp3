// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { columnChart } from '../src/ui/chart.js';

describe('column chart', () => {
  it('the table toggle keeps focus when switching views', () => {
    const chart = columnChart({
      title: 'Payments',
      categories: [{ label: 'Jan', values: [100, 50] }, { label: 'Feb', values: [80, 20] }],
      series: [{ name: 'Billed', color: 'red' }, { name: 'Paid', color: 'blue' }],
      format: String,
      short: String,
    });
    document.body.replaceChildren(chart);
    const toggle = chart.querySelector('button');
    toggle.focus();
    toggle.click();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toBe('View chart');
    expect(chart.querySelector('table')).not.toBeNull();
    toggle.click();
    expect(document.activeElement).toBe(toggle);
    expect(chart.querySelector('table')).toBeNull();
    expect(chart.querySelector('svg')).not.toBeNull();
  });
});
