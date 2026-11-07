// @vitest-environment jsdom
/**
 * Regression tests from a review of the calendar, tasks, dashboard,
 * documents, and settings screens.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { today, addDays } from '../src/core/dates.js';

/** A view context whose watch() follows the store, like the real view host. */
function makeCtx(query = {}, params = {}) {
  const disposers = [];
  return {
    query,
    params,
    route: { query, params },
    live(fn, colls = 'all') {
      const n = document.createElement('div');
      const draw = () => n.replaceChildren(...[].concat(fn()).filter(Boolean));
      draw();
      disposers.push(app.store.subscribe((changed) => (colls === 'all' ? !changed.has('sync') || changed.size > 1 : colls.some((c) => changed.has(c))) && draw()));
      return n;
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

const tick = () => new Promise((r) => setTimeout(r, 0));

async function freshStore(collections = {}, settings) {
  app.store = createStore({ backend: createMemoryBackend({ collections, settings }), flushDelay: 0 });
  await app.store.init();
}

beforeAll(() => {
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  globalThis.CSS ??= {};
  globalThis.CSS.escape ??= (s) => String(s).replace(/["\\]/g, '\\$&');
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  }
});

beforeEach(() => {
  document.body.replaceChildren();
  app.demo = true;
  app.team = null;
  app.user = null;
  try {
    localStorage.clear();
  } catch {}
});

let ctx;
afterEach(() => {
  ctx?.dispose();
  ctx = null;
});

const USER = { id: 'u-1', name: 'Alex Kim', role: 'lawyer', active: true };

describe('calendar', () => {
  it('follows an event moved with the keyboard to a day outside the view', async () => {
    const d = today();
    await freshStore({ users: [USER], events: [{ id: 'e-1', title: 'Hearing', date: d, start: '10:00', end: '11:00', attendeeIds: ['u-1'] }] });
    const { render } = await import('../src/views/calendar.js');
    ctx = makeCtx({ view: 'day', date: d });
    const out = render(ctx);
    document.body.append(out.node);
    const ev = out.node.querySelector('.cal-ev');
    ev.focus();
    ev.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    await tick();
    expect(app.store.get('events', 'e-1').date).toBe(addDays(d, 1));
    // The view moves to the event's new day and keeps focus on it.
    const moved = out.node.querySelector('.cal-ev[data-id="e-1"]');
    expect(moved).not.toBeNull();
    expect(document.activeElement).toBe(moved);
  });
});

/** Pointer events with the fields jsdom leaves out, and grid geometry for the calendar. */
function pointer(el, type, { x = 0, y = 0, pointerType = 'mouse' } = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  el.dispatchEvent(e);
  return e;
}

function stubCalendarGeometry() {
  Element.prototype.setPointerCapture ??= () => {};
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (this.classList?.contains('cal-col')) {
      const left = Number(this.dataset.idx) * 100;
      return { top: 0, left, width: 100, height: 1152, right: left + 100, bottom: 1152, x: left, y: 0 };
    }
    if (this.classList?.contains('cal-ev')) {
      const top = parseFloat(this.style.top) || 0;
      return { top, left: 0, width: 96, height: 40, right: 96, bottom: top + 40, x: 0, y: top };
    }
    return orig.call(this);
  };
  return () => (Element.prototype.getBoundingClientRect = orig);
}

describe('calendar sidebar on narrow screens', () => {
  it('has a button that shows the calendars and layers panel', async () => {
    await freshStore({ users: [USER] });
    const { render } = await import('../src/views/calendar.js');
    ctx = makeCtx({ view: 'week' });
    const out = render(ctx);
    document.body.append(out.node);
    const btn = out.node.querySelector('.cal-side-toggle');
    expect(btn).not.toBeNull();
    const side = document.getElementById(btn.getAttribute('aria-controls'));
    expect(side.classList.contains('cal-side')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(side.parentElement.classList.contains('side-open')).toBe(true);
    btn.click();
    expect(side.parentElement.classList.contains('side-open')).toBe(false);
  });
});

describe('calendar all-day row', () => {
  it('lists every all-day item in day view, where "+N more" has nowhere else to go', async () => {
    const d = today();
    const events = Array.from({ length: 5 }, (_, i) => ({ id: `e-${i}`, title: `Filing ${i}`, date: d, allDay: true, attendeeIds: ['u-1'] }));
    await freshStore({ users: [USER], events });
    const { render } = await import('../src/views/calendar.js');
    ctx = makeCtx({ view: 'day', date: d });
    const out = render(ctx);
    document.body.append(out.node);
    expect(out.node.querySelectorAll('.cal-allday .cal-chip')).toHaveLength(5);
    expect(out.node.querySelector('.cal-allday .cal-more')).toBeNull();
  });
});

describe('calendar dragging', () => {
  let restore;
  beforeEach(() => (restore = stubCalendarGeometry()));
  afterEach(() => restore());

  async function dayView() {
    const d = today();
    await freshStore({ users: [USER], events: [{ id: 'e-1', title: 'Hearing', date: d, start: '10:00', end: '11:00', attendeeIds: ['u-1'] }] });
    const { render } = await import('../src/views/calendar.js');
    ctx = makeCtx({ view: 'day', date: d });
    const out = render(ctx);
    document.body.append(out.node);
    return out.node.querySelector('.cal-ev');
  }

  it('moves an event with the mouse', async () => {
    const ev = await dayView();
    pointer(ev, 'pointerdown', { x: 50, y: 490 });
    pointer(ev, 'pointermove', { x: 50, y: 590 });
    pointer(ev, 'pointerup', { x: 50, y: 590 });
    expect(app.store.get('events', 'e-1')).toMatchObject({ start: '12:00', end: '13:00' });
  });

  it('resizes an event from its bottom edge, says so, and can undo it', async () => {
    const ev = await dayView();
    pointer(ev.querySelector('.cal-ev-resize'), 'pointerdown', { x: 50, y: 526 });
    pointer(ev, 'pointermove', { x: 50, y: 600 });
    pointer(ev, 'pointerup', { x: 50, y: 600 });
    expect(app.store.get('events', 'e-1')).toMatchObject({ start: '10:00', end: '12:30' });
    const t = [...document.querySelectorAll('.toast')].pop();
    expect(t.textContent).toMatch(/now ends at/);
    expect(t.textContent).not.toMatch(/Moved/);
    t.querySelector('.toast-action').click();
    expect(app.store.get('events', 'e-1')).toMatchObject({ start: '10:00', end: '11:00' });
  });

  it('finishes a drag even if other data changes in the middle of it', async () => {
    const ev = await dayView();
    pointer(ev, 'pointerdown', { x: 50, y: 490 });
    pointer(ev, 'pointermove', { x: 50, y: 590 });
    // A sync or a colleague's edit arrives while the event is being dragged.
    app.store.put('tasks', { id: 't-9', name: 'Unrelated', dueDate: today(), done: false });
    await tick();
    // Removing the dragged block would release the pointer and lose the drop.
    expect(ev.isConnected).toBe(true);
    // Released over the grid rather than the block (pointer capture can be lost when the block changes column).
    pointer(document.querySelector('.cal-col'), 'pointerup', { x: 50, y: 590 });
    expect(app.store.get('events', 'e-1')).toMatchObject({ start: '12:00', end: '13:00' });
    await tick();
    // The change that arrived is drawn once the drag is over.
    expect(document.body.textContent).toContain('Unrelated');
  });

  it('takes away an event deleted elsewhere while it was being dragged', async () => {
    const ev = await dayView();
    pointer(ev, 'pointerdown', { x: 50, y: 490 });
    pointer(ev, 'pointermove', { x: 50, y: 590 });
    // A colleague deletes the event mid-drag.
    app.store.remove('events', 'e-1');
    await tick();
    pointer(document.querySelector('.cal-col'), 'pointerup', { x: 50, y: 590 });
    await tick();
    expect(app.store.get('events', 'e-1')).toBeNull();
    expect(document.querySelector('.cal-ev[data-id="e-1"]')).toBeNull();
    expect([...document.querySelectorAll('.toast')].some((t) => /Moved/.test(t.textContent))).toBe(false);
  });

  it('leaves the event where it was when the browser cancels the drag', async () => {
    const ev = await dayView();
    pointer(ev, 'pointerdown', { x: 50, y: 490 });
    pointer(ev, 'pointermove', { x: 50, y: 590 });
    pointer(ev, 'pointercancel', { x: 50, y: 590 });
    expect(app.store.get('events', 'e-1')).toMatchObject({ start: '10:00', end: '11:00' });
  });

  it('lets a finger swipe across an event scroll the calendar instead of moving the event', async () => {
    const ev = await dayView();
    pointer(ev, 'pointerdown', { x: 50, y: 490, pointerType: 'touch' });
    pointer(ev, 'pointermove', { x: 50, y: 590, pointerType: 'touch' });
    pointer(ev, 'pointerup', { x: 50, y: 590, pointerType: 'touch' });
    expect(app.store.get('events', 'e-1')).toMatchObject({ start: '10:00', end: '11:00' });
  });

  it('moves an event by touch after a long press', async () => {
    const ev = await dayView();
    vi.useFakeTimers();
    try {
      pointer(ev, 'pointerdown', { x: 50, y: 490, pointerType: 'touch' });
      vi.advanceTimersByTime(600);
      const tm = new Event('touchmove', { bubbles: true, cancelable: true });
      ev.dispatchEvent(tm);
      // While dragging, the page must not scroll under the finger.
      expect(tm.defaultPrevented).toBe(true);
      pointer(ev, 'pointermove', { x: 50, y: 590, pointerType: 'touch' });
      pointer(ev, 'pointerup', { x: 50, y: 590, pointerType: 'touch' });
    } finally {
      vi.useRealTimers();
    }
    expect(app.store.get('events', 'e-1')).toMatchObject({ start: '12:00', end: '13:00' });
  });
});

describe('tasks', () => {
  it('keeps the bulk bar count in step when selected tasks leave the list', async () => {
    const d = today();
    await freshStore({
      users: [USER],
      tasks: [
        { id: 't-1', name: 'Draft complaint', dueDate: d, assigneeId: 'u-1', done: false },
        { id: 't-2', name: 'Call client', dueDate: d, assigneeId: 'u-1', done: false },
        { id: 't-3', name: 'File motion', dueDate: d, assigneeId: 'u-1', done: false },
      ],
    });
    const { render } = await import('../src/views/tasks.js');
    ctx = makeCtx({ who: 'all' });
    const out = render(ctx);
    document.body.append(out.node);
    const rowFor = (name) => [...out.node.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes(name));
    for (const name of ['Draft complaint', 'Call client']) {
      const cb = rowFor(name).querySelector('input[type=checkbox]');
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    }
    const bar = out.node.querySelector('.bulk-bar');
    expect(bar.textContent).toContain('2 selected');
    // Completing one of them from its own row takes it off the outstanding list.
    rowFor('Call client').querySelector('.task-check').click();
    await tick();
    expect(bar.textContent).toContain('1 selected');
    rowFor('Draft complaint').querySelector('.task-check').click();
    await tick();
    expect(bar.hidden).toBe(true);
  });
});

describe('dashboard', () => {
  it('counts hours of people who were deactivated this month in the firm table', async () => {
    const d = today();
    await freshStore({
      users: [USER, { id: 'u-2', name: 'Former Associate', role: 'lawyer', active: false }],
      matters: [{ id: 'm-1', description: 'Estate', status: 'open' }],
      activities: [
        { id: 'a-1', kind: 'time', userId: 'u-1', matterId: 'm-1', date: d, minutes: 60, rateCents: 10000 },
        { id: 'a-2', kind: 'time', userId: 'u-2', matterId: 'm-1', date: d, minutes: 120, rateCents: 10000 },
      ],
    });
    const { render } = await import('../src/views/dashboard.js');
    ctx = makeCtx({ tab: 'firm' });
    const out = render(ctx);
    document.body.append(out.node);
    const table = out.node.querySelector('.hours-table');
    expect(table.textContent).toContain('Former Associate');
    expect(table.querySelector('tfoot td.num').textContent).toBe('3.0');
  });
});

describe('dates from timestamps', () => {
  const TZ = process.env.TZ;
  // Honolulu: west of nearly every zone, so cached date formatters still print local midnights correctly.
  beforeEach(() => (process.env.TZ = 'Pacific/Honolulu'));
  afterEach(() => (process.env.TZ = TZ));

  // 9:30 PM on October 12 in Honolulu is already October 13 in UTC.
  const evening = '2026-10-13T07:30:00.000Z';

  it('shows the local upload date of a document', async () => {
    const { formatDate } = await import('../src/core/dates.js');
    await freshStore({ documents: [{ id: 'd-1', name: 'Letter.pdf', matterId: null, createdAt: evening, file: { path: 'x', name: 'Letter.pdf', type: 'application/pdf', size: 10 } }] });
    const { render } = await import('../src/views/documents.js');
    ctx = makeCtx({});
    const out = render(ctx);
    document.body.append(out.node);
    const row = out.node.querySelector('tbody tr');
    expect(row.textContent).toContain(formatDate('2026-10-12'));
    expect(row.textContent).not.toContain(formatDate('2026-10-13'));
  });

  it('shows the local completion date of a task', async () => {
    const { formatDate } = await import('../src/core/dates.js');
    await freshStore({ users: [USER], tasks: [{ id: 't-1', name: 'Done late', assigneeId: 'u-1', done: true, completedAt: evening }] });
    localStorage.setItem('legal.columns.tasks', JSON.stringify([]));
    const { render } = await import('../src/views/tasks.js');
    ctx = makeCtx({ status: 'completed', who: 'all' });
    const out = render(ctx);
    document.body.append(out.node);
    const row = out.node.querySelector('tbody tr');
    expect(row.textContent).toContain(formatDate('2026-10-12'));
  });

  it('shows the local date a template was updated', async () => {
    const { formatDate } = await import('../src/core/dates.js');
    await freshStore({ templates: [{ id: 'tp-1', name: 'Letter', body: 'Hi', updatedAt: evening }] });
    const { templatesPanel } = await import('../src/views/docs-templates.js');
    ctx = makeCtx({});
    const node = templatesPanel(ctx);
    expect(node.textContent).toContain(`Updated ${formatDate('2026-10-12')}`);
  });
});

describe('document previews', () => {
  const created = [];
  let origCreate;
  let origRevoke;
  beforeEach(() => {
    // jsdom's Blob has no arrayBuffer(); browsers all do.
    Blob.prototype.arrayBuffer ??= function () {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsArrayBuffer(this);
      });
    };
    origCreate = URL.createObjectURL;
    origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (blob) => (created.push(blob), `blob:test/${created.length}`);
    URL.revokeObjectURL = () => {};
  });
  afterEach(() => {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    created.length = 0;
  });

  async function preview(name, type, content) {
    await freshStore();
    const { saveFile } = await import('../src/files.js');
    const ref = await saveFile(new Blob([content], { type }), { name });
    const { openDocumentPreview } = await import('../src/views/docs-actions.js');
    const api = openDocumentPreview({ id: 'd-1', name, file: { ...ref, type } });
    for (let i = 0; i < 10 && api.dialog.querySelector('[aria-busy]'); i++) await tick();
    return api;
  }

  it('never shows a "PDF" stored with a web page type as a page on the app origin', async () => {
    const api = await preview('invoice.pdf', 'text/html', '<script>parent.stolen = 1</script>');
    const frame = api.dialog.querySelector('iframe.doc-frame');
    expect(frame).not.toBeNull();
    const blob = created.at(-1);
    expect(blob.type).toBe('application/pdf');
    api.close();
  });

  it('shows an SVG image from a data URL, so opening it in a new tab cannot run its scripts', async () => {
    const api = await preview('logo.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const img = api.dialog.querySelector('img.doc-img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src').startsWith('data:image/svg+xml')).toBe(true);
    api.close();
  });
});

describe('dropping files', () => {
  function drag(target, type) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { types: ['Files'], files: [], dropEffect: 'none' } });
    target.dispatchEvent(e);
    return e;
  }

  it('does not let a file dropped beside the drop zone replace the app', async () => {
    await freshStore();
    const { openUploadDocuments } = await import('../src/views/docs-upload.js');
    openUploadDocuments();
    await tick();
    const outside = document.querySelector('dialog .dialog-head');
    const over = drag(outside, 'dragover');
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe('none');
    expect(drag(outside, 'drop').defaultPrevented).toBe(true);
    // The drop zone itself still takes files.
    const zone = document.querySelector('.drop-zone');
    const onZone = drag(zone, 'dragover');
    expect(onZone.dataTransfer.dropEffect).toBe('copy');
    document.querySelector('dialog .icon-btn[aria-label="Close"]').click();
  });
});

