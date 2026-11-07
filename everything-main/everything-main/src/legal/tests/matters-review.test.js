// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';
import { today } from '../src/core/dates.js';

/** A view context whose live regions redraw on store changes, like the real view host. */
function ctxFor(params = {}, query = {}) {
  const lives = [];
  const watchers = [];
  const ctx = {
    params,
    query,
    route: {},
    watch(colls, fn) {
      watchers.push(app.store.subscribe((changed) => [...changed].some((c) => colls.includes(c)) && fn(changed)));
    },
    onDispose() {},
    live(fn, colls = 'all') {
      const node = document.createElement('div');
      const draw = () => {
        const out = fn();
        node.replaceChildren(...(Array.isArray(out) ? out.filter(Boolean) : out ? [out] : []));
      };
      draw();
      node.redraw = draw;
      lives.push({ draw, colls });
      return node;
    },
  };
  watchers.push(
    app.store.subscribe((changed) => {
      if (changed.size === 1 && changed.has('sync')) return;
      for (const l of lives) if (l.colls === 'all' || l.colls.some((c) => changed.has(c))) l.draw();
    }),
  );
  return ctx;
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const submit = (form) => form.dispatchEvent(new Event('submit', { cancelable: true }));
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

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
  document.body.replaceChildren(document.createElement('main'));
  app.demo = true;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(today())), flushDelay: 0 });
  await app.store.init();
});

