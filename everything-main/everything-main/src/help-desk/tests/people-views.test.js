import { describe, it, expect, beforeEach, vi } from 'vitest';
import { app } from '../src/app.js';
import { mount as mountCustomers, newCustomerDialog } from '../src/views/customers.js';
import { mount as mountCustomer } from '../src/views/customer.js';
import { mount as mountOrgs } from '../src/views/orgs.js';
import { mount as mountOrg } from '../src/views/org.js';
import { mount as mountSearch, runSearch, rememberSearch, loadRecent } from '../src/views/search.js';
import { dataTable } from '../src/views/people-ui.js';

const KIND = { t: 'tickets', u: 'users', o: 'orgs', a: 'articles' };

class FakeReplica extends EventTarget {
  constructor() {
    super();
    this.tickets = new Map();
    this.users = new Map();
    this.orgs = new Map();
    this.articles = new Map();
    this.members = { me: { uuid: 'me', name: 'Olivia', role: 'owner', active: true } };
    this.me = this.members.me;
    this.cfg = { groups: [] };
    this.meta = { name: 'Acme' };
    this.status = 'live';
  }
  isAdmin() { return true; }
  agents() { return Object.values(this.members); }
  ticketsFor(fn) { return [...this.tickets.values()].filter(fn); }
  upsert(kind, rec) {
    this[KIND[kind]].set(rec.id, rec);
    this.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set([kind]) } }));
  }
  drop(kind, id) {
    this[KIND[kind]].delete(id);
    this.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set([kind]) } }));
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function seed(r) {
  r.orgs.set(1, { id: 1, name: 'Northwind', domains: ['northwind.example'], updatedAt: 1 });
  r.users.set(1, { id: 1, name: 'Ava Kim', email: 'ava@northwind.example', org: 1, tags: ['vip'], createdAt: Date.now(), updatedAt: 3 });
  r.users.set(2, { id: 2, name: 'Bo Lee', email: 'bo@mail.example', tags: [], createdAt: Date.now(), updatedAt: 2 });
  r.users.set(3, { id: 3, name: 'Cy Banned', email: 'cy@mail.example', suspended: true, tags: [], updatedAt: 1 });
  r.tickets.set(10, { id: 10, subject: 'Cannot log in', desc: 'password reset fails', requester: 1, org: 1, status: 'open', tags: ['login'], updatedAt: 5, createdAt: 1 });
  r.tickets.set(11, { id: 11, subject: 'Invoice question', desc: '', requester: 2, org: null, status: 'solved', tags: ['billing'], updatedAt: 4, createdAt: 1, csat: { score: 'good' } });
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  app.replica = new FakeReplica();
  seed(app.replica);
  app.api = { post: vi.fn(), del: vi.fn() };
  history.replaceState(null, '', '#/customers');
});

function rows(root) {
  return [...root.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('.person-name')?.textContent);
}

describe('customers list', () => {
  it('lists active customers sorted by name, with open ticket counts', () => {
    const main = document.createElement('main');
    document.body.append(main);
    mountCustomers(main, { route: { query: {} } });
    expect(rows(main)).toEqual(['Ava Kim', 'Bo Lee']);
    expect(main.querySelector('.open-count').textContent).toBe('1');
    expect(main.querySelector('h1').textContent).toBe('All customers');
  });

  it('filters by search text and by list', async () => {
    const main = document.createElement('main');
    document.body.append(main);
    mountCustomers(main, { route: { query: { filter: 'suspended' } } });
    expect(rows(main)).toEqual(['Cy Banned']);
    const open = [...main.querySelectorAll('.side-link')].find((a) => a.textContent.includes('With open tickets'));
    open.click();
    expect(rows(main)).toEqual(['Ava Kim']);
    expect(location.hash).toBe('#/customers?filter=open');
    const all = [...main.querySelectorAll('.side-link')].find((a) => a.textContent.includes('All customers'));
    all.click();
    const input = main.querySelector('input[type=search]');
    input.value = 'northwind';
    input.dispatchEvent(new Event('input'));
    await wait(150);
    expect(rows(main)).toEqual(['Ava Kim']);
    input.value = 'nobody here';
    input.dispatchEvent(new Event('input'));
    await wait(150);
    expect(main.textContent).toContain('No customers match your search');
  });

  it('lets Tab reach the list chosen from the side', () => {
    const main = document.createElement('main');
    document.body.append(main);
    mountCustomers(main, { route: { query: {} } });
    [...main.querySelectorAll('.side-link')].find((a) => a.textContent.includes('Suspended')).click();
    const checked = main.querySelector('.seg[aria-checked="true"]');
    expect(checked.tabIndex).toBe(0);
    expect([...main.querySelectorAll('.seg')].filter((b) => b.tabIndex === 0)).toEqual([checked]);
  });

  it('updates when the replica changes', () => {
    const main = document.createElement('main');
    document.body.append(main);
    mountCustomers(main, { route: { query: {} } });
    app.replica.upsert('u', { id: 4, name: 'Aaron Able', email: 'a@a.io', tags: [], updatedAt: 9 });
    expect(rows(main)[0]).toBe('Aaron Able');
  });
});