describe('generating and uploading documents', () => {
  it('saves one document when Save is clicked twice', async () => {
    await freshStore({ matters: [{ id: 'm-1', description: 'Estate', status: 'open', displayNumber: '00001' }], templates: [{ id: 'tp-1', name: 'Letter', body: 'Dear client' }] });
    const { openGenerateDocument } = await import('../src/views/docs-generate.js');
    const done = openGenerateDocument({ matterId: 'm-1', templateId: 'tp-1' });
    const form = document.querySelector('dialog form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await done;
    await tick();
    expect(app.store.all('documents')).toHaveLength(1);
  });

  it('keeps the upload dialog open with its files when nothing could be uploaded', async () => {
    await freshStore();
    app.team = { url: 'https://team.example' }; // 8 MB limit per file
    const { openUploadDocuments } = await import('../src/views/docs-upload.js');
    openUploadDocuments();
    const input = document.querySelector('dialog input[type=file]');
    const big = new File(['x'], 'Scan.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [big], configurable: true });
    input.dispatchEvent(new Event('change'));
    document.querySelector('dialog form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    await tick();
    const dlg = document.querySelector('dialog');
    expect(dlg).not.toBeNull();
    expect(dlg.querySelector('.upload-item').textContent).toContain('Scan.pdf');
    const btn = dlg.querySelector('.dialog-foot .btn.primary');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Upload');
    app.team = null;
    dlg.querySelector('.icon-btn[aria-label="Close"]').click();
  });
});

describe('settings lists', () => {
  it('carries a renamed document category and relationship type over to the records using them', async () => {
    await freshStore({
      documents: [{ id: 'd-1', name: 'Letter.pdf', category: 'Correspondence', file: { path: 'x', name: 'Letter.pdf', type: 'application/pdf', size: 1 } }],
      templates: [{ id: 'tp-1', name: 'Engagement letter', category: 'Correspondence', body: '' }],
      matters: [{ id: 'm-1', description: 'Estate', status: 'open', related: [{ contactId: 'c-1', relationship: 'Witness' }] }],
    });
    const { render } = await import('../src/views/settings.js');
    ctx = makeCtx({}, { section: 'lists' });
    const out = render(ctx);
    document.body.append(out.node);
    const rename = (from, to) => {
      const input = [...out.node.querySelectorAll('.le-name')].find((i) => i.value === from);
      input.value = to;
      input.dispatchEvent(new Event('change'));
    };
    rename('Correspondence', 'Letters');
    expect(app.settings().documentCategories).toContain('Letters');
    expect(app.store.get('documents', 'd-1').category).toBe('Letters');
    expect(app.store.get('templates', 'tp-1').category).toBe('Letters');
    rename('Witness', 'Fact witness');
    expect(app.store.get('matters', 'm-1').related[0].relationship).toBe('Fact witness');
  });
});

describe('practice area stages', () => {
  async function openAreaStages() {
    const { defaultSettings } = await import('../src/core/settings.js');
    const settings = defaultSettings();
    settings.practiceAreas = [{ id: 'pa-x', name: 'Family', stages: [...settings.stages, { id: 'st-mediation', name: 'Mediation' }] }];
    await freshStore(
      {
        matters: [
          { id: 'm-1', description: 'Divorce', status: 'open', practiceAreaId: 'pa-x', stageId: 'st-mediation' },
          { id: 'm-2', description: 'Custody', status: 'open', practiceAreaId: 'pa-x', stageId: 'st-intake' },
        ],
      },
      settings,
    );
    const { render } = await import('../src/views/settings.js');
    ctx = makeCtx({}, { section: 'practice' });
    const out = render(ctx);
    document.body.append(out.node);
    out.node.querySelector('button[aria-label="Stages for Family"]').click();
    return document.querySelector('dialog input[role=switch]');
  }
  const answer = async (label) => {
    await tick();
    const dlg = [...document.querySelectorAll('dialog')].pop();
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === label).click();
    await tick();
  };

  it('asks before dropping stages that matters are in, and keeps them on cancel', async () => {
    const sw = await openAreaStages();
    sw.checked = false;
    sw.dispatchEvent(new Event('change'));
    await answer('Cancel');
    expect(app.settings().practiceAreas[0].stages.map((s) => s.id)).toContain('st-mediation');
    expect(sw.checked).toBe(true);
  });

  it('clears the stage of matters left in a dropped stage', async () => {
    const sw = await openAreaStages();
    sw.checked = false;
    sw.dispatchEvent(new Event('change'));
    await answer('Use default stages');
    expect(app.settings().practiceAreas[0].stages).toEqual([]);
    expect(app.store.get('matters', 'm-1').stageId).toBe('');
    // Matters in a stage the default list also has keep it.
    expect(app.store.get('matters', 'm-2').stageId).toBe('st-intake');
  });
});

describe('rates and targets', () => {
  it('does not save a negative default hourly rate', async () => {
    await freshStore();
    const { render } = await import('../src/views/settings.js');
    ctx = makeCtx({}, { section: 'billing' });
    const out = render(ctx);
    const rate = out.node.querySelector('input[name=rate]');
    rate.value = '-250';
    rate.dispatchEvent(new Event('change'));
    expect(app.settings().billing.defaultRateCents).toBeGreaterThanOrEqual(0);
    expect(rate.getAttribute('aria-invalid')).toBe('true');
    // Said out loud, like the workday check, not only marked on the field.
    expect([...document.querySelectorAll('.toast.error')].some((t) => /rate/i.test(t.textContent))).toBe(true);
  });

  it('rejects a negative rate or target for a firm user', async () => {
    await freshStore({ users: [USER] });
    const { openUserDialog } = await import('../src/views/settings-users.js');
    openUserDialog(app.store.get('users', 'u-1'));
    const form = document.querySelector('dialog form');
    form.querySelector('[name=rate]').value = '-100';
    form.querySelector('[name=targetHours]').value = '-5';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    const u = app.store.get('users', 'u-1');
    expect(u.rateCents || 0).toBeGreaterThanOrEqual(0);
    expect(u.targetHours || 0).toBeGreaterThanOrEqual(0);
    document.querySelector('dialog .icon-btn[aria-label="Close"]')?.click();
  });
});

describe('keyboard focus across redraws', () => {
  const arrowRight = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

  it('keeps focus in the calendar view switcher while arrowing through views', async () => {
    await freshStore({ users: [USER] });
    const { render } = await import('../src/views/calendar.js');
    ctx = makeCtx({ view: 'week' });
    const out = render(ctx);
    document.body.append(out.node);
    const seg = () => out.node.querySelector('.cal-toolbar .seg');
    [...seg().querySelectorAll('button')].find((b) => b.textContent === 'Week').focus();
    arrowRight(document.activeElement);
    expect(out.node.querySelectorAll('.cal-mcell')).toHaveLength(42);
    expect(document.activeElement.textContent).toBe('Month');
    expect(document.activeElement.isConnected).toBe(true);
    arrowRight(document.activeElement);
    expect(document.activeElement.textContent).toBe('Agenda');
  });

  it('keeps focus on calendar sidebar controls after using them', async () => {
    await freshStore({ users: [USER, { id: 'u-2', name: 'Blake Ro', role: 'paralegal', active: true }] });
    const { render } = await import('../src/views/calendar.js');
    ctx = makeCtx({ view: 'week' });
    const out = render(ctx);
    document.body.append(out.node);
    const next = out.node.querySelector('.mini-cal [aria-label="Next month"]');
    next.focus();
    next.click();
    expect(document.activeElement.getAttribute('aria-label')).toBe('Next month');
    expect(document.activeElement.isConnected).toBe(true);
    const layer = [...out.node.querySelectorAll('.cal-layers label.layer')].find((l) => l.textContent.includes('Blake Ro')).querySelector('input');
    layer.focus();
    layer.click();
    expect(document.activeElement.isConnected).toBe(true);
    expect(document.activeElement.type).toBe('checkbox');
    expect(document.activeElement.closest('label')?.textContent).toContain('Blake Ro');
  });

  it('keeps focus in the tasks status switcher', async () => {
    await freshStore({ users: [USER], tasks: [{ id: 't-1', name: 'One', assigneeId: 'u-1', done: false }] });
    const { render } = await import('../src/views/tasks.js');
    ctx = makeCtx({ who: 'all' });
    const out = render(ctx);
    document.body.append(out.node);
    out.node.querySelector('.seg [aria-checked="true"]').focus();
    arrowRight(document.activeElement);
    expect(document.activeElement.getAttribute('role')).toBe('radio');
    expect(document.activeElement.isConnected).toBe(true);
    expect(document.activeElement.textContent).toContain('Completed');
  });
});

describe('custom fields', () => {
  it('keeps focus on a field being reordered with the keyboard', async () => {
    const { defaultSettings } = await import('../src/core/settings.js');
    const settings = defaultSettings();
    settings.customFields = [
      { id: 'f-1', entity: 'matter', label: 'Case number', type: 'text', options: [] },
      { id: 'f-2', entity: 'matter', label: 'Referral', type: 'text', options: [] },
      { id: 'f-3', entity: 'matter', label: 'Injury date', type: 'date', options: [] },
    ];
    await freshStore({}, settings);
    const { render } = await import('../src/views/settings.js');
    ctx = makeCtx({}, { section: 'fields' });
    const out = render(ctx);
    document.body.append(out.node);
    const btn = out.node.querySelector('[aria-label="Move Injury date up"]');
    btn.focus();
    btn.click();
    await tick();
    expect(app.settings().customFields.map((f) => f.id)).toEqual(['f-1', 'f-3', 'f-2']);
    expect(document.activeElement.getAttribute('aria-label')).toBe('Move Injury date up');
    expect(document.activeElement.isConnected).toBe(true);
    document.activeElement.click();
    await tick();
    // Now first: its up button is disabled, so focus moves to its down button.
    expect(document.activeElement.getAttribute('aria-label')).toBe('Move Injury date down');
  });
});

describe("dashboard agenda's task link", () => {
  it('opens a task list with every task the agenda counts', async () => {
    const d = today();
    const tasks = Array.from({ length: 10 }, (_, i) => ({ id: `t-${i}`, name: `Task ${i}`, assigneeId: 'u-1', done: false, dueDate: i < 5 ? addDays(d, -1) : d }));
    await freshStore({ users: [USER], tasks: [...tasks, { id: 't-next', name: 'Later', assigneeId: 'u-1', done: false, dueDate: addDays(d, 3) }] });
    const dash = await import('../src/views/dashboard.js');
    ctx = makeCtx({});
    const out = dash.render(ctx);
    const link = out.node.querySelector('.dash-more a');
    expect(link.textContent).toBe('View all 10 tasks');
    const query = Object.fromEntries(new URLSearchParams(link.getAttribute('href').split('?')[1] || ''));
    ctx.dispose();
    const { render } = await import('../src/views/tasks.js');
    ctx = makeCtx(query);
    const list = render(ctx);
    expect(list.node.querySelectorAll('tbody .task-name').length).toBe(10);
  });
});

describe('task list editor', () => {
  it('keeps focus in the dialog after removing the last task row', async () => {
    await freshStore();
    const { openTaskListDialog } = await import('../src/views/settings-tasks.js');
    openTaskListDialog();
    const dlg = document.querySelector('dialog');
    const remove = dlg.querySelector('[aria-label="Remove task 1"]');
    remove.focus();
    remove.click();
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(document.activeElement.textContent).toContain('Add task');
    dlg.querySelector('.icon-btn[aria-label="Close"]').click();
  });

});

describe('firm settings', () => {
  it('flags a workday that ends before it starts instead of silently not saving it', async () => {
    await freshStore();
    const { render } = await import('../src/views/settings.js');
    ctx = makeCtx({}, { section: 'firm' });
    const out = render(ctx);
    document.body.append(out.node);
    const end = out.node.querySelector('input[name=end]');
    end.value = '07:00';
    end.dispatchEvent(new Event('change'));
    expect(app.settings().workday.end).toBe('18:00');
    expect(end.getAttribute('aria-invalid')).toBe('true');
    expect([...document.querySelectorAll('.toast')].pop()?.textContent || '').toMatch(/end after it starts/);
    end.value = '17:00';
    end.dispatchEvent(new Event('change'));
    expect(app.settings().workday.end).toBe('17:00');
    expect(end.hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('settings list editor', () => {
  it('refuses to rename an item to a name already in the list, as adding does', async () => {
    await freshStore();
    const { render } = await import('../src/views/settings.js');
    ctx = makeCtx({}, { section: 'lists' });
    const out = render(ctx);
    document.body.append(out.node);
    const before = [...app.settings().documentCategories];
    const input = [...out.node.querySelectorAll('.le-name')].find((i) => i.value === 'Evidence');
    input.value = 'pleadings';
    input.dispatchEvent(new Event('change'));
    expect(app.settings().documentCategories).toEqual(before);
    expect(input.value).toBe('Evidence');
  });
});

describe('deleting firm users', () => {
  it('counts payments and trust transactions they recorded', async () => {
    await freshStore({
      users: [USER],
      payments: [{ id: 'p-1', billId: 'b-1', amountCents: 100, recordedBy: 'u-1' }],
      transactions: [{ id: 'x-1', type: 'deposit', amountCents: 100, recordedBy: 'u-1' }],
    });
    const { userReferences } = await import('../src/views/settings-users.js');
    expect(userReferences(app.store, 'u-1')).toBe(2);
  });
});
