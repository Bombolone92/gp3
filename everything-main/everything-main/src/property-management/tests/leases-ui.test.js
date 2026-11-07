// @vitest-environment jsdom
/**
 * Smoke test for the lease screens and transaction dialogs: boot the shell
 * on the sample portfolio, render each route, then fill and submit the main
 * dialogs and check the ledger moved as expected.
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
  window.print = () => {};
});

const TODAY = '2026-10-12';
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

let ctx;
async function boot() {
  const { app } = await import('../src/app.js');
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { buildSampleData } = await import('../src/core/sample.js');
  const { buildShell } = await import('../src/ui/shell.js');
  const { startViews } = await import('../src/ui/viewhost.js');
  app.demo = true;
  app.today = () => TODAY;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(TODAY)), flushDelay: 0, timeoutMs: 0 });
  await app.store.init();
  document.body.innerHTML = '<div id="app"></div>';
  const shell = buildShell({});
  document.getElementById('app').append(shell.root);
  startViews(shell.main);
  return { app, main: shell.main, store: app.store };
}

async function go(hash) {
  const before = ctx.main.firstElementChild;
  location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  for (let i = 0; i < 250; i++) {
    await settle();
    const now = ctx.main.firstElementChild;
    if (now && now !== before && ctx.main.querySelector('h1')) break;
  }
  await settle();
}

const openDialogEl = () => [...document.querySelectorAll('dialog[open]')].pop();
const setMoney = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
async function submitDialog() {
  const dlg = openDialogEl();
  dlg.querySelector('.dialog-foot .btn.primary').click();
  await settle(30);
}

/** Fill the new lease form for a fresh unit and save it; returns the lease. */
async function createLease({ start, button = 'primary', extra = () => {} } = {}) {
  const prop = ctx.store.all('properties').find((p) => !p.singleUnit);
  const unit = ctx.store.put('units', { propertyId: prop.id, name: `T${ctx.store.all('units').length}`, marketRent: 120000 });
  await go(`#/leases/new?unitId=${unit.id}`);
  const form = ctx.main.querySelector('form.lf-form');
  [...form.querySelectorAll('button')].find((b) => /Add a new tenant/.test(b.textContent)).click();
  const row = form.querySelector('.lf-new-tenant');
  row.querySelector('input[autocomplete="given-name"]').value = 'Pat';
  row.querySelector('input[autocomplete="family-name"]').value = `Lee ${unit.name}`;
  const startInput = [...form.querySelectorAll('input[type="date"]')].find((i) => i.required);
  startInput.value = start;
  startInput.dispatchEvent(new Event('change'));
  extra(form);
  const count = ctx.store.all('leases').length;
  const btn = button === 'primary' ? ctx.main.querySelector('.lf-actions .btn.primary') : [...ctx.main.querySelectorAll('.lf-actions .btn')].find((b) => b.textContent === button);
  btn.click();
  for (let i = 0; i < 50 && ctx.store.all('leases').length === count; i++) await settle();
  await settle();
  return ctx.store.all('leases').find((l) => l.unitId === unit.id);
}