describe('newCustomerDialog', () => {
  it('suggests the organization from the email domain and creates the customer', async () => {
    app.api.post.mockResolvedValue({ user: { id: 9, name: 'Dee', email: 'dee@northwind.example', org: 1, tags: [] } });
    const done = newCustomerDialog({ navigate: false });
    const dlg = document.querySelector('dialog');
    dlg.querySelector('input').value = 'Dee';
    const email = dlg.querySelector('input[type=email]');
    email.value = 'dee@northwind.example';
    email.dispatchEvent(new Event('input'));
    expect(dlg.textContent).toContain('Northwind');
    dlg.querySelector('form').requestSubmit();
    expect(await done).toMatchObject({ id: 9 });
    expect(app.api.post).toHaveBeenCalledWith('/users', expect.objectContaining({ name: 'Dee', email: 'dee@northwind.example', org: 1 }));
    expect(app.replica.users.get(9).name).toBe('Dee');
  });

  it('offers the existing customer when the email is taken', async () => {
    const err = Object.assign(new Error('Ava Kim already uses that email address'), { code: 'exists', current: app.replica.users.get(1) });
    app.api.post.mockRejectedValue(err);
    newCustomerDialog({ navigate: false });
    const dlg = document.querySelector('dialog');
    dlg.querySelector('input').value = 'Ava';
    dlg.querySelector('input[type=email]').value = 'ava@northwind.example';
    dlg.querySelector('form').requestSubmit();
    await tick();
    await tick();
    const link = dlg.querySelector('a[href="#/customers/1"]');
    expect(link).toBeTruthy();
    expect(dlg.querySelector('input[type=email]').getAttribute('aria-invalid')).toBe('true');
  });

  it('requires a name or email', () => {
    newCustomerDialog({ navigate: false });
    const dlg = document.querySelector('dialog');
    dlg.querySelector('form').requestSubmit();
    expect(app.api.post).not.toHaveBeenCalled();
    expect(dlg.textContent).toContain('Enter a name or an email address');
  });
});

