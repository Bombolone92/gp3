import { describe, it, expect, afterEach } from 'vitest';
import { ticketTable } from '../src/views/ticket-table.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const make = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, subject: `Ticket ${i + 1}`, status: 'open', updatedAt: 1000 - i, createdAt: 1 }));

function mountTable(opts = {}) {
  const table = ticketTable({ onOpen() {}, ...opts });
  document.body.append(table.el);
  return table;
}

afterEach(() => { document.body.textContent = ''; });

describe('ticket table', () => {
  it('keeps the focused row focused while scrolling', async () => {
    const table = mountTable();
    table.update({ tickets: make(300), columns: ['status', 'subject'] });
    const row = table.el.querySelector('tbody tr[data-id="5"]');
    row.focus();
    table.el.scrollTop = 30;
    table.el.dispatchEvent(new Event('scroll'));
    await tick(30);
    expect(document.activeElement).toBe(row);
    // Far enough that the row is no longer drawn: focus stays in the list.
    table.el.scrollTop = 46 * 200;
    table.el.dispatchEvent(new Event('scroll'));
    await tick(30);
    expect(table.el.contains(document.activeElement)).toBe(true);
    table.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
    expect(document.activeElement.dataset.id).toBe('6');
  });

  it('always leaves one row reachable with Tab', () => {
    const table = mountTable();
    const all = make(5);
    table.update({ tickets: all, columns: ['status', 'subject'] });
    table.el.querySelector('tbody tr[data-id="2"]').focus();
    table.update({ tickets: all.filter((t) => t.id !== 2), columns: ['status', 'subject'] });
    expect(table.el.querySelectorAll('tbody tr[tabindex="0"]').length).toBe(1);
  });

  it('draws more rows when the window grows taller', async () => {
    const real = window.ResizeObserver;
    let resized = null;
    window.ResizeObserver = class { constructor(fn) { resized = fn; } observe() {} disconnect() {} };
    try {
      const table = mountTable();
      table.update({ tickets: make(300), columns: ['status', 'subject'] });
      const before = table.el.querySelectorAll('tbody tr[data-id]').length;
      Object.defineProperty(table.el, 'clientHeight', { value: 4000, configurable: true });
      resized([]);
      await tick(30);
      expect(table.el.querySelectorAll('tbody tr[data-id]').length).toBeGreaterThan(before);
      table.destroy();
    } finally {
      window.ResizeObserver = real;
    }
  });

  it('numbers rows for screen readers counting group headings', () => {
    const table = mountTable();
    const list = make(4).map((t, i) => ({ ...t, status: i < 2 ? 'open' : 'pending' }));
    table.update({ tickets: list, columns: ['status', 'subject'], groupBy: 'status' });
    const rows = [...table.el.querySelectorAll('tbody tr:not(.tt-spacer)')];
    expect(rows.map((r) => r.getAttribute('aria-rowindex'))).toEqual(['2', '3', '4', '5', '6', '7']);
    expect(table.el.querySelector('table').getAttribute('aria-rowcount')).toBe('7');
  });

  it('keeps focus on a sort button after sorting', () => {
    const table = mountTable({ onSort: (sort) => table.update({ tickets: make(5), sort }) });
    table.update({ tickets: make(5), columns: ['status', 'subject'] });
    const btn = [...table.el.querySelectorAll('.sort-btn')].find((b) => b.textContent.includes('Subject'));
    btn.focus();
    btn.click();
    expect(document.activeElement.textContent).toContain('Subject');
    expect(document.activeElement.classList.contains('sort-btn')).toBe(true);
  });
});

describe('ticket table selection', () => {
  it('tells the bulk bar when selected tickets leave the view', () => {
    let reported = null;
    const table = mountTable({ onSelect: (sel) => { reported = sel; } });
    const list = make(4);
    table.update({ tickets: list, columns: ['status', 'subject'] });
    table.el.querySelector('tbody tr[data-id="2"] input').click();
    table.el.querySelector('tbody tr[data-id="3"] input').click();
    expect([...reported].sort()).toEqual([2, 3]);
    table.update({ tickets: list.filter((t) => t.id !== 2) });
    expect([...reported]).toEqual([3]);
  });
});

describe('ticket table range selection', () => {
  it('selects from the clicked ticket even after the list re-sorts', () => {
    let reported = null;
    const table = mountTable({ onSelect: (sel) => { reported = sel; } });
    const list = make(6);
    table.update({ tickets: list, columns: ['status', 'subject'] });
    table.el.querySelector('tbody tr[data-id="2"] input').click();
    // Ticket 2 moves to the bottom.
    list[1].updatedAt = 0;
    table.update({ tickets: list });
    table.el.querySelector('tbody tr[data-id="5"] input').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true, cancelable: true }));
    expect([...reported].sort()).toEqual([2, 5, 6]);
  });
});
