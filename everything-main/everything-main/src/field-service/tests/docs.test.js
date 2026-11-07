// @vitest-environment jsdom
/**
 * Quotes, invoices, requests, payments and expenses screens, rendered on the
 * demo data: behaviour a person relies on when editing and sending them.
 */
import { describe, it, expect, beforeAll } from 'vitest';

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
});

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

let app;
let main;

async function boot() {
  ({ app } = await import('../src/app.js'));
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { buildSampleData } = await import('../src/core/sample.js');
  const { buildShell } = await import('../src/ui/shell.js');
  const { startViews } = await import('../src/ui/viewhost.js');
  app.demo = true;
  app.today = () => '2026-10-12';
  const data = buildSampleData('2026-10-12');
  data.settings.taxes = [
    { id: 'tax-none', name: 'Exempt', rate: 0 },
    { id: 'tax-gst', name: 'GST', rate: 5 },
  ];
  app.store = createStore({ backend: createMemoryBackend(data) });
  await app.store.init();
  document.body.innerHTML = '<div id="app"></div>';
  const shell = buildShell({});
  document.getElementById('app').append(shell.root);
  startViews(shell.main);
  main = shell.main;
}

// Views load on demand: wait until the new one has rendered.
async function go(hash) {
  const before = main.firstElementChild;
  location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  for (let i = 0; i < 250; i++) {
    await settle();
    // Leaving a form a test typed into.
    [...document.querySelectorAll('dialog[open] .btn')].find((b) => b.textContent === 'Discard changes')?.click();
    if (main.firstElementChild && main.firstElementChild !== before && main.querySelector('h1')) break;
  }
  await settle();
}

