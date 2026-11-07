// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';
import { today } from '../src/core/dates.js';
import { trustBalance } from '../src/core/finance.js';

/** A view context that behaves like the real view host (live regions redraw). */
function ctxFor(params = {}, query = {}) {
  return {
    params,
    query,
    route: {},
    watch() {},
    onDispose() {},
    live(fn) {
      const node = document.createElement('div');
      const draw = () => {
        const out = fn();
        node.replaceChildren(...(Array.isArray(out) ? out.filter(Boolean) : out ? [out] : []));
      };
      draw();
      node.redraw = draw;
      return node;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  }
  location.hash = '#/';
});

beforeEach(async () => {
  document.body.replaceChildren();
  app.demo = true;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(today())), flushDelay: 0 });
  await app.store.init();
});

describe('matters list', () => {
  it('shows open matters by default with status counts and totals', async () => {
    const { render } = await import('../src/views/matters.js');
    const out = render(ctxFor());
    document.body.append(out.node);
    const open = app.store.all('matters').filter((m) => m.status === 'open').length;
    expect(out.node.querySelector('[aria-label="Matter status"]').textContent).toContain(`Open${open}`);
    expect(out.node.querySelector('.dt-foot').textContent).toContain(`${open} matters`);
  });

  it('filters by search and practice area from the query', async () => {
    const { render } = await import('../src/views/matters.js');
    const out = render(ctxFor({}, { status: 'all', q: 'kestrel' }));
    expect(out.node.querySelector('.dt-foot').textContent).toContain('1 matter');
    const byArea = render(ctxFor({}, { status: 'all', area: 'pa-imm' }));
    const n = app.store.all('matters').filter((m) => m.practiceAreaId === 'pa-imm').length;
    expect(byArea.node.querySelector('.dt-foot').textContent).toContain(`${n} matters`);
  });
});

describe('matter form', () => {
  it('requires a client, description, and practice area', async () => {
    const { render } = await import('../src/views/matter-form.js');
    const out = render(ctxFor());
    document.body.append(out.node);
    const before = app.store.all('matters').length;
    out.node.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(app.store.all('matters').length).toBe(before);
    expect(out.node.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThanOrEqual(2);
  });

  it('creates a numbered matter for a preselected client and applies task lists', async () => {
    const { render } = await import('../src/views/matter-form.js');
    const out = render(ctxFor({}, { client: 'p-3' }));
    document.body.append(out.node);
    const form = out.node.querySelector('form');
    form.querySelector('[name=description]').value = 'Haddad severance negotiation';
    form.querySelector('[name=practiceAreaId]').value = 'pa-pi';
    form.querySelector('[name=list_tl-pi]').checked = true;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    const m = app.store.all('matters').find((x) => x.description === 'Haddad severance negotiation');
    expect(m).toBeTruthy();
    expect(m.clientId).toBe('p-3');
    expect(m.number).toBe(23);
    expect(m.displayNumber).toBe('00023-Haddad');
    expect(app.store.all('tasks').filter((t) => t.matterId === m.id)).toHaveLength(5);
    expect(location.hash).toBe(`#/matters/${m.id}`);
  });

  it('edits an existing matter and reports unsaved changes', async () => {
    const { render } = await import('../src/views/matter-form.js');
    const out = render(ctxFor({ id: 'm-1' }));
    document.body.append(out.node);
    await tick();
    expect(out.dirty()).toBe(false);
    out.node.querySelector('[name=description]').value = 'Renamed';
    expect(out.dirty()).toBe(true);
  });
});

describe('matter workspace', () => {
  it('renders the dashboard with money at a glance', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const out = render(ctxFor({ id: 'm-6' }));
    document.body.append(out.node);
    const text = out.node.textContent;
    expect(text).toContain('Haddad employment claim');
    expect(text).toContain('Work in progress');
    expect(text).toContain('Trust funds');
    expect(out.node.querySelectorAll('[role=tab]').length).toBe(10);
  });

  it('renders every tab', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    for (const tab of ['activities', 'calendar', 'communications', 'notes', 'tasks', 'bills', 'transactions', 'contacts']) {
      const out = render(ctxFor({ id: 'm-7' }, { tab }));
      expect(out.node.querySelector('[role=tabpanel]').children.length).toBeGreaterThan(0);
    }
  });

  it('shows a trust ledger whose last balance matches the matter balance', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const out = render(ctxFor({ id: 'm-6' }, { tab: 'transactions' }));
    const bal = trustBalance('m-6', app.store.all('transactions'), app.store.all('accounts'));
    expect(out.node.textContent).toContain((bal / 100).toLocaleString(undefined, { minimumFractionDigits: 2 }));
  });

  it('shows not found for a missing matter', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const out = render(ctxFor({ id: 'nope' }));
    expect((out instanceof Node ? out : out.node).textContent).toContain('Matter not found');
  });
});

describe('entry dialogs', () => {
  it('records a time entry rounded up to the billing increment at the right rate', async () => {
    const { openActivityDialog } = await import('../src/views/dialogs.js');
    const done = openActivityDialog({ kind: 'time', matterId: 'm-3', description: 'Call' });
    const dlg = document.querySelector('dialog');
    dlg.querySelector('[name=duration]').value = '0:07';
    dlg.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    const saved = await done;
    expect(saved).toMatchObject({ kind: 'time', minutes: 12, matterId: 'm-3', billable: true });
    // Daniel Okafor is not "me" in the sample, so the rate is the signed-in user's.
    expect(saved.amountCents).toBe(Math.round((12 * saved.rateCents) / 60));
  });

  it('updates the line on a draft bill when its entry is edited', async () => {
    const { openActivityDialog } = await import('../src/views/dialogs.js');
    const draft = app.store.all('bills').find((b) => b.status === 'draft');
    const act = app.store.get('activities', draft.lines.find((l) => l.activityId).activityId);
    const done = openActivityDialog({ activity: act });
    const dlg = document.querySelector('dialog');
    dlg.querySelector('[name=duration]').value = '2.5';
    dlg.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await done;
    const line = app.store.get('bills', draft.id).lines.find((l) => l.activityId === act.id);
    expect(line.minutes).toBe(150);
    expect(line.amountCents).toBe(Math.round((150 * act.rateCents) / 60));
  });

  it('refuses a trust withdrawal larger than the matter holds', async () => {
    const { openTrustDialog } = await import('../src/views/money-dialogs.js');
    const before = app.store.all('transactions').length;
    openTrustDialog({ type: 'withdrawal', matterId: 'm-6' });
    const dlg = document.querySelector('dialog');
    dlg.querySelector('[name=amount]').value = '999999';
    dlg.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(app.store.all('transactions').length).toBe(before);
    expect(document.querySelector('.toast.error')?.textContent).toContain('overdraw');
  });

  it('finds conflicts across clients and related parties', async () => {
    const { openConflictCheck } = await import('../src/views/dialogs.js');
    openConflictCheck('Sorensen');
    const dlg = document.querySelector('dialog');
    expect(dlg.textContent).toContain('Victor Sorensen');
    expect(dlg.textContent).toContain('Opposing counsel');
  });
});
