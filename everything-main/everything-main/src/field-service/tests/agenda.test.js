import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { agendaItems, filterByMembers, setAgendaComplete, moveAgendaItem } from '../src/core/agenda.js';
import { layoutOverlaps } from '../src/core/layout.js';
import { createSearchIndex } from '../src/core/search.js';

let store;
beforeEach(async () => {
  store = createStore({ backend: createMemoryBackend(), flushDelay: 10_000 });
  await store.init();
  store.put('jobs', { id: 'j', title: 'Mow', clientId: 'c', assignees: ['a'], visits: [{ id: 'v1', date: '2026-10-12', start: '09:00', end: '10:00', assignees: ['a'] }, { id: 'v2', date: '2026-10-19', start: '', assignees: [] }, { id: 'v3', date: null }] });
  store.put('requests', { id: 'r', title: 'Leak', assessment: { date: '2026-10-12', start: '08:00', end: '08:30', assignees: ['b'] } });
  store.put('events', { id: 'e', kind: 'task', title: 'Order parts', date: '2026-10-12', start: '', assignees: [] });
});

describe('agenda', () => {
  it('merges visits, assessments and tasks in time order', () => {
    const items = agendaItems(store, { from: '2026-10-12', to: '2026-10-12' });
    expect(items.map((i) => i.kind)).toEqual(['assessment', 'visit', 'task']);
    expect(items[0].title).toBe('Assessment: Leak');
  });

  it('can include undated visits', () => {
    expect(agendaItems(store, { includeUndated: true }).some((i) => i.visitId === 'v3')).toBe(true);
  });

  it('filters by team member, including unassigned work', () => {
    const items = agendaItems(store, {});
    expect(filterByMembers(items, ['a']).map((i) => i.key)).toEqual(['v:j:v1']);
    expect(filterByMembers(items, ['unassigned']).map((i) => i.kind)).toEqual(['task', 'visit']);
  });

  it('completes and moves each kind of item', () => {
    const [assess, visit, task] = agendaItems(store, { from: '2026-10-12', to: '2026-10-12' });
    setAgendaComplete(store, visit, true);
    setAgendaComplete(store, assess, true);
    setAgendaComplete(store, task, true);
    expect(store.get('jobs', 'j').visits[0].completedAt).toBeTruthy();
    expect(store.get('requests', 'r').assessment.completedAt).toBeTruthy();
    expect(store.get('events', 'e').completedAt).toBeTruthy();
    moveAgendaItem(store, visit, { date: '2026-10-14', start: '13:00', end: '14:00' });
    expect(store.get('jobs', 'j').visits[0]).toMatchObject({ date: '2026-10-14', start: '13:00', end: '14:00' });
  });
});

describe('calendar layout', () => {
  it('places overlapping items side by side', () => {
    const out = layoutOverlaps([
      { key: 'a', start: '09:00', end: '11:00' },
      { key: 'b', start: '10:00', end: '12:00' },
      { key: 'c', start: '10:30', end: '11:30' },
      { key: 'd', start: '13:00', end: '14:00' },
    ]);
    const by = Object.fromEntries(out.map((o) => [o.it.key, o]));
    expect(by.a.width).toBeCloseTo(1 / 3);
    expect(new Set([by.a.left, by.b.left, by.c.left]).size).toBe(3);
    expect(by.d).toMatchObject({ left: 0, width: 1 });
  });

  it('reuses a column once it frees up', () => {
    const out = layoutOverlaps([
      { key: 'a', start: '09:00', end: '10:00' },
      { key: 'b', start: '09:30', end: '11:00' },
      { key: 'c', start: '10:00', end: '10:30' },
    ]);
    const by = Object.fromEntries(out.map((o) => [o.it.key, o]));
    expect(by.c.left).toBe(by.a.left);
    expect(by.a.width).toBe(0.5);
  });
});

describe('search', () => {
  it('finds records by name, number and client, accent-insensitively', () => {
    store.put('clients', { id: 'c', firstName: 'José', lastName: 'Álvarez', emails: [{ address: 'jose@example.com' }] });
    store.put('quotes', { clientId: 'c', number: 42, title: 'Patio' });
    const search = createSearchIndex(store);
    expect(search('jose alv')[0].items[0].title).toBe('José Álvarez');
    const byNumber = search('#42').find((g) => g.coll === 'quotes');
    expect(byNumber.items[0].title).toBe('Quote #42: Patio');
    expect(search('alvarez').find((g) => g.coll === 'quotes').items).toHaveLength(1);
    expect(search('')).toEqual([]);
  });
});