describe('customer profile', () => {
  it('shows details, requests and saves edits', async () => {
    app.api.post.mockImplementation(async (path, body) => ({ user: { ...app.replica.users.get(1), ...body, updatedAt: 99 } }));
    const main = document.createElement('main');
    document.body.append(main);
    mountCustomer(main, { id: 1 });
    expect(main.querySelector('h1').textContent).toContain('Ava Kim');
    expect(main.textContent).toContain('Cannot log in');
    const phone = main.querySelector('input[type=tel]');
    phone.value = '+1 555 0100';
    phone.dispatchEvent(new Event('change'));
    await tick();
    expect(app.api.post).toHaveBeenCalledWith('/users/1', { phone: '+1 555 0100' });
    expect(app.replica.users.get(1).phone).toBe('+1 555 0100');
  });

  it('shows a saved name in the header and title at once', async () => {
    app.api.post.mockImplementation(async (path, body) => ({ user: { ...app.replica.users.get(1), ...body, updatedAt: 99 } }));
    const main = document.createElement('main');
    document.body.append(main);
    mountCustomer(main, { id: 1 });
    const name = main.querySelector('.profile-details input');
    name.value = 'Ava Smith';
    name.dispatchEvent(new Event('change'));
    await tick();
    // The live copy of the same record arrives later and changes nothing.
    app.replica.upsert('u', { ...app.replica.users.get(1) });
    expect(main.querySelector('h1').textContent).toContain('Ava Smith');
    expect(document.title).toBe('Ava Smith - Help Desk');
  });

  it('leaves spam out of the requests and counts, like the customer list', () => {
    app.replica.tickets.set(12, { id: 12, subject: 'Cheap watches', requester: 1, org: 1, status: 'new', spam: true, tags: [], updatedAt: 6, createdAt: 2 });
    const main = document.createElement('main');
    document.body.append(main);
    mountCustomer(main, { id: 1 });
    expect(main.querySelector('.pstat-value').textContent).toBe('1');
    expect(main.textContent).not.toContain('Cheap watches');
  });

  it('clears a save error once the saved value is typed back', async () => {
    app.api.post.mockRejectedValue(new Error('That email address is taken'));
    const main = document.createElement('main');
    document.body.append(main);
    mountCustomer(main, { id: 1 });
    const email = main.querySelector('input[type=email]');
    email.value = 'bo@mail.example';
    email.dispatchEvent(new Event('change'));
    await tick();
    expect(email.getAttribute('aria-invalid')).toBe('true');
    email.value = 'ava@northwind.example';
    email.dispatchEvent(new Event('change'));
    expect(email.hasAttribute('aria-invalid')).toBe(false);
    expect(email.closest('.field').querySelector('.field-error').textContent).toBe('');
  });

  it('handles a missing customer', () => {
    const main = document.createElement('main');
    document.body.append(main);
    mountCustomer(main, { id: 999 });
    expect(main.textContent).toContain('Customer not found');
  });

  it('explains that tickets in the trash keep a customer from being deleted', async () => {
    app.replica.tickets.set(11, { ...app.replica.tickets.get(11), deleted: 123 });
    const main = document.createElement('main');
    document.body.append(main);
    mountCustomer(main, { id: 2 });
    main.querySelector('[aria-label="More actions"]').click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Delete customer')).click();
    await tick();
    expect(document.querySelector('dialog[open] .dialog-title').textContent).toBe('This customer has tickets');
    expect(app.api.del).not.toHaveBeenCalled();
  });

  it('starts a ticket for the customer', () => {
    const main = document.createElement('main');
    document.body.append(main);
    mountCustomer(main, { id: 2 });
    [...main.querySelectorAll('button')].find((b) => b.textContent.includes('New ticket')).click();
    expect(app.drafts.get('new').requester).toBe(2);
    expect(location.hash).toBe('#/tickets/new');
  });
});

describe('organization profile', () => {
  it('shows a saved name at once and saves a rename back', async () => {
    app.api.post.mockImplementation(async (path, body) => ({ org: { ...app.replica.orgs.get(1), ...body, updatedAt: Date.now() } }));
    const main = document.createElement('main');
    document.body.append(main);
    mountOrg(main, { id: 1 });
    const name = main.querySelector('.profile-details input');
    name.value = 'Northwind Traders';
    name.dispatchEvent(new Event('change'));
    await tick();
    expect(main.querySelector('h1').textContent).toBe('Northwind Traders');
    expect(document.title).toBe('Northwind Traders - Help Desk');
    name.value = 'Northwind';
    name.dispatchEvent(new Event('change'));
    await tick();
    expect(app.api.post).toHaveBeenLastCalledWith('/orgs/1', { name: 'Northwind' });
    expect(main.querySelector('h1').textContent).toBe('Northwind');
  });
});

describe('organizations list', () => {
  it('lists organizations with customer and open ticket counts', () => {
    const main = document.createElement('main');
    document.body.append(main);
    mountOrgs(main, { route: { query: {} } });
    const cells = [...main.querySelectorAll('tbody tr td')].map((td) => td.textContent);
    expect(main.querySelector('tbody .person-name').textContent).toBe('Northwind');
    expect(cells).toContain('northwind.example');
    expect(main.querySelector('.open-count').textContent).toBe('1');
  });
});

