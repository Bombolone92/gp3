// @vitest-environment jsdom
/**
 * Regression tests for the money screens: activities, bills, bill runs,
 * payments, trust, and reports.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';
import { accountBalance } from '../src/core/finance.js';

const TODAY = '2026-10-12';

beforeAll(() => {
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
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
  app.today = () => TODAY;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(TODAY)), flushDelay: 0 });
  await app.store.init();
});

function ctx(params = {}, query = {}) {
  return { params, query, route: { params, query }, watch() {}, onDispose() {}, live: (fn) => fn() };
}

async function mount(mod, params, query) {
  const out = (await mod).render(ctx(params, query));
  const node = out instanceof Node ? out : out.node;
  document.body.append(node);
  return { node, out };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const button = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()));

describe('account ledger', () => {
  it('shows the closing balance of the newest transaction in the footer', async () => {
    const { node } = await mount(import('../src/views/accounts.js'), { id: 'acct-trust' }, {});
    const store = app.store;
    const bal = accountBalance(store.get('accounts', 'acct-trust'), store.all('transactions'));
    const foot = node.querySelector('.dt-foot').textContent;
    const closing = /Closing balance\s*(\S+)/.exec(foot)[1];
    const { formatMoney } = await import('../src/core/money.js');
    expect(closing).toBe(formatMoney(bal));
  });
});

describe('bulk selection follows the visible rows', () => {
  it('drops bills hidden by a search from the bulk bar and its actions', async () => {
    const { node } = await mount(import('../src/views/billing.js'), {}, { status: 'all' });
    const rows = [...node.querySelectorAll('tbody tr:not(.dt-spacer)')];
    const pick = (tr) => {
      const cb = tr.querySelector('td.dt-check input');
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    };
    pick(rows[0]);
    pick(rows[1]);
    const bar = node.querySelector('.bulk-bar');
    expect(bar.textContent).toMatch(/2 selected/);
    const keep = rows[0].querySelector('.strong').textContent; // "#N"
    const search = node.querySelector('input[type=search]');
    search.value = keep;
    search.dispatchEvent(new Event('input'));
    await wait(200);
    expect(node.querySelectorAll('tbody tr:not(.dt-spacer)').length).toBe(1);
    expect(bar.textContent).toMatch(/1 selected/);
  });

  it('drops activities hidden by a filter from the bulk bar', async () => {
    const { node } = await mount(import('../src/views/activities.js'), {}, { range: 'year', billed: 'unbilled' });
    const rows = [...node.querySelectorAll('tbody tr:not(.dt-spacer)')];
    const cb = (tr) => tr.querySelector('td.dt-check input');
    for (const tr of rows.slice(0, 2)) {
      cb(tr).checked = true;
      cb(tr).dispatchEvent(new Event('change'));
    }
    const bar = node.querySelector('.bulk-bar');
    expect(bar.textContent).toMatch(/2 selected/);
    const kind = node.querySelector('select[name=billed]');
    kind.value = 'billed';
    kind.dispatchEvent(new Event('change'));
    expect(bar.hidden || /0 selected/.test(bar.textContent)).toBe(true);
  });
});

describe('flat fee matters', () => {
  async function generateAll(node) {
    const store = app.store;
    const before = store.all('bills').length;
    button(node, /Generate \d+ draft/).click();
    for (let i = 0; i < 50 && store.all('bills').length === before; i++) await flush();
    await flush();
    return store.all('bills').slice(before);
  }

  it('does not bill the agreed fee again after a flat fee entry was billed', async () => {
    const store = app.store;
    const client = store.all('contacts')[0];
    const m = store.put('matters', { number: 900, displayNumber: '00900', description: 'Flat matter', clientId: client.id, status: 'open', billing: { billable: true, method: 'flat', flatFeeCents: 250000 } });
    store.put('activities', { kind: 'flat', matterId: m.id, date: '2026-10-01', description: 'Agreed flat fee', amountCents: 250000, billable: true });
    const { node } = await mount(import('../src/views/bill-generate.js'), {}, { matter: m.id });
    const made = await generateAll(node);
    expect(made).toHaveLength(1);
    expect(made[0].lines.map((l) => l.amountCents)).toEqual([250000]);
    const { billableMatters } = await import('../src/core/billing-ops.js');
    const again = billableMatters({ matters: [store.get('matters', m.id)], activities: store.all('activities'), to: TODAY });
    expect(again).toHaveLength(0);
  });

  it('does not add the agreed fee when a flat fee entry falls outside the period', async () => {
    const store = app.store;
    const client = store.all('contacts')[0];
    const m = store.put('matters', { number: 901, displayNumber: '00901', description: 'Flat matter', clientId: client.id, status: 'open', billing: { billable: true, method: 'flat', flatFeeCents: 250000 } });
    store.put('activities', { kind: 'flat', matterId: m.id, date: '2026-12-01', description: 'Agreed flat fee', amountCents: 250000, billable: true });
    store.put('activities', { kind: 'expense', matterId: m.id, date: '2026-10-01', description: 'Filing fee', qty: 1, priceCents: 5000, billable: true });
    const { draftBill } = await import('../src/core/finance.js');
    const out = draftBill({ matter: store.get('matters', m.id), activities: store.all('activities'), settings: app.settings(), number: 1, issueDate: TODAY, to: TODAY });
    expect(out.bill.lines.map((l) => l.kind)).toEqual(['expense']);
  });
});

describe('payments', () => {
  it('does not overpay a bill when undoing a deleted payment after a new one', async () => {
    const store = app.store;
    const { billBalance, billPaid, billTotals } = await import('../src/core/finance.js');
    const bill = store.all('bills').find((b) => b.status === 'issued' && billBalance(b, store.all('payments')) > 0 && billPaid(b, store.all('payments')) === 0);
    const total = billTotals(bill).total;
    const pay = store.put('payments', { billId: bill.id, matterId: bill.matterId, contactId: bill.clientId, date: TODAY, amountCents: total, method: 'check' });
    const { deletePayment } = await import('../src/views/money-dialogs.js');
    const done = deletePayment(pay);
    await flush();
    button(document.body, /^Delete payment$/).click();
    expect(await done).toBe(true);
    const undo = document.querySelector('.toast-action');
    store.put('payments', { billId: bill.id, matterId: bill.matterId, contactId: bill.clientId, date: TODAY, amountCents: total, method: 'bank' });
    undo.click();
    expect(billPaid(bill, store.all('payments'))).toBeLessThanOrEqual(total);
  });
});

describe('payment dialog', () => {
  it('refuses a payment on a bill voided while the dialog was open', async () => {
    const store = app.store;
    const { billBalance } = await import('../src/core/finance.js');
    const bill = store.all('bills').find((b) => b.status === 'issued' && billBalance(b, store.all('payments')) > 0);
    const { openPaymentDialog } = await import('../src/views/money-dialogs.js');
    const before = store.all('payments').length;
    const done = openPaymentDialog({ billId: bill.id });
    store.patch('bills', bill.id, { status: 'void' });
    const form = document.querySelector('dialog form');
    form.querySelector('[name=amount]').value = '10.00';
    form.requestSubmit();
    await flush();
    expect(store.all('payments').length).toBe(before);
    document.querySelector('dialog .dialog-head button').click();
    await done;
  });
});

describe('reports', () => {
  it('labels profitability columns so matters numbered by year stay distinct', async () => {
    const store = app.store;
    for (const m of store.all('matters')) store.patch('matters', m.id, { displayNumber: `2026-${String(m.number).padStart(5, '0')}` });
    const { node } = await mount(import('../src/views/reports.js'), { report: 'profitability' }, {});
    await new Promise((r) => requestAnimationFrame(r));
    const labels = [...node.querySelectorAll('.chart-svg text.chart-tick')].map((t) => t.textContent).filter((t) => /\d{3}/.test(t) && !/\$/.test(t));
    expect(labels.length).toBeGreaterThan(2);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('editing a draft bill', () => {
  async function editDraft() {
    const draft = app.store.all('bills').find((b) => b.status === 'draft');
    const { node } = await mount(import('../src/views/bill-detail.js'), { id: draft.id }, {});
    button(node, /^Edit$/).click();
    return { node, draft };
  }

  it('does not save a bill without an issue or due date', async () => {
    const { node, draft } = await editDraft();
    const [issue] = node.querySelectorAll('.edit-grid input[type=date]');
    issue.value = '';
    issue.dispatchEvent(new Event('change'));
    button(node, /Save changes/).click();
    expect(app.store.get('bills', draft.id).issueDate).toBe(draft.issueDate);
    expect(node.querySelector('.bill-edit')).toBeTruthy();
  });

  it('does not save a due date before the issue date', async () => {
    const { node, draft } = await editDraft();
    const [, due] = node.querySelectorAll('.edit-grid input[type=date]');
    due.value = '2020-01-01';
    due.dispatchEvent(new Event('change'));
    button(node, /Save changes/).click();
    expect(app.store.get('bills', draft.id).dueDate).toBe(draft.dueDate);
  });

  it('accepts a percent discount typed with a percent sign', async () => {
    const { node, draft } = await editDraft();
    const disc = node.querySelector('input[aria-label=Discount]');
    disc.value = '10%';
    disc.dispatchEvent(new Event('input'));
    button(node, /Save changes/).click();
    expect(app.store.get('bills', draft.id).discount).toEqual({ type: 'percent', value: 10 });
  });
});

describe('trust can never go below zero on any date', () => {
  function freshMatter() {
    const store = app.store;
    const client = store.all('contacts')[0];
    return store.put('matters', { number: 950, displayNumber: '00950', description: 'Trust matter', clientId: client.id, status: 'open', billing: { billable: true, method: 'hourly' } });
  }

  it('refuses a withdrawal dated before the deposit that would fund it', async () => {
    const store = app.store;
    const m = freshMatter();
    store.put('transactions', { accountId: 'acct-trust', type: 'deposit', date: '2026-10-10', amountCents: 100000, matterId: m.id });
    const { openTrustDialog } = await import('../src/views/money-dialogs.js');
    const before = store.all('transactions').length;
    const done = openTrustDialog({ type: 'withdrawal', matterId: m.id });
    const form = document.querySelector('dialog form');
    form.querySelector('[name=date]').value = '2026-10-01';
    form.querySelector('[name=amount]').value = '500.00';
    form.requestSubmit();
    await flush();
    expect(store.all('transactions').length).toBe(before);
    document.querySelector('dialog .dialog-head button').click();
    await done;
  });

  it('refuses to delete a deposit that an earlier-dated balance depends on', async () => {
    const store = app.store;
    const m = freshMatter();
    store.put('transactions', { accountId: 'acct-trust', type: 'deposit', date: '2026-10-01', amountCents: 100000, matterId: m.id });
    store.put('transactions', { accountId: 'acct-trust', type: 'withdrawal', date: '2026-10-05', amountCents: 80000, matterId: m.id });
    const late = store.put('transactions', { accountId: 'acct-trust', type: 'deposit', date: '2026-10-20', amountCents: 100000, matterId: m.id });
    const first = store.all('transactions').find((t) => t.matterId === m.id && t.date === '2026-10-01');
    const { deleteTransaction } = await import('../src/views/money-dialogs.js');
    // Removing the October 1 deposit leaves the October 5 withdrawal unfunded,
    // even though the final balance would still be positive.
    expect(await deleteTransaction(first)).toBe(false);
    expect(store.get('transactions', first.id)).toBeTruthy();
    expect(late).toBeTruthy();
  });
});

describe('new bills screen', () => {
  it('stops showing the preset matter once another client is chosen', async () => {
    const store = app.store;
    const m = store.all('matters').find((x) => x.clientId && x.billing?.method === 'hourly');
    const other = store.all('matters').find((x) => x.clientId && x.clientId !== m.clientId);
    const { node } = await mount(import('../src/views/bill-generate.js'), {}, { matter: m.id });
    const preset = node.querySelector('.gen-preset').closest('.field');
    expect(preset.hidden).toBe(false);
    node.querySelector('input[name=client]').closest('.picker').value = other.clientId;
    // The list now covers every matter of the new client, so the preset
    // matter must no longer be shown as the filter.
    expect(preset.hidden).toBe(true);
  });
});

describe('time entry dialog', () => {
  it('lets time be saved without a matter after switching away from flat fee', async () => {
    const store = app.store;
    const { openActivityDialog } = await import('../src/views/dialogs.js');
    const before = store.all('activities').length;
    const done = openActivityDialog({ kind: 'time' });
    const dlg = document.querySelector('dialog');
    const seg = (label) => [...dlg.querySelectorAll('[role=radio]')].find((b) => b.textContent.trim() === label);
    seg('Flat fee').click();
    seg('Time').click();
    const form = dlg.querySelector('form');
    form.querySelector('[name=duration]').value = '1.5';
    form.requestSubmit();
    await done;
    expect(store.all('activities').length).toBe(before + 1);
  });
});

describe('printable trust ledger', () => {
  it('selects the requested matter even when it has no trust transactions yet', async () => {
    const store = app.store;
    const client = store.all('contacts')[0];
    const m = store.put('matters', { number: 960, displayNumber: '00960', description: 'New retainer', clientId: client.id, status: 'open', trustMinimumCents: 100000, billing: { billable: true, method: 'hourly' } });
    const { printTrustLedger } = await import('../src/views/accounts.js');
    printTrustLedger(m.id);
    const sel = document.querySelector('dialog select[name=ledgerMatter]');
    expect(sel.value).toBe(m.id);
  });
});

describe('activities add entry', () => {
  it('starts a new entry on the matter the list is filtered to', async () => {
    const m = app.store.all('matters')[0];
    const { node } = await mount(import('../src/views/activities.js'), {}, { matter: m.id });
    button(node, /^Add entry$/).click();
    const hidden = document.querySelector('dialog input[type=hidden][name=matterId]');
    expect(hidden.value).toBe(m.id);
  });
});

describe('bill editor focus', () => {
  it('keeps keyboard focus in the line table after removing a line', async () => {
    const draft = app.store.all('bills').find((b) => b.status === 'draft' && b.lines.length > 1);
    const { node } = await mount(import('../src/views/bill-detail.js'), { id: draft.id }, {});
    button(node, /^Edit$/).click();
    const btn = node.querySelector('.edit-lines tbody tr button[aria-label^="Remove line"]');
    btn.focus();
    btn.click();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement.getAttribute('aria-label')).toMatch(/^Remove line/);
  });
});

describe('payment dialog bill choice', () => {
  it('falls back to an unpaid bill when asked to pay a bill that is already paid', async () => {
    const store = app.store;
    const { billBalance, billStatus } = await import('../src/core/finance.js');
    const paid = store.all('bills').find((b) => billStatus(b, store.all('payments'), TODAY) === 'paid');
    const { openPaymentDialog } = await import('../src/views/money-dialogs.js');
    const done = openPaymentDialog({ billId: paid.id });
    const sel = document.querySelector('dialog select[name=billId]');
    const chosen = store.get('bills', sel.value);
    expect(chosen).toBeTruthy();
    const { parseMoney } = await import('../src/core/money.js');
    expect(parseMoney(document.querySelector('dialog [name=amount]').value)).toBe(billBalance(chosen, store.all('payments')));
    document.querySelector('dialog .dialog-head button').click();
    await done;
  });
});

describe('approving bills in bulk', () => {
  it('says drafts were submitted for approval, not approved', async () => {
    const store = app.store;
    const first = store.all('bills').find((b) => b.status === 'draft');
    const { id, ...copy } = first;
    store.put('bills', { ...copy, number: 9999, lines: [] });
    const drafts = store.all('bills').filter((b) => b.status === 'draft');
    expect(drafts.length).toBe(2);
    const { approveBills } = await import('../src/views/billing-actions.js');
    approveBills(drafts);
    expect(drafts.every((b) => store.get('bills', b.id).status === 'pending')).toBe(true);
    const last = [...document.querySelectorAll('.toast')].pop().textContent;
    expect(last).toMatch(/submitted for approval/);
    expect(last).not.toMatch(/approved/);
  });
});

describe('voiding bills', () => {
  it('does not void a bill that received a payment while the confirmation was open', async () => {
    const store = app.store;
    const { billBalance, billPaid } = await import('../src/core/finance.js');
    const bill = store.all('bills').find((b) => b.status === 'issued' && billPaid(b, store.all('payments')) === 0 && billBalance(b, store.all('payments')) > 0);
    const { voidBills } = await import('../src/views/billing-actions.js');
    const done = voidBills([bill]);
    await flush();
    store.put('payments', { billId: bill.id, matterId: bill.matterId, date: TODAY, amountCents: 100, method: 'check' });
    button(document.body, /^Void$/).click();
    expect(await done).toBe(false);
    expect(store.get('bills', bill.id).status).toBe('issued');
  });
});

describe('deleting drafts', () => {
  it('does not delete a bill that was issued while the confirmation was open', async () => {
    const store = app.store;
    const draft = store.all('bills').find((b) => b.status === 'draft');
    const { deleteDrafts } = await import('../src/views/billing-actions.js');
    const done = deleteDrafts([draft]);
    await flush();
    store.patch('bills', draft.id, { status: 'issued' });
    button(document.body, /^Delete$/).click();
    expect(await done).toBe(false);
    expect(store.get('bills', draft.id)).toBeTruthy();
  });
});

describe('deleting a trust deposit', () => {
  it('re-checks the balance after the confirmation', async () => {
    const store = app.store;
    const client = store.all('contacts')[0];
    const m = store.put('matters', { number: 970, displayNumber: '00970', description: 'Deposit', clientId: client.id, status: 'open', billing: { billable: true, method: 'hourly' } });
    const dep = store.put('transactions', { accountId: 'acct-trust', type: 'deposit', date: '2026-10-01', amountCents: 50000, matterId: m.id });
    const { deleteTransaction } = await import('../src/views/money-dialogs.js');
    const done = deleteTransaction(dep);
    await flush();
    store.put('transactions', { accountId: 'acct-trust', type: 'withdrawal', date: '2026-10-02', amountCents: 20000, matterId: m.id });
    button(document.body, /^Delete$/).click();
    expect(await done).toBe(false);
    expect(store.get('transactions', dep.id)).toBeTruthy();
  });
});

describe('bulk deleting entries', () => {
  it('keeps an entry that was billed while the confirmation was open', async () => {
    const store = app.store;
    const { node } = await mount(import('../src/views/activities.js'), {}, { range: 'year', billed: 'unbilled' });
    const tr = node.querySelector('tbody tr:not(.dt-spacer)');
    const cb = tr.querySelector('td.dt-check input');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    const id = tr.querySelector('[data-act]').dataset.act;
    button(node.querySelector('.bulk-bar'), /Delete/).click();
    await flush();
    const bill = store.all('bills').find((b) => b.status === 'draft');
    store.patch('activities', id, { billId: bill.id });
    button(document.querySelector('dialog'), /^Delete$/).click();
    await flush();
    expect(store.get('activities', id)).toBeTruthy();
  });
});

describe('typing amounts with a decimal comma', () => {
  it('reads "12,50" as twelve fifty, not twelve hundred fifty', async () => {
    const { parseMoney } = await import('../src/core/money.js');
    expect(parseMoney('12,50')).toBe(1250);
    expect(parseMoney('1.234,50')).toBe(123450);
    expect(parseMoney('0,5')).toBe(50);
    expect(parseMoney('€ 1 234,56')).toBe(123456);
    // Unchanged: a comma before three digits groups thousands.
    expect(parseMoney('1,234')).toBe(123400);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('12.5')).toBe(1250);
  });
});

describe('report export', () => {
  it('disables Export CSV when the report has nothing to export', async () => {
    const { node } = await mount(import('../src/views/reports.js'), { report: 'ledger' }, {});
    // No client chosen yet: the client ledger shows an empty state.
    expect(button(node, /Export CSV/).disabled).toBe(true);
    document.body.replaceChildren();
    const r = await mount(import('../src/views/reports.js'), { report: 'revenue' }, {});
    expect(button(r.node, /Export CSV/).disabled).toBe(false);
  });
});

describe('bill document on phones', () => {
  it('lets wide line tables scroll instead of being clipped by the card', async () => {
    const issued = app.store.all('bills').find((b) => b.status === 'issued' && b.lines.some((l) => l.kind === 'expense'));
    const { node } = await mount(import('../src/views/bill-detail.js'), { id: issued.id }, {});
    const tables = [...node.querySelectorAll('.bill-doc table.doc-table')];
    expect(tables.length).toBeGreaterThan(1);
    for (const t of tables) expect(t.parentElement.classList.contains('table-wrap-x')).toBe(true);
  });
});

describe('sent date', () => {
  it('shows the local day a bill was sent, not the UTC day', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const store = app.store;
      const bill = store.all('bills').find((b) => b.status === 'issued');
      // 9 pm on October 12 in New York is already October 13 in UTC.
      store.patch('bills', bill.id, { sentAt: '2026-10-13T01:00:00.000Z' });
      const { node } = await mount(import('../src/views/bill-detail.js'), { id: bill.id }, {});
      const { formatDate } = await import('../src/core/dates.js');
      expect(node.querySelector('.page-header').textContent).toContain(`Sent ${formatDate('2026-10-12')}`);
    } finally {
      process.env.TZ = tz;
      if (tz === undefined) delete process.env.TZ;
    }
  });
});
