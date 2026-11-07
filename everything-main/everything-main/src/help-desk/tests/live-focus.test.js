/** Live updates keep a keyboard user's place on list and profile pages. */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../src/app.js';
import { mount as mountHome } from '../src/views/home.js';
import { mount as mountCustomer } from '../src/views/customer.js';
import { mount as mountCustomers } from '../src/views/customers.js';
import { mount as mountViews } from '../src/views/views.js';

class FakeReplica extends EventTarget {
  constructor() {
    super();
    this.tickets = new Map([
      [1, { id: 1, subject: 'A', status: 'open', assignee: 'me', requester: 7, updatedAt: 2, createdAt: 1, tags: [] }],
      [2, { id: 2, subject: 'B', status: 'open', assignee: 'me', requester: 7, updatedAt: 1, createdAt: 1, tags: [] }],
      [99, { id: 99, subject: 'other', status: 'open', requester: 8, updatedAt: 1, createdAt: 1, tags: [] }],
    ]);
    this.users = new Map([[7, { id: 7, name: 'Carla', email: 'c@x.io', createdAt: 1, updatedAt: 1, tags: [] }], [8, { id: 8, name: 'Zed', email: 'z@x.io', createdAt: 1, updatedAt: 1, tags: [] }]]);
    this.orgs = new Map();
    this.articles = new Map();
    this.members = { me: { uuid: 'me', name: 'Me', role: 'agent', active: true } };
    this.me = this.members.me;
    this.cfg = { groups: [] };
    this.meta = { name: 'A' };
    this.status = 'live';
  }
  isAdmin() { return false; }
  agents() { return Object.values(this.members); }
  ticketsFor(f) { return [...this.tickets.values()].filter(f); }
}

let cleanup = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.textContent = '';
});

function setup(mount, ctx) {
  app.replica = new FakeReplica();
  const main = document.createElement('main');
  document.body.append(main);
  cleanup = mount(main, ctx);
  return main;
}

describe('live updates', () => {
  it('keep focus on the same card on Home', () => {
    const main = setup(mountHome, { route: { query: {} } });
    const card = main.querySelectorAll('.home-card')[1];
    const href = card.getAttribute('href');
    card.focus();
    app.replica.tickets.set(99, { ...app.replica.tickets.get(99), updatedAt: 5 });
    app.replica.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set(['t']), ids: { t: new Set([99]) } } }));
    expect(document.activeElement.getAttribute('href')).toBe(href);
  });

  it('leave a customer profile alone for other customers\' tickets', () => {
    const main = setup(mountCustomer, { id: 7 });
    const row = main.querySelector('tbody tr');
    row.focus();
    app.replica.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set(['t']), ids: { t: new Set([99]) } } }));
    expect(document.activeElement).toBe(row);
    // A change to one of theirs repaints, keeping the focused row.
    const key = row.dataset.key;
    app.replica.tickets.set(2, { ...app.replica.tickets.get(2), subject: 'B2', updatedAt: 9 });
    app.replica.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set(['t']), ids: { t: new Set([2]) } } }));
    expect(main.textContent).toContain('B2');
    expect(document.activeElement.dataset.key).toBe(key);
  });

  it('keep focus on the same view link as counts change', async () => {
    const main = setup(mountViews, { id: 'sys-mine', route: { path: ['views', 'sys-mine'], query: {} } });
    const link = main.querySelector('.side-link[href="#/views/sys-unassigned"]');
    link.focus();
    app.replica.tickets.set(3, { id: 3, subject: 'C', status: 'new', requester: 7, updatedAt: 3, createdAt: 3, tags: [] });
    app.replica.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set(['t']), ids: { t: new Set([3]) } } }));
    await new Promise((r) => setTimeout(r, 300));
    expect(document.activeElement.getAttribute('href')).toBe('#/views/sys-unassigned');
  });

  it('follow a view a teammate edits, or deletes', async () => {
    app.replica = new FakeReplica();
    const cond = (status) => ({ all: [{ field: 'status', op: 'is', value: status }], any: [] });
    app.replica.cfg.views = [{ id: 'vshared1', title: 'Open ones', active: true, conditions: cond('open'), columns: ['subject'] }];
    app.replica.tickets.set(3, { id: 3, subject: 'C', status: 'pending', requester: 7, updatedAt: 3, createdAt: 3, tags: [] });
    const main = document.createElement('main');
    document.body.append(main);
    history.replaceState(null, '', '#/views/vshared1');
    cleanup = mountViews(main, { id: 'vshared1' });
    expect(main.querySelector('.view-count').textContent).toBe('3 tickets');
    const change = () => app.replica.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set(['c']) } }));
    app.replica.cfg = { ...app.replica.cfg, views: [{ id: 'vshared1', title: 'Waiting', active: true, conditions: cond('pending'), columns: ['subject'] }] };
    change();
    expect(main.querySelector('.view-count').textContent).toBe('1 ticket');
    expect(main.querySelector('h1').textContent).toBe('Waiting');
    app.replica.cfg = { ...app.replica.cfg, views: [] };
    change();
    expect(location.hash).toBe('#/views/sys-mine');
  });

  it('keep the sort chosen on a view when the views change', async () => {
    app.replica = new FakeReplica();
    const view = { id: 'vshared2', title: 'Open ones', active: true, conditions: { all: [{ field: 'status', op: 'is', value: 'open' }], any: [] }, columns: ['subject', 'updatedAt'] };
    app.replica.cfg.views = [view];
    const main = document.createElement('main');
    document.body.append(main);
    history.replaceState(null, '', '#/views/vshared2');
    cleanup = mountViews(main, { id: 'vshared2' });
    const subject = () => [...main.querySelectorAll('th')].find((th) => th.textContent.includes('Subject'));
    subject().querySelector('button').click();
    const chosen = subject().getAttribute('aria-sort');
    expect(chosen).toBeTruthy();
    const change = () => app.replica.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set(['c']) } }));
    // Another view is added: this one is unchanged, but a new copy.
    app.replica.cfg = { ...app.replica.cfg, views: [{ ...view }, { ...view, id: 'vother12', title: 'Other' }] };
    change();
    expect(subject().getAttribute('aria-sort')).toBe(chosen);
    // This one is renamed: its sort stays the agent's choice.
    app.replica.cfg = { ...app.replica.cfg, views: [{ ...view, title: 'Open tickets' }] };
    change();
    expect(main.querySelector('h1').textContent).toBe('Open tickets');
    expect(subject().getAttribute('aria-sort')).toBe(chosen);
  });

  it('keep focus on the same row in the customer list', () => {
    const main = setup(mountCustomers, { route: { query: {} } });
    const rows = main.querySelectorAll('tbody tr');
    rows[1].focus();
    const key = rows[1].dataset.key;
    app.replica.dispatchEvent(new CustomEvent('change', { detail: { kinds: new Set(['t']), ids: { t: new Set([1]) } } }));
    expect(document.activeElement.dataset.key).toBe(key);
    expect(document.activeElement.tabIndex).toBe(0);
  });
});
