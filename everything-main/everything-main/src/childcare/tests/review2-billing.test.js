// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { app } from '../src/app.js';
import { tick } from './helpers.js';
import { formatMoney } from '../src/core/money.js';
import { setupApp, button, mountView, downloaded } from './review2-billing-helpers.js';

const usd = (cents) => formatMoney(cents, 'USD');
const plan = { id: 'p', name: 'Toddler', amountCents: 160000, frequency: 'monthly' };
const kid = { id: 's', firstName: 'Ada', lastName: 'Byron', status: 'active', plans: [{ planId: 'p' }] };

describe('billing: double submits', () => {
  it('a double click on "Create statements" bills each child once', async () => {
    await setupApp({ collections: { plans: [plan], students: [kid] } });
    const { openBillingRun } = await import('../src/views/billing.js');
    openBillingRun();
    const create = button('Create statements');
    create.click();
    create.click();
    await tick(20);
    expect(app.store.all('invoices')).toHaveLength(1);
  });

  it('a double click on "Create statement" creates one statement', async () => {
    await setupApp({ collections: { plans: [plan], students: [kid] } });
    const { openInvoiceForm } = await import('../src/views/billing.js');
    openInvoiceForm({ studentId: 's' });
    const create = button('Create statement');
    create.click();
    create.click();
    await tick(20);
    expect(app.store.all('invoices')).toHaveLength(1);
  });
});

describe('calendar and menus: links with a malformed month or week', () => {
  it('#/calendar?month=foo shows the current month instead of hanging the tab', async () => {
    await setupApp({});
    const cal = await import('../src/views/calendar.js');
    const node = mountView(cal, {}, { month: 'foo' });
    expect(node.querySelector('.cal-title').textContent).toBe('October 2026');
    expect(node.querySelectorAll('.cal-row:not(.cal-head)').length).toBe(5);
  });

  it('#/calendar?month=2026-1 falls back instead of greying out the whole month', async () => {
    await setupApp({});
    const cal = await import('../src/views/calendar.js');
    const node = mountView(cal, {}, { month: '2026-1' });
    expect(node.querySelector('.cal-title').textContent).toBe('October 2026');
    expect(node.querySelectorAll('.cal-cell:not(.other)').length).toBe(31);
  });

  it('#/menus?week=x shows this week instead of crashing the page', async () => {
    await setupApp({});
    const menus = await import('../src/views/menus.js');
    const node = mountView(menus, {}, { week: 'x' });
    expect(node.querySelector('.month-label').textContent).toBe('Week of October 12');
  });
});

describe('billing: statements made by hand from tuition plans', () => {
  it('a New statement prefilled with this month\'s tuition counts as billed for the month', async () => {
    await setupApp({ collections: { plans: [plan], students: [kid] } });
    const { openInvoiceForm } = await import('../src/views/billing.js');
    const { planBillingRun } = await import('../src/core/billing.js');
    openInvoiceForm({ studentId: 's' });
    expect(document.querySelector('.line-item:not(.line-head) input').value).toBe('Toddler, October 2026');
    button('Create statement').click();
    await tick(20);
    const store = app.store;
    const run = planBillingRun({ students: store.all('students'), plans: store.all('plans'), invoices: store.all('invoices') }, { frequency: 'monthly', day: '2026-10-12' });
    expect(run.drafts).toHaveLength(0);
  });

  it('a hand-made statement without the tuition lines does not stop the billing run', async () => {
    await setupApp({ collections: { plans: [plan], students: [kid] } });
    const { openInvoiceForm } = await import('../src/views/billing.js');
    const { planBillingRun } = await import('../src/core/billing.js');
    openInvoiceForm({ studentId: 's' });
    document.querySelector('[aria-label="Remove line"]').click();
    button('Add line').click();
    const line = document.querySelector('.line-item:not(.line-head) input');
    line.value = 'Registration fee';
    line.dispatchEvent(new Event('input'));
    const amount = document.querySelector('.line-item:not(.line-head) [aria-label="Amount"]');
    amount.value = '50';
    amount.dispatchEvent(new Event('input'));
    button('Create statement').click();
    await tick(20);
    const store = app.store;
    expect(store.all('invoices')[0].items.map((i) => i.description)).toEqual(['Registration fee']);
    const run = planBillingRun({ students: store.all('students'), plans: store.all('plans'), invoices: store.all('invoices') }, { frequency: 'monthly', day: '2026-10-12' });
    expect(run.drafts).toHaveLength(1);
  });
});