describe('search', () => {
  it('searches every kind of record, and filters apply to tickets only', () => {
    const res = runSearch(app.replica, 'northwind');
    expect(res.customers.map((u) => u.id)).toEqual([1]);
    expect(res.orgs.map((o) => o.id)).toEqual([1]);
    expect(res.tickets.map((t) => t.id)).toEqual([10]);
    const filtered = runSearch(app.replica, 'status:solved');
    expect(filtered.tickets.map((t) => t.id)).toEqual([11]);
    expect(filtered.customers).toEqual([]);
  });

  it('remembers recent searches without duplicates', () => {
    rememberSearch('refund');
    rememberSearch('login');
    rememberSearch('Refund');
    expect(loadRecent()).toEqual(['Refund', 'login']);
  });

  it('switches to the first tab with results and keeps the query in the URL', async () => {
    const main = document.createElement('main');
    document.body.append(main);
    mountSearch(main, { route: { query: {} } });
    const input = main.querySelector('.search-big-input');
    input.value = 'cy banned';
    input.dispatchEvent(new Event('input'));
    await wait(150);
    expect(location.hash).toContain('q=cy+banned');
    expect(main.querySelector('.seg[aria-checked="true"]').textContent).toContain('Customers');
    expect(main.querySelectorAll('.sr-row')).toHaveLength(1);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement.classList.contains('sr-row')).toBe(true);
  });
});

describe('search tabs', () => {
  it('mark the kind of results shown after "Show tickets"', async () => {
    const main = document.createElement('main');
    document.body.append(main);
    mountSearch(main, { route: { query: { q: 'login' } } });
    await wait(150);
    [...main.querySelectorAll('.seg')].find((b) => b.textContent.startsWith('Customers')).click();
    const show = [...main.querySelectorAll('.search-none button')].find((b) => b.textContent.startsWith('Show'));
    show.click();
    const on = main.querySelector('.seg[aria-checked="true"]');
    expect(on.textContent).toContain('Tickets');
    expect(on.tabIndex).toBe(0);
    expect(document.activeElement).toBe(on);
    expect(main.querySelectorAll('.sr-row').length).toBeGreaterThan(0);
  });
});

describe('dataTable', () => {
  it('sorts by a column and moves focus with the keyboard', () => {
    const opened = [];
    const t = dataTable({
      label: 'Things',
      onOpen: (r) => opened.push(r.n),
      columns: [{ id: 'n', label: 'N', sort: (r) => r.n, render: (r) => String(r.n) }],
    });
    document.body.append(t.el);
    t.update([{ n: 3 }, { n: 1 }, { n: 2 }]);
    const values = () => [...t.el.querySelectorAll('tbody td')].map((td) => td.textContent);
    expect(values()).toEqual(['1', '2', '3']);
    t.el.querySelector('.sort-btn').click();
    expect(values()).toEqual(['3', '2', '1']);
    expect(t.el.querySelector('th').getAttribute('aria-sort')).toBe('descending');
    t.focusFirst();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(opened).toEqual([2]);
  });

  it('keeps a row reachable with Tab when the list shrinks', () => {
    const t = dataTable({ label: 'Few', columns: [{ id: 'n', label: 'N', sort: (r) => r.n, render: (r) => String(r.n) }] });
    document.body.append(t.el);
    t.update([1, 2, 3, 4, 5].map((n) => ({ n })));
    t.el.querySelectorAll('tbody tr')[4].focus();
    t.update([{ n: 1 }]);
    expect(t.el.querySelectorAll('tbody tr[tabindex="0"]')).toHaveLength(1);
  });

  it('renders large lists in batches', () => {
    const t = dataTable({ label: 'Many', columns: [{ id: 'n', label: 'N', sort: (r) => r.n, render: (r) => String(r.n) }] });
    document.body.append(t.el);
    t.update(Array.from({ length: 250 }, (_, n) => ({ n })));
    expect(t.el.querySelectorAll('tbody tr')).toHaveLength(100);
    t.el.querySelector('.dt-more button').click();
    expect(t.el.querySelectorAll('tbody tr')).toHaveLength(200);
  });
});

describe('accessibility', () => {
  it('has no axe violations on the customer, organization and search screens', async () => {
    const axe = (await import('axe-core')).default;
    for (const [mountFn, ctx] of [[mountCustomers, { route: { query: {} } }], [mountOrgs, { route: { query: {} } }], [mountCustomer, { id: 1 }], [mountSearch, { route: { query: { q: 'login' } } }]]) {
      document.body.innerHTML = '';
      const main = document.createElement('main');
      document.body.append(main);
      mountFn(main, ctx);
      const res = await axe.run(main, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
      expect(res.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    }
  });
});
