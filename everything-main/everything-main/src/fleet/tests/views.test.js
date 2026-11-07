// @vitest-environment jsdom
/**
 * Smoke test: boot the app shell on the sample fleet and render every
 * screen, failing on any exception or missing heading. Catches broken
 * imports, typos in rarely used views, and crashes on real-looking data.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
  HTMLCanvasElement.prototype.getContext ??= () => null;
});

const settle = () => new Promise((r) => setTimeout(r, 15));

async function bootDemo() {
  const { app } = await import('../src/app.js');
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { bucketOf } = await import('../src/core/schema.js');
  const { buildSampleData } = await import('../src/core/sample.js');
  const { buildShell } = await import('../src/ui/shell.js');
  const { startViews } = await import('../src/ui/viewhost.js');
  app.demo = true;
  app.today = () => '2026-10-12';
  app.store = createStore({ backend: createMemoryBackend(buildSampleData('2026-10-12'), { bucketOf }) });
  await app.store.init();
  document.body.innerHTML = '<div id="app"></div>';
  const shell = buildShell({});
  document.getElementById('app').append(shell.root);
  startViews(shell.main);
  return { app, main: shell.main };
}

describe('every screen renders on the sample fleet', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await bootDemo();
  });

  const go = async (hash) => {
    const before = ctx.main.firstElementChild;
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    for (let i = 0; i < 250; i++) {
      await settle();
      const now = ctx.main.firstElementChild;
      if (now && now !== before && ctx.main.querySelector('h1')) break;
    }
    await settle();
    // Leave forms without the "discard changes" prompt getting in the way.
    for (const d of document.querySelectorAll('dialog[open]')) [...d.querySelectorAll('button')].find((b) => /Discard/.test(b.textContent))?.click();
  };

  it('renders all routes without errors', async () => {
    const errors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.map(String).join(' ')));
    const s = ctx.app.store;
    const first = (c) => s.all(c)[0]?.id;
    const routes = [
      '#/', '#/vehicles', '#/vehicles/new', `#/vehicles/${first('vehicles')}`, `#/vehicles/${first('vehicles')}?tab=fuel`, `#/vehicles/${first('vehicles')}?tab=reminders`, `#/vehicles/${first('vehicles')}/edit`,
      '#/assignments', '#/meters', '#/expenses', '#/inspections', '#/inspections/start', '#/inspections/start?vehicle=v101&form=if-pretrip', `#/inspections/${first('inspections')}`,
      '#/failures', '#/inspection-forms', '#/inspection-forms/new', '#/inspection-forms/if-pretrip', '#/issues', '#/issues/new', `#/issues/${first('issues')}`,
      '#/reminders', '#/reminders/new', `#/reminders/${first('reminders')}`, '#/renewals', '#/contact-renewals', '#/service', '#/service/new', `#/service/${first('serviceEntries')}`,
      '#/work-orders', '#/work-orders?view=board', '#/work-orders/new', `#/work-orders/${first('workOrders')}`, '#/service-tasks', '#/service-programs', '#/service-programs/sp-light',
      '#/contacts', '#/contacts/c1', '#/contacts/new', '#/vendors', '#/vendors/vd1', '#/parts', '#/parts/p1', '#/parts/new', '#/purchase-orders', '#/purchase-orders/new', `#/purchase-orders/${first('purchaseOrders')}`,
      '#/fuel', '#/fuel/new', `#/fuel/${first('fuel')}`, '#/documents', '#/reports', '#/reports/costs', '#/reports/tco', '#/reports/fuel', '#/reports/utilization', '#/reports/service', '#/reports/tasks',
      '#/reports/compliance', '#/reports/inspections', '#/reports/issues', '#/reports/expenses', '#/reports/inventory', '#/settings', '#/settings/vehicles', '#/settings/lists', '#/settings/team', '#/settings/data',
    ];
    const failures = [];
    for (const r of routes) {
      await go(r);
      const text = ctx.main.textContent;
      if (!ctx.main.querySelector('h1') || /Something went wrong|Page not found/.test(text)) failures.push(`${r}: ${ctx.main.querySelector('.empty p')?.textContent || 'no heading'}`);
    }
    spy.mockRestore();
    expect(failures).toEqual([]);
    expect(errors).toEqual([]);
  }, 60000);

  it('shows the sample fleet on the vehicle list with a working search', async () => {
    await go('#/vehicles');
    const rows = ctx.main.querySelectorAll('tbody tr');
    expect(rows.length).toBe(ctx.app.store.all('vehicles').filter((v) => !v.archived).length);
    const input = ctx.main.querySelector('.grid-search input');
    input.value = 'tacoma';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));
    expect(ctx.main.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('flags missing required fields instead of saving', async () => {
    await go('#/issues/new');
    const before = ctx.app.store.all('issues').length;
    ctx.main.querySelector('.form-foot .btn.primary').click();
    await settle();
    expect(ctx.app.store.all('issues').length).toBe(before);
    expect(ctx.main.querySelector('[aria-invalid="true"]')).not.toBeNull();
  });

  it('opens pickers inside a modal dialog, not behind it', async () => {
    await go('#/assignments');
    const { openAssignmentDialog } = await import('../src/views/assignments.js');
    openAssignmentDialog({});
    await settle();
    const dlg = document.querySelector('dialog[open]');
    dlg.querySelector('.picker-btn').click();
    await settle();
    const pop = document.querySelector('.popover');
    expect(pop).not.toBeNull();
    expect(dlg.contains(pop)).toBe(true);
    expect(pop.contains(document.activeElement)).toBe(true);
    // Choosing an option fills the picker.
    pop.querySelector('[role="option"]').click();
    await settle();
    expect(dlg.querySelector('.picker-btn .picker-value')).not.toBeNull();
    dlg.querySelector('.dialog-foot .btn').click();
  });

  it('refuses a service reminder with no schedule', async () => {
    await go('#/reminders/new?vehicle=v101');
    const before = ctx.app.store.all('reminders').length;
    for (const label of ['Repeat on a time interval', 'Repeat on a meter interval']) {
      const cb = [...ctx.main.querySelectorAll('label.switch')].find((l) => l.textContent.includes(label)).querySelector('input');
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));
    }
    ctx.main.querySelector('.form-foot .btn.primary').click();
    await settle();
    expect(ctx.app.store.all('reminders').length).toBe(before);
    expect(ctx.main.textContent).toMatch(/Turn on a time interval/);
  });
});
