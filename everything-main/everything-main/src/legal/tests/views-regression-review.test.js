// @vitest-environment jsdom
/**
 * Regression tests from the review of the view fixes.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';

const TODAY = '2026-10-12';

beforeAll(() => {
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  Element.prototype.scrollIntoView ??= function () {};
  const D = globalThis.HTMLDialogElement?.prototype;
  if (D && !D.showModal) {
    D.showModal = function () {
      this.setAttribute('open', '');
    };
    D.close = function () {
      this.removeAttribute('open');
    };
  }
});

beforeEach(async () => {
  document.body.replaceChildren();
  location.hash = '';
  app.demo = true;
  app.user = null;
  app.team = null;
  app.today = () => TODAY;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(TODAY)), flushDelay: 0 });
  await app.store.init();
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const button = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()));

describe('deleting an entry on a bill that is issued meanwhile', () => {
  it('leaves the issued bill alone when it was approved while the question was open', async () => {
    const store = app.store;
    const b = store.all('bills').find((x) => x.status === 'draft' && x.lines.some((l) => l.activityId && l.kind === 'time'));
    store.patch('bills', b.id, { status: 'pending' });
    const line = b.lines.find((l) => l.activityId && l.kind === 'time');
    const act = store.get('activities', line.activityId);
    const { openActivityDialog } = await import('../src/views/dialogs.js');
    openActivityDialog({ activity: act });
    button(document.querySelector('dialog'), /^Delete$/).click();
    await flush();
    // A partner approves (and so issues) the bill while the question is open.
    store.patch('bills', b.id, { status: 'issued' });
    const confirm = [...document.querySelectorAll('dialog')].pop();
    button(confirm, /Delete entry/).click();
    await flush();
    expect(app.store.get('bills', b.id).lines.some((l) => l.activityId === act.id)).toBe(true);
  });
});

describe('undoing the delete of an entry on a draft bill', () => {
  async function deleteFromDraft() {
    const store = app.store;
    const b = store.all('bills').find((x) => x.status === 'draft' && x.lines.filter((l) => l.activityId && l.kind === 'time').length > 1);
    const line = b.lines.find((l) => l.activityId && l.kind === 'time');
    const act = store.get('activities', line.activityId);
    const { openActivityDialog } = await import('../src/views/dialogs.js');
    openActivityDialog({ activity: act });
    button(document.querySelector('dialog'), /^Delete$/).click();
    await flush();
    button([...document.querySelectorAll('dialog')].pop(), /Delete entry/).click();
    await flush();
    const undo = () => [...document.querySelectorAll('.toast button')].find((x) => x.textContent === 'Undo').click();
    return { b, act, undo };
  }

  it('keeps edits made to the bill since the delete', async () => {
    const { b, act, undo } = await deleteFromDraft();
    const other = app.store.get('bills', b.id).lines.find((l) => l.activityId && l.kind === 'time');
    app.store.patch('bills', b.id, (cur) => ({ ...cur, lines: cur.lines.map((l) => (l.id === other.id ? { ...l, description: 'Edited after the delete' } : l)) }));
    undo();
    const lines = app.store.get('bills', b.id).lines;
    expect(lines.some((l) => l.activityId === act.id)).toBe(true);
    expect(lines.find((l) => l.id === other.id).description).toBe('Edited after the delete');
    expect(app.store.get('activities', act.id).billId).toBe(b.id);
  });

  it('leaves a bill issued since the delete alone and brings the entry back unbilled', async () => {
    const { b, act, undo } = await deleteFromDraft();
    app.store.patch('bills', b.id, { status: 'issued' });
    const issued = structuredClone(app.store.get('bills', b.id).lines);
    undo();
    expect(app.store.get('bills', b.id).lines).toEqual(issued);
    expect(app.store.get('activities', act.id)).toBeTruthy();
    expect(app.store.get('activities', act.id).billId || null).toBeNull();
  });
});

/** A view context whose watch() follows the store, like the real view host. */
function liveCtx(params = {}, query = {}) {
  const disposers = [];
  return {
    params,
    query,
    route: { params, query },
    live(fn, colls = 'all') {
      const node = document.createElement('div');
      const draw = () => node.replaceChildren(...[].concat(fn()).filter(Boolean));
      draw();
      node.redraw = draw;
      disposers.push(app.store.subscribe((changed) => (colls === 'all' || colls.some((c) => changed.has(c))) && draw()));
      return node;
    },
    watch(colls, fn) {
      const set = new Set(colls);
      disposers.push(app.store.subscribe((changed) => [...changed].some((c) => set.has(c)) && fn(changed)));
    },
    onDispose(fn) {
      disposers.push(fn);
    },
    dispose: () => disposers.forEach((d) => d()),
  };
}

describe('bulk bars keep keyboard focus when data changes in the background', () => {
  const pickFirstRows = (node, n) => {
    for (const tr of [...node.querySelectorAll('tbody tr:not(.dt-spacer)')].slice(0, n)) {
      const cb = tr.querySelector('td.dt-check input');
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    }
  };
  for (const [name, path, coll, query] of [
    ['matters', '../src/views/matters.js', 'matters', {}],
    ['contacts', '../src/views/contacts.js', 'contacts', {}],
    ['tasks', '../src/views/tasks.js', 'tasks', { who: 'all' }],
    ['activities', '../src/views/activities.js', 'activities', { range: 'year' }],
    ['bills', '../src/views/billing.js', 'bills', { status: 'all' }],
  ]) {
    it(`on the ${name} list`, async () => {
      const { render } = await import(path);
      const c = liveCtx({}, query);
      const out = render(c);
      const node = out instanceof Node ? out : out.node;
      document.body.append(node);
      pickFirstRows(node, 2);
      const bar = node.querySelector('.bulk-bar');
      expect(bar.textContent).toMatch(/2 selected/);
      button(bar, /^Clear$/).focus();
      // Someone else edits a record that is not selected.
      const selected = new Set([...node.querySelectorAll('tbody tr.selected')]);
      const other = app.store.all(coll).at(-1);
      app.store.patch(coll, other.id, { updatedBy: 'someone' });
      await flush();
      expect(selected.size).toBe(2);
      expect(bar.textContent).toMatch(/2 selected/);
      expect(document.activeElement?.textContent.trim()).toBe('Clear');
      expect(bar.contains(document.activeElement)).toBe(true);
      c.dispose();
    });
  }
});

describe("a matter's Documents tab", () => {
  it('tries loading the documents again after a failed download', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const c = liveCtx({ id: 'm-1' }, { tab: 'documents' });
    vi.doMock('../src/views/docs-table.js', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const err = console.error;
    console.error = () => {};
    let out;
    try {
      out = render(c);
      document.body.append(out.node);
      for (let i = 0; i < 50 && !/could not be loaded/.test(out.node.textContent); i++) await new Promise((r) => setTimeout(r, 10));
      expect(out.node.textContent).toMatch(/Documents could not be loaded/);
    } finally {
      console.error = err;
      vi.doUnmock('../src/views/docs-table.js');
    }
    // Back online: switching away and back to the tab tries again.
    const tab = (label) => [...out.node.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith(label));
    tab('Tasks').click();
    tab('Documents').click();
    for (let i = 0; i < 50 && !out.node.querySelector('.docs-block'); i++) await new Promise((r) => setTimeout(r, 10));
    expect(out.node.querySelector('.docs-block')).not.toBeNull();
    c.dispose();
  });
});
