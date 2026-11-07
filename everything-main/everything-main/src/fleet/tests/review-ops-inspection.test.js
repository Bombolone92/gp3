// @vitest-environment jsdom
/**
 * Inspection run screen: submitting, uploads still in flight, the
 * signature pad, and number validation.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Uploads resolve only when a test lets them, to model a slow phone network.
const uploads = [];
vi.mock('../src/files.js', () => ({
  saveFile: vi.fn((file) => new Promise((resolve) => uploads.push(() => resolve({ id: `f${uploads.length}`, name: file.name, type: file.type, size: 1, path: `files/inspections/${file.name}` })))),
  fileUrl: vi.fn(() => Promise.reject(new Error('none'))),
  deleteFile: vi.fn(() => Promise.resolve()),
  isImage: () => true,
}));

const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  Element.prototype.scrollIntoView ??= function () {};
  Element.prototype.setPointerCapture ??= function () {};
  // A canvas that records what was drawn, since jsdom has none.
  HTMLCanvasElement.prototype.getContext = function () {
    this._ops ??= [];
    const ops = this._ops;
    const rec = (name) => (...a) => ops.push([name, ...a]);
    return new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'getImageData' ? () => ({}) : rec(k)), set: (t, k, v) => ((t[k] = v), true) });
  };
  HTMLCanvasElement.prototype.toBlob = function (cb) {
    cb(new Blob(['png'], { type: 'image/png' }));
  };
});

const box = (el, width, height = 150) => (el.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 }));
const pointer = (el, type, x, y, id = 1) => {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: id });
  el.dispatchEvent(e);
};
const sign = (canvas) => {
  pointer(canvas, 'pointerdown', 10, 10);
  pointer(canvas, 'pointermove', 40, 30);
  pointer(canvas, 'pointerup', 40, 30);
};

let app;
let store;

async function boot({ items, vehicle = {} } = {}) {
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
  store.put('vehicles', { id: 'v1', name: 'Van 1', meterUnit: 'mi', ...vehicle });
  store.put('inspectionForms', { id: 'f1', name: 'Pre-trip', items, vehicleIds: [], archived: false });
  document.body.innerHTML = '';
  uploads.length = 0;
}

async function run(query = { vehicle: 'v1', form: 'f1' }) {
  const mod = await import('../src/views/inspection-run.js');
  const ctx = { params: {}, query, live: (fn) => fn(), onDispose() {} };
  const out = mod.render(ctx);
  document.body.append(out.node);
  return out;
}

const itemRow = (id) => document.querySelector(`[data-item="${id}"]`);
const submitBtn = () => [...document.querySelectorAll('button')].find((b) => /Submit inspection/.test(b.textContent));

describe('submitting an inspection', () => {
  beforeEach(() => boot({ items: [{ id: 'a', type: 'passfail', label: 'Brakes', required: true }] }));

  it('saves once and opens one issue when Submit is tapped twice', async () => {
    await run();
    itemRow('a').querySelector('.pf-btn.fail').click();
    submitBtn().click();
    await settle(5);
    // The view is still on screen while the next one loads.
    submitBtn().click();
    await settle(5);
    expect(store.all('inspections')).toHaveLength(1);
    expect(store.all('issues')).toHaveLength(1);
  });

  it('drops the failure note of an item changed back to Pass', async () => {
    await run();
    itemRow('a').querySelector('.pf-btn.fail').click();
    const note = itemRow('a').querySelector('textarea');
    note.value = 'Pedal feels soft';
    note.dispatchEvent(new Event('input'));
    itemRow('a').querySelector('.pf-btn.pass').click();
    submitBtn().click();
    await settle(5);
    const [sub] = store.all('inspections');
    expect(sub.results[0]).toMatchObject({ value: 'pass', pass: true, note: '', photos: [] });
  });
});

describe('required items', () => {
  beforeEach(() => boot({ items: [{ id: 'a', type: 'passfail', label: 'Brakes', required: true }] }));

  it('tells screen readers an item is required instead of reading a star', async () => {
    await run();
    const label = itemRow('a').querySelector('.insp-label');
    expect(label.querySelector('.req').getAttribute('aria-hidden')).toBe('true');
    expect(label.querySelector('.sr-only')?.textContent).toMatch(/required/);
  });
});

describe('pass and fail with the keyboard', () => {
  beforeEach(() => boot({ items: [{ id: 'a', type: 'passfail', label: 'Brakes', required: true }, { id: 'c', type: 'choice', label: 'Fuel', options: ['Full', 'Half', 'Empty'], passOptions: ['Full', 'Half'] }] }));

  it('has one Tab stop per item and moves the choice with the arrow keys', async () => {
    await run();
    const [pass, fail] = itemRow('a').querySelectorAll('.pf-btn');
    expect([pass.tabIndex, fail.tabIndex]).toEqual([0, -1]);
    pass.focus();
    pass.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(fail);
    expect(fail.getAttribute('aria-checked')).toBe('true');
    expect([pass.tabIndex, fail.tabIndex]).toEqual([-1, 0]);
    const opts = [...itemRow('c').querySelectorAll('.choice-btn')];
    opts[0].focus();
    opts[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(opts[2]);
    expect(opts[2].getAttribute('aria-checked')).toBe('true');
    expect(opts.map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
  });
});

describe('choosing the form', () => {
  beforeEach(async () => {
    await boot({ items: [{ id: 'a', type: 'passfail', label: 'Brakes' }] });
    store.put('inspectionForms', { id: 'f2', name: 'Post-trip', items: [{ id: 'b', type: 'passfail', label: 'Lights' }], vehicleIds: [], archived: false });
  });

  it('keeps focus on the chosen form and supports the arrow keys', async () => {
    await run({ vehicle: 'v1' });
    const choices = () => [...document.querySelectorAll('.form-choice')];
    expect(choices().map((b) => b.tabIndex)).toEqual([0, -1]);
    choices()[1].focus();
    choices()[1].click();
    expect(document.activeElement).toBe(choices()[1]);
    expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(choices()[0]);
    expect(choices()[0].getAttribute('aria-checked')).toBe('true');
    expect(choices().map((b) => b.tabIndex)).toEqual([0, -1]);
  });

  it('does not start a form on a vehicle it does not apply to', async () => {
    store.patch('inspectionForms', 'f1', { vehicleIds: ['v2'] });
    store.patch('inspectionForms', 'f2', { archived: true });
    await run({ vehicle: 'v1' });
    expect(document.querySelector('.insp-list')).toBeNull();
    expect(document.body.textContent).toContain('No form applies to this vehicle.');
    document.body.innerHTML = '';
    // An archived form is not used either, even when named in the link.
    await run({ vehicle: 'v1', form: 'f2' });
    expect(document.querySelector('.insp-list')).toBeNull();
  });
});

describe('number and meter items', () => {
  beforeEach(() => boot({ items: [{ id: 'm', type: 'meter', label: 'Odometer', required: true }] }));

  it('does not accept text that is not a number as a meter reading', async () => {
    await run();
    const inp = itemRow('m').querySelector('input');
    inp.value = 'abc';
    inp.dispatchEvent(new Event('input'));
    expect(itemRow('m').querySelector('.insp-warn').textContent).toMatch(/number/i);
    submitBtn().click();
    await settle(5);
    expect(store.all('inspections')).toHaveLength(0);
    inp.value = '12,345';
    inp.dispatchEvent(new Event('input'));
    expect(itemRow('m').querySelector('.insp-warn').textContent).toBe('');
    submitBtn().click();
    await settle(5);
    expect(store.all('inspections')).toHaveLength(1);
    expect(store.all('inspections')[0].meter).toBe(12345);
  });
});

const pickFiles = (input, files) => {
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new Event('change'));
};

describe('photos still uploading', () => {
  beforeEach(() => boot({ items: [{ id: 'p', type: 'photo', label: 'Damage photos', required: false }] }));

  it('lets the driver take a photo or pick one from the library', async () => {
    await run();
    expect(itemRow('p').querySelector('input[type=file]').hasAttribute('capture')).toBe(false);
  });

  it('keeps focus in the item after removing a photo', async () => {
    await run();
    pickFiles(itemRow('p').querySelector('input[type=file]'), [new File(['x'], 'a.jpg', { type: 'image/jpeg' }), new File(['y'], 'b.jpg', { type: 'image/jpeg' })]);
    await settle();
    uploads[0]();
    await settle();
    uploads[1]();
    await settle();
    const dels = () => [...itemRow('p').querySelectorAll('.photo-del')];
    expect(dels()).toHaveLength(2);
    dels()[1].click();
    expect(document.activeElement).toBe(dels()[0]);
    dels()[0].click();
    expect(document.activeElement.textContent).toContain('Add photo');
  });

  it('waits for photo uploads before saving the inspection', async () => {
    await run();
    pickFiles(itemRow('p').querySelector('input[type=file]'), [new File(['x'], 'dent.jpg', { type: 'image/jpeg' })]);
    await settle();
    expect(uploads).toHaveLength(1);
    submitBtn().click();
    await settle(5);
    expect(store.all('inspections')).toHaveLength(0);
    uploads[0]();
    await settle(5);
    expect(store.all('inspections')).toHaveLength(1);
    expect(store.all('inspections')[0].results[0].photos).toHaveLength(1);
  });
});

describe('signature pad', () => {
  beforeEach(() => boot({ items: [{ id: 's', type: 'signature', label: 'Driver signature', required: true }] }));

  it('keeps a signature drawn just before Submit', async () => {
    await run();
    const canvas = itemRow('s').querySelector('canvas');
    box(canvas, 300);
    await settle(5);
    sign(canvas);
    // Submit right away, before the pad's pause has passed.
    submitBtn().click();
    await settle(5);
    expect(uploads).toHaveLength(1);
    uploads[0]();
    await settle(5);
    const [sub] = store.all('inspections');
    expect(sub).toBeTruthy();
    expect(sub.results[0]).toMatchObject({ value: 'signed' });
    expect(sub.results[0].photos).toHaveLength(1);
  });

  it('draws with one finger at a time', async () => {
    await run();
    const canvas = itemRow('s').querySelector('canvas');
    box(canvas, 300);
    await settle(5);
    canvas._ops.length = 0;
    pointer(canvas, 'pointerdown', 10, 10, 1);
    pointer(canvas, 'pointerdown', 250, 120, 2);
    pointer(canvas, 'pointermove', 260, 130, 2);
    pointer(canvas, 'pointermove', 40, 30, 1);
    pointer(canvas, 'pointerup', 260, 130, 2);
    pointer(canvas, 'pointermove', 60, 40, 1);
    pointer(canvas, 'pointerup', 60, 40, 1);
    const path = canvas._ops.filter(([op]) => op === 'moveTo' || op === 'lineTo');
    expect(path).toEqual([['moveTo', 10, 10], ['lineTo', 40, 30], ['lineTo', 60, 40]]);
    // Let the pad's delayed save run before the next test starts.
    await settle(600);
  });

  it('stays cleared when Clear is tapped while the signature uploads', async () => {
    await run();
    const canvas = itemRow('s').querySelector('canvas');
    box(canvas, 300);
    await settle(5);
    sign(canvas);
    await settle(600);
    expect(uploads).toHaveLength(1);
    [...itemRow('s').querySelectorAll('button')].find((b) => b.textContent === 'Clear').click();
    uploads[0]();
    await settle(5);
    submitBtn().click();
    await settle(5);
    expect(store.all('inspections')).toHaveLength(0);
    expect(itemRow('s').classList.contains('missing')).toBe(true);
  });

  it('resizes its drawing surface when the pad changes size, keeping the strokes', async () => {
    const observers = [];
    globalThis.ResizeObserver = class {
      constructor(cb) {
        this.cb = cb;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
    };
    try {
      await run();
      const canvas = itemRow('s').querySelector('canvas');
      box(canvas, 300);
      await settle(5);
      expect(canvas.width).toBe(300);
      sign(canvas);
      // The phone turns sideways and the pad gets wider.
      box(canvas, 600);
      canvas._ops.length = 0;
      for (const o of observers) o.cb([]);
      expect(canvas.width).toBe(600);
      expect(canvas._ops.some(([op]) => op === 'drawImage')).toBe(true);
    } finally {
      delete globalThis.ResizeObserver;
    }
  });
});