describe('lease screens', () => {
  beforeAll(async () => {
    ctx = await boot();
  });

  const activeLease = () => {
    const { leaseStatus } = ctx.leasesMod;
    return ctx.store.all('leases').find((l) => leaseStatus(l, TODAY) === 'active');
  };

  beforeAll(async () => {
    ctx.leasesMod = await import('../src/core/leases.js');
    ctx.dialogs = await import('../src/views/transactions/dialogs.js');
  });

  it('renders the rent roll with filters and totals', async () => {
    await go('#/leases');
    expect(ctx.main.querySelector('h1').textContent).toBe('Rent roll');
    expect(ctx.main.querySelectorAll('tbody tr').length).toBeGreaterThan(10);
    await go('#/leases?status=expiring');
    expect(ctx.main.querySelector('[aria-pressed="true"]').textContent).toMatch(/Expiring/);
  });

  it('renders outstanding balances with aging', async () => {
    await go('#/balances');
    expect(ctx.main.querySelector('h1').textContent).toBe('Outstanding balances');
    expect(ctx.main.querySelector('tfoot')).toBeTruthy();
  });

  it('renders every tab of a lease', async () => {
    const l = activeLease();
    for (const tab of ['', '?tab=ledger', '?tab=tenants', '?tab=notes', '?tab=files']) {
      await go(`#/leases/${l.id}${tab}`);
      expect(ctx.main.querySelector('h1').textContent.length).toBeGreaterThan(0);
      expect(ctx.main.querySelector('[role="tabpanel"]')).toBeTruthy();
    }
    await go(`#/leases/${l.id}?tab=ledger`);
    expect(ctx.main.querySelectorAll('.ls-ledger tbody tr').length).toBeGreaterThan(2);
  });

  it('renders the new, edit and renewal forms', async () => {
    await go('#/leases/new');
    expect(ctx.main.querySelector('h1').textContent).toBe('New lease');
    const l = activeLease();
    await go(`#/leases/${l.id}/edit`);
    expect(ctx.main.querySelector('h1').textContent).toBe('Edit lease');
    await go(`#/leases/new?renews=${l.id}`);
    expect(ctx.main.querySelector('h1').textContent).toBe('Renew lease');
  });

  it('receives a payment for the full balance', async () => {
    const owing = ctx.store.all('leases').find((l) => ctx.app.ledger().lease(l.id).balance > 0);
    const before = ctx.app.ledger().lease(owing.id).balance;
    expect(before).toBeGreaterThan(0);
    const p = ctx.dialogs.receivePaymentDialog({ leaseId: owing.id });
    await settle();
    await submitDialog();
    const tx = await p;
    expect(tx.kind).toBe('payment');
    expect(ctx.app.ledger().lease(owing.id).balance).toBe(0);
  });

  it('enters a charge', async () => {
    const l = activeLease();
    const before = ctx.app.ledger().lease(l.id).balance;
    const p = ctx.dialogs.chargeDialog({ leaseId: l.id });
    await settle();
    setMoney(openDialogEl().querySelector('.tx-row:not(.tx-row-head) .input.num'), '45.50');
    await submitDialog();
    await p;
    expect(ctx.app.ledger().lease(l.id).balance).toBe(before + 4550);
  });

  it('records a bill and pays it', async () => {
    const vendor = ctx.store.all('vendors')[0];
    const p = ctx.dialogs.billDialog({ vendorId: vendor.id, propertyId: ctx.store.all('properties')[0].id });
    await settle();
    setMoney(openDialogEl().querySelector('.tx-row-expense:not(.tx-row-head) .input.num'), '120');
    await submitDialog();
    const bill = await p;
    expect(bill.kind).toBe('bill');
    expect(ctx.app.ledger().bill(bill.id).balance).toBe(12000);

    const q = ctx.dialogs.payBillsDialog({ billIds: [bill.id] });
    await settle();
    await submitDialog();
    await q;
    expect(ctx.app.ledger().bill(bill.id).balance).toBe(0);
  });

  it('pays only the bills shown, not ones a vendor filter hides', async () => {
    const vendors = ctx.store.all('vendors');
    const [va, vb] = vendors;
    const prop = ctx.store.all('properties')[0].id;
    const mkBill = async (vendorId) => {
      const p = ctx.dialogs.billDialog({ vendorId, propertyId: prop });
      await settle();
      setMoney(openDialogEl().querySelector('.tx-row-expense:not(.tx-row-head) .input.num'), '50');
      await submitDialog();
      return p;
    };
    const billA = await mkBill(va.id);
    const billB = await mkBill(vb.id);
    const q = ctx.dialogs.payBillsDialog({ vendorId: va.id });
    await settle();
    const dlg = openDialogEl();
    const filter = dlg.querySelector('select[aria-label="Vendor"]');
    filter.value = vb.id;
    filter.dispatchEvent(new Event('change'));
    const box = [...dlg.querySelectorAll('tbody input[type=checkbox]')].find((b) => b.closest('tr').querySelector('.num').textContent && b.closest('tr').textContent.includes('50.00'));
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await submitDialog();
    await q;
    expect(ctx.app.ledger().bill(billB.id).balance).toBe(0);
    expect(ctx.app.ledger().bill(billA.id).balance).toBe(5000);
  });

  it("changing a bill's date keeps the due date it was given", async () => {
    const { buildBill } = await import('../src/core/ledger.js');
    const { ACC } = await import('../src/core/accounts.js');
    const bill = ctx.store.put('transactions', buildBill({ vendorId: ctx.store.all('vendors')[0].id, date: '2026-10-12', dueDate: '2026-10-20', items: [{ accountId: ACC.repairs, amount: 4000, propertyId: ctx.store.all('properties')[0].id }] }));
    const p = ctx.dialogs.billDialog({ billId: bill.id });
    await settle();
    const dates = openDialogEl().querySelectorAll('input[type=date]');
    dates[0].value = '2026-10-05';
    dates[0].dispatchEvent(new Event('change'));
    expect(dates[1].value).toBe('2026-10-20');
    await submitDialog();
    await p;
    expect(ctx.store.get('transactions', bill.id)).toMatchObject({ date: '2026-10-05', dueDate: '2026-10-20' });
  });

  it('editing a journal entry made for a lease keeps it linked to the lease', async () => {
    const { ACC } = await import('../src/core/accounts.js');
    const l = activeLease();
    const je = ctx.store.put('transactions', {
      kind: 'journal',
      date: TODAY,
      memo: 'Deposit moved',
      ref: '',
      leaseId: l.id,
      propertyId: l.propertyId,
      lines: [
        { accountId: ACC.depositsHeld, amount: 100, propertyId: l.propertyId, leaseId: l.id },
        { accountId: ACC.depositsHeld, amount: -100, propertyId: l.propertyId, leaseId: l.id },
      ],
    });
    const p = ctx.dialogs.journalDialog({ txId: je.id });
    await settle();
    openDialogEl().querySelector('input[placeholder="What this entry records"]').value = 'Deposit moved (fixed)';
    await submitDialog();
    await p;
    expect(ctx.store.get('transactions', je.id)).toMatchObject({ memo: 'Deposit moved (fixed)', leaseId: l.id, propertyId: l.propertyId });
  });

  it("a journal entry's debit and credit fields say which is which", async () => {
    const p = ctx.dialogs.journalDialog();
    await settle();
    const dlg = openDialogEl();
    const row = dlg.querySelector('.tx-row-journal:not(.tx-row-head)');
    expect([...row.querySelectorAll('.input.num')].map((i) => i.placeholder)).toEqual(['Debit', 'Credit']);
    dlg.querySelector('.dialog-foot .btn:not(.primary)')?.click();
    await Promise.race([p, settle(50)]);
  });

  it('refuses an unbalanced journal entry and saves a balanced one', async () => {
    const { ACC } = await import('../src/core/accounts.js');
    const p = ctx.dialogs.journalDialog();
    await settle();
    const dlg = openDialogEl();
    dlg.querySelector('input[placeholder="What this entry records"]').value = 'Correction';
    const rows = dlg.querySelectorAll('.tx-row-journal:not(.tx-row-head)');
    rows[0].querySelector('select').value = ACC.operating;
    rows[1].querySelector('select').value = ACC.rent;
    const [d0] = rows[0].querySelectorAll('.input.num');
    const [, c1] = rows[1].querySelectorAll('.input.num');
    setMoney(d0, '10');
    setMoney(c1, '9');
    await submitDialog();
    expect(openDialogEl()).toBeTruthy();
    expect(openDialogEl().querySelector('.tx-error').hidden).toBe(false);
    setMoney(c1, '10');
    await submitDialog();
    const tx = await p;
    expect(tx.kind).toBe('journal');
  });

  it('voids and restores a transaction', async () => {
    const pay = ctx.store.all('transactions').find((t) => t.kind === 'payment' && t.leaseId);
    const before = ctx.app.ledger().lease(pay.leaseId).balance;
    const v = ctx.dialogs.voidTransaction(pay.id);
    await settle();
    openDialogEl().querySelector('.dialog-foot .btn:last-child').click();
    await v;
    expect(ctx.store.get('transactions', pay.id).voided).toBe(true);
    expect(ctx.app.ledger().lease(pay.leaseId).balance).toBeGreaterThan(before);
    await ctx.dialogs.voidTransaction(pay.id);
    expect(ctx.app.ledger().lease(pay.leaseId).balance).toBe(before);
  });

  it('builds a printable receipt', () => {
    const pay = ctx.store.all('transactions').find((t) => t.kind === 'payment' && t.leaseId && !t.voided);
    const node = ctx.dialogs.receiptNode(pay);
    expect(node.textContent).toMatch(/Payment receipt/);
    ctx.dialogs.printReceipt(pay.id);
    expect(document.getElementById('print-root')).toBeTruthy();
  });

  it('a lease entered after it began is charged from this month, not back-billed', async () => {
    const lease = await createLease({ start: '2026-06-15' });
    expect(lease).toBeTruthy();
    const rent = ctx.store.all('transactions').filter((t) => t.leaseId === lease.id && t.kind === 'charge' && t.lines.some((l) => l.forAccountId === 'acc-rent'));
    expect(rent.map((t) => t.date)).toEqual(['2026-10-01']);
    // No late fees for the months before charging began.
    const fees = ctx.store.all('transactions').filter((t) => t.leaseId === lease.id && t.id.startsWith('lf-'));
    expect(fees.filter((t) => t.id < `lf-${lease.id}-2026-10`)).toEqual([]);
  });

  it('editing a payment deposited to a deactivated bank keeps that bank', async () => {
    const pay = ctx.store.all('transactions').find((t) => t.kind === 'payment' && !t.voided && t.bankAccountId);
    const bankId = pay.bankAccountId;
    ctx.store.patch('accounts', bankId, { active: false });
    try {
      const p = ctx.dialogs.receivePaymentDialog({ txId: pay.id });
      await settle();
      await submitDialog();
      await p;
      const saved = ctx.store.get('transactions', pay.id);
      expect(saved.lines.every((l) => l.accountId)).toBe(true);
      expect(saved.lines.find((l) => l.amount > 0).accountId).toBe(bankId);
    } finally {
      ctx.store.patch('accounts', bankId, { active: true });
    }
  });

  it("a new payment falls back to an active bank when the property's bank is gone", async () => {
    const l = activeLease();
    const prop = ctx.store.get('properties', l.propertyId);
    ctx.store.patch('properties', prop.id, { bankAccountId: 'acc-deleted' });
    try {
      const p = ctx.dialogs.receivePaymentDialog({ leaseId: l.id });
      await settle();
      setMoney(openDialogEl().querySelector('.input.num'), '10');
      await submitDialog();
      const tx = await p;
      expect(tx.lines.every((x) => x.accountId)).toBe(true);
      expect(tx.bankAccountId).toBe(ctx.app.settings().accounting.defaultBankId);
    } finally {
      ctx.store.patch('properties', prop.id, { bankAccountId: prop.bankAccountId });
    }
  });

  it("a new payment uses the default bank from settings when the property has none", async () => {
    const l = activeLease();
    const prop = ctx.store.get('properties', l.propertyId);
    const before = ctx.app.settings().accounting.defaultBankId;
    ctx.store.patch('properties', prop.id, { bankAccountId: null });
    ctx.store.saveSettings({ accounting: { defaultBankId: 'acc-deposits' } });
    try {
      const p = ctx.dialogs.receivePaymentDialog({ leaseId: l.id });
      await settle();
      expect(openDialogEl().querySelector('select[name=bankAccountId]').value).toBe('acc-deposits');
      openDialogEl().querySelector('.dialog-foot .btn:not(.primary)')?.click();
      await Promise.race([p, settle(50)]);
    } finally {
      ctx.store.patch('properties', prop.id, { bankAccountId: prop.bankAccountId });
      ctx.store.saveSettings({ accounting: { defaultBankId: before } });
    }
  });

  it('editing a charge for a deactivated account keeps the account', async () => {
    const { ACC } = await import('../src/core/accounts.js');
    const l = activeLease();
    const p = ctx.dialogs.chargeDialog({ leaseId: l.id, items: [{ accountId: ACC.lateFees, amount: 2500 }] });
    await settle();
    await submitDialog();
    const charge = await p;
    ctx.store.patch('accounts', ACC.lateFees, { active: false });
    try {
      const q = ctx.dialogs.chargeDialog({ txId: charge.id });
      await settle();
      await submitDialog();
      await q;
      const saved = ctx.store.get('transactions', charge.id);
      expect(saved.lines.map((x) => x.accountId)).toEqual([ACC.ar, ACC.lateFees]);
      expect(saved.lines[0].forAccountId).toBe(ACC.lateFees);
    } finally {
      ctx.store.patch('accounts', ACC.lateFees, { active: true });
    }
  });

  it('activating a draft renewal ends the old lease and moves its deposit', async () => {
    const { ACC } = await import('../src/core/accounts.js');
    const old = ctx.store.all('leases').find((l) => !l.draft && !l.renewedByLeaseId && l.type === 'fixed-rollover' && l.end > TODAY && ctx.app.ledger().lease(l.id).deposits > 0 && !ctx.store.all('leases').some((x) => x.renewsLeaseId === l.id));
    const held = ctx.app.ledger().lease(old.id).deposits;
    await go(`#/leases/new?renews=${old.id}`);
    const count = ctx.store.all('leases').length;
    [...ctx.main.querySelectorAll('.lf-actions .btn')].find((b) => b.textContent === 'Save as draft').click();
    for (let i = 0; i < 50 && ctx.store.all('leases').length === count; i++) await settle();
    const draft = ctx.store.all('leases').find((l) => l.renewsLeaseId === old.id);
    expect(draft.draft).toBe(true);
    await go(`#/leases/${draft.id}/edit`);
    ctx.main.querySelector('.lf-actions .btn.primary').click();
    for (let i = 0; i < 50 && ctx.store.get('leases', draft.id).draft; i++) await settle();
    await settle();
    const before = ctx.store.get('leases', old.id);
    expect(before.renewedByLeaseId).toBe(draft.id);
    expect(before.type).toBe('fixed');
    expect(before.end < draft.start).toBe(true);
    // The deposit moved over instead of being charged a second time.
    expect(ctx.app.ledger().lease(draft.id).deposits).toBe(held);
    const depositCharges = ctx.store.all('transactions').filter((t) => t.leaseId === draft.id && t.kind === 'charge' && t.lines.some((l) => l.forAccountId === ACC.depositsHeld));
    expect(depositCharges).toEqual([]);
  });

  it("activating an applicant's draft lease marks the applicant converted", async () => {
    const applicant = ctx.store.put('applicants', { firstName: 'Ava', lastName: 'Draft', status: 'approved', email: 'ava@example.com' });
    const prop = ctx.store.all('properties').find((p) => !p.singleUnit);
    const unit = ctx.store.put('units', { propertyId: prop.id, name: 'AP1', marketRent: 100000 });
    await go(`#/leases/new?applicantId=${applicant.id}&unitId=${unit.id}`);
    const count = ctx.store.all('leases').length;
    [...ctx.main.querySelectorAll('.lf-actions .btn')].find((b) => b.textContent === 'Save as draft').click();
    for (let i = 0; i < 50 && ctx.store.all('leases').length === count; i++) await settle();
    const draft = ctx.store.all('leases').find((l) => l.unitId === unit.id);
    expect(ctx.store.get('applicants', applicant.id).status).toBe('approved');
    await go(`#/leases/${draft.id}/edit`);
    expect(ctx.main.querySelectorAll('.lf-new-tenant').length).toBe(0);
    ctx.main.querySelector('.lf-actions .btn.primary').click();
    for (let i = 0; i < 50 && ctx.store.get('leases', draft.id).draft; i++) await settle();
    expect(ctx.store.get('applicants', applicant.id)).toMatchObject({ status: 'converted', leaseId: draft.id });
  });

  it('a lease that began last month is not charged a prorated part of that month', async () => {
    const lease = await createLease({ start: '2026-09-15' });
    const rent = ctx.store.all('transactions').filter((t) => t.leaseId === lease.id && t.kind === 'charge' && t.lines.some((l) => l.forAccountId === 'acc-rent'));
    expect(rent.map((t) => t.date)).toEqual(['2026-10-01']);
  });

  it('a draft with prorated first-month rent charges it when activated', async () => {
    const lease = await createLease({ start: '2026-10-20', button: 'Save as draft' });
    expect(lease.recurring.find((r) => r.accountId === 'acc-rent').start).toBe('2026-11-01');
    await go(`#/leases/${lease.id}/edit`);
    ctx.main.querySelector('.lf-actions .btn.primary').click();
    for (let i = 0; i < 50 && ctx.store.get('leases', lease.id).draft; i++) await settle();
    const prorated = ctx.store.all('transactions').filter((t) => t.leaseId === lease.id && t.kind === 'charge' && t.date === '2026-10-20' && t.lines.some((l) => l.forAccountId === 'acc-rent'));
    expect(prorated).toHaveLength(1);
  });

  it("moving a draft's start date moves when rent starts", async () => {
    const lease = await createLease({ start: '2026-11-01', button: 'Save as draft' });
    expect(lease.draft).toBe(true);
    await go(`#/leases/${lease.id}/edit`);
    const startInput = [...ctx.main.querySelectorAll('form.lf-form input[type="date"]')].find((i) => i.required);
    startInput.value = '2027-01-01';
    startInput.dispatchEvent(new Event('change'));
    ctx.main.querySelector('.lf-actions .btn.primary').click();
    for (let i = 0; i < 50 && ctx.store.get('leases', lease.id).draft; i++) await settle();
    const rent = ctx.store.get('leases', lease.id).recurring.find((r) => r.accountId === 'acc-rent');
    expect(rent.start).toBe('2027-01-01');
  });

  it('clicking Save lease twice creates one lease', async () => {
    const next = ctx.store.nextNumber;
    ctx.store.nextNumber = (c) => new Promise((r) => setTimeout(() => r(next(c)), 80));
    let unitId;
    try {
      const lease = await createLease({
        start: '2026-11-01',
        extra: () => {
          unitId = new URLSearchParams(location.hash.split('?')[1]).get('unitId');
          ctx.main.querySelector('.lf-actions .btn.primary').click();
        },
      });
      expect(lease).toBeTruthy();
      await settle(150);
    } finally {
      ctx.store.nextNumber = next;
    }
    expect(ctx.store.all('leases').filter((l) => l.unitId === unitId)).toHaveLength(1);
  });

  it('saving a lease form opened before charges posted keeps what was posted', async () => {
    const l = activeLease();
    await go(`#/leases/${l.id}/edit`);
    const rentItem = ctx.store.get('leases', l.id).recurring.find((r) => r.accountId === 'acc-rent');
    // Posting runs while the form is open.
    ctx.store.patch('leases', l.id, (x) => ((x.recurring.find((r) => r.id === rentItem.id).postedThrough = '2026-11-01'), (x.lateFeesThrough = '2026-11'), x));
    ctx.main.querySelector('.lf-actions .btn.primary').click();
    for (let i = 0; i < 20; i++) await settle();
    const saved = ctx.store.get('leases', l.id);
    expect(saved.recurring.find((r) => r.id === rentItem.id).postedThrough).toBe('2026-11-01');
    expect(saved.lateFeesThrough).toBe('2026-11');
  });

  it('refuses to apply more of a payment to a charge than is owed on it', async () => {
    const owing = ctx.store.all('leases').find((l) => ctx.app.ledger().lease(l.id).balance > 0);
    const p = ctx.dialogs.receivePaymentDialog({ leaseId: owing.id });
    await settle();
    const dlg = openDialogEl();
    const [amount] = dlg.querySelectorAll('.input.num');
    const row = dlg.querySelector('.tx-apply-table tbody tr');
    const due = row.querySelector('td.r .num').textContent;
    setMoney(amount, '99999');
    for (const input of dlg.querySelectorAll('.tx-apply-table tbody input')) setMoney(input, '0');
    setMoney(row.querySelector('input'), '99999');
    await submitDialog();
    expect(openDialogEl()).toBe(dlg);
    expect(dlg.querySelector('.tx-error').textContent).toContain(`is owed ${due}`);
    expect(row.querySelector('input').getAttribute('aria-invalid')).toBe('true');
    dlg.querySelector('.dialog-foot .btn:not(.primary)')?.click();
    await settle();
    await Promise.race([p, settle(50)]);
  });

  it('editing a refund to come from the deposit allows only what the deposit holds', async () => {
    const { ACC } = await import('../src/core/accounts.js');
    const { buildPayment, buildRefund } = await import('../src/core/ledger.js');
    const l = ctx.store.all('leases').find((x) => !x.draft && ctx.app.ledger().lease(x.id).deposits > 0 && ctx.app.ledger().lease(x.id).prepaid === 0);
    const held = ctx.app.ledger().lease(l.id).deposits;
    ctx.store.put('transactions', buildPayment({ lease: l, date: TODAY, amount: 30000, allocations: [] }));
    const refund = ctx.store.put('transactions', buildRefund({ lease: l, date: TODAY, amount: 30000, fromAccountId: ACC.prepaid }));
    const p = ctx.dialogs.refundDialog({ txId: refund.id });
    await settle();
    const dlg = openDialogEl();
    [...dlg.querySelectorAll('[role=radio]')].find((b) => /deposit/i.test(b.textContent)).click();
    await settle();
    setMoney(dlg.querySelector('.input.num'), String((held + 30000) / 100));
    await submitDialog();
    expect(openDialogEl()).toBe(dlg);
    expect(ctx.app.ledger().lease(l.id).deposits).toBe(held);
    dlg.querySelector('.dialog-foot .btn:not(.primary)')?.click();
    await Promise.race([p, settle(50)]);
  });

  it("a payment whose prepaid rent was used can't be cut below it or voided", async () => {
    const { ACC } = await import('../src/core/accounts.js');
    const { buildPayment, buildCharge, buildApplyPrepayment } = await import('../src/core/ledger.js');
    const l = ctx.store.all('leases').find((x) => !x.draft && ctx.app.ledger().lease(x.id).prepaid === 0 && ctx.app.ledger().lease(x.id).balance <= 0);
    const pay = ctx.store.put('transactions', buildPayment({ lease: l, date: TODAY, amount: 50000, allocations: [] }));
    ctx.store.put('transactions', buildCharge({ lease: l, date: TODAY, items: [{ accountId: ACC.rent, amount: 50000 }] }));
    ctx.store.put('transactions', buildApplyPrepayment({ lease: l, date: TODAY, items: [{ accountId: ACC.rent, amount: 50000 }] }));
    const p = ctx.dialogs.receivePaymentDialog({ txId: pay.id });
    await settle();
    const dlg = openDialogEl();
    setMoney(dlg.querySelector('.input.num'), '100');
    await submitDialog();
    expect(openDialogEl()).toBe(dlg);
    expect(dlg.querySelector('.tx-error').textContent).toMatch(/prepaid rent/);
    dlg.querySelector('.dialog-foot .btn:not(.primary)')?.click();
    await Promise.race([p, settle(50)]);
    const v = ctx.dialogs.voidTransaction(pay.id);
    await settle();
    expect(openDialogEl().textContent).toMatch(/can't be voided yet/);
    openDialogEl().querySelector('.dialog-foot .btn.primary').click();
    await v;
    expect(ctx.store.get('transactions', pay.id).voided).toBeFalsy();
    expect(ctx.app.ledger().lease(l.id).prepaid).toBe(0);
  });

  it('a payment still saves unchanged after a later credit on the charge it paid', async () => {
    const { ACC } = await import('../src/core/accounts.js');
    const { buildPayment, buildCharge, buildCredit } = await import('../src/core/ledger.js');
    const l = activeLease();
    ctx.store.put('transactions', buildCharge({ lease: l, date: TODAY, items: [{ accountId: ACC.lateFees, amount: 5000 }] }));
    const pay = ctx.store.put('transactions', buildPayment({ lease: l, date: TODAY, amount: 5000, allocations: [{ accountId: ACC.lateFees, amount: 5000 }] }));
    ctx.store.put('transactions', buildCredit({ lease: l, date: TODAY, items: [{ accountId: ACC.lateFees, amount: 2000 }] }));
    const p = ctx.dialogs.receivePaymentDialog({ txId: pay.id });
    await settle();
    const dlg = openDialogEl();
    dlg.querySelector('input[placeholder="Shown on the receipt"]').value = 'Check 1042';
    await submitDialog();
    expect(openDialogEl()).toBeFalsy();
    await p;
    const saved = ctx.store.get('transactions', pay.id);
    expect(saved.memo).toBe('Check 1042');
    expect(saved.lines.find((x) => x.accountId === ACC.ar)).toMatchObject({ forAccountId: ACC.lateFees, amount: -5000 });
  });

  it("a paid charge can't be edited below what was paid on it", async () => {
    const { ACC } = await import('../src/core/accounts.js');
    const { buildPayment, buildCharge } = await import('../src/core/ledger.js');
    const l = activeLease();
    const charge = ctx.store.put('transactions', buildCharge({ lease: l, date: TODAY, items: [{ accountId: ACC.lateFees, amount: 10000 }] }));
    ctx.store.put('transactions', buildPayment({ lease: l, date: TODAY, amount: 10000, allocations: [{ accountId: ACC.lateFees, amount: 10000 }] }));
    const p = ctx.dialogs.chargeDialog({ txId: charge.id });
    await settle();
    const dlg = openDialogEl();
    setMoney(dlg.querySelector('.tx-row:not(.tx-row-head) .input.num'), '10');
    await submitDialog();
    expect(openDialogEl()).toBe(dlg);
    expect(dlg.querySelector('.tx-error').textContent).toMatch(/already paid/);
    dlg.querySelector('.dialog-foot .btn:not(.primary)')?.click();
    await Promise.race([p, settle(50)]);
    expect(ctx.store.get('transactions', charge.id).lines[0].amount).toBe(10000);
  });

  it('deleting a renewal puts the lease it renewed back as it was', async () => {
    const old = ctx.store.all('leases').find((l) => !l.draft && !l.renewedByLeaseId && l.type === 'fixed-rollover' && l.end > TODAY && !ctx.store.all('leases').some((x) => x.renewsLeaseId === l.id));
    const snapshot = structuredClone(ctx.store.get('leases', old.id));
    await go(`#/leases/new?renews=${old.id}`);
    // No deposit move, so the renewal has no transactions and can be deleted.
    const carry = [...ctx.main.querySelectorAll('label.check')].find((x) => /Move the/.test(x.textContent))?.querySelector('input');
    if (carry) carry.checked = false;
    const count = ctx.store.all('leases').length;
    ctx.main.querySelector('.lf-actions .btn.primary').click();
    for (let i = 0; i < 50 && ctx.store.all('leases').length === count; i++) await settle();
    const renewal = ctx.store.all('leases').find((l) => l.renewsLeaseId === old.id);
    expect(ctx.store.get('leases', old.id).renewedByLeaseId).toBe(renewal.id);
    expect(ctx.store.all('transactions').some((t) => t.leaseId === renewal.id)).toBe(false);
    await go(`#/leases/${renewal.id}`);
    ctx.main.querySelector('button[aria-label="More actions"], .more-btn')?.click();
    await settle();
    [...document.querySelectorAll('.menu-item, [role=menuitem]')].find((x) => /Delete lease/.test(x.textContent)).click();
    await settle();
    openDialogEl().querySelector('.dialog-foot .btn.primary, .btn.danger').click();
    for (let i = 0; i < 20 && ctx.store.get('leases', renewal.id); i++) await settle();
    expect(ctx.store.get('leases', renewal.id)).toBe(null);
    const back = ctx.store.get('leases', old.id);
    expect(back).toMatchObject({ type: snapshot.type, end: snapshot.end });
    expect(back.renewedByLeaseId).toBeUndefined();
    expect(back.recurring.map((r) => r.end ?? null)).toEqual(snapshot.recurring.map((r) => r.end ?? null));
  });

  it("deleting an applicant's lease puts the applicant back to approved", async () => {
    const applicant = ctx.store.put('applicants', { firstName: 'Cleo', lastName: 'Undo', status: 'approved' });
    const prop = ctx.store.all('properties').find((p) => !p.singleUnit);
    const unit = ctx.store.put('units', { propertyId: prop.id, name: 'AP2', marketRent: 100000 });
    await go(`#/leases/new?applicantId=${applicant.id}&unitId=${unit.id}`);
    const startInput = [...ctx.main.querySelectorAll('form.lf-form input[type="date"]')].find((i) => i.required);
    startInput.value = '2026-12-01';
    startInput.dispatchEvent(new Event('change'));
    const count = ctx.store.all('leases').length;
    ctx.main.querySelector('.lf-actions .btn.primary').click();
    for (let i = 0; i < 50 && ctx.store.all('leases').length === count; i++) await settle();
    const lease = ctx.store.all('leases').find((l) => l.unitId === unit.id);
    expect(ctx.store.get('applicants', applicant.id).status).toBe('converted');
    // Remove what was charged, so the lease can be deleted.
    for (const t of ctx.store.all('transactions').filter((x) => x.leaseId === lease.id)) ctx.store.remove('transactions', t.id);
    await go(`#/leases/${lease.id}`);
    ctx.main.querySelector('button[aria-label="More actions"]').click();
    await settle();
    [...document.querySelectorAll('[role=menuitem]')].find((x) => /Delete lease/.test(x.textContent)).click();
    await settle();
    openDialogEl().querySelector('.dialog-foot .btn.primary, .btn.danger').click();
    for (let i = 0; i < 20 && ctx.store.get('leases', lease.id); i++) await settle();
    expect(ctx.store.get('applicants', applicant.id)).toMatchObject({ status: 'approved', leaseId: null });
  });

  it('Escape in a picker inside a dialog closes the suggestions, not the dialog', async () => {
    const p = ctx.dialogs.receivePaymentDialog({});
    await settle();
    const dlg = openDialogEl();
    const input = dlg.querySelector('.combo input');
    input.value = 'a';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('focus'));
    await settle(150);
    expect(dlg.querySelector('.combo [role=listbox]').hidden).toBe(false);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(esc);
    // An Escape left uncancelled is what makes the browser close a modal dialog.
    expect(esc.defaultPrevented).toBe(true);
    expect(dlg.querySelector('.combo [role=listbox]').hidden).toBe(true);
    dlg.querySelector('.dialog-foot .btn:not(.primary)')?.click();
    await Promise.race([p, settle(50)]);
  });

  it('creates a lease with a new tenant, deposit and first charges', async () => {
    const { occupancy } = ctx.leasesMod;
    const occ = occupancy(ctx.store.all('leases'), TODAY);
    const vacant = ctx.store.all('units').find((u) => !occ.has(u.id) && !ctx.store.all('leases').some((l) => l.unitId === u.id && l.start > TODAY));
    await go(`#/leases/new?unitId=${vacant.id}`);
    const form = ctx.main.querySelector('form.lf-form');
    const newTenantBtn = [...form.querySelectorAll('button')].find((b) => /Add a new tenant/.test(b.textContent));
    newTenantBtn.click();
    const row = form.querySelector('.lf-new-tenant');
    row.querySelector('input[autocomplete="given-name"]').value = 'Test';
    row.querySelector('input[autocomplete="family-name"]').value = 'Person';
    const startInput = [...form.querySelectorAll('input[type="date"]')].find((i) => i.required);
    startInput.value = '2026-10-01';
    startInput.dispatchEvent(new Event('change'));
    const count = ctx.store.all('leases').length;
    [...ctx.main.querySelectorAll('.lf-actions .btn.primary')][0].click();
    for (let i = 0; i < 50 && ctx.store.all('leases').length === count; i++) await settle();
    const lease = ctx.store.all('leases').find((l) => l.unitId === vacant.id && l.start === '2026-10-01');
    expect(lease).toBeTruthy();
    expect(ctx.store.get('tenants', lease.tenantIds[0]).lastName).toBe('Person');
    const charges = ctx.store.all('transactions').filter((t) => t.leaseId === lease.id && t.kind === 'charge');
    expect(charges.some((t) => t.lines.some((l) => l.forAccountId === 'acc-deposits-held'))).toBe(true);
    expect(charges.some((t) => t.date === '2026-10-01' && t.auto)).toBe(true);
  });
});
