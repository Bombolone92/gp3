import { describe, it, expect } from 'vitest';
import { parseQuery, searchTickets, searchUsers, searchOrgs } from '../src/client/search.js';

function replica() {
  const users = new Map([[1, { id: 1, name: 'Ann Lee', email: 'ann@x.io' }], [2, { id: 2, name: 'Bo Kim', email: 'bo@y.io' }]]);
  const tickets = new Map([
    [1, { id: 1, subject: 'Refund for order', desc: 'Please refund', status: 'open', requester: 1, updatedAt: 2, tags: [] }],
    [2, { id: 2, subject: 'Login broken', desc: 'Error: 500 on sign in at 10:30', status: 'pending', requester: 2, updatedAt: 1, tags: [] }],
  ]);
  return { users, orgs: new Map(), tickets, members: {}, cfg: { groups: [] }, me: { uuid: 'me' } };
}

describe('ticket search', () => {
  it('treats only known fields as filters', () => {
    expect(parseQuery('status:open refund').filters).toEqual([{ field: 'status', value: 'open' }]);
    expect(parseQuery('re:refund').filters).toEqual([]);
    expect(parseQuery('re:refund').text).toEqual(['re:refund']);
    const r = replica();
    expect(searchTickets(r, 're:refund').map((t) => t.id)).toEqual([]);
    expect(searchTickets(r, '10:30').map((t) => t.id)).toEqual([2]);
    expect(searchTickets(r, 'Error: 500').map((t) => t.id)).toEqual([2]);
    expect(searchTickets(r, 'status:pending').map((t) => t.id)).toEqual([2]);
  });
});

describe('ticket search after a rename', () => {
  it('finds tickets by the customer\'s new name', () => {
    const r = replica();
    expect(searchTickets(r, 'ann').map((t) => t.id)).toEqual([1]);
    r.users.set(1, { id: 1, name: 'Annabel Stone', email: 'ann@x.io' });
    expect(searchTickets(r, 'stone').map((t) => t.id)).toEqual([1]);
    expect(searchTickets(r, 'lee').map((t) => t.id)).toEqual([]);
  });
});

describe('customer and organization search', () => {
  it('reads quoted names and a trailing colon like a ticket search', () => {
    const r = replica();
    r.orgs.set(1, { id: 1, name: 'Acme Corp', domains: ['acme.io'] });
    expect(searchUsers(r, '"Ann Lee"').map((u) => u.id)).toEqual([1]);
    expect(searchOrgs(r, '"acme corp"').map((o) => o.id)).toEqual([1]);
    expect(searchOrgs(r, 'acme:').map((o) => o.id)).toEqual([1]);
  });

  it('lists the first names first however many match', () => {
    const r = replica();
    r.users.clear();
    for (let i = 1; i < 1000; i++) r.users.set(i, { id: i, name: `Zara ${i}` });
    r.users.set(1000, { id: 1000, name: 'Aaron Able' });
    expect(searchUsers(r, 'a', 10)[0].name).toBe('Aaron Able');
  });
});
