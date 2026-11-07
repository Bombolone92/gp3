import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installPuterMock } from './helpers/puter-mock.js';
import { Store } from '../src/lib/store.js';
import {
  normalizeSavedView, viewsForScope, chipsForScope, sameViewFilter,
  pruneViewFilter, planViewReorder, BUILT_IN_VIEWS, ALL_SCOPE,
} from '../src/lib/savedviews.js';
import { emptyFilter } from '../src/lib/filters.js';

const view = (patch = {}) => ({
  id: 'v1',
  name: 'Mine',
  scope: 'p1',
  filter: { ...emptyFilter(), labelIds: ['l1'], due: ['week'] },
  sort: { key: 'due', dir: 'asc' },
  group: 'due',
  createdAt: 1,
  ...patch,
});

describe('normalizeSavedView', () => {
  it('keeps a well-formed view as it is', () => {
    expect(normalizeSavedView(view())).toEqual(view());
  });

  it('refuses anything without an id or a name', () => {
    expect(normalizeSavedView(null)).toBe(null);
    expect(normalizeSavedView({ name: 'No id' })).toBe(null);
    expect(normalizeSavedView({ id: 'v', name: '   ' })).toBe(null);
  });

  it('fills in a filter that is missing pieces, and drops nonsense', () => {
    const v = normalizeSavedView({ id: 'v', name: 'Sparse', filter: { labelIds: ['a', 7] } });
    expect(v.filter).toEqual({
      text: '', labelIds: ['a'], assigneeIds: [], priorities: [], due: [],
    });
    expect(v.sort).toEqual({ key: 'board', dir: 'asc' });
    expect(v.group).toBe('column');
    expect(v.scope).toBe(ALL_SCOPE);
  });

  it('keeps the deliberate null in the priority facet', () => {
    const v = normalizeSavedView({ id: 'v', name: 'None', filter: { priorities: [null, 'high'] } });
    expect(v.filter.priorities).toEqual([null, 'high']);
  });

  it('drops a due bucket this app does not have', () => {
    const v = normalizeSavedView({ id: 'v', name: 'Odd', filter: { due: ['week', 'someday'] } });
    expect(v.filter.due).toEqual(['week']);
  });
});

describe('viewsForScope', () => {
  it('keeps only the scope asked for, in order', () => {
    const views = [
      view({ id: 'a', scope: 'p1', name: 'A' }),
      view({ id: 'b', scope: 'p2', name: 'B' }),
      view({ id: 'c', scope: 'p1', name: 'C' }),
    ];
    expect(viewsForScope(views, 'p1').map((v) => v.id)).toEqual(['a', 'c']);
    expect(viewsForScope(views, ALL_SCOPE)).toEqual([]);
    expect(viewsForScope(undefined, 'p1')).toEqual([]);
  });

  it('leads with the built-ins, which every scope has', () => {
    const chips = chipsForScope([view()], 'p1');
    expect(chips.slice(0, 3).map((v) => v.name))
      .toEqual(BUILT_IN_VIEWS.map((v) => v.name));
    expect(chips[3].name).toBe('Mine');
    expect(chips.every((v) => v.filter && v.sort && v.group)).toBe(true);
  });
});

describe('sameViewFilter', () => {
  it('ignores the order values were picked in', () => {
    expect(sameViewFilter(
      { ...emptyFilter(), priorities: ['high', 'urgent'] },
      { ...emptyFilter(), priorities: ['urgent', 'high'] },
    )).toBe(true);
  });

  it('is not fooled by a longer list or different text', () => {
    expect(sameViewFilter(
      { ...emptyFilter(), due: ['week'] },
      { ...emptyFilter(), due: ['week', 'today'] },
    )).toBe(false);
    expect(sameViewFilter({ ...emptyFilter(), text: 'a' }, emptyFilter())).toBe(false);
    // Whitespace-only text is no filter at all, in either of them.
    expect(sameViewFilter({ ...emptyFilter(), text: '  ' }, emptyFilter())).toBe(true);
  });
});

