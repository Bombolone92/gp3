// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { formatMoney } from '../src/core/money.js';
import { setupApp, mountView } from './review2-billing-helpers.js';

const usd = (cents) => formatMoney(cents, 'USD');
const kid = { id: 's', firstName: 'Ada', lastName: 'Byron', status: 'active' };

describe('statement: lines with a blank or invalid quantity', () => {
  it('price each line the way the total does', async () => {
    const items = [
      { id: 'a', description: 'Tuition', amountCents: 1000, qty: '' },
      { id: 'b', description: 'Snacks', amountCents: 500, qty: 'x' },
    ];
    await setupApp({ collections: { students: [kid], invoices: [{ id: 'i', number: 7, studentId: 's', issueDate: '2026-10-01', dueDate: '2026-10-08', status: 'open', items }], guardians: [{ id: 'g', firstName: 'Ann', studentIds: ['s'], billing: true, email: 'ann@example.com' }] } });
    const view = await import('../src/views/invoice.js');
    const node = mountView(view, { id: 'i' });
    const rows = [...node.querySelectorAll('.statement-lines tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows).toEqual([['Tuition', '1', usd(1000)], ['Snacks', '1', usd(500)]]);
    expect(node.querySelector('.statement-lines tfoot th.r').textContent).toBe(usd(1500));
    const body = decodeURIComponent(node.querySelector('a[href^="mailto:"]').getAttribute('href'));
    expect(body).toContain(`Tuition: ${usd(1000)}`);
    expect(body).toContain(`Snacks: ${usd(500)}`);
  });
});

describe('billing: a failure while creating statements', () => {
  const plan = { id: 'p', name: 'Toddler', amountCents: 160000, frequency: 'monthly' };
  const billed = { ...kid, plans: [{ planId: 'p' }] };
  const lastError = () => [...document.querySelectorAll('.toast.error')].at(-1)?.textContent || '';

  it('Create statements says what went wrong and can be pressed again', async () => {
    const { button } = await import('./review2-billing-helpers.js');
    await setupApp({ collections: { plans: [plan], students: [billed] } });
    const { app } = await import('../src/app.js');
    app.store.nextNumber = async () => {
      throw new Error('The school server did not answer.');
    };
    const { openBillingRun } = await import('../src/views/billing.js');
    openBillingRun();
    const create = button('Create statements');
    create.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(lastError()).toContain('The school server did not answer.');
    expect(create.disabled).toBe(false);
    expect(app.store.all('invoices')).toHaveLength(0);
  });

  it('Create statement says what went wrong and can be pressed again', async () => {
    const { button } = await import('./review2-billing-helpers.js');
    await setupApp({ collections: { plans: [plan], students: [billed] } });
    const { app } = await import('../src/app.js');
    app.store.nextNumber = async () => {
      throw new Error('The school server did not answer.');
    };
    const { openInvoiceForm } = await import('../src/views/billing.js');
    openInvoiceForm({ studentId: 's' });
    const create = button('Create statement');
    create.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(lastError()).toContain('The school server did not answer.');
    expect(create.disabled).toBe(false);
  });
});

describe('billing: Balances child links', () => {
  it('open the child\'s Billing tab, like the row', async () => {
    await setupApp({ collections: { students: [kid] } });
    const billing = await import('../src/views/billing.js');
    const node = mountView(billing, { tab: 'balances' });
    const link = node.querySelector('table a.person-link');
    expect(link.getAttribute('href')).toBe('#/children/s?tab=billing');
  });
});