describe('statement: line amounts', () => {
  const statement = (items) => ({ id: 'i', number: 1042, studentId: 's', issueDate: '2026-10-01', dueDate: '2026-10-08', status: 'open', items });

  it('a line with quantity 0 shows $0.00 on screen and in the email', async () => {
    await setupApp({ collections: { students: [kid], invoices: [statement([{ id: 'a', description: 'Tuition', amountCents: 160000, qty: 1 }, { id: 'b', description: 'Field trip', amountCents: 2500, qty: 0 }, { id: 'c', description: 'Late fee', amountCents: 1500 }])], guardians: [{ id: 'g', firstName: 'Ann', studentIds: ['s'], billing: true, email: 'ann@example.com' }] } });
    const view = await import('../src/views/invoice.js');
    const node = mountView(view, { id: 'i' });
    const rows = [...node.querySelectorAll('.statement-lines tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows).toEqual([['Tuition', '1', usd(160000)], ['Field trip', '0', usd(0)], ['Late fee', '1', usd(1500)]]);
    const body = decodeURIComponent(node.querySelector('a[href^="mailto:"]').getAttribute('href'));
    expect(body).toContain(`Field trip: ${usd(0)}`);
    expect(body).toContain(`Late fee: ${usd(1500)}`);
  });
});

describe('billing overview', () => {
  it('"Collected this month" leaves out payments dated in a later month', async () => {
    await setupApp({ collections: { students: [kid], payments: [
      { id: 'p1', studentId: 's', amountCents: 5000, date: '2026-10-02', method: 'card', kind: 'payment' },
      { id: 'p2', studentId: 's', amountCents: 7000, date: '2026-11-01', method: 'check', kind: 'payment' },
    ] } });
    const billing = await import('../src/views/billing.js');
    const node = mountView(billing, {});
    const stat = [...node.querySelectorAll('.stat')].find((s) => s.textContent.includes('Collected this month'));
    expect(stat.textContent).toContain(usd(5000));
  });
});

describe('credits are not payments', () => {
  const payments = [
    { id: 'p1', studentId: 's', amountCents: 5000, date: '2026-10-02', method: 'check', reference: '1001', kind: 'payment' },
    { id: 'p2', studentId: 's', amountCents: 2000, date: '2026-10-03', method: 'card', note: 'Sibling discount', kind: 'credit' },
  ];

  it('the Payments received report totals money received, not credits, and names the method', async () => {
    await setupApp({ collections: { students: [kid], payments } });
    const reports = await import('../src/views/reports.js');
    const node = mountView(reports, {}, { r: 'payments', from: '2026-10-01', to: '2026-10-12' });
    await tick(10);
    const rows = [...node.querySelectorAll('.report-table tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe('Check');
    expect(node.querySelector('.report-table tfoot').textContent).toBe(`Total${usd(5000)}`);
  });

  it('the Payments tab and its CSV label a credit as a credit, not a card payment', async () => {
    await setupApp({ collections: { students: [kid], payments } });
    const billing = await import('../src/views/billing.js');
    const node = mountView(billing, { tab: 'payments' });
    const rows = [...node.querySelectorAll('tbody tr')].map((tr) => tr.textContent);
    expect(rows.find((r) => r.includes(usd(2000)))).toContain('Credit or discount');
    expect(rows.find((r) => r.includes(usd(2000)))).not.toContain('Credit or debit card');
    const text = await downloaded(() => button('Export CSV', node).click());
    expect(text).toContain('2026-10-03,Ada Byron,20.00,Credit or discount');
  });
});

describe('menus: copy last week', () => {
  const lastWeek = { id: '2026-10-05', weekStart: '2026-10-05', days: { 1: { lunch: 'Pasta' } } };

  it('shows the copied menu at once', async () => {
    await setupApp({ collections: { menus: [lastWeek] } });
    const menus = await import('../src/views/menus.js');
    const node = mountView(menus, {});
    button('Copy last week', node).click();
    await tick(10);
    expect(app.store.get('menus', '2026-10-12').days[1].lunch).toBe('Pasta');
    expect([...node.querySelectorAll('textarea')].map((t) => t.value)).toContain('Pasta');
  });

  it('asks before replacing a menu this week already has', async () => {
    await setupApp({ collections: { menus: [lastWeek, { id: '2026-10-12', weekStart: '2026-10-12', days: { 2: { lunch: 'Tacos' } } }] } });
    const menus = await import('../src/views/menus.js');
    const node = mountView(menus, {});
    button('Copy last week', node).click();
    await tick(10);
    const dlg = document.querySelector('dialog[open]');
    expect(dlg?.textContent).toContain('Replace');
    button('Cancel', dlg).click();
    await tick(10);
    expect(app.store.get('menus', '2026-10-12').days[2].lunch).toBe('Tacos');
    button('Copy last week', node).click();
    await tick(10);
    button('Replace', document.querySelector('dialog[open]')).click();
    await tick(10);
    expect(app.store.get('menus', '2026-10-12').days[1].lunch).toBe('Pasta');
    expect([...node.querySelectorAll('textarea')].map((t) => t.value)).toContain('Pasta');
  });
});

describe('reports: changing the dates while a report builds', () => {
  it('shows the last range asked for, not a slower earlier one', async () => {
    await setupApp({ collections: { students: [kid], 'attendance:2026-09-15': [{ id: 's-s', studentId: 's', absent: { reason: 'Sick' }, events: [] }] } });
    const reports = await import('../src/views/reports.js');
    const read = app.store.read;
    let calls = 0;
    app.store.read = async (names) => {
      const slow = calls++ === 0;
      await tick(slow ? 60 : 5);
      return read(names);
    };
    const node = mountView(reports, {}, { r: 'absences', from: '2026-09-01', to: '2026-09-30' });
    const [from, to] = node.querySelectorAll('input[type=date]');
    from.value = '2026-10-01';
    to.value = '2026-10-12';
    to.dispatchEvent(new Event('change'));
    await tick(100);
    expect(calls).toBe(2);
    expect(node.querySelector('.report-table')).toBeNull();
    expect(node.querySelector('.report-out').textContent).toContain('Nothing to report');
    // The CSV matches what is on screen.
    const csv = await downloaded(() => button('Export CSV', node).click());
    expect(csv).not.toContain('Sick');
  });
});

describe('settings: saving redraws the section without losing your place', () => {
  it('keeps focus on the next field after a field saves', async () => {
    await setupApp({});
    const settings = await import('../src/views/settings.js');
    const node = mountView(settings, { section: 'school' });
    const [name, phone] = node.querySelectorAll('.settings-body input');
    name.value = 'Sunny Days';
    phone.focus(); // Tab moves focus first, then the change event saves.
    name.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(10);
    expect(app.settings().school.name).toBe('Sunny Days');
    expect(document.activeElement).toBe(node.querySelectorAll('.settings-body input')[1]);
  });

  it('keeps a switch focused after toggling it', async () => {
    await setupApp({});
    const settings = await import('../src/views/settings.js');
    const node = mountView(settings, { section: 'privacy' });
    const sw = node.querySelectorAll('.settings-body input[type=checkbox]')[2];
    sw.focus();
    sw.click();
    await tick(10);
    expect(app.settings().access.parentsCanReportAbsence).toBe(false);
    expect(document.activeElement).toBe(node.querySelectorAll('.settings-body input[type=checkbox]')[2]);
  });

  it('keeps unsaved typing when a sync redraws the section', async () => {
    await setupApp({ collections: { guardians: [{ id: 'g', firstName: 'Ann', studentIds: [] }] } });
    const settings = await import('../src/views/settings.js');
    const node = mountView(settings, { section: 'billing' });
    const msg = node.querySelector('.settings-body textarea');
    msg.focus();
    msg.value = 'Pay by bank transfer to';
    msg.dispatchEvent(new Event('input', { bubbles: true }));
    app.store.patch('guardians', 'g', { phone: '555' }); // another device's change arrives
    await tick(10);
    const now = node.querySelector('.settings-body textarea');
    expect(now.value).toBe('Pay by bank transfer to');
    expect(document.activeElement).toBe(now);
  });
});

describe('calendar: the .ics download', () => {
  it('gives a family only the events the calendar shows them', async () => {
    await setupApp({
      role: 'family',
      me: { guardianId: 'g', staffId: null, studentIds: ['s'] },
      collections: {
        rooms: [{ id: 'r1', name: 'Toddlers' }, { id: 'r2', name: 'Preschool' }],
        students: [{ ...kid, roomId: 'r1' }],
        events: [
          { id: 'e1', title: 'Preschool field trip', date: '2026-10-20', roomIds: ['r2'], allDay: true },
          { id: 'e2', title: 'Picture day', date: '2026-10-21', roomIds: [], allDay: true },
          { id: 'e3', title: 'Toddler music', date: '2026-10-22', roomIds: ['r1'], allDay: true },
        ],
      },
    });
    const cal = await import('../src/views/calendar.js');
    const node = mountView(cal, {});
    expect(node.querySelector('.cal-grid').textContent).not.toContain('Preschool field trip');
    node.querySelector('.page-header .actions button').click();
    const item = [...document.querySelectorAll('[role=menuitem], .menu button')].find((b) => b.textContent.includes('.ics'));
    const ics = await downloaded(() => item.click());
    expect(ics).toContain('SUMMARY:Picture day');
    expect(ics).toContain('SUMMARY:Toddler music');
    expect(ics).not.toContain('Preschool field trip');
  });
});

describe('focus stays put when a screen redraws itself', () => {
  it('Billing: the search box keeps focus while filtering', async () => {
    await setupApp({ collections: { students: [kid, { ...kid, id: 't', firstName: 'Ben' }] } });
    const billing = await import('../src/views/billing.js');
    const node = mountView(billing, { tab: 'balances' });
    const q = node.querySelector('input[type=search]');
    q.focus();
    q.value = 'Ad';
    q.dispatchEvent(new Event('input'));
    await tick(200);
    expect(node.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(document.activeElement).toBe(node.querySelector('input[type=search]'));
  });

  it('Billing: arrow keys keep moving through the tabs', async () => {
    await setupApp({ collections: { students: [kid] } });
    const billing = await import('../src/views/billing.js');
    const node = mountView(billing, {});
    node.querySelector('[role=tab][aria-selected=true]').focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement.textContent).toBe('Statements');
    expect(node.querySelector('[role=tab][aria-selected=true]').textContent).toBe('Statements');
  });

  it('Billing: a status chip keeps focus after filtering', async () => {
    await setupApp({ collections: { students: [kid] } });
    const billing = await import('../src/views/billing.js');
    const node = mountView(billing, { tab: 'statements' });
    const paid = button('Paid', node);
    paid.focus();
    paid.click();
    expect(document.activeElement.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement.textContent).toContain('Paid');
  });

  it('Calendar: Next month keeps focus for the next press', async () => {
    await setupApp({});
    const cal = await import('../src/views/calendar.js');
    const node = mountView(cal, {});
    node.querySelector('[aria-label="Next month"]').focus();
    document.activeElement.click();
    document.activeElement.click();
    expect(node.querySelector('.cal-title').textContent).toBe('December 2026');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Next month');
  });

  it('Menus: Next week keeps focus for the next press', async () => {
    await setupApp({});
    const menus = await import('../src/views/menus.js');
    const node = mountView(menus, {});
    node.querySelector('[aria-label="Next week"]').focus();
    document.activeElement.click();
    document.activeElement.click();
    expect(node.querySelector('.month-label').textContent).toBe('Week of October 26');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Next week');
  });
});

describe('calendar: event times', () => {
  it('does not save an event that ends before it starts', async () => {
    await setupApp({});
    const { openEventForm } = await import('../src/views/calendar.js');
    openEventForm({ date: '2026-10-20' });
    const dlg = document.querySelector('dialog[open]');
    const title = dlg.querySelector('input:not([type])') || dlg.querySelector('input');
    title.value = 'Parent night';
    const allDay = [...dlg.querySelectorAll('input[type=checkbox]')][0];
    allDay.click();
    const [start, end] = dlg.querySelectorAll('input[type=time]');
    start.value = '18:00';
    end.value = '17:00';
    button('Add event', dlg).click();
    expect(app.store.all('events')).toHaveLength(0);
    expect(document.activeElement).toBe(end);
    end.value = '19:30';
    button('Add event', dlg).click();
    expect(app.store.all('events')).toMatchObject([{ title: 'Parent night', start: '18:00', end: '19:30', allDay: false }]);
  });
});

describe('calendar: the phone agenda', () => {
  const events = [
    { id: 'e1', title: 'Fall festival', date: '2026-10-20', roomIds: [], allDay: true },
    { id: 'e2', title: 'Winter break', date: '2026-12-21', endDate: '2027-01-01', kind: 'closure', roomIds: [], allDay: true },
    { id: 'e3', title: 'Spring photos', date: '2027-03-10', roomIds: [], allDay: true },
  ];
  const agenda = (node) => [...node.querySelectorAll('.agenda .person-name')].map((n) => n.textContent);

  it('follows the month chosen with the arrows', async () => {
    await setupApp({ collections: { events } });
    const cal = await import('../src/views/calendar.js');
    const node = mountView(cal, {});
    expect(agenda(node)).toEqual(['Fall festival']);
    node.querySelector('[aria-label="Next month"]').click();
    node.querySelector('[aria-label="Next month"]').click();
    expect(agenda(node)).toEqual(['Winter break']);
    const jan = mountView(cal, {}, { month: '2027-01' });
    expect(agenda(jan)).toEqual(['Winter break']); // still closed on Jan 1
    const mar = mountView(cal, {}, { month: '2027-03' });
    expect(agenda(mar)).toEqual(['Spring photos']);
  });
});

describe('billing: balances of deleted children', () => {
  const owed = { id: 'i', number: 1001, studentId: 'gone', issueDate: '2026-09-01', dueDate: '2026-09-08', status: 'open', items: [{ id: 'a', description: 'Tuition', amountCents: 40000, qty: 1 }] };

  it('the Balances tab still lists what a deleted child owes, so it adds up to Outstanding', async () => {
    await setupApp({ collections: { students: [kid], invoices: [owed] } });
    const billing = await import('../src/views/billing.js');
    const node = mountView(billing, { tab: 'balances' });
    const rows = [...node.querySelectorAll('table tbody tr')].map((tr) => tr.textContent);
    expect(rows.some((r) => r.includes('Unknown') && r.includes(usd(40000)))).toBe(true);
  });

  it('the Balances report keeps them too', async () => {
    await setupApp({ collections: { students: [kid], invoices: [owed] } });
    const reports = await import('../src/views/reports.js');
    const node = mountView(reports, {}, { r: 'balances' });
    await tick(10);
    const rows = [...node.querySelectorAll('.report-table tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows).toEqual([['Unknown', usd(40000), usd(0), usd(40000), usd(40000)]]);
  });
});

describe('settings: Download backup', () => {
  const stay = { id: 's-s', studentId: 's', events: [{ type: 'in', at: '08:00' }, { type: 'out', at: '16:00' }] };
  const backup = (node) =>
    new Promise((resolve) => {
      const orig = URL.createObjectURL;
      URL.createObjectURL = (b) => {
        URL.createObjectURL = orig;
        const r = new FileReader();
        r.onload = () => resolve(JSON.parse(r.result));
        r.readAsText(b);
        return '#download';
      };
      button('Download backup', node).click();
      setTimeout(() => ((URL.createObjectURL = orig), resolve(null)), 200);
    });

  it('includes attendance older than two years', async () => {
    await setupApp({ collections: { students: [{ ...kid, createdAt: '2022-08-15T12:00:00.000Z' }], 'attendance:2023-05-01': [stay], 'attendance:2026-10-01': [stay] } });
    const settings = await import('../src/views/settings.js');
    const node = mountView(settings, { section: 'data' });
    const b = await backup(node);
    expect(Object.keys(b.collections)).toContain('attendance:2026-10-01');
    expect(Object.keys(b.collections)).toContain('attendance:2023-05-01');
  });

  it('fails instead of saving a partial backup when the versions cannot be read', async () => {
    const { backend } = await setupApp({ collections: { students: [kid], 'attendance:2026-09-01': [stay] } });
    const settings = await import('../src/views/settings.js');
    const node = mountView(settings, { section: 'data' });
    backend.setFailing(true);
    expect(await backup(node)).toBeNull();
  });
});

describe('settings: number fields', () => {
  it('keep Days until due and the next statement number in range', async () => {
    await setupApp({});
    const settings = await import('../src/views/settings.js');
    const node = mountView(settings, { section: 'billing' });
    const [days, next] = node.querySelectorAll('.settings-body input[type=number]');
    days.value = '-5';
    days.dispatchEvent(new Event('change', { bubbles: true }));
    next.value = '-3';
    next.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.settings().billing.dueDays).toBe(0);
    expect(app.settings().numbering.invoice).toBe(1);
    const [days2] = node.querySelectorAll('.settings-body input[type=number]');
    days2.value = '10.6';
    days2.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.settings().billing.dueDays).toBe(11);
  });
});

describe('statement: restoring a void statement', () => {
  it('asks first when the child was billed again for that period', async () => {
    const base = { studentId: 's', issueDate: '2026-10-01', dueDate: '2026-10-08', period: 'monthly:2026-10', items: [{ id: 'a', description: 'Tuition', amountCents: 160000, qty: 1 }] };
    await setupApp({ collections: { students: [kid], invoices: [{ ...base, id: 'old', number: 1001, status: 'void' }, { ...base, id: 'new', number: 1002, status: 'open' }] } });
    const view = await import('../src/views/invoice.js');
    const node = mountView(view, { id: 'old' });
    button('Restore', node).click();
    await tick(10);
    const dlg = document.querySelector('dialog[open]');
    expect(dlg?.textContent).toContain('#1002');
    button('Cancel', dlg).click();
    await tick(10);
    expect(app.store.get('invoices', 'old').status).toBe('void');
  });
});

describe('settings: clearing a whole list', () => {
  it('says the list needs an item and puts the saved list back instead of silently keeping it', async () => {
    await setupApp({});
    const settings = await import('../src/views/settings.js');
    const node = mountView(settings, { section: 'lists' });
    const meals = node.querySelector('.settings-body textarea');
    const saved = app.settings().mealTypes;
    meals.value = '  \n ';
    meals.dispatchEvent(new Event('input', { bubbles: true }));
    meals.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(10);
    expect(app.settings().mealTypes).toEqual(saved);
    expect(node.querySelector('.settings-body textarea').value).toBe(saved.join('\n'));
    expect(document.querySelector('.toast.error')?.textContent).toContain('at least one');
  });
});