describe('pruneViewFilter', () => {
  it('drops the refs a scope no longer has, and counts them', () => {
    const { filter, dropped } = pruneViewFilter(
      { ...emptyFilter(), labelIds: ['l1', 'gone'], assigneeIds: ['m1'] },
      { labelIds: ['l1'], assigneeIds: [] },
    );
    expect(filter.labelIds).toEqual(['l1']);
    expect(filter.assigneeIds).toEqual([]);
    expect(dropped).toBe(2);
  });

  it('leaves a filter alone when everything still resolves', () => {
    const filter = { ...emptyFilter(), labelIds: ['l1'], due: ['overdue'] };
    const result = pruneViewFilter(filter, { labelIds: ['l1'], assigneeIds: [] });
    expect(result.dropped).toBe(0);
    expect(result.filter).toEqual(filter);
  });
});

describe('planViewReorder', () => {
  const views = () => [
    view({ id: 'a', scope: 'p1' }),
    view({ id: 'x', scope: 'p2' }),
    view({ id: 'b', scope: 'p1' }),
    view({ id: 'c', scope: 'p1' }),
  ];

  it('moves within a scope and leaves other scopes exactly where they were', () => {
    const next = planViewReorder(views(), 'p1', 'c', 0);
    expect(next.map((v) => v.id)).toEqual(['c', 'x', 'a', 'b']);
  });

  it('has nothing to write when the move changes nothing', () => {
    expect(planViewReorder(views(), 'p1', 'a', 0)).toBe(null);
    expect(planViewReorder(views(), 'p1', 'ghost', 1)).toBe(null);
  });
});

describe('the store side of saved views', () => {
  let mock;
  let store;

  beforeEach(async () => {
    vi.useFakeTimers();
    mock = installPuterMock({ username: 'nadia' });
    store = new Store();
    await store.init();
  });

  it('saves, renames, reorders, and deletes, surviving a reload', async () => {
    const a = await store.saveView({ name: 'Mine', scope: 'p1', filter: { due: ['week'] } });
    const b = await store.saveView({ name: 'Theirs', scope: 'p1', filter: {} });
    expect(store.views).toHaveLength(2);

    await store.renameView(a.id, 'Renamed');
    expect(await store.moveView('p1', b.id, 0)).toBe(true);

    const fresh = new Store();
    await fresh.init();
    expect(viewsForScope(fresh.views, 'p1').map((v) => v.name)).toEqual(['Theirs', 'Renamed']);

    await store.deleteView(a.id);
    const third = new Store();
    await third.init();
    expect(third.views.map((v) => v.name)).toEqual(['Theirs']);
  });

  it('refuses a nameless view', async () => {
    await expect(store.saveView({ name: '  ', scope: 'p1' })).rejects.toThrow(/needs a name/);
  });

  it('remembers the view a scope was last looked at through', async () => {
    const v = await store.saveView({ name: 'Morning', scope: 'p1', filter: {} });
    await store.rememberView('p1', v.id);
    expect(store.lastViewFor('p1')).toBe(v.id);

    const fresh = new Store();
    await fresh.init();
    expect(fresh.lastViewFor('p1')).toBe(v.id);
    expect(fresh.lastViewFor('p2')).toBe(null);

    await store.rememberView('p1', null);
    expect(store.lastViewFor('p1')).toBe(null);
  });

  it('drops a stored view that is no longer readable rather than trusting it', async () => {
    mock._kv.set('pm:views:v1', JSON.stringify([
      { id: 'ok', name: 'Fine', scope: 'p1', filter: {} },
      { name: 'No id' },
      'nonsense',
    ]));
    const fresh = new Store();
    await fresh.init();
    expect(fresh.views.map((v) => v.name)).toEqual(['Fine']);
  });
});