describe('matter workspace', () => {
  it('keeps the activity filters when an entry changes', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const out = render(ctxFor({ id: 'm-6' }, { tab: 'activities' }));
    document.querySelector('main').append(out.node);
    const seg = () => out.node.querySelector('[aria-label="Billing status"]');
    click([...seg().querySelectorAll('[role=radio]')].find((b) => b.textContent === 'Unbilled'));
    const unbilled = out.node.querySelector('.dt-foot').textContent;
    const n = app.store.all('activities').filter((a) => a.matterId === 'm-6' && a.billable !== false && !a.billId).length;
    expect(n).toBeGreaterThan(0);
    expect(unbilled).toContain(`${n} entries`);
    const act = app.store.all('activities').find((a) => a.matterId === 'm-6');
    app.store.patch('activities', act.id, { description: 'Edited' });
    await tick();
    expect(seg().querySelector('[aria-checked=true]').textContent).toBe('Unbilled');
    expect(out.node.querySelector('.dt-foot').textContent).toBe(unbilled);
  });

  it('ties its tabs to the panel they control, through redraws', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const out = render(ctxFor({ id: 'm-6' }, {}));
    document.querySelector('main').append(out.node);
    const check = () => {
      const panel = out.node.querySelector('[role=tabpanel]');
      expect(panel.id).toBeTruthy();
      for (const t of out.node.querySelectorAll('[role=tab]')) expect(t.getAttribute('aria-controls')).toBe(panel.id);
    };
    check();
    click([...out.node.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith('Notes')));
    check();
  });

  it('keeps a related contact chosen in the contacts tab when the store changes', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const out = render(ctxFor({ id: 'm-2' }, { tab: 'contacts' }));
    document.querySelector('main').append(out.node);
    // Picking (or quick-creating) a contact changes the store and redraws the tab.
    const created = app.store.put('contacts', { type: 'person', firstName: 'Nadia', lastName: 'Vey', emails: [], phones: [], addresses: [], tags: [] });
    const picker = out.node.querySelector('.related-add .picker');
    picker.value = created.id;
    await tick();
    const rel = out.node.querySelector('.related-add select');
    rel.value = rel.options[1].value;
    rel.dispatchEvent(new Event('change'));
    click([...out.node.querySelectorAll('.related-add button')].find((b) => b.textContent === 'Add'));
    await tick();
    expect(app.store.get('matters', 'm-2').related.some((r) => r.contactId === created.id)).toBe(true);
  });

  it('does not move time running on another matter to this one', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const { startTimer, resetTimer, getTimer, elapsedMs } = await import('../src/ui/timer.js');
    resetTimer();
    startTimer({ matterId: 'm-1', description: 'Drafting' });
    const t = getTimer();
    localStorage.setItem('legal.timer.demo', JSON.stringify({ ...t, startedAt: Date.now() - 45 * 60000 }));
    try {
      const out = render(ctxFor({ id: 'm-6' }));
      document.querySelector('main').append(out.node);
      click([...out.node.querySelectorAll('button')].find((b) => b.textContent === 'Start timer'));
      await tick();
      // The 45 minutes still belong to the first matter.
      expect(getTimer().matterId).toBe('m-1');
      const confirm = document.querySelector('dialog');
      expect(confirm.textContent).toContain(app.store.get('matters', 'm-1').displayNumber);
      click([...confirm.querySelectorAll('.btn')].pop());
      await tick();
      const entry = document.querySelector('dialog');
      expect(entry.querySelector('[name=duration]').value).toBe('0.75');
      submit(entry.querySelector('form'));
      await tick(10);
      const saved = app.store.all('activities').find((a) => a.matterId === 'm-1' && a.description === 'Drafting' && a.minutes === 48);
      expect(saved).toBeTruthy();
      expect(getTimer()).toMatchObject({ running: true, matterId: 'm-6' });
      expect(elapsedMs()).toBeLessThan(5000);
    } finally {
      resetTimer();
    }
  });

  it('builds the documents tab once instead of on every store change', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const ctx = ctxFor({ id: 'm-1' }, { tab: 'documents' });
    let watches = 0;
    const watch = ctx.watch;
    ctx.watch = (...a) => (watches++, watch(...a));
    const out = render(ctx);
    document.querySelector('main').append(out.node);
    for (let i = 0; i < 100 && !out.node.querySelector('.docs-block'); i++) await tick(20);
    const search = out.node.querySelector('.docs-block input[type=search]');
    search.value = 'spoliation';
    search.dispatchEvent(new Event('input'));
    await tick(200);
    for (let i = 0; i < 3; i++) {
      app.store.patch('tasks', app.store.all('tasks')[0].id, { name: `Task ${i}` });
      await tick(20);
    }
    expect(watches).toBe(1);
    expect(out.node.querySelectorAll('.docs-block')).toHaveLength(1);
    expect(out.node.querySelector('.docs-block input[type=search]').value).toBe('spoliation');
  });

  it('keeps keyboard focus on the stage picker and task checkboxes when the panel redraws', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const out = render(ctxFor({ id: 'm-6' }));
    document.querySelector('main').append(out.node);
    const sel = out.node.querySelector('select[name=stage]');
    sel.focus();
    sel.value = sel.options[2].value;
    sel.dispatchEvent(new Event('change'));
    await tick();
    expect(document.activeElement).toBe(out.node.querySelector('select[name=stage]'));
    expect(document.activeElement.value).toBe(sel.options[2].value);

    // An open task of its own: the sample firm's tasks depend on today's date.
    const task = app.store.put('tasks', { name: 'File the reply brief', matterId: 'm-6', dueDate: '2000-01-01', done: false });
    const tasks = render(ctxFor({ id: 'm-6' }, { tab: 'tasks' }));
    document.querySelector('main').replaceChildren(tasks.node);
    const check = tasks.node.querySelector(`.task-check[aria-label="Complete ${task.name}"]`);
    const label = check.getAttribute('aria-label');
    check.focus();
    click(check);
    await tick();
    expect(document.activeElement.getAttribute('aria-label')).toBe(label);
    expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
  });

  it('takes a deleted matter off the running timer', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const { startTimer, resetTimer, getTimer } = await import('../src/ui/timer.js');
    const m = app.store.put('matters', { number: 99, displayNumber: '00099', description: 'Opened by mistake', clientId: 'p-3', status: 'open', practiceAreaId: 'pa-pi', related: [] });
    resetTimer();
    startTimer({ matterId: m.id, description: 'Intake call' });
    try {
      const out = render(ctxFor({ id: m.id }));
      document.querySelector('main').append(out.node);
      click(out.node.querySelector('[aria-label="More matter actions"]'));
      click([...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Delete matter')));
      await tick();
      click([...document.querySelectorAll('dialog .btn')].find((b) => b.textContent === 'Delete matter'));
      await tick();
      expect(app.store.get('matters', m.id)).toBeNull();
      expect(getTimer()).toMatchObject({ running: true, matterId: '', description: 'Intake call' });
    } finally {
      resetTimer();
    }
  });

  it('updates the low trust warning in the header when money is deposited', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const { financialsFor } = await import('../src/views/common.js');
    app.store.patch('matters', 'm-6', { trustMinimumCents: financialsFor(app.store.get('matters', 'm-6')).trust + 100000 });
    const out = render(ctxFor({ id: 'm-6' }));
    document.querySelector('main').append(out.node);
    const head = () => out.node.querySelector('.page-header').textContent;
    await tick();
    expect(head()).toContain('Trust below minimum');
    app.store.put('transactions', { accountId: 'acct-trust', type: 'deposit', date: today(), amountCents: 500000, matterId: 'm-6', description: 'Replenishment' });
    await tick();
    expect(head()).not.toContain('Trust below minimum');
  });

  it('opens the change stage menu next to the matter actions button', async () => {
    const { render } = await import('../src/views/matter-detail.js');
    const out = render(ctxFor({ id: 'm-6' }));
    document.querySelector('main').append(out.node);
    const more = out.node.querySelector('[aria-label="More matter actions"]');
    click(more);
    const item = [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Change stage'));
    item.focus();
    click(item);
    expect(document.querySelector('[role=menu]')).toBeTruthy();
    expect(document.body.hasAttribute('aria-expanded')).toBe(false);
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('matter form', () => {
  async function editForm(id) {
    const { render } = await import('../src/views/matter-form.js');
    const out = render(ctxFor({ id }));
    document.querySelector('main').append(out.node);
    await tick();
    return out;
  }
  const pick = (form, name, value) => {
    const r = form.querySelector(`input[type=radio][name=${name}][value=${value}]`);
    r.checked = true;
    r.dispatchEvent(new Event('change'));
  };

  it('shows whole-unit money placeholders for currencies without cents', async () => {
    const { setMoneyDefaults } = await import('../src/core/money.js');
    setMoneyDefaults({ currency: 'JPY' });
    try {
      const out = await editForm('m-1');
      for (const name of ['trustMin', 'flatFee']) expect(out.node.querySelector(`[name=${name}]`).placeholder).toBe('0');
    } finally {
      setMoneyDefaults({ currency: 'USD' });
    }
  });

  it('refuses a negative flat fee', async () => {
    const out = await editForm('m-1');
    const form = out.node.querySelector('form');
    pick(form, 'method', 'flat');
    form.querySelector('[name=flatFee]').value = '-1500';
    submit(form);
    await tick();
    expect(app.store.get('matters', 'm-1').billing.flatFeeCents).not.toBe(-150000);
    expect(form.querySelector('[name=flatFee]').getAttribute('aria-invalid')).toBe('true');
  });

  it('refuses a contingency above 100 percent', async () => {
    const out = await editForm('m-1');
    const form = out.node.querySelector('form');
    pick(form, 'method', 'contingency');
    form.querySelector('[name=contingencyPct]').value = '330';
    submit(form);
    await tick();
    expect(app.store.get('matters', 'm-1').billing.contingencyPct).not.toBe(330);
    expect(form.querySelector('[name=contingencyPct]').getAttribute('aria-invalid')).toBe('true');
  });

  it('refuses a negative budget or trust minimum', async () => {
    const out = await editForm('m-1');
    const form = out.node.querySelector('form');
    form.querySelector('[name=budget]').value = '-100';
    form.querySelector('[name=trustMin]').value = '(50)';
    submit(form);
    await tick();
    const m = app.store.get('matters', 'm-1');
    expect(m.billing.budgetCents).toBeGreaterThanOrEqual(0);
    expect(m.trustMinimumCents).toBeGreaterThanOrEqual(0);
  });

  it('keeps a custom choice whose option was later removed from the field', async () => {
    app.store.saveSettings({ customFields: [{ id: 'cf-court', entity: 'matter', label: 'Court', type: 'select', options: ['District', 'Circuit'] }] });
    app.store.patch('matters', 'm-1', { custom: { 'cf-court': 'Superior' } });
    const out = await editForm('m-1');
    const form = out.node.querySelector('form');
    form.querySelector('[name=description]').value = 'Renamed matter';
    submit(form);
    await tick();
    const m = app.store.get('matters', 'm-1');
    expect(m.description).toBe('Renamed matter');
    expect(m.custom['cf-court']).toBe('Superior');
  });

  it('refuses a closed date before the open date', async () => {
    const out = await editForm('m-1');
    const form = out.node.querySelector('form');
    pick(form, 'status', 'closed');
    form.querySelector('[name=openDate]').value = '2026-03-10';
    form.querySelector('[name=closedDate]').value = '2026-03-01';
    submit(form);
    await tick();
    expect(app.store.get('matters', 'm-1').status).toBe('open');
    expect(form.querySelector('[name=closedDate]').getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps changes made elsewhere to fields the form does not show', async () => {
    app.store.patch('matters', 'm-2', (cur) => ({ ...cur, billing: { ...cur.billing, flatFeeBilled: false } }));
    const out = await editForm('m-2');
    // While the form is open a flat fee bill is generated and a related contact is added in another tab.
    app.store.patch('matters', 'm-2', (cur) => ({ ...cur, billing: { ...cur.billing, flatFeeBilled: true }, stageChangedAt: '2026-01-02T10:00:00.000Z' }));
    const form = out.node.querySelector('form');
    form.querySelector('[name=description]').value = 'Whitfield estate plan (updated)';
    submit(form);
    await tick();
    const m = app.store.get('matters', 'm-2');
    expect(m.description).toBe('Whitfield estate plan (updated)');
    expect(m.billing.flatFeeBilled).toBe(true);
    expect(m.stageChangedAt).toBe("2026-01-02T10:00:00.000Z");
  });

  it('moves focus to "Add related contact" after removing a related contact', async () => {
    const out = await editForm('m-1');
    const remove = out.node.querySelector('[aria-label="Remove related contact 1"]');
    remove.focus();
    click(remove);
    expect(document.activeElement.textContent).toBe('Add related contact');
  });
});

describe('matters list', () => {
  it('acts only on selected matters that are still listed after the search changes', async () => {
    const { render } = await import('../src/views/matters.js');
    const out = render(ctxFor({}, { status: 'all' }));
    document.querySelector('main').append(out.node);
    const boxes = [...out.node.querySelectorAll('tbody input[type=checkbox]')].slice(0, 3);
    for (const b of boxes) {
      b.checked = true;
      b.dispatchEvent(new Event('change'));
    }
    expect(out.node.querySelector('.bulk-bar').textContent).toContain('3 selected');
    const ids = [...out.node.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('input:checked')).map((tr) => tr.querySelector('a.row-link').getAttribute('href').split('/').pop());
    const before = Object.fromEntries(ids.map((id) => [id, app.store.get('matters', id).status]));
    const m = app.store.get('matters', ids.find((id) => before[id] !== 'closed'));
    const search = out.node.querySelector('input[type=search]');
    search.value = m.displayNumber;
    search.dispatchEvent(new Event('input'));
    await tick(200);
    const bar = out.node.querySelector('.bulk-bar');
    expect(bar.textContent).toContain('1 selected');
    click([...bar.querySelectorAll('button')].find((b) => b.textContent.includes('Change status')));
    click([...document.querySelectorAll('.menu-item')].find((b) => b.textContent === 'Closed'));
    await tick();
    click([...document.querySelectorAll('dialog .btn')].find((b) => b.textContent === 'Close matters'));
    await tick();
    for (const id of ids) expect(app.store.get('matters', id).status).toBe(id === m.id ? 'closed' : before[id]);
  });

  it('warns before closing several matters that still hold trust funds', async () => {
    const { render } = await import('../src/views/matters.js');
    const { financialsFor } = await import('../src/views/common.js');
    const out = render(ctxFor());
    document.querySelector('main').append(out.node);
    const withTrust = app.store.all('matters').filter((m) => m.status === 'open' && financialsFor(m).trust > 0);
    expect(withTrust.length).toBeGreaterThan(0);
    out.node.querySelector('thead input[type=checkbox]').checked = true;
    out.node.querySelector('thead input[type=checkbox]').dispatchEvent(new Event('change'));
    const bar = out.node.querySelector('.bulk-bar');
    click([...bar.querySelectorAll('button')].find((b) => b.textContent.includes('Change status')));
    click([...document.querySelectorAll('.menu-item')].find((b) => b.textContent === 'Closed'));
    await tick();
    const dlg = document.querySelector('dialog');
    expect(dlg.textContent).toMatch(new RegExp(`${withTrust.length} (of these matters|matter) still hold`));
    click([...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Cancel'));
  });
});

describe('contacts list', () => {
  it('counts only selected contacts that are still listed after the search changes', async () => {
    const { render } = await import('../src/views/contacts.js');
    const out = render(ctxFor());
    document.querySelector('main').append(out.node);
    const boxes = [...out.node.querySelectorAll('tbody input[type=checkbox]')].slice(0, 3);
    for (const b of boxes) {
      b.checked = true;
      b.dispatchEvent(new Event('change'));
    }
    expect(out.node.querySelector('.bulk-bar').textContent).toContain('3 selected');
    const id = boxes[0].closest('tr').querySelector('a.row-link').getAttribute('href').split('/').pop();
    const search = out.node.querySelector('input[type=search]');
    search.value = app.store.get('contacts', id).emails?.[0]?.address || id;
    search.dispatchEvent(new Event('input'));
    await tick(200);
    expect(out.node.querySelector('.dt-foot').textContent).toContain('1 contact');
    expect(out.node.querySelector('.bulk-bar').textContent).toContain('1 selected');
  });

  it('warns that deleting contacts in bulk removes them from their matters', async () => {
    const { render } = await import('../src/views/contacts.js');
    const out = render(ctxFor({}, { q: 'Nakamura' }));
    document.querySelector('main').append(out.node);
    const row = [...out.node.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('a.row-link')?.getAttribute('href') === '#/contacts/x-spouse');
    const cb = row.querySelector('input[type=checkbox]');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    click([...out.node.querySelectorAll('.bulk-bar button')].find((b) => b.textContent.includes('Delete')));
    await tick();
    const dlg = document.querySelector('dialog');
    expect(dlg.textContent).toContain('related party on 1 matter');
    expect(dlg.textContent).toContain('conflict checks');
    click([...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Cancel'));
  });

  it('deletes the notes filed only on contacts deleted in bulk, with undo', async () => {
    const own = app.store.put('notes', { subject: 'Background', body: 'x', date: today(), contactId: 'x-spouse', matterId: null });
    const { render } = await import('../src/views/contacts.js');
    const out = render(ctxFor({}, { q: 'Nakamura' }));
    document.querySelector('main').append(out.node);
    const row = [...out.node.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('a.row-link')?.getAttribute('href') === '#/contacts/x-spouse');
    const cb = row.querySelector('input[type=checkbox]');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    click([...out.node.querySelectorAll('.bulk-bar button')].find((b) => b.textContent.includes('Delete')));
    await tick();
    const dlg = document.querySelector('dialog');
    expect(dlg.textContent).toContain('1 note filed on it will be deleted too');
    click([...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Delete'));
    await tick();
    expect(app.store.get('notes', own.id)).toBeNull();
    click([...document.querySelectorAll('.toast button')].find((b) => b.textContent === 'Undo'));
    expect(app.store.get('contacts', 'x-spouse')).toBeTruthy();
    expect(app.store.get('notes', own.id)).toBeTruthy();
  });
});

describe('contact page', () => {
  it('names its tab panel after the selected tab', async () => {
    const { render } = await import('../src/views/contact-detail.js');
    const out = render(ctxFor({ id: 'p-0' }, { tab: 'bills' }));
    document.querySelector('main').append(out.node);
    expect(out.node.querySelector('[role=tabpanel]').getAttribute('aria-label')).toBe('Bills');
    click([...out.node.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith('Notes')));
    expect(out.node.querySelector('[role=tabpanel]').getAttribute('aria-label')).toBe('Notes');
    const panel = out.node.querySelector('[role=tabpanel]');
    for (const t of out.node.querySelectorAll('[role=tab]')) expect(t.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.id).toBeTruthy();
  });

  it('links a person added from a company page to that company', async () => {
    const { render } = await import('../src/views/contact-detail.js');
    const out = render(ctxFor({ id: 'c-1' }));
    const add = [...out.node.querySelectorAll('a')].find((a) => a.textContent === 'Add person');
    const query = Object.fromEntries(new URLSearchParams(add.getAttribute('href').split('?')[1]));
    const form = (await import('../src/views/contact-form.js')).render(ctxFor({}, query));
    document.querySelector('main').replaceChildren(form.node);
    form.node.querySelector('input[name=firstName]').value = 'Ada';
    form.node.querySelector('input[name=lastName]').value = 'Byron';
    submit(form.node.querySelector('form'));
    expect(app.store.all('contacts').find((c) => c.lastName === 'Byron')).toMatchObject({ type: 'person', companyId: 'c-1' });
  });

  it('retitles a new company form when it is switched to a person', async () => {
    const { render } = await import('../src/views/contact-form.js');
    const out = render(ctxFor({}, { type: 'company' }));
    expect(out.node.querySelector('h1').textContent).toBe('New company');
    click([...out.node.querySelectorAll('[role=radio]')].find((b) => b.textContent === 'Person'));
    expect(out.node.querySelector('h1').textContent).toBe('New contact');
  });

  it('deletes the notes filed only on a deleted contact, with undo', async () => {
    const own = app.store.put('notes', { subject: 'Adjuster prefers email', body: 'x', date: today(), contactId: 'x-adj', matterId: null });
    const shared = app.store.put('notes', { subject: 'Call with adjuster', body: 'y', date: today(), contactId: 'x-adj', matterId: 'm-12' });
    const { render } = await import('../src/views/contact-detail.js');
    const out = render(ctxFor({ id: 'x-adj' }));
    document.querySelector('main').append(out.node);
    click(out.node.querySelector('[aria-label="More actions"]'));
    click([...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Delete contact')));
    await tick();
    const dlg = document.querySelector('dialog');
    expect(dlg.textContent).toContain('Its note is deleted with it');
    click([...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Delete contact'));
    await tick();
    expect(app.store.get('contacts', 'x-adj')).toBeNull();
    expect(app.store.get('notes', own.id)).toBeNull();
    expect(app.store.get('notes', shared.id)).toBeTruthy();
    click([...document.querySelectorAll('.toast button')].find((b) => b.textContent === 'Undo'));
    expect(app.store.get('contacts', 'x-adj')).toBeTruthy();
    expect(app.store.get('notes', own.id)).toBeTruthy();
  });

  it('shows the local date a contact was added', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      // 8 pm on October 12 in California is already October 13 in UTC.
      const c = app.store.put('contacts', { type: 'person', firstName: 'Late', lastName: 'Adder', emails: [{ address: 'late@example.com', primary: true }], phones: [], addresses: [], tags: [] });
      app.store.restore('contacts', { ...c, createdAt: new Date(2026, 9, 12, 20, 0, 0).toISOString() });
      const { render } = await import('../src/views/contact-detail.js');
      const out = render(ctxFor({ id: c.id }));
      const { formatDate } = await import('../src/core/dates.js');
      const added = [...out.node.querySelectorAll('dt')].find((d) => d.textContent === 'Added').nextElementSibling;
      expect(added.textContent).toBe(formatDate('2026-10-12'));
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});

describe('record dialogs', () => {
  it('saves a time entry without a matter after the type was switched to flat fee and back', async () => {
    const { openActivityDialog } = await import('../src/views/dialogs.js');
    const done = openActivityDialog({ kind: 'time' });
    const dlg = document.querySelector('dialog');
    const seg = dlg.querySelector('[aria-label="Entry type"]');
    click([...seg.querySelectorAll('[role=radio]')].find((b) => b.textContent === 'Flat fee'));
    click([...seg.querySelectorAll('[role=radio]')].find((b) => b.textContent === 'Time'));
    dlg.querySelector('[name=duration]').value = '1.5';
    submit(dlg.querySelector('form'));
    const saved = await Promise.race([done, tick(50).then(() => 'still open')]);
    expect(saved).toMatchObject({ kind: 'time', minutes: 90, matterId: null });
  });

  it('saves matter description matches in a conflict check note', async () => {
    const { openConflictCheck } = await import('../src/views/dialogs.js');
    openConflictCheck('Lakeshore', { matterId: 'm-3' });
    const dlg = document.querySelector('dialog');
    expect(dlg.textContent).toContain('Mentioned in matter descriptions');
    click([...dlg.querySelectorAll('button')].find((b) => b.textContent.includes('Save result as a note')));
    const note = app.store.all('notes').find((n) => n.subject === 'Conflict check: Lakeshore');
    expect(note.body).not.toContain('No potential conflicts found');
    expect(note.body).toContain('Fairbanks slip and fall, Lakeshore Mall');
  });

  it('files a saved conflict check where it can be found again', async () => {
    const { openConflictCheck } = await import('../src/views/dialogs.js');
    const notes = app.store.all('notes').length;
    openConflictCheck('Sorensen');
    let dlg = document.querySelector('dialog');
    const save = () => click([...dlg.querySelectorAll('button')].find((b) => b.textContent.includes('Save result as a note')));
    save();
    // Nowhere to show it yet: the dialog asks for a matter.
    expect(app.store.all('notes').length).toBe(notes);
    expect(dlg.querySelector('[name=fileTo]').closest('.picker').querySelector('input[role=combobox]').getAttribute('aria-invalid')).toBe('true');
    dlg.querySelector('[name=fileTo]').closest('.picker').value = 'm-3';
    save();
    const onMatter = app.store.all('notes').find((n) => n.subject === 'Conflict check: Sorensen');
    expect(onMatter).toMatchObject({ matterId: 'm-3', contactId: null });

    openConflictCheck('Lowell', { contactId: 'x-adj' });
    dlg = document.querySelector('dialog');
    save();
    expect(app.store.all('notes').find((n) => n.subject === 'Conflict check: Lowell')).toMatchObject({ matterId: null, contactId: 'x-adj' });
  });

  it('files an intake conflict check under the prospective client when there is no matter yet', async () => {
    const { openConflictCheck } = await import('../src/views/dialogs.js');
    openConflictCheck('Okonkwo');
    const dlg = document.querySelector('dialog');
    expect(dlg.querySelector('[name=fileContact]')).not.toBeNull();
    dlg.querySelector('[name=fileContact]').closest('.picker').value = 'x-adj';
    click([...dlg.querySelectorAll('button')].find((b) => b.textContent.includes('Save result as a note')));
    expect(app.store.all('notes').find((n) => n.subject === 'Conflict check: Okonkwo')).toMatchObject({ matterId: null, contactId: 'x-adj' });
  });

  it('fills in the client’s own hourly rate when the matter and user have none', async () => {
    const { openActivityDialog } = await import('../src/views/dialogs.js');
    const m = app.store.get('matters', 'm-3');
    app.store.patch('matters', m.id, { billing: { ...m.billing, method: 'flat', rateCents: null } });
    for (const u of app.store.all('users')) app.store.patch('users', u.id, { rateCents: null });
    app.store.patch('contacts', m.clientId, { rateCents: 17500 });
    openActivityDialog({ kind: 'time', matterId: 'm-3' });
    const dlg = document.querySelector('dialog');
    expect(dlg.querySelector('[name=rate]').value).toBe('175.00');
    expect(dlg.textContent).toContain('Client rate');
  });

  it('refuses a negative hourly rate on a time entry', async () => {
    const { openActivityDialog } = await import('../src/views/dialogs.js');
    const before = app.store.all('activities').length;
    openActivityDialog({ kind: 'time', matterId: 'm-3' });
    const dlg = document.querySelector('dialog');
    dlg.querySelector('[name=duration]').value = '1';
    const rate = dlg.querySelector('[name=rate]');
    rate.value = '-250';
    rate.dispatchEvent(new Event('input'));
    submit(dlg.querySelector('form'));
    await tick();
    expect(app.store.all('activities').length).toBe(before);
    expect(rate.getAttribute('aria-invalid')).toBe('true');
  });

  it('refuses a malformed email on a quick contact', async () => {
    const { quickContactDialog } = await import('../src/views/dialogs.js');
    const before = app.store.all('contacts').length;
    quickContactDialog('Nadia Vey');
    const dlg = document.querySelector('dialog');
    const email = dlg.querySelector('[name=email]');
    email.value = 'nadia.vey@';
    submit(dlg.querySelector('form'));
    await tick();
    expect(app.store.all('contacts').length).toBe(before);
    expect(email.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('communication logs', () => {
  it('asks for a duration instead of skipping the time entry it was asked to record', async () => {
    const { openLogDialog } = await import('../src/views/dialogs.js');
    const logs = app.store.all('communications').length;
    const acts = app.store.all('activities').length;
    openLogDialog({ kind: 'phone', matterId: 'm-3' });
    const dlg = document.querySelector('dialog');
    dlg.querySelector('[name=subject]').value = 'Call with adjuster';
    dlg.querySelector('[name=addTime]').checked = true;
    submit(dlg.querySelector('form'));
    await tick();
    expect(dlg.isConnected).toBe(true);
    expect(dlg.querySelector('[name=duration]').getAttribute('aria-invalid')).toBe('true');
    expect(app.store.all('communications').length).toBe(logs);
    dlg.querySelector('[name=duration]').value = '0:12';
    submit(dlg.querySelector('form'));
    await tick();
    expect(dlg.isConnected).toBe(false);
    expect(app.store.all('activities').length).toBe(acts + 1);
  });

  it('refuses a duration it cannot read', async () => {
    const { openLogDialog } = await import('../src/views/dialogs.js');
    const logs = app.store.all('communications').length;
    openLogDialog({ kind: 'phone', matterId: 'm-3' });
    const dlg = document.querySelector('dialog');
    dlg.querySelector('[name=subject]').value = 'Call with adjuster';
    dlg.querySelector('[name=duration]').value = 'half an hour';
    submit(dlg.querySelector('form'));
    await tick();
    expect(app.store.all('communications').length).toBe(logs);
    expect(dlg.querySelector('[name=duration]').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('stages board', () => {
  it('counts days in a stage from the local date, not the UTC one', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    // 8 pm on the West Coast is already tomorrow in UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 20, 0, 0));
    try {
      app.store.patch('matters', 'm-6', { stageChangedAt: new Date().toISOString() });
      const { render } = await import('../src/views/stages.js');
      const out = render(ctxFor({}, { area: 'pa-emp' }));
      const card = out.node.querySelector('.board-card[data-id="m-6"]');
      expect(card.querySelector('[title="Days in this stage"]').textContent).toBe('0d');
    } finally {
      vi.useRealTimers();
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('keeps keyboard focus on a card after moving it with its menu', async () => {
    const { render } = await import('../src/views/stages.js');
    const out = render(ctxFor({}, { area: 'pa-emp' }));
    document.querySelector('main').append(out.node);
    const btn = out.node.querySelector('.board-card[data-id="m-6"] .card-move');
    btn.focus();
    click(btn);
    const target = [...document.querySelectorAll('.menu-item')].find((b) => b.getAttribute('aria-checked') === 'false');
    click(target);
    await tick();
    const moved = out.node.querySelector('.board-card[data-id="m-6"]');
    expect(moved.closest('.board-col').querySelector('h2').textContent).toBe(target.textContent);
    expect(document.activeElement).toBe(moved.querySelector('.card-move'));
  });

  it('explains in plain words which practice areas have their own stages', async () => {
    const st = app.settings();
    app.store.saveSettings({
      practiceAreas: st.practiceAreas.map((p, i) => (i < 2 ? { ...p, stages: [{ id: `own-${i}`, name: 'Own' }] } : p)),
    });
    const { render } = await import('../src/views/stages.js');
    const out = render(ctxFor());
    const [a, b] = app.settings().practiceAreas;
    expect(out.node.querySelector('.board-note').textContent).toBe(`${a.name} and ${b.name} have their own stages. Choose one above to see those matters.`);
    app.store.saveSettings({ practiceAreas: st.practiceAreas.map((p, i) => (i === 0 ? { ...p, stages: [{ id: 'own', name: 'Own' }] } : p)) });
    const one = render(ctxFor());
    expect(one.node.querySelector('.board-note').textContent).toBe(`${a.name} has its own stages. Choose it above to see those matters.`);
  });

  it('catches up with changes that arrived during a drag that was dropped back', async () => {
    const { render } = await import('../src/views/stages.js');
    const out = render(ctxFor({}, { area: 'pa-emp' }));
    document.querySelector('main').append(out.node);
    document.elementFromPoint ??= () => null;
    const card = out.node.querySelector('.board-card[data-id="m-6"]');
    const ev = (type, x) => {
      const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10, button: 0 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      Object.defineProperty(e, 'pointerType', { value: 'mouse' });
      return e;
    };
    card.dispatchEvent(ev('pointerdown', 10));
    card.dispatchEvent(ev('pointermove', 40));
    // A colleague renames the matter while the card is being dragged.
    app.store.patch('matters', 'm-6', { description: 'Renamed during drag' });
    await tick();
    card.dispatchEvent(ev('pointerup', 40));
    await tick();
    expect(out.node.querySelector('.board-card[data-id="m-6"]').textContent).toContain('Renamed during drag');
  });
});

describe('phone-width labels', () => {
  // .hide-sm is display: none on phones, which also removes it from the accessibility tree.
  // (The shared Columns button is left to its own module.)
  const unnamed = (root) =>
    [...root.querySelectorAll('a, button')].filter((el) => el.querySelector(':scope > .hide-sm') && !el.getAttribute('aria-label') && !el.closest('.dt') && el.textContent.trim() !== 'Columns').map((el) => el.textContent.trim());

  it('names icon buttons whose text is hidden on phones', async () => {
    const views = [
      ['matters', {}, {}],
      ['matter-detail', { id: 'm-1' }, {}],
      ['matter-detail', { id: 'm-1' }, { tab: 'communications' }],
      ['stages', {}, {}],
      ['contacts', {}, {}],
      ['contact-detail', { id: 'p-0' }, {}],
      ['communications', {}, {}],
    ];
    const missing = [];
    for (const [name, params, query] of views) {
      const { render } = await import(`../src/views/${name}.js`);
      const out = render(ctxFor(params, query));
      for (const t of unnamed(out.node)) missing.push(`${name}: ${t}`);
    }
    expect(missing).toEqual([]);
  });
});