const change = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('quote and invoice screens', () => {
  beforeAll(async () => app || (await boot()));

  it('shows the rate already applied when switching tax to a custom rate', async () => {
    await go('#/quotes/new');
    const sel = main.querySelector('select[aria-label="Tax rate"]');
    change(sel, '5');
    change(sel, 'custom');
    const custom = main.querySelector('input[aria-label="Custom tax rate percent"]');
    expect(custom.hidden).toBe(false);
    expect(custom.value).toBe('5');
    expect(custom.nextElementSibling.hidden).toBe(false);
  });

  it('keeps keyboard focus in the line items after removing or moving one', async () => {
    await go('#/invoices/new');
    const add = [...main.querySelectorAll('button')].find((b) => b.textContent === 'Add line item');
    add.click();
    add.click();
    expect(main.querySelectorAll('.item-row').length).toBe(3);
    const down = main.querySelector('.item-row .move-down');
    down.focus();
    down.click();
    down.ownerDocument.activeElement.click();
    // Now at the bottom, where Move down is disabled.
    expect(document.activeElement.classList.contains('move-up')).toBe(true);
    expect(document.activeElement.closest('.item-row')).toBe(main.querySelectorAll('.item-row')[2]);
    const remove = main.querySelectorAll('.remove-item')[1];
    remove.focus();
    remove.click();
    expect(document.activeElement).toBe(main.querySelectorAll('.remove-item')[1]);
    main.querySelectorAll('.remove-item')[1].click();
    expect(document.activeElement).toBe(main.querySelectorAll('.remove-item')[0]);
    main.querySelectorAll('.remove-item')[0].click();
    expect(document.activeElement).toBe(add);
  });

  it('says which line item each move button moves', async () => {
    await go('#/quotes/new');
    [...main.querySelectorAll('button')].find((b) => b.textContent === 'Add line item').click();
    const labels = [...main.querySelectorAll('.item-tools button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Move item 1 up', 'Move item 1 down', 'Remove item 1', 'Move item 2 up', 'Move item 2 down', 'Remove item 2']);
  });

  it('keeps focus on the Optional box of a line item after ticking it', async () => {
    await go('#/quotes/new');
    const box = [...main.querySelectorAll('.item-row label.check')].find((l) => l.textContent === 'Optional').querySelector('input');
    box.focus();
    box.click();
    expect(document.activeElement.closest('label')?.textContent).toBe('Optional');
    expect(document.activeElement.checked).toBe(true);
  });

  it('tells screen readers which product suggestion is active', async () => {
    await go('#/quotes/new');
    const name = main.querySelector('.item-name');
    name.focus();
    name.value = '';
    name.dispatchEvent(new Event('input'));
    const list = document.getElementById(name.getAttribute('aria-controls'));
    expect(list?.getAttribute('role')).toBe('listbox');
    expect(list.hidden).toBe(false);
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const active = document.getElementById(name.getAttribute('aria-activedescendant'));
    expect(active?.getAttribute('aria-selected')).toBe('true');
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(name.getAttribute('aria-expanded')).toBe('false');
    expect(name.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('updates the Taxable box when a product picked from the suggestions is not taxable', async () => {
    app.store.put('products', { id: 'p-permit', name: 'Zz permit fee', unitPrice: 2500, unitCost: 0, taxable: false, active: true });
    await go('#/invoices/new');
    const name = main.querySelector('.item-name');
    name.focus();
    name.value = 'Zz permit';
    name.dispatchEvent(new Event('input'));
    const option = document.getElementById(name.getAttribute('aria-controls')).querySelector('[role=option]');
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const row = name.closest('.item-row');
    const taxable = [...row.querySelectorAll('label.check')].find((l) => l.textContent === 'Taxable').querySelector('input');
    expect(taxable.checked).toBe(false);
  });

  it('names an untitled line item in the email text the way the document does', async () => {
    const { documentText } = await import('../src/views/docview.js');
    const q = app.store.all('quotes')[0];
    const text = documentText('quotes', { ...q, items: [{ id: 'x', name: '', description: 'Haul away debris', qty: 1, unitPrice: 5000 }] });
    expect(text).toMatch(/^  Untitled item x 1: /m);
  });

  it('shows an inactive salesperson on a quote that names them', async () => {
    const member = app.store.all('team').find((m) => m.role !== 'owner');
    const q = app.store.all('quotes')[0];
    app.store.patch('team', member.id, { active: false });
    app.store.patch('quotes', q.id, { salespersonId: member.id });
    try {
      await go(`#/quotes/${q.id}/edit`);
      const sel = [...main.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent === 'None'));
      expect(sel.value).toBe(member.id);
      expect(sel.selectedOptions[0].textContent).toBe(`${member.name} (inactive)`);
    } finally {
      app.store.patch('team', member.id, { active: true });
    }
  });

  it('names every button in the send dialog, including those whose label hides on phones', async () => {
    const q = app.store.all('quotes').find((x) => x.status === 'draft');
    await go(`#/quotes/${q.id}`);
    [...main.querySelectorAll('button')].find((b) => b.textContent.includes('Send quote')).click();
    const dlg = document.querySelector('dialog[open]');
    // Styled to wrap its actions on phones (see views.css).
    expect(dlg.classList.contains('send-dialog')).toBe(true);
    for (const b of dlg.querySelectorAll('.dialog-foot button')) {
      const visible = [...b.childNodes].filter((n) => !(n.classList?.contains('hide-mobile'))).map((n) => n.textContent).join('').trim();
      expect(b.getAttribute('aria-label') || visible, b.outerHTML.slice(0, 80)).not.toBe('');
    }
    dlg.querySelector('.dialog-head button').click();
  });
});

const menuLabels = async () => {
  main.querySelector('.page-header button[aria-label="More actions"]').click();
  await settle();
  const items = [...document.querySelectorAll('[role=menu] [role^=menuitem]')];
  const out = items.map((b) => ({ label: b.textContent.trim(), disabled: b.disabled, el: b }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  (await import('../src/ui/menu.js')).closeMenu();
  return out;
};

describe('status actions', () => {
  beforeAll(async () => app || (await boot()));

  it('does not offer Revert to draft on a bad debt invoice, where it would change nothing', async () => {
    const inv = app.store.all('invoices').find((i) => i.sentAt && !i.badDebt);
    app.store.patch('invoices', inv.id, { badDebt: true, badDebtAt: new Date().toISOString() });
    await go(`#/invoices/${inv.id}`);
    const labels = (await menuLabels()).map((m) => m.label);
    expect(labels).toContain('Remove bad debt');
    expect(labels).not.toContain('Revert to draft');
  });

  it('leaves the payments of a deleted invoice unapplied, and links them back on Undo', async () => {
    const payments = app.store.all('payments');
    const inv = app.store.all('invoices').find((i) => payments.some((p) => p.invoiceId === i.id && !p.voided));
    const paid = payments.filter((p) => p.invoiceId === inv.id).map((p) => p.id);
    await go(`#/invoices/${inv.id}`);
    const del = (await menuLabels()).find((m) => m.label === 'Delete');
    main.querySelector('.page-header button[aria-label="More actions"]').click();
    await settle();
    [...document.querySelectorAll('[role=menu] [role^=menuitem]')].find((b) => b.textContent.trim() === del.label).click();
    await settle();
    const confirm = [...document.querySelectorAll('dialog[open] .btn')].find((b) => b.textContent === 'Delete invoice');
    expect(confirm.closest('dialog').textContent).toContain('become unapplied');
    confirm.click();
    await settle();
    for (const id of paid) expect(app.store.get('payments', id).invoiceId).toBeNull();
    [...document.querySelectorAll('button.toast-action')].findLast((b) => b.textContent === 'Undo').click();
    for (const id of paid) expect(app.store.get('payments', id).invoiceId).toBe(inv.id);
  });

  it('offers no status change or second conversion on an archived quote that became a job', async () => {
    const q = app.store.all('quotes').find((x) => x.jobId && app.store.get('jobs', x.jobId));
    app.store.patch('quotes', q.id, { archived: true });
    await go(`#/quotes/${q.id}`);
    const items = await menuLabels();
    expect(items.map((m) => m.label)).not.toContain('Convert to job');
    for (const label of ['Draft', 'Awaiting response', 'Changes requested', 'Approved']) expect(items.find((m) => m.label === label).disabled, label).toBe(true);
    expect(items.find((m) => m.label === 'Approved').el.getAttribute('aria-checked')).toBe('true');
  });
  it("says so when the approval toast's Convert to job is used after the quote was deleted", async () => {
    const q = app.store.all('quotes').find((x) => !x.jobId && (x.status === 'awaiting_response' || x.status === 'changes_requested'));
    await go(`#/quotes/${q.id}`);
    [...main.querySelectorAll('.page-header button')].find((b) => b.textContent.includes('Mark approved')).click();
    await settle();
    const convert = [...document.querySelectorAll('button.toast-action')].findLast((b) => b.textContent === 'Convert to job');
    app.store.remove('quotes', q.id);
    const errors = [];
    const onError = (e) => errors.push(e.reason);
    window.addEventListener('unhandledrejection', onError);
    process.on('unhandledRejection', onError);
    convert.click();
    await settle(50);
    window.removeEventListener('unhandledrejection', onError);
    process.off('unhandledRejection', onError);
    expect(errors).toEqual([]);
    expect(document.body.textContent).toContain('This quote no longer exists');
  });
});

describe('requests', () => {
  beforeAll(async () => app || (await boot()));

  it('does not call an assessment with no date scheduled', async () => {
    const r = app.store.all('requests').find((x) => !x.convertedTo && !x.archived);
    app.store.patch('requests', r.id, { assessment: { date: null, start: '', end: '', assignees: [], instructions: '', completedAt: null } });
    await go(`#/requests/${r.id}`);
    const card = [...main.querySelectorAll('section.card')].find((c) => c.querySelector('h2')?.textContent === 'Assessment');
    expect(card.textContent).toContain('Not set');
    expect(card.querySelector('.card-head .pill')).toBeNull();
  });

  it('follows the first conversion when Convert to quote and Convert to job are both clicked', async () => {
    const r = app.store.all('requests').find((x) => !x.convertedTo && !x.archived);
    await go(`#/requests/${r.id}`);
    const jobsBefore = app.store.all('jobs').length;
    [...main.querySelectorAll('button')].find((b) => b.textContent === 'Convert to quote').click();
    main.querySelector('.page-header button[aria-label="More actions"]').click();
    [...document.querySelectorAll('[role=menu] [role^=menuitem]')].find((b) => b.textContent.trim() === 'Convert to job').click();
    for (let i = 0; i < 50 && !/\/quotes\/.+\/edit/.test(location.hash); i++) await settle();
    await settle(60);
    expect(location.hash).toMatch(/^#\/quotes\/.+\/edit$/);
    expect(app.store.all('jobs').length).toBe(jobsBefore);
    expect(document.body.textContent).not.toMatch(/Job #\d+ started/);
  });

  it('keeps keyboard focus on the page after marking an assessment or quote done', async () => {
    const r = app.store.all('requests').find((x) => x.assessment?.date && !x.assessment.completedAt);
    await go(`#/requests/${r.id}`);
    const done = [...main.querySelectorAll('button')].find((b) => b.textContent === 'Mark complete');
    done.focus();
    done.click();
    await settle();
    expect(main.contains(document.activeElement)).toBe(true);
    const q = app.store.all('quotes').find((x) => x.status === 'awaiting_response' && !x.jobId && !x.archived);
    await go(`#/quotes/${q.id}`);
    const approve = [...main.querySelectorAll('button')].find((b) => b.textContent === 'Mark approved');
    approve.focus();
    approve.click();
    await settle();
    expect(document.activeElement.textContent).toBe('Convert to job');
  });
});

describe('lists', () => {
  beforeAll(async () => app || (await boot()));

  it('announces the result count from one live region that stays on the page', async () => {
    await go('#/quotes');
    const region = main.querySelector('.list-card [role=status]');
    const before = region.textContent;
    [...main.querySelectorAll('.chips .chip')].find((c) => c.textContent.startsWith('Draft')).click();
    expect(main.querySelector('.list-card [role=status]')).toBe(region);
    expect(region.textContent).not.toBe(before);
    expect(region.textContent).toMatch(/^\d+ quotes$/);
  });

  it('counts days late from the current date when the invoice list refreshes after midnight', async () => {
    await go('#/invoices?status=past_due');
    const lateText = () => [...main.querySelectorAll('tbody .sub')].map((n) => n.textContent).find((t) => /days? late/.test(t));
    const before = parseInt(lateText(), 10);
    const today = app.today;
    try {
      app.today = () => '2026-10-13';
      app.store.patch('clients', app.store.all('clients')[0].id, { notes: 'next day' });
      await settle();
      expect(parseInt(lateText(), 10)).toBe(before + 1);
    } finally {
      app.today = today;
    }
  });

  it('keeps focus on the status filter or sort button just used, and through a refresh', async () => {
    await go('#/invoices');
    const chip = [...main.querySelectorAll('.chips .chip')].find((c) => c.textContent.startsWith('Paid'));
    chip.focus();
    chip.click();
    expect(document.activeElement.textContent).toMatch(/^Paid/);
    expect(document.activeElement.getAttribute('aria-pressed')).toBe('true');
    const sort = [...main.querySelectorAll('th button.sort')].find((b) => b.textContent === 'Total');
    sort.focus();
    sort.click();
    expect(document.activeElement.textContent).toBe('Total');
    expect(document.activeElement.closest('th').getAttribute('aria-sort')).toBe('ascending');
    const c = app.store.all('clients')[0];
    app.store.patch('clients', c.id, { notes: 'refresh' });
    await settle();
    expect(document.activeElement.textContent).toBe('Total');
  });

  it('keeps typing in the payments and expenses search boxes, and focus on their filters', async () => {
    for (const hash of ['#/payments', '#/expenses']) {
      await go(hash);
      const input = main.querySelector('input[type=search]');
      input.focus();
      input.value = 'a';
      input.dispatchEvent(new Event('input'));
      await settle(200);
      expect(document.activeElement, hash).toBe(input);
    }
    const chip = main.querySelectorAll('.chips .chip')[1];
    chip.focus();
    chip.click();
    expect(document.activeElement.getAttribute('aria-pressed')).toBe('true');
    await go('#/payments');
    const range = main.querySelector('select[aria-label="Date range"]');
    range.focus();
    change(range, 'month');
    expect(document.activeElement).toBe(range);
  });
});

describe('expenses', () => {
  beforeAll(async () => app || (await boot()));

  it('does not save an expense without the receipt that is still uploading', async () => {
    const { expenseDialog } = await import('../src/views/expenses.js');
    expenseDialog();
    const dlg = document.querySelector('dialog[open]');
    const [title, amount] = dlg.querySelectorAll('input.input');
    title.value = 'Mulch';
    amount.value = '42';
    const file = dlg.querySelector('input[type=file]');
    Object.defineProperty(file, 'files', { value: [new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' })] });
    file.dispatchEvent(new Event('change'));
    const save = [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Add expense');
    save.click();
    for (let i = 0; i < 50 && save.disabled; i++) await settle();
    if (save.isConnected) save.click();
    const saved = app.store.all('expenses').filter((x) => x.title === 'Mulch');
    expect(saved.length).toBe(1);
    expect(saved[0].receipt?.name).toBe('receipt.pdf');
  });

  it('says why an expense cannot be saved', async () => {
    const { expenseDialog } = await import('../src/views/expenses.js');
    expenseDialog();
    const dlg = document.querySelector('dialog[open]');
    const [title, amount] = dlg.querySelectorAll('input.input');
    const save = [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Add expense');
    save.click();
    expect(document.activeElement).toBe(title);
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(document.body.textContent).toContain('Enter what the expense was for');
    title.value = 'Fuel';
    save.click();
    expect(document.activeElement).toBe(amount);
    expect(document.body.textContent).toContain('Enter an amount greater than zero');
    dlg.querySelector('.dialog-head button').click();
  });
});
