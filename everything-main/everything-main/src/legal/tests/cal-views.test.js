// @vitest-environment jsdom
/**
 * Smoke tests: the calendar, tasks, and dashboard screens render against the
 * sample firm, switch views, and react to changes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';
import { today } from '../src/core/dates.js';

function makeCtx(query = {}) {
  const disposers = [];
  return {
    query,
    params: {},
    route: { query, params: {} },
    live(fn) {
      const n = document.createElement('div');
      const draw = () => n.replaceChildren(...[].concat(fn()).filter(Boolean));
      draw();
      return n;
    },
    watch() {},
    onDispose(fn) {
      disposers.push(fn);
    },
    dispose: () => disposers.forEach((d) => d()),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(async () => {
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  app.demo = true;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(today())), flushDelay: 0 });
  await app.store.init();
});

describe('calendar view', () => {
  it('renders the week grid with events and switches views', async () => {
    const { render } = await import('../src/views/calendar.js');
    const ctx = makeCtx({ view: 'week' });
    const out = render(ctx);
    document.body.replaceChildren(out.node);
    expect(out.node.querySelectorAll('.cal-col')).toHaveLength(7);
    expect(out.node.querySelectorAll('.cal-ev').length).toBeGreaterThan(0);
    expect(out.node.querySelector('.cal-title').textContent).toMatch(/to/);

    const seg = [...out.node.querySelectorAll('.seg button')];
    seg.find((b) => b.textContent === 'Month').click();
    expect(out.node.querySelectorAll('.cal-mcell')).toHaveLength(42);
    seg.find((b) => b.textContent === 'Agenda').click();
    expect(out.node.querySelectorAll('.agenda-day').length).toBeGreaterThan(0);
    out.node.querySelector('.cal-toolbar [aria-label="Next"]').click();
    ctx.dispose();
  });

  it('hides a person when their calendar is turned off', async () => {
    const { render } = await import('../src/views/calendar.js');
    const ctx = makeCtx({ view: 'month' });
    const out = render(ctx);
    document.body.replaceChildren(out.node);
    const before = out.node.querySelectorAll('.cal-chip').length;
    for (const cb of out.node.querySelectorAll('.cal-layers label.layer input')) {
      if (cb.checked) cb.click();
    }
    const after = out.node.querySelectorAll('.cal-chip').length;
    expect(after).toBeLessThan(before);
    localStorage.clear();
    ctx.dispose();
  });
});

describe('tasks view', () => {
  it('lists outstanding tasks and completes one', async () => {
    const { render } = await import('../src/views/tasks.js');
    const ctx = makeCtx({ who: 'all' });
    const out = render(ctx);
    document.body.replaceChildren(out.node);
    const checks = out.node.querySelectorAll('.task-check');
    expect(checks.length).toBeGreaterThan(0);
    const open = app.store.all('tasks').filter((t) => !t.done).length;
    checks[0].click();
    await flush();
    expect(app.store.all('tasks').filter((t) => !t.done).length).toBe(open - 1);
    ctx.dispose();
  });
});

describe('dashboard view', () => {
  it('renders personal and firm tabs', async () => {
    const { render } = await import('../src/views/dashboard.js');
    const ctx = makeCtx({});
    const out = render(ctx);
    document.body.replaceChildren(out.node);
    expect(out.node.textContent).toContain("Today's agenda");
    expect(out.node.querySelector('svg.week-chart')).toBeTruthy();
    const firmTab = [...out.node.querySelectorAll('[role="tab"]')].find((b) => b.textContent === 'Firm');
    firmTab.click();
    expect(out.node.textContent).toContain('Hours by person this month');
    expect(out.node.textContent).toContain('Receivables aging');
    ctx.dispose();
  });

  it('ties its tabs to the panel they control', async () => {
    const { render } = await import('../src/views/dashboard.js');
    const ctx = makeCtx({});
    const out = render(ctx);
    document.body.replaceChildren(out.node);
    const tabsEl = [...out.node.querySelectorAll('[role="tab"]')];
    const panel = out.node.querySelector('[role="tabpanel"]');
    expect(panel?.id).toBeTruthy();
    expect(panel.getAttribute('aria-label')).toBe('Personal');
    for (const t of tabsEl) expect(t.getAttribute('aria-controls')).toBe(panel.id);
    tabsEl.find((b) => b.textContent === 'Firm').click();
    expect(out.node.querySelector('[role="tabpanel"]').getAttribute('aria-label')).toBe('Firm');
    ctx.dispose();
  });
});
