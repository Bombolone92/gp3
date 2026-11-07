// @vitest-environment jsdom
/**
 * Regression tests for the list grid (ui/grid.js).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  window.cancelAnimationFrame ??= (id) => clearTimeout(id);
  globalThis.cancelAnimationFrame ??= window.cancelAnimationFrame;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
});

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const key = (target, k, init = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

async function makeList(config = {}, n = 120) {
  const { app } = await import('../src/app.js');
  const subs = new Set();
  app.store = { subscribe: (fn) => (subs.add(fn), () => subs.delete(fn)), all: () => [] };
  const { renderList } = await import('../src/ui/grid.js');
  const rows = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Row ${String(i).padStart(4, '0')}`, n: i }));
  const disposers = [];
  const ctx = { query: {}, onDispose: (fn) => disposers.push(fn) };
  const list = renderList(ctx, {
    key: `test-${Math.random()}`,
    title: 'Things',
    rows: () => rows,
    columns: [
      { id: 'name', label: 'Name', render: (r) => r.name, sort: (r) => r.name },
      { id: 'n', label: 'Number', render: (r) => String(r.n), sort: (r) => r.n },
    ],
    search: (r) => r.name,
    rowHref: (r) => `#/things/${r.id}`,
    bulk: [{ label: 'Archive', run: () => false }, { label: 'Done', run: async () => true }],
    filters: [{ id: 'odd', label: 'Parity', options: () => [{ value: 'odd', label: 'Odd' }, { value: 'even', label: 'Even' }], match: (r, vals) => vals.has(r.n % 2 ? 'odd' : 'even') }],
    ...config,
  });
  document.body.replaceChildren(list.node);
  const dispose = () => disposers.forEach((d) => d());
  return { list, rows, dispose, node: list.node };
}

describe('list grid', () => {
  it('does not write a pending search into the next page URL after leaving', async () => {
    history.replaceState(null, '', '#/things');
    const { node, dispose } = await makeList();
    const search = node.querySelector('.grid-search input');
    search.value = 'row 1';
    search.dispatchEvent(new Event('input'));
    dispose();
    history.replaceState(null, '', '#/other');
    await tick(200);
    expect(location.hash).toBe('#/other');
  });

  it('Enter on another control after J does not open the highlighted row', async () => {
    history.replaceState(null, '', '#/things');
    const { node, dispose } = await makeList();
    key(document.body, 'j');
    expect(node.querySelector('tr.kbd-focus')).not.toBeNull();
    const next = node.querySelector('[aria-label="Next page"]');
    next.focus();
    key(next, 'Enter');
    expect(location.hash).toBe('#/things');
    dispose();
  });

  it('J and K still work after ticking a row checkbox', async () => {
    const { node, dispose } = await makeList();
    const cb = node.querySelector('tbody input[type="checkbox"]');
    cb.focus();
    key(cb, 'j');
    expect(node.querySelector('tr.kbd-focus')).not.toBeNull();
    // The global shortcuts (N, /, ?) use the same check.
    const { isTypingTarget } = await import('../src/ui/dom.js');
    expect(isTypingTarget(cb)).toBe(false);
    expect(isTypingTarget(node.querySelector('.grid-search input'))).toBe(true);
    dispose();
  });

  it('keeps keyboard focus on the control used when the table redraws', async () => {
    const { node, dispose } = await makeList();
    const next = node.querySelector('[aria-label="Next page"]');
    next.focus();
    next.click();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Next page');
    const sortBtn = node.querySelector('th button.sort');
    sortBtn.focus();
    sortBtn.click();
    expect(document.activeElement?.closest('th')).not.toBeNull();
    expect(document.activeElement?.textContent).toContain('Name');
    const cb = node.querySelectorAll('tbody input[type="checkbox"]')[2];
    cb.focus();
    cb.click();
    expect(document.activeElement?.type).toBe('checkbox');
    expect(document.activeElement?.closest('tr')).toBe(node.querySelectorAll('tbody tr')[2]);
    dispose();
  });

  it('returns focus to the filter button after choosing in its popover', async () => {
    const { node, dispose } = await makeList();
    const btn = node.querySelector('.filter-btn');
    btn.focus();
    btn.click();
    const pop = document.querySelector('.popover');
    const cb = pop.querySelector('input[type="checkbox"]');
    cb.click();
    expect(node.querySelectorAll('tbody tr').length).toBe(50);
    key(document.activeElement || document.body, 'Escape');
    const filterBtn = node.querySelector('.filter-btn');
    expect(document.activeElement).toBe(filterBtn);
    expect(filterBtn.getAttribute('aria-expanded')).toBe('false');
    expect(filterBtn.textContent).toContain('Odd');
    node.querySelector('.clear-filters').click();
    expect(document.activeElement).toBe(filterBtn);
    dispose();
  });

  it('stays fast when thousands of rows are selected', async () => {
    const { node, dispose } = await makeList({}, 40000);
    node.querySelector('thead input[type="checkbox"]').click();
    [...node.querySelectorAll('.bulk-bar button')].find((b) => /Select all/.test(b.textContent)).click();
    const t0 = performance.now();
    node.querySelector('tbody input[type="checkbox"]').click();
    node.querySelector('tbody input[type="checkbox"]').click();
    expect(performance.now() - t0).toBeLessThan(1000);
    dispose();
  }, 30000);

  it('sorts numbers with missing or invalid values last and in order', async () => {
    const vals = [3, NaN, 1, undefined, 10, '', null, 0, 2, NaN, 7];
    const rows = vals.map((v, i) => ({ id: `r${i}`, v }));
    const { list, dispose } = await makeList({
      rows: () => rows,
      columns: [{ id: 'v', label: 'Volume', render: (r) => String(r.v), sort: (r) => r.v }],
      defaultSort: { id: 'v', dir: 'asc' },
    });
    const numbers = (l) => l.rows.map((r) => r.v).filter((v) => typeof v === 'number' && !Number.isNaN(v));
    expect(numbers(list)).toEqual([0, 1, 2, 3, 7, 10]);
    expect(list.rows.slice(0, 6).map((r) => r.v)).toEqual([0, 1, 2, 3, 7, 10]);
    dispose();
  });

  it('announces the result count only when it changes', async () => {
    const { node, dispose } = await makeList();
    const live = node.querySelector('[role="status"]');
    expect(live.textContent).toBe('120 results');
    const mutations = [];
    const mo = new MutationObserver((m) => mutations.push(...m));
    mo.observe(live, { childList: true, characterData: true, subtree: true });
    node.querySelector('tbody input[type="checkbox"]').click();
    node.querySelector('[aria-label="Next page"]').click();
    await tick();
    expect(mutations).toHaveLength(0);
    const search = node.querySelector('.grid-search input');
    search.value = 'row 001';
    search.dispatchEvent(new Event('input'));
    await tick(200);
    expect(live.textContent).toBe('11 results');
    mo.disconnect();
    dispose();
  });

  it('follows the tabs pattern for its saved views', async () => {
    const { node, dispose } = await makeList({
      tabs: [{ id: 'all', label: 'All' }, { id: 'odd', label: 'Odd', filter: (r) => r.n % 2 }, { id: 'even', label: 'Even', filter: (r) => !(r.n % 2) }],
    });
    const tabs = () => [...node.querySelectorAll('[role="tab"]')];
    const selected = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true');
    const panel = document.getElementById(selected().getAttribute('aria-controls'));
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(selected().id);
    selected().focus();
    key(document.activeElement, 'End');
    expect(selected().textContent).toContain('Even');
    expect(document.activeElement).toBe(selected());
    expect(panel.getAttribute('aria-labelledby')).toBe(selected().id);
    key(document.activeElement, 'Home');
    expect(selected().textContent).toContain('All');
    dispose();
  });

  it('opens a row in a new tab on Ctrl or Cmd click, like its link', async () => {
    history.replaceState(null, '', '#/things');
    const { node, dispose } = await makeList();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      const cell = node.querySelectorAll('tbody tr')[3].querySelectorAll('td')[2];
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      expect(location.hash).toBe('#/things');
      expect(open).toHaveBeenCalledWith('#/things/r3', '_blank', 'noopener');
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(location.hash).toBe('#/things/r3');
    } finally {
      open.mockRestore();
      dispose();
    }
  });

  it('keeps focus in the list after using the selection bar', async () => {
    const { node, dispose } = await makeList();
    node.querySelector('tbody input[type="checkbox"]').click();
    const bar = node.querySelector('.bulk-bar');
    const selectAll = [...bar.querySelectorAll('button')].find((b) => /Select all/.test(b.textContent));
    selectAll.focus();
    selectAll.click();
    expect(bar.textContent).toContain('120 selected');
    expect(bar.contains(document.activeElement)).toBe(true);
    const clear = bar.querySelector('[aria-label="Clear selection"]');
    clear.focus();
    clear.click();
    expect(bar.hidden).toBe(true);
    expect(document.activeElement).toBe(node.querySelector('thead input[type="checkbox"]'));
    // A bulk action that clears the selection.
    node.querySelector('tbody input[type="checkbox"]').click();
    const run = [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Done');
    run.focus();
    run.click();
    await tick();
    expect(bar.hidden).toBe(true);
    expect(document.activeElement).toBe(node.querySelector('thead input[type="checkbox"]'));
    dispose();
  });
});
