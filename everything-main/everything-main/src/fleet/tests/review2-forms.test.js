// @vitest-environment jsdom
/** Forms, dialogs, and pickers: second review. */
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
  app.team = null;
  app.today = () => '2026-10-12';
  store = createStore({ backend: createMemoryBackend({ settings: defaultSettings() }, { bucketOf }), flushDelay: 0 });
  await store.init();
  app.store = store;
  store.put('vehicles', { id: 'v1', name: 'Van 1' });
  document.body.innerHTML = '';
}

async function view(name, params = {}, query = {}, path = '') {
  const mod = await import(`../src/views/${name}.js`);
  const ctx = {
    params,
    query,
    route: { path },
    live: (fn) => {
      const node = document.createElement('div');
      const draw = () => node.replaceChildren(...[fn()].flat().filter(Boolean));
      draw();
      node.redraw = draw;
      return node;
    },
    onDispose() {},
  };
  const out = mod.render(ctx);
  document.body.append(out.node || out);
  return out;
}

const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const field = (name) => document.querySelector(`[name="${name}"]`);
const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`);

describe('decimal commas in number fields', () => {
  beforeEach(boot);

  it('parses numbers with the same comma rule as money', async () => {
    const { parseDecimal, parseMoney } = await import('../src/core/money.js');
    for (const [s, n] of [['12,5', 12.5], ['1,234', 1234], ['1.234,5', 1234.5], ['1,234.5', 1234.5], ['0,75', 0.75], ['5', 5]]) {
      expect(parseDecimal(s)).toBe(n);
      expect(parseMoney(s)).toBe(Math.round(n * 100));
    }
    expect(parseDecimal('  ')).toBe(null);
    expect(parseDecimal('1,2,3x')).toBeNaN();
  });

  it('reads a decimal comma in a form number field the way money fields do', async () => {
    const { buildForm } = await import('../src/ui/form.js');
    const form = buildForm({ sections: [{ fields: [{ id: 'n', label: 'N', type: 'number' }] }] });
    document.body.append(form.node);
    const input = form.field('n');
    const read = (s) => ((input.value = s), form.values().n);
    expect(read('12,5')).toBe(12.5);
    expect(read('12,50')).toBe(12.5);
    expect(read('1,234')).toBe(1234);
    expect(read('1.234,5')).toBe(1234.5);
    expect(read('1 234,5')).toBe(1234.5);
    expect(read('-3,5')).toBe(-3.5);
    expect(read('12.5')).toBe(12.5);
    expect(read('')).toBe(null);
    expect(read('abc')).toBeNaN();
  });

  it('saves a fuel volume typed with a decimal comma as that volume, not ten times it', async () => {
    await view('fuel-form', {}, { vehicle: 'v1' });
    type(field('volume'), '12,5');
    type(field('price'), '3,10');
    // The total is worked out from the two given.
    expect(field('totalCents').value).toBe('38.75');
    document.querySelector('.form-foot button[type=submit]').click();
    await settle();
    const [f] = store.all('fuel');
    expect(f.volume).toBe(12.5);
    expect(f.price).toBe(3.1);
    expect(f.total).toBe(3875);
  });

  it('reads a decimal comma in an inspection number item and its passing range', async () => {
    store.put('inspectionForms', { id: 'f1', name: 'Tyres', archived: false, items: [{ id: 'i1', type: 'number', label: 'Tread depth', required: true, help: '' }] });
    await view('inspection-form-builder', { id: 'f1' });
    type(byLabel('Minimum passing value'), '2,2');
    type(byLabel('Maximum passing value'), '2,8');
    document.querySelector('.form-foot button[type=submit]').click();
    await settle();
    const item = store.get('inspectionForms', 'f1').items[0];
    expect(item.min).toBe(2.2);
    expect(item.max).toBe(2.8);
  });
});

describe('decimal commas while inspecting', () => {
  beforeEach(boot);

  it('passes a number item answered with a decimal comma inside its range', async () => {
    store.put('inspectionForms', { id: 'f1', name: 'Tyres', archived: false, items: [{ id: 'i1', type: 'number', label: 'Tread depth', required: true, min: 2, max: 3 }] });
    await view('inspection-run', {}, { vehicle: 'v1', form: 'f1' });
    const input = document.querySelector('.insp-num-input');
    type(input, '2,5');
    expect(input.closest('.failed')).toBe(null);
    expect(document.querySelector('.insp-warn').textContent).toBe('');
  });
});

describe('saving a form page', () => {
  beforeEach(boot);
  const submit = () => document.querySelector('.form-foot button[type=submit]').click();

  it('does not save again on a second click while the next page loads', async () => {
    await view('vendor-form');
    type(field('name'), 'Quick Lube');
    submit();
    await settle();
    // The next screen's code is still loading: the form is still there.
    submit();
    await settle();
    expect(store.all('vendors')).toHaveLength(1);
  });

  it('still lets a save that was refused, or that failed, be tried again', async () => {
    const { formPage } = await import('../src/ui/form.js');
    let calls = 0;
    const page = formPage({
      title: 'T',
      sections: [{ fields: [{ id: 'name', label: 'Name' }] }],
      onSave: () => {
        calls += 1;
        if (calls === 1) return false;
        if (calls === 2) throw new Error('offline');
      },
    });
    document.body.append(page.node);
    await page.save();
    await page.save().catch(() => {});
    await page.save();
    await page.save();
    expect(calls).toBe(3);
  });
});

describe('confirm dialogs', () => {
  beforeEach(boot);

  it('starts on the safe choice when the action destroys data', async () => {
    const { confirmDialog } = await import('../src/ui/dialog.js');
    const answer = confirmDialog({ title: 'Delete fuel entry?', message: 'Gone for good.', confirmLabel: 'Delete', danger: true });
    expect(document.activeElement.textContent).toBe('Cancel');
    document.activeElement.click();
    expect(await answer).toBe(false);
  });

  it('starts on the confirm button for other confirms', async () => {
    const { confirmDialog } = await import('../src/ui/dialog.js');
    const answer = confirmDialog({ title: 'Turn on?', message: 'Shares the fleet.', confirmLabel: 'Turn on' });
    expect(document.activeElement.textContent).toBe('Turn on');
    document.activeElement.click();
    expect(await answer).toBe(true);
  });

  it('starts on "Keep editing" when a form dialog asks to discard changes', async () => {
    const { openFormDialog } = await import('../src/ui/form.js');
    openFormDialog({ title: 'Edit', fields: [{ id: 'name', label: 'Name' }], onSave: () => true });
    const input = document.querySelector('dialog[open] input[name="name"]');
    type(input, 'changed');
    document.querySelector('dialog[open]').dispatchEvent(new Event('cancel', { cancelable: true }));
    await settle();
    const dialogs = document.querySelectorAll('dialog[open]');
    expect(dialogs).toHaveLength(2);
    expect(document.activeElement.textContent).toBe('Keep editing');
  });
});

describe('bulk archive on list tabs', () => {
  beforeEach(boot);
  const lists = [
    ['vehicles', 'vehicles', { name: 'Old van' }],
    ['parts', 'parts', { description: 'Old filter', number: 'F-1' }],
    ['service-tasks', 'serviceTasks', { name: 'Old task' }],
    ['vendors', 'vendors', { name: 'Old shop' }],
    ['contacts', 'contacts', { firstName: 'Old', lastName: 'Driver' }],
  ];
  const bulkButtons = () => [...document.querySelectorAll('.bulk-bar button.btn')].map((b) => b.textContent.trim());
  const selectFirst = () => {
    const cb = document.querySelector('tbody input[type=checkbox]');
    cb.click();
  };

  for (const [name, coll, rec] of lists) {
    it(`offers Restore, not Archive, on the ${name} Archived tab`, async () => {
      const row = store.put(coll, { ...rec, archived: true });
      await view(name, {}, { tab: 'archived' });
      selectFirst();
      expect(bulkButtons()).toContain('Restore');
      expect(bulkButtons()).not.toContain('Archive');
      [...document.querySelectorAll('.bulk-bar button.btn')].find((b) => b.textContent.trim() === 'Restore').click();
      await settle();
      expect(store.get(coll, row.id).archived).toBe(false);
    });

    it(`archives from the ${name} default tab`, async () => {
      const row = store.put(coll, { ...rec, archived: false });
      document.body.innerHTML = '';
      await view(name, {}, {});
      const tr = [...document.querySelectorAll('tbody tr')].find((t) => t.querySelector('input[type=checkbox]'));
      // Pick this record's row (vehicles also lists Van 1).
      const target = [...document.querySelectorAll('tbody tr')].find((t) => t.textContent.includes(rec.name || rec.description || rec.firstName)) || tr;
      target.querySelector('input[type=checkbox]').click();
      expect(bulkButtons()).toContain('Archive');
      [...document.querySelectorAll('.bulk-bar button.btn')].find((b) => b.textContent.trim() === 'Archive').click();
      await settle();
      expect(store.get(coll, row.id).archived).toBe(true);
    });
  }
});

describe('pickers on records of archived vehicles', () => {
  beforeEach(async () => {
    await boot();
    store.put('vehicles', { id: 'va', name: 'Retired truck', archived: true });
    store.put('vendors', { id: 'da', name: 'Closed shop', archived: true, kinds: ['fuel', 'service', 'parts'] });
    store.put('contacts', { id: 'ca', firstName: 'Former', lastName: 'Tech', archived: true, roles: ['technician'] });
    store.put('serviceTasks', { id: 'ta', name: 'Old task', archived: true });
  });
  const shown = (label) => document.querySelector(`button.picker-btn[aria-label^="${label}:"]`)?.getAttribute('aria-label');
  const submit = () => document.querySelector('.form-foot button[type=submit]').click();

  it('fuel entry: shows the vehicle and vendor and keeps them on save', async () => {
    store.put('fuel', { id: 'fu1', vehicleId: 'va', vendorId: 'da', date: '2026-10-01', kind: 'fuel', volume: 10, price: 3, total: 3000, attachments: [] });
    await view('fuel-form', { id: 'fu1' });
    expect(shown('Vehicle')).toBe('Vehicle: Retired truck');
    expect(shown('Vendor')).toBe('Vendor: Closed shop');
    type(field('notes'), 'checked');
    submit();
    await settle();
    expect(store.get('fuel', 'fu1')).toMatchObject({ vehicleId: 'va', vendorId: 'da', notes: 'checked' });
  });

  it('issue: shows the vehicle and assignee', async () => {
    store.put('issues', { id: 'is1', number: 1, vehicleId: 'va', assigneeId: 'ca', summary: 'Rust', priority: 'none', reportedDate: '2026-10-01', status: 'open' });
    await view('issue-form', { id: 'is1' });
    expect(shown('Vehicle')).toBe('Vehicle: Retired truck');
    expect(shown('Assigned to')).toBe('Assigned to: Former Tech');
  });

  it('service entry and work order: show the vehicle, vendor and assignee', async () => {
    store.put('serviceEntries', { id: 'se1', vehicleId: 'va', vendorId: 'da', date: '2026-10-01', repairClass: 'scheduled', lineItems: [] });
    await view('service-form', { id: 'se1' }, {}, '/service/se1/edit');
    expect(shown('Vehicle')).toBe('Vehicle: Retired truck');
    expect(shown('Vendor')).toBe('Vendor: Closed shop');
    document.body.innerHTML = '';
    store.put('workOrders', { id: 'wo1', number: 1, vehicleId: 'va', vendorId: 'da', assigneeId: 'ca', status: 'open', repairClass: 'scheduled', issueDate: '2026-10-01', lineItems: [] });
    await view('service-form', { id: 'wo1' }, {}, '/work-orders/wo1/edit');
    expect(shown('Vehicle')).toBe('Vehicle: Retired truck');
    expect(shown('Vendor')).toBe('Vendor: Closed shop');
    expect(shown('Assigned to')).toBe('Assigned to: Former Tech');
  });

  it('reminder: shows the vehicle and task', async () => {
    store.put('reminders', { id: 'rm1', vehicleId: 'va', taskId: 'ta', interval: { every: 6, unit: 'months' }, lastDate: '2026-01-01' });
    await view('reminder-form', { id: 'rm1' });
    expect(shown('Vehicle')).toBe('Vehicle: Retired truck');
    expect(shown('Service task')).toBe('Service task: Old task');
  });

  it('expense and renewal dialogs: show the vehicle, vendor and contact', async () => {
    const { openExpenseDialog } = await import('../src/views/expenses.js');
    openExpenseDialog({ id: 'ex1', vehicleId: 'va', vendorId: 'da', type: 'Tolls', amount: 500, date: '2026-10-01' });
    expect(shown('Vehicle')).toBe('Vehicle: Retired truck');
    expect(shown('Vendor')).toBe('Vendor: Closed shop');
    document.body.innerHTML = '';
    const { openRenewalDialog } = await import('../src/views/renewals.js');
    openRenewalDialog({ kind: 'vehicle', vehicleId: 'va' });
    expect(shown('Vehicle')).toBe('Vehicle: Retired truck');
    document.body.innerHTML = '';
    openRenewalDialog({ kind: 'contact', contactId: 'ca' });
    expect(shown('Contact')).toBe('Contact: Former Tech');
  });

  it('purchase order: shows its vendor', async () => {
    store.put('purchaseOrders', { id: 'po1', number: 1, vendorId: 'da', status: 'draft', date: '2026-10-01', items: [] });
    await view('purchase-order-form', { id: 'po1' });
    expect(shown('Vendor')).toBe('Vendor: Closed shop');
  });

  it('inspection: shows the vehicle chosen from its page', async () => {
    store.put('inspectionForms', { id: 'f1', name: 'Pre-trip', archived: false, items: [{ id: 'i1', type: 'pass', label: 'Lights' }] });
    store.put('inspectionForms', { id: 'f2', name: 'Post-trip', archived: false, items: [{ id: 'i2', type: 'pass', label: 'Lights' }] });
    await view('inspection-run', {}, { vehicle: 'va' });
    expect(shown('Vehicle')).toBe('Vehicle: Retired truck');
  });

  it('inspection form builder: names the archived vehicles it applies to', async () => {
    store.put('inspectionForms', { id: 'f1', name: 'Pre-trip', archived: false, vehicleIds: ['va'], items: [{ id: 'i1', type: 'pass', label: 'Lights' }] });
    await view('inspection-form-builder', { id: 'f1' });
    expect(document.querySelector('.multi-tags .tag').textContent).toBe('Retired truck');
  });
});

describe('issue form', () => {
  beforeEach(boot);

  it('shows the meter unit of the vehicle chosen in the form', async () => {
    store.put('vehicles', { id: 'fk', name: 'Forklift 2', meterUnit: 'hr' });
    await view('issue-form');
    const unit = () => field('meter').parentElement.querySelector('.affix-end').textContent;
    expect(unit()).toBe('mi');
    document.querySelector('button.picker-btn[aria-label^="Vehicle:"]').click();
    const option = [...document.querySelectorAll('.picker-option')].find((o) => o.textContent.includes('Forklift 2'));
    option.click();
    expect(unit()).toBe('hr');
    expect(field('dueMeter').parentElement.querySelector('.affix-end').textContent).toBe('hr');
  });
});

describe('confirm dialog semantics', () => {
  beforeEach(boot);

  it('is an alert dialog that is described by its message', async () => {
    const { confirmDialog } = await import('../src/ui/dialog.js');
    confirmDialog({ title: 'Delete fuel entry?', message: 'Its meter reading is removed too.', confirmLabel: 'Delete', danger: true });
    const dlg = document.querySelector('dialog[open]');
    expect(dlg.getAttribute('role')).toBe('alertdialog');
    expect(document.getElementById(dlg.getAttribute('aria-describedby'))?.textContent).toBe('Its meter reading is removed too.');
    document.activeElement.click();
  });
});

describe('edit forms and changes made while they are open', () => {
  beforeEach(boot);
  const submit = () => document.querySelector('.form-foot button[type=submit]').click();

  it('keeps a receipt uploaded on the fuel entry page when the entry is saved', async () => {
    store.put('fuel', { id: 'fu1', vehicleId: 'v1', date: '2026-10-01', kind: 'fuel', volume: 10, price: 3, total: 3000, attachments: [] });
    await view('fuel-form', { id: 'fu1' });
    // The Receipt panel on the same page adds the file to the stored entry.
    store.patch('fuel', 'fu1', (r) => ({ ...r, attachments: [{ id: 'a1', name: 'receipt.jpg' }] }));
    type(field('notes'), 'Card 4411');
    submit();
    await settle();
    expect(store.get('fuel', 'fu1').attachments).toEqual([{ id: 'a1', name: 'receipt.jpg' }]);
    expect(store.get('fuel', 'fu1').notes).toBe('Card 4411');
  });

  it('does not bring back an issue deleted on another device', async () => {
    store.put('issues', { id: 'is1', number: 1, vehicleId: 'v1', summary: 'Rust', priority: 'none', reportedDate: '2026-10-01', status: 'open' });
    await view('issue-form', { id: 'is1' });
    store.remove('issues', 'is1');
    type(field('summary'), 'Rust on door');
    submit();
    await settle();
    expect(store.get('issues', 'is1')).toBeFalsy();
    expect([...document.querySelectorAll('.toast')].pop()?.textContent || '').toMatch(/This issue was deleted/);
  });

  it('keeps a reminder completion recorded while its form was open', async () => {
    store.put('serviceTasks', { id: 't1', name: 'Oil change' });
    store.put('reminders', { id: 'rm1', vehicleId: 'v1', taskId: 't1', interval: { every: 6, unit: 'months' }, lastDate: '2026-01-01', history: [] });
    await view('reminder-form', { id: 'rm1' });
    store.patch('reminders', 'rm1', (r) => ({ ...r, history: [{ date: '2026-10-01', type: 'service' }] }));
    type(field('dueSoonDays'), '10');
    submit();
    await settle();
    expect(store.get('reminders', 'rm1').history).toHaveLength(1);
    expect(store.get('reminders', 'rm1').dueSoonDays).toBe(10);
  });
});
