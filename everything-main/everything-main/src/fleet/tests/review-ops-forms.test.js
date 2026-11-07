// @vitest-environment jsdom
/** Inspection form builder and the forms list. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  Element.prototype.scrollIntoView ??= function () {};
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
});

let app;
let store;

async function boot() {
  ({ app } = await import('../src/app.js'));
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { bucketOf } = await import('../src/core/schema.js');
  const { defaultSettings } = await import('../src/core/settings.js');
  app.demo = true;
  app.today = () => '2026-10-12';
  store = createStore({ backend: createMemoryBackend({ settings: defaultSettings() }, { bucketOf }), flushDelay: 0 });
  await store.init();
  app.store = store;
  store.put('vehicles', { id: 'v1', name: 'Van 1' });
  document.body.innerHTML = '';
}

async function view(name, params = {}, query = {}) {
  const mod = await import(`../src/views/${name}.js`);
  const lives = [];
  const ctx = {
    params,
    query,
    live: (fn) => {
      const node = document.createElement('div');
      const draw = () => node.replaceChildren(...[fn()].flat().filter(Boolean));
      draw();
      node.redraw = draw;
      lives.push(node);
      return node;
    },
    onDispose() {},
  };
  const out = mod.render(ctx);
  document.body.append(out.node || out);
  return { out, lives };
}

const saveBtn = () => document.querySelector('.form-foot button[type=submit]');
const builderRow = (id) => document.querySelector(`.builder-item[data-id="${id}"]`);
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('change'));
};

describe('form builder', () => {
  beforeEach(boot);

  it('refuses a multiple choice item with no options', async () => {
    store.put('inspectionForms', { id: 'f1', name: 'Daily', vehicleIds: [], archived: false, items: [{ id: 'c', type: 'choice', label: 'Fuel level', required: true, options: ['Full', 'Empty'], passOptions: ['Full'] }] });
    await view('inspection-form-builder', { id: 'f1' });
    type(builderRow('c').querySelector('input[aria-label="Item 1 options"]'), ' , ');
    saveBtn().click();
    await settle();
    expect(store.get('inspectionForms', 'f1').items[0].options).toEqual(['Full', 'Empty']);
    expect(document.querySelector('.toast')?.textContent).toMatch(/option/i);
  });

  it('refuses a number range that is not a number or has min above max', async () => {
    const item = { id: 'n', type: 'number', label: 'Tire pressure', required: true, min: 30, max: 40, unit: 'psi' };
    store.put('inspectionForms', { id: 'f1', name: 'Daily', vehicleIds: [], archived: false, items: [item] });
    await view('inspection-form-builder', { id: 'f1' });
    const min = builderRow('n').querySelector('input[aria-label="Minimum passing value"]');
    const max = builderRow('n').querySelector('input[aria-label="Maximum passing value"]');
    type(min, '30 psi');
    saveBtn().click();
    await settle();
    expect(store.get('inspectionForms', 'f1').items[0].min).toBe(30);
    type(min, '45');
    saveBtn().click();
    await settle();
    expect(store.get('inspectionForms', 'f1').items[0].min).toBe(30);
    type(min, '1,000');
    type(max, '');
    saveBtn().click();
    await settle();
    expect(store.get('inspectionForms', 'f1').items[0]).toMatchObject({ min: 1000, max: null });
  });

  it('keeps keyboard focus in the list after removing an item', async () => {
    const items = ['a', 'b', 'c'].map((id) => ({ id, type: 'passfail', label: `Item ${id}`, required: true }));
    store.put('inspectionForms', { id: 'f1', name: 'Daily', vehicleIds: [], archived: false, items });
    await view('inspection-form-builder', { id: 'f1' });
    const remove = (id) => [...builderRow(id).querySelectorAll('button')].find((b) => /Remove item/.test(b.getAttribute('aria-label')));
    remove('b').focus();
    remove('b').click();
    expect(document.activeElement).toBe(remove('c'));
    remove('c').focus();
    remove('c').click();
    expect(document.activeElement).toBe(remove('a'));
    remove('a').click();
    expect(document.activeElement?.textContent).toMatch(/Add item/);
  });

  it('creates one form when Create is clicked twice', async () => {
    await view('inspection-form-builder');
    const name = document.querySelector('[name="name"]');
    name.value = 'Walk-around';
    name.dispatchEvent(new Event('input'));
    type(document.querySelector('.builder-item input'), 'Odometer reading');
    saveBtn().click();
    await settle();
    saveBtn().click();
    await settle();
    expect(store.all('inspectionForms')).toHaveLength(1);
  });

  describe('drag and drop', () => {
    const drag = (el, typeName, { y = 0 } = {}) => {
      const e = new Event(typeName, { bubbles: true, cancelable: true });
      e.dataTransfer = { setData() {}, effectAllowed: '' };
      e.clientY = y;
      el.dispatchEvent(e);
      return e;
    };
    const order = () => store.get('inspectionForms', 'f1').items.map((it) => it.id);
    beforeEach(() => {
      const items = ['a', 'b', 'c'].map((id) => ({ id, type: 'passfail', label: `Item ${id}`, required: true }));
      store.put('inspectionForms', { id: 'f1', name: 'Daily', vehicleIds: [], archived: false, items });
    });

    it('forgets a cancelled drag, so dropping text later does not move items', async () => {
      await view('inspection-form-builder', { id: 'f1' });
      const handle = builderRow('a').querySelector('.drag-handle');
      handle.dispatchEvent(new Event('pointerdown'));
      drag(builderRow('a'), 'dragstart');
      drag(builderRow('a'), 'dragend');
      // Later, some text is dragged into item c's field.
      expect(drag(builderRow('c'), 'dragover').defaultPrevented).toBe(false);
      drag(builderRow('c'), 'drop');
      saveBtn().click();
      await settle();
      expect(order()).toEqual(['a', 'b', 'c']);
    });

    it('stops a row being draggable after a click on its handle', async () => {
      await view('inspection-form-builder', { id: 'f1' });
      const handle = builderRow('a').querySelector('.drag-handle');
      handle.dispatchEvent(new Event('pointerdown'));
      handle.dispatchEvent(new Event('pointerup'));
      expect(builderRow('a').draggable).toBe(false);
    });

    it('can drop an item at the end of the list', async () => {
      await view('inspection-form-builder', { id: 'f1' });
      builderRow('a').querySelector('.drag-handle').dispatchEvent(new Event('pointerdown'));
      drag(builderRow('a'), 'dragstart');
      const last = builderRow('c');
      last.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 300, width: 300 });
      expect(drag(last, 'dragover', { y: 130 }).defaultPrevented).toBe(true);
      expect(last.classList.contains('drop-after')).toBe(true);
      drag(last, 'drop', { y: 130 });
      saveBtn().click();
      await settle();
      expect(order()).toEqual(['b', 'c', 'a']);
    });
  });
});

describe('inspection forms list', () => {
  beforeEach(boot);

  const menuItem = (card, label) => {
    card.querySelector('button[aria-label="More actions"]').click();
    return [...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent.includes(label));
  };

  it('makes a duplicate of an archived form that is in use, not archived', async () => {
    store.put('inspectionForms', { id: 'old', name: 'Winter check', vehicleIds: [], archived: true, items: [{ id: 'x', type: 'passfail', label: 'Chains', required: true }] });
    await view('inspection-forms');
    const card = [...document.querySelectorAll('.form-card')].find((c) => c.textContent.includes('Winter check'));
    // An archived form cannot be started.
    expect([...card.querySelectorAll('a')].some((a) => a.textContent === 'Start')).toBe(false);
    menuItem(card, 'Duplicate').click();
    const copy = store.all('inspectionForms').find((f) => f.id !== 'old');
    expect(copy).toMatchObject({ name: 'Winter check (copy)', archived: false });
    expect(copy.items[0].id).not.toBe('x');
  });
});

describe('inspection detail after the form changed', () => {
  beforeEach(boot);

  it('does not file results of removed items under another section', async () => {
    store.put('inspectionForms', { id: 'f1', name: 'Daily', vehicleIds: [], archived: false, items: [
      { id: 's1', type: 'section', label: 'Exterior' },
      { id: 'a', type: 'passfail', label: 'Lights' },
      { id: 's2', type: 'section', label: 'In the cab' },
      { id: 'b', type: 'passfail', label: 'Horn' },
    ] });
    store.put('inspections', { id: 'i1', formId: 'f1', formName: 'Daily', vehicleId: 'v1', date: '2026-10-10', results: [
      { itemId: 'm', label: 'Odometer reading', type: 'meter', value: 1200, pass: null, photos: [] },
      { itemId: 'a', label: 'Lights', type: 'passfail', value: 'pass', pass: true, photos: [] },
      { itemId: 'b', label: 'Horn', type: 'passfail', value: 'pass', pass: true, photos: [] },
    ], failed: 0 });
    await view('inspection-detail', { id: 'i1' });
    const cab = [...document.querySelectorAll('.insp-result-card')].find((c) => c.querySelector('h2')?.textContent === 'In the cab');
    expect(cab.textContent).toContain('Horn');
    expect(cab.textContent).not.toContain('Odometer reading');
    expect(document.body.textContent).toContain('Odometer reading');
  });
});

describe('pre-trip template', () => {
  beforeEach(boot);

  it('adds one form when the template button is double-clicked', async () => {
    await view('inspection-forms');
    const btn = [...document.querySelectorAll('.page-header button')].find((b) => b.textContent.includes('Pre-trip template'));
    btn.click();
    await settle();
    // The builder is still loading, so the button is still on screen.
    btn.click();
    await settle();
    expect(store.all('inspectionForms')).toHaveLength(1);
  });
});
