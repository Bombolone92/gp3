// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';

const TODAY = '2026-10-12';
const tick = () => new Promise((r) => setTimeout(r, 0));

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
  document.body.replaceChildren();
  app.demo = true;
  app.today = () => TODAY;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(TODAY)), flushDelay: 0 });
  await app.store.init();
});

describe('trust dialog', () => {
  it('refuses a withdrawal dated before the matter had the funds', async () => {
    const { openTrustDialog } = await import('../src/views/money-dialogs.js');
    const trust = app.store.all('accounts').find((a) => a.type === 'trust');
    const firstDeposit = app.store
      .all('transactions')
      .filter((t) => t.matterId === 'm-6' && t.accountId === trust.id)
      .map((t) => t.date)
      .sort()[0];
    expect(firstDeposit > '2026-07-01').toBe(true);
    const before = app.store.all('transactions').length;
    openTrustDialog({ type: 'withdrawal', matterId: 'm-6' });
    const dlg = document.querySelector('dialog');
    dlg.querySelector('[name=amount]').value = '100';
    dlg.querySelector('[name=date]').value = '2026-07-01';
    dlg.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(app.store.all('transactions').length).toBe(before);
    expect(document.querySelector('.toast.error')?.textContent).toContain('overdraw');
  });

  it('refuses to delete a deposit that an earlier withdrawal depended on', async () => {
    const { deleteTransaction } = await import('../src/views/money-dialogs.js');
    const trust = app.store.all('accounts').find((a) => a.type === 'trust');
    const mine = () => app.store.all('transactions').filter((t) => t.matterId === 'm-6' && t.accountId === trust.id);
    const first = mine().sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    expect(first.type).toBe('deposit');
    expect(mine().some((t) => t.type === 'withdrawal' && t.date > first.date)).toBe(true);
    // A large later deposit keeps today's balance positive without the first deposit.
    app.store.put('transactions', { accountId: trust.id, matterId: 'm-6', type: 'deposit', amountCents: first.amountCents * 2, date: TODAY });
    const ok = await deleteTransaction(first);
    expect(ok).toBe(false);
    expect(app.store.get('transactions', first.id)).toBeTruthy();
    expect(document.querySelector('.toast.error')?.textContent).toContain('negative trust balance');
  });
});
