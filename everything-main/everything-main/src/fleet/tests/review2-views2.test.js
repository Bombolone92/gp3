// @vitest-environment jsdom
/**
 * Second review of the fuel, parts, inspection form, reminder, assignment,
 * and renewal screens, rendered against a memory store.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

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
// Views still open at the end of a test; their timers must not outlive it.
let open = [];
afterEach(async () => {
  for (const d of open.splice(0)) d();
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  await settle(40);
});

async function boot() {
  ({ app } = await import('../src/app.js'));
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { bucketOf } = await import('../src/core/schema.js');
  app.demo = true;
  app.team = null;
  app.today = () => '2026-10-12';
  store = createStore({ backend: createMemoryBackend({}, { bucketOf }), flushDelay: 0 });
  await store.init();
  app.store = store;
  store.put('vehicles', { id: 'v1', name: 'Van 1', meterUnit: 'mi', meter: 12000 });
  document.body.innerHTML = '';
  location.hash = '';
}

async function view(name, params = {}, query = {}) {
  const mod = await import(`../src/views/${name}.js`);
  const disposers = [];
  open.push(() => disposers.forEach((d) => d()));
  const ctx = {
    params,
    query,
    route: { path: `/${name}`, params, query },
    live: (fn) => {
      const node = document.createElement('div');
      const draw = () => node.replaceChildren(...[fn()].flat().filter(Boolean));
      draw();
      node.redraw = draw;
      return node;
    },
    onDispose: (fn) => disposers.push(fn),
  };
  const out = mod.render(ctx);
  document.body.append(out.node || out);
  return { out, dispose: () => disposers.forEach((d) => d()) };
}

// Capture what "Export to CSV" downloads.
async function exportCSV() {
  const blobs = [];
  const orig = URL.createObjectURL;
  URL.createObjectURL = (b) => (blobs.push(b), 'blob:x');
  URL.revokeObjectURL ??= () => {};
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    document.querySelector('button[aria-label="More actions"]').click();
    [...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent.includes('Export to CSV')).click();
    const text = await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result);
      fr.readAsText(blobs[0]);
    });
    return text.trim().split('\r\n').map((l) => l.split(','));
  } finally {
    URL.createObjectURL = orig;
    clickSpy.mockRestore();
  }
}
const col = (rows, label) => rows.slice(1).map((r) => r[rows[0].indexOf(label)]);

const statValue = (label) => [...document.querySelectorAll('.summary-stat')].find((s) => s.querySelector('.label')?.textContent === label)?.querySelector('.value');

describe('fuel list summary', () => {
  beforeEach(boot);

  it('shows the volume, energy, and average price instead of node text', async () => {
    store.put('fuel', { vehicleId: 'v1', date: '2026-10-01', meter: 12000, volume: 10, price: 3.5, total: 3500 });
    store.put('fuel', { vehicleId: 'v1', date: '2026-10-05', meter: 12300, volume: 10, price: 3.5, total: 3500 });
    store.put('fuel', { vehicleId: 'v1', date: '2026-10-06', kind: 'charge', volume: 40, total: 1200 });
    await view('fuel');
    expect(document.querySelector('.summary-stats').textContent).not.toContain('[object');
    expect(statValue('Fuel volume').textContent).toBe('20 gal');
    expect(statValue('Energy').textContent).toBe('40 kWh');
    expect(statValue('Average price').textContent).toMatch(/3\.50 \/ gal$/);
  });
});

describe('duplicating an inspection form', () => {
  beforeEach(boot);

  it('makes a copy of a sample form that removing the sample data keeps', async () => {
    store.put('inspectionForms', { id: 'if-s', name: 'Pre-trip', sample: true, archived: false, items: [{ id: 'a', type: 'passfail', label: 'Horn' }] });
    await view('inspection-forms');
    document.querySelector('.form-card button[aria-label="More actions"]').click();
    [...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent.includes('Duplicate')).click();
    const copy = store.all('inspectionForms').find((f) => f.id !== 'if-s');
    expect(copy.name).toBe('Pre-trip (copy)');
    expect(copy.sample).toBeFalsy();
    const { removeSampleData } = await import('../src/views/sample-data.js');
    removeSampleData();
    expect(store.all('inspectionForms').map((f) => f.id)).toEqual([copy.id]);
  });
});

describe('parts list', () => {
  beforeEach(boot);

  it('exports the stock value as a money amount', async () => {
    store.put('parts', { number: 'OIL', description: 'Oil', unit: 'quart', unitCost: 1299, archived: false, locations: [{ location: 'Main shop', qty: 2.5 }] });
    await view('parts');
    const rows = await exportCSV();
    expect(col(rows, 'Unit cost')).toEqual(['12.99']);
    expect(col(rows, 'Value')).toEqual(['32.48']);
  });

  it('exports the quantity on hand rounded', async () => {
    store.put('parts', { number: 'ATF', unit: 'quart', unitCost: 100, archived: false, locations: [{ location: 'Main shop', qty: 0.1 }, { location: 'Van stock', qty: 0.2 }] });
    await view('parts');
    expect(col(await exportCSV(), 'On hand')).toEqual(['0.3']);
  });

  it('exports where each part is kept', async () => {
    store.put('parts', { number: 'ATF', unit: 'quart', unitCost: 100, archived: false, locations: [{ location: 'Main shop', qty: 2, aisle: 'B4' }, { location: 'Van stock', qty: 1 }] });
    await view('parts');
    const rows = await exportCSV();
    expect(rows[0]).toContain('Location');
    expect(col(rows, 'Location')).toEqual(['Main shop (B4); Van stock']);
  });
});

describe('phone cards of lists edited in a dialog', () => {
  beforeEach(boot);

  it('open an assignment', async () => {
    store.put('contacts', { id: 'c1', firstName: 'Ana', lastName: 'Diaz' });
    store.put('assignments', { id: 'a1', vehicleId: 'v1', contactId: 'c1', start: '2026-10-01', end: null });
    await view('assignments');
    const card = document.querySelector('.grid-cards .grid-card');
    expect(card.tagName).toBe('BUTTON');
    card.click();
    await settle();
    expect(document.querySelector('dialog[open]')?.textContent).toContain('Edit assignment');
  });

  it('open a renewal', async () => {
    store.put('renewals', { id: 'r1', kind: 'vehicle', vehicleId: 'v1', type: 'Registration', dueDate: '2026-11-01', history: [] });
    await view('renewals');
    const card = document.querySelector('.grid-cards .grid-card');
    expect(card.tagName).toBe('BUTTON');
    card.click();
    await settle();
    expect(document.querySelector('dialog[open]')?.textContent).toContain('Edit Registration');
  });

  it('stay plain for someone who cannot edit them', async () => {
    app.team = { role: 'driver' };
    store.put('assignments', { id: 'a1', vehicleId: 'v1', contactId: null, start: '2026-10-01', end: null });
    await view('assignments');
    expect(document.querySelector('.grid-cards .grid-card').tagName).toBe('DIV');
  });
});

describe('code splitting', () => {
  it('keeps the vehicle page out of the reminder, service form, and meter screens', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    for (const f of ['reminders', 'reminder-detail', 'reminder-form', 'line-items', 'service-form', 'meters']) {
      const src = fs.readFileSync(path.join(process.cwd(), 'src/views', `${f}.js`), 'utf8');
      expect(src, f).not.toMatch(/from '\.\/vehicle-detail\.js'/);
    }
  });
});

describe('recall lookup', () => {
  it('explains an answer that is not recall data instead of showing the parse error', async () => {
    const { fetchRecalls } = await import('../src/core/recalls.js');
    const html = async () => ({ ok: true, json: async () => JSON.parse('<!DOCTYPE html><html>') });
    await expect(fetchRecalls({ year: 2020, make: 'Ford', model: 'Transit' }, html)).rejects.toThrow('The recall service sent an answer the app could not read. Try again later.');
    const odd = async () => ({ ok: true, json: async () => ({ results: 'none' }) });
    await expect(fetchRecalls({ year: 2020, make: 'Ford', model: 'Transit' }, odd)).rejects.toThrow('could not read');
  });
});

describe('a reminder counted by meter alone', () => {
  beforeEach(async () => {
    await boot();
    store.put('vehicles', { id: 'v2', name: 'New trailer', meterUnit: 'mi', meter: null });
    store.put('serviceTasks', { id: 't1', name: 'Grease', archived: false });
  });
  const field = (name) => document.querySelector(`[name="${name}"]`);
  const setField = (name, value) => {
    field(name).value = value;
    field(name).dispatchEvent(new Event('input'));
  };
  const toggle = (text, on) => {
    const cb = [...document.querySelectorAll('label.switch')].find((l) => l.textContent === text).querySelector('input');
    cb.checked = on;
    cb.dispatchEvent(new Event('change'));
  };
  const pick = (label, value) => {
    const lab = [...document.querySelectorAll('label')].find((l) => l.textContent.replace('*', '').trim() === label);
    const el = document.getElementById(lab.getAttribute('for')).parentElement;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  };
  const save = () => [...document.querySelectorAll('.page-header .btn.primary')].pop().click();

  it('asks for a starting meter when the vehicle has no meter reading', async () => {
    await view('reminder-form', {}, { vehicle: 'v2' });
    pick('Service task', 't1');
    toggle('Repeat on a time interval', false);
    save();
    await settle();
    expect(store.all('reminders')).toHaveLength(0);
    expect(field('lastMeter').getAttribute('aria-invalid')).toBe('true');
    setField('lastMeter', '800');
    save();
    await settle();
    expect(store.all('reminders')).toMatchObject([{ vehicleId: 'v2', lastMeter: 800, meterInterval: 5000 }]);
  });

  it('cannot lose its starting meter when edited', async () => {
    store.put('reminders', { id: 'r1', vehicleId: 'v1', taskId: 't1', interval: null, meterInterval: 5000, lastDate: '2026-01-01', lastMeter: 10000, history: [] });
    await view('reminder-form', { id: 'r1' });
    setField('lastMeter', '');
    save();
    await settle();
    expect(store.get('reminders', 'r1').lastMeter).toBe(10000);
    expect(field('lastMeter').getAttribute('aria-invalid')).toBe('true');
  });

  it('can still be saved for a vehicle that has a meter', async () => {
    await view('reminder-form', {}, { vehicle: 'v1' });
    pick('Service task', 't1');
    toggle('Repeat on a time interval', false);
    save();
    await settle();
    expect(store.all('reminders')).toMatchObject([{ vehicleId: 'v1', lastMeter: 12000 }]);
  });
});

describe('a driver in a team fleet', () => {
  beforeEach(async () => {
    await boot();
    app.demo = false;
    app.user = { username: 'dee', uuid: 'u2' };
    app.team = { role: 'driver' };
  });
  afterEach(() => {
    app.team = null;
    app.user = null;
  });
  const buttons = (text) => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === text);
  const menuItems = () => {
    const more = document.querySelector('.detail-actions button[aria-label="More actions"]');
    if (!more) return [];
    more.click();
    const items = [...document.querySelectorAll('[role=menuitem]')].map((b) => b.textContent.trim());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return items;
  };

  it('can still add fuel but is not offered deletes the team server refuses', async () => {
    const { canEdit, canDelete } = await import('../src/app.js');
    expect(canEdit('fuel')).toBe(true);
    for (const c of ['fuel', 'meters', 'inspections', 'issues', 'vehicles']) expect(canDelete(c), c).toBe(false);
    app.team = { role: 'member' };
    for (const c of ['fuel', 'meters', 'inspections', 'issues', 'vehicles']) expect(canDelete(c), c).toBe(true);
  });

  it('gets no Delete bulk action on the fuel list', async () => {
    store.put('fuel', { id: 'f1', vehicleId: 'v1', date: '2026-10-01', volume: 10, total: 3500 });
    await view('fuel');
    expect(document.querySelector('.page-header a.btn.primary')?.textContent).toContain('Add fuel entry');
    expect(document.querySelector('tbody input[type=checkbox]')).toBeNull();
    expect(buttons('Delete')).toHaveLength(0);
  });

  it('gets no Delete on a fuel entry it can edit', async () => {
    store.put('fuel', { id: 'f1', vehicleId: 'v1', date: '2026-10-01', volume: 10, total: 3500 });
    await view('fuel-form', { id: 'f1' });
    expect(buttons('Save entry').length).toBeGreaterThan(0);
    expect(buttons('Delete')).toHaveLength(0);
  });

  it('gets no Delete on a meter reading it can edit', async () => {
    store.put('meters', { id: 'm1', vehicleId: 'v1', date: '2026-10-01', value: 12000 });
    const { openMeterDialog } = await import('../src/views/meters.js');
    openMeterDialog(store.get('meters', 'm1'));
    await settle();
    const dlg = document.querySelector('dialog[open]');
    expect(dlg.textContent).toContain('Edit meter reading');
    expect([...dlg.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Delete')).toBe(false);
  });

  it('gets no Delete on an issue or an inspection', async () => {
    store.put('issues', { id: 'i1', number: 1, vehicleId: 'v1', summary: 'Flat tire', status: 'resolved', priority: 'low', reportedDate: '2026-10-01' });
    await view('issue-detail', { id: 'i1' });
    expect(buttons('Reopen')).toHaveLength(1);
    expect(menuItems()).not.toContain('Delete issue');
    document.body.innerHTML = '';
    store.put('inspections', { id: 's1', formId: 'f', formName: 'Daily', vehicleId: 'v1', date: '2026-10-01', results: [] });
    await view('inspection-detail', { id: 's1' });
    expect(menuItems()).not.toContain('Delete inspection');
  });

  it('still lets a member delete them', async () => {
    app.team = { role: 'member' };
    store.put('issues', { id: 'i1', number: 1, vehicleId: 'v1', summary: 'Flat tire', status: 'open', priority: 'low', reportedDate: '2026-10-01' });
    await view('issue-detail', { id: 'i1' });
    expect(menuItems()).toContain('Delete issue');
    document.body.innerHTML = '';
    store.put('fuel', { id: 'f1', vehicleId: 'v1', date: '2026-10-01', volume: 10, total: 3500 });
    await view('fuel-form', { id: 'f1' });
    expect(buttons('Delete')).toHaveLength(1);
  });
});

describe('editing a part while its stock moves elsewhere', () => {
  beforeEach(async () => {
    await boot();
    store.put('parts', { id: 'p1', number: 'OF-1', description: 'Oil filter', unit: 'each', unitCost: 800, archived: false, attachments: [], locations: [{ location: 'Main shop', qty: 10, aisle: 'A1', reorderPoint: 2 }] });
  });
  const input = (label) => document.querySelector(`input[aria-label="${label}"]`);
  const type = (el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input'));
  };
  const save = () => [...document.querySelectorAll('.page-header .btn.primary')].pop().click();

  it('keeps a deduction and a file added while the form was open', async () => {
    await view('part-form', { id: 'p1' });
    const { adjustStock } = await import('../src/core/actions.js');
    adjustStock(store, 'p1', 'Main shop', -3);
    store.patch('parts', 'p1', { attachments: [{ id: 'a1', name: 'label.jpg' }] });
    type(document.querySelector('[name="description"]'), 'Oil filter, long life');
    save();
    await settle();
    const p = store.get('parts', 'p1');
    expect(p.description).toBe('Oil filter, long life');
    expect(p.locations).toMatchObject([{ location: 'Main shop', qty: 7, aisle: 'A1' }]);
    expect(p.attachments).toHaveLength(1);
  });

  it('applies a count typed in the form on top of stock that moved', async () => {
    await view('part-form', { id: 'p1' });
    const { adjustStock } = await import('../src/core/actions.js');
    adjustStock(store, 'p1', 'Main shop', -3);
    type(input('Quantity at location 1'), '12');
    save();
    await settle();
    expect(store.get('parts', 'p1').locations[0].qty).toBe(9);
  });

  it('keeps a unit cost updated by a received purchase order', async () => {
    await view('part-form', { id: 'p1' });
    store.patch('parts', 'p1', { unitCost: 950 });
    save();
    await settle();
    expect(store.get('parts', 'p1').unitCost).toBe(950);
  });

  it('does not bring back a part deleted while the form was open', async () => {
    await view('part-form', { id: 'p1' });
    store.remove('parts', 'p1');
    save();
    await settle();
    expect(store.get('parts', 'p1')).toBeNull();
    expect([...document.querySelectorAll('.toast')].pop()?.textContent).toContain('This part was deleted');
  });
});

describe('editing a reminder completed while the form was open', () => {
  beforeEach(async () => {
    await boot();
    store.put('serviceTasks', { id: 't1', name: 'Oil change', archived: false });
    store.put('reminders', { id: 'r1', vehicleId: 'v1', taskId: 't1', interval: { every: 6, unit: 'months' }, meterInterval: 5000, lastDate: '2026-01-01', lastMeter: 7000, history: [] });
  });
  const type = (name, value) => {
    const el = document.querySelector(`[name="${name}"]`);
    el.value = value;
    el.dispatchEvent(new Event('input'));
  };
  const save = () => [...document.querySelectorAll('.page-header .btn.primary')].pop().click();
  const complete = async () => {
    const { completeReminder } = await import('../src/core/reminders.js');
    store.put('reminders', completeReminder(store.get('reminders', 'r1'), { date: '2026-10-10', meter: 12000, entryId: 'e1' }, store.get('vehicles', 'v1'), app.settings()));
  };

  it('keeps the completion and its history', async () => {
    await view('reminder-form', { id: 'r1' });
    await complete();
    type('dueSoonDays', '30');
    save();
    await settle();
    expect(store.get('reminders', 'r1')).toMatchObject({ dueSoonDays: 30, lastDate: '2026-10-10', lastMeter: 12000, history: [{ entryId: 'e1' }] });
  });

  it('still uses a last completion typed in the form', async () => {
    await view('reminder-form', { id: 'r1' });
    await complete();
    type('lastMeter', '12500');
    save();
    await settle();
    expect(store.get('reminders', 'r1')).toMatchObject({ lastMeter: 12500, history: [{ entryId: 'e1' }] });
  });

  it('does not bring back a reminder deleted meanwhile', async () => {
    await view('reminder-form', { id: 'r1' });
    store.remove('reminders', 'r1');
    save();
    await settle();
    expect(store.get('reminders', 'r1')).toBeFalsy();
  });
});

describe('part form locations', () => {
  beforeEach(async () => {
    await boot();
    store.saveSettings({ partLocations: ['Main shop', 'Van stock', 'North yard'] });
    store.put('parts', { id: 'p1', number: 'OF-1', description: 'Oil filter', unit: 'each', archived: false, attachments: [], locations: [{ location: 'Main shop', qty: 1 }, { location: 'Van stock', qty: 2 }, { location: 'North yard', qty: 3 }] });
  });

  it('keeps keyboard focus in the list when a location is removed', async () => {
    await view('part-form', { id: 'p1' });
    const remove = (n) => document.querySelector(`button[aria-label="Remove location ${n}"]`);
    remove(2).focus();
    remove(2).click();
    expect(document.activeElement).toBe(remove(2));
    remove(2).click();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Location 1');
  });
});

describe('adding a stock location to a part', () => {
  beforeEach(async () => {
    await boot();
    store.saveSettings({ partLocations: ['Main shop', 'Van stock'] });
  });

  it('moves focus to the new row', async () => {
    await view('part-form');
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add location').click();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Location 2');
    expect(document.activeElement.value).toBe('Van stock');
  });
});
