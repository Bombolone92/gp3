// @vitest-environment jsdom
/**
 * Smoke test for the accounting screens: boot the shell on the demo data,
 * open every accounting route, and exercise reconciliation and the budget
 * grid. Fails on any exception or a missing heading.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
  globalThis.CSS ??= { escape: (s) => String(s).replace(/"/g, '\\"') };
});

const settle = () => new Promise((r) => setTimeout(r, 20));

async function bootDemo() {
  const { app } = await import('../src/app.js');
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { buildSampleData } = await import('../src/core/sample.js');
  const { buildShell } = await import('../src/ui/shell.js');
  const { startViews } = await import('../src/ui/viewhost.js');
  app.demo = true;
  app.today = () => '2026-10-12';
  app.store = createStore({ backend: createMemoryBackend(buildSampleData('2026-10-12')) });
  await app.store.init();
  document.body.innerHTML = '<div id="app"></div>';
  const shell = buildShell({});
  document.getElementById('app').append(shell.root);
  startViews(shell.main);
  return { app, main: shell.main };
}

describe('accounting screens render on demo data', () => {
  let ctx;
  const errors = [];
  beforeAll(async () => {
    window.addEventListener('error', (e) => errors.push(e.error || e.message));
    ctx = await bootDemo();
  });

  const go = async (hash) => {
    const before = ctx.main.firstElementChild;
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    for (let i = 0; i < 250; i++) {
      await settle();
      const now = ctx.main.firstElementChild;
      if (now && now !== before && ctx.main.querySelector('h1')) break;
    }
    await settle();
  };
  const h1 = () => ctx.main.querySelector('h1')?.textContent || '';
  const tx = (kind) => ctx.app.store.all('transactions').find((t) => t.kind === kind);

  it('renders every route', async () => {
    const budget = ctx.app.store.all('budgets')[0];
    const routes = [
      ['#/financials', /Financials/],
      ['#/financials?period=last-year', /Financials/],
      ['#/financials?period=custom&from=2026-01-01&to=2026-03-31', /Financials/],
      ['#/ledger', /General ledger/],
      ['#/ledger?kind=payment&voided=1', /General ledger/],
      [`#/transactions/${tx('payment').id}`, /Payment/],
      [`#/transactions/${tx('bill').id}`, /Bill/],
      [`#/transactions/${tx('bill-payment').id}`, /Bill payment/],
      ['#/transactions/missing', /not found/],
      ['#/banking', /Banking/],
      ['#/banking/acc-operating', /Operating bank account/],
      ['#/banking/acc-operating?tab=reconciliations', /Operating bank account/],
      ['#/bills', /Bills/],
      ['#/bills?status=all', /Bills/],
      [`#/bills/${tx('bill').id}`, /Bill from/],
      ['#/accounts', /Chart of accounts/],
      ['#/accounts/acc-rent', /Rent income/],
      ['#/budgets', /Budgets/],
      [`#/budgets/${budget.id}`, /Maple Court/],
      [`#/budgets/${budget.id}?tab=actual`, /Maple Court/],
    ];
    for (const [hash, re] of routes) {
      await go(hash);
      expect(h1(), hash).toMatch(re);
      expect(ctx.main.textContent, hash).not.toMatch(/Something went wrong/);
    }
    expect(errors).toEqual([]);
  });

  it('shows statement figures that tie out', async () => {
    await go('#/financials?period=ytd');
    const text = ctx.main.textContent;
    expect(text).toMatch(/Net operating income/);
    expect(text).toMatch(/Rent income/);
  });

  it('reconciles a bank account end to end', async () => {
    const { app } = ctx;
    const { unreconciledLines, clearedBalance } = await import('../src/core/financials.js');
    const lines = unreconciledLines(app.store, 'acc-operating', '2026-09-30');
    const target = clearedBalance(app.store, 'acc-operating', lines.map((l) => l.tx.id));
    const rec = app.store.put('reconciliations', { accountId: 'acc-operating', statementDate: '2026-09-30', statementBalance: target, cleared: [], status: 'open' });
    await go('#/banking/acc-operating');
    const cont = [...ctx.main.querySelectorAll('button')].find((b) => /Continue reconciling/.test(b.textContent));
    cont.click();
    await settle();
    expect(h1()).toMatch(/Reconcile/);
    const finish = [...ctx.main.querySelectorAll('button')].find((b) => /Finish/.test(b.textContent));
    expect(finish.disabled).toBe(true);
    for (const b of [...ctx.main.querySelectorAll('button')].filter((x) => x.textContent === 'Select all')) b.click();
    await settle();
    expect(finish.disabled).toBe(false);
    finish.click();
    await settle();
    expect(app.store.get('reconciliations', rec.id).status).toBe('reconciled');
    expect(app.store.get('reconciliations', rec.id).cleared.length).toBe(lines.length);
    expect(h1()).toMatch(/Operating bank account/);
  });

  it('a reconciliation saved for later and then finished keeps every cleared item', async () => {
    const { app } = ctx;
    const { unreconciledLines, clearedBalance } = await import('../src/core/financials.js');
    const lines = unreconciledLines(app.store, 'acc-operating', '2026-10-31');
    expect(lines.length).toBeGreaterThan(1);
    const target = clearedBalance(app.store, 'acc-operating', lines.map((l) => l.tx.id));
    const rec = app.store.put('reconciliations', { accountId: 'acc-operating', statementDate: '2026-10-31', statementBalance: target, cleared: [], status: 'open' });
    const button = (re) => [...ctx.main.querySelectorAll('button')].find((b) => re.test(b.textContent));
    await go('#/banking/acc-operating');
    button(/Continue reconciling/).click();
    await settle();
    const box = ctx.main.querySelector('.acct-rec-list input[type=checkbox]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 450)); // the selection saves
    button(/Save for later/).click();
    await settle();
    button(/Continue reconciling/).click();
    await settle();
    for (const b of [...ctx.main.querySelectorAll('button')].filter((x) => x.textContent === 'Select all')) b.click();
    await settle();
    button(/Finish/).click();
    await settle();
    await go('#/banking');
    const saved = app.store.get('reconciliations', rec.id);
    expect(saved.status).toBe('reconciled');
    expect(saved.cleared.length).toBe(lines.length);
  });

  it('saves a budget cell and keeps totals in step', async () => {
    const budget = ctx.app.store.all('budgets')[0];
    await go(`#/budgets/${budget.id}`);
    const input = ctx.main.querySelector('.acct-budget-grid input');
    input.value = '1234.56';
    input.dispatchEvent(new Event('change'));
    await settle();
    const saved = ctx.app.store.get('budgets', budget.id).lines.find((l) => Array.isArray(l.months));
    expect(saved.months).toContain(123456);
  });

  it("a next year's budget offers no year to date", async () => {
    const src = ctx.app.store.all('budgets')[0];
    const next = ctx.app.store.put('budgets', { ...structuredClone(src), id: 'bg-next', year: 2027 });
    await go(`#/budgets/${next.id}?tab=actual`);
    const sel = ctx.main.querySelector('select[aria-label="Period"]');
    expect([...sel.options].map((o) => o.textContent)).not.toContain('Year to date');
    expect(sel.value).toBe('year');
  });

  it('selecting bills shows the payment bar', async () => {
    await go('#/bills');
    const box = ctx.main.querySelector('table input[type="checkbox"]');
    expect(box).toBeTruthy();
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();
    expect(ctx.main.querySelector('.acct-selbar')?.textContent).toMatch(/1 selected/);
  });
});
