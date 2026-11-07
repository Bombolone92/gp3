import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTER,
  describeFilter,
  isFiltered,
  normalizeFilter,
  rowMatchesFilter,
  shiftMatchesFilter,
} from '../src/core/filters.js';
import { buildWeekSnapshot } from '../src/core/share.js';

const shift = (id, role, assigneeId = null) => ({
  id,
  date: '2026-08-17',
  start: '09:00',
  end: '17:00',
  role,
  assigneeId,
});

describe('filter state', () => {
  it('treats an empty or absent filter as no filter at all', () => {
    expect(isFiltered(null)).toBe(false);
    expect(isFiltered(EMPTY_FILTER)).toBe(false);
    expect(isFiltered({ roles: ['Kitchen'] })).toBe(true);
    expect(isFiltered({ employees: ['e1'] })).toBe(true);
    expect(isFiltered({ openOnly: true })).toBe(true);
    expect(isFiltered({ understaffedOnly: true })).toBe(true);
  });

  it('fills in every field from partial input', () => {
    expect(normalizeFilter({ roles: ['Kitchen'] })).toEqual({
      roles: ['Kitchen'],
      employees: [],
      openOnly: false,
      understaffedOnly: false,
    });
    expect(normalizeFilter(undefined)).toEqual(EMPTY_FILTER);
  });

  it('describes itself for the filtered flag', () => {
    const state = { employees: [{ id: 'e1', name: 'Ava Chen' }] };
    expect(describeFilter({ roles: ['Kitchen'] }, state)).toBe('Kitchen');
    expect(describeFilter({ roles: ['Kitchen', 'Floor'] }, state)).toBe('2 roles');
    expect(describeFilter({ employees: ['e1'] }, state)).toBe('Ava Chen');
    expect(describeFilter({ employees: ['e1', 'e2'] }, state)).toBe('2 people');
    expect(describeFilter({ roles: ['Kitchen'], openOnly: true }, state)).toBe(
      'Kitchen · open shifts only'
    );
    expect(describeFilter({ understaffedOnly: true }, state)).toBe('understaffed days only');
  });
});

describe('shiftMatchesFilter', () => {
  it('keeps everything with no filter', () => {
    expect(shiftMatchesFilter(shift('s1', 'Floor', 'e1'), null)).toBe(true);
    expect(shiftMatchesFilter(shift('s1', 'Floor', 'e1'), EMPTY_FILTER)).toBe(true);
  });

  it('matches roles case-insensitively and ignoring surrounding space', () => {
    const filter = { roles: ['Kitchen'] };
    expect(shiftMatchesFilter(shift('s1', ' kitchen '), filter)).toBe(true);
    expect(shiftMatchesFilter(shift('s2', 'Floor'), filter)).toBe(false);
  });

  it('drops assigned shifts under "open shifts only"', () => {
    const filter = { openOnly: true };
    expect(shiftMatchesFilter(shift('s1', 'Floor'), filter)).toBe(true);
    expect(shiftMatchesFilter(shift('s2', 'Floor', 'e1'), filter)).toBe(false);
  });

  it('keeps open shifts visible when people are picked', () => {
    const filter = { employees: ['e1'] };
    expect(shiftMatchesFilter(shift('s1', 'Floor', 'e1'), filter)).toBe(true);
    expect(shiftMatchesFilter(shift('s2', 'Floor', 'e2'), filter)).toBe(false);
    // Nobody holds an open shift yet, so it is everybody's business.
    expect(shiftMatchesFilter(shift('s3', 'Floor'), filter)).toBe(true);
  });
});

describe('rowMatchesFilter', () => {
  it('keeps every row with no filter, even an empty one', () => {
    expect(rowMatchesFilter(EMPTY_FILTER, 'e1', 0)).toBe(true);
    expect(rowMatchesFilter(null, null, 0)).toBe(true);
  });

  it('keeps a person picked by name even on a week with nothing in it', () => {
    expect(rowMatchesFilter({ employees: ['e1'] }, 'e1', 0)).toBe(true);
    expect(rowMatchesFilter({ employees: ['e1'] }, 'e2', 5)).toBe(false);
  });

  it('makes other rows earn their place with a matching shift', () => {
    expect(rowMatchesFilter({ roles: ['Kitchen'] }, 'e1', 0)).toBe(false);
    expect(rowMatchesFilter({ roles: ['Kitchen'] }, 'e1', 2)).toBe(true);
    // The open-shifts row has no name to be picked by.
    expect(rowMatchesFilter({ employees: ['e1'] }, null, 0)).toBe(false);
    expect(rowMatchesFilter({ employees: ['e1'] }, null, 1)).toBe(true);
  });

  it('requires a matching shift even from a named person once a role filter is on', () => {
    expect(rowMatchesFilter({ employees: ['e1'], roles: ['Kitchen'] }, 'e1', 0)).toBe(false);
    expect(rowMatchesFilter({ employees: ['e1'], openOnly: true }, 'e1', 0)).toBe(false);
  });

  it('keeps every row when only the understaffed-days toggle is on', () => {
    // The toggle narrows days, not shifts. Whoever is free on a short day
    // is exactly who has nothing on it, so their row has to stay for the
    // missing shift to be added to.
    expect(rowMatchesFilter({ understaffedOnly: true }, 'e1', 0)).toBe(true);
    expect(rowMatchesFilter({ understaffedOnly: true }, null, 0)).toBe(true);
  });

  it('still makes rows earn their place when a shift filter joins it', () => {
    expect(rowMatchesFilter({ understaffedOnly: true, roles: ['Kitchen'] }, 'e1', 0)).toBe(false);
    expect(rowMatchesFilter({ understaffedOnly: true, roles: ['Kitchen'] }, 'e1', 1)).toBe(true);
  });
});

describe('buildWeekSnapshot with a filter', () => {
  const state = {
    employees: [
      { id: 'e1', name: 'Ava Chen', role: 'Kitchen', active: true, color: '#000' },
      { id: 'e2', name: 'Liam Torres', role: 'Floor', active: true, color: '#111' },
    ],
    shifts: [
      { id: 's1', date: '2026-08-17', start: '09:00', end: '17:00', role: 'Kitchen', assigneeId: 'e1' },
      { id: 's2', date: '2026-08-18', start: '10:00', end: '18:00', role: 'Floor', assigneeId: 'e2' },
      { id: 's3', date: '2026-08-19', start: '12:00', end: '20:00', role: 'Floor', assigneeId: null },
    ],
    availability: {},
  };

  it('publishes the whole week when nothing is filtered', () => {
    const page = buildWeekSnapshot(state, '2026-08-17', { generatedAt: '2026-08-17' });
    expect(page).toContain('Ava Chen');
    expect(page).toContain('Liam Torres');
    expect(page).toContain('Open shifts');
    expect(page).not.toContain('This is not the whole week');
  });

  it('drops the rows a role filter leaves empty and says the page is narrowed', () => {
    const page = buildWeekSnapshot(state, '2026-08-17', {
      generatedAt: '2026-08-17',
      filter: { roles: ['Kitchen'] },
    });
    expect(page).toContain('Ava Chen');
    expect(page).not.toContain('Liam Torres');
    expect(page).toContain('Showing Kitchen. This is not the whole week.');
    // The open Floor shift goes with its role, and its row with it.
    expect(page).not.toContain('Open shifts');
  });

  it('keeps a picked person and the open shifts, and drops everyone else', () => {
    const page = buildWeekSnapshot(state, '2026-08-17', {
      generatedAt: '2026-08-17',
      filter: { employees: ['e1'] },
    });
    expect(page).toContain('Ava Chen');
    expect(page).not.toContain('Liam Torres');
    expect(page).toContain('Open shifts');
    expect(page).toContain('Showing Ava Chen.');
  });

  it('leaves only the open shifts under "open shifts only"', () => {
    const page = buildWeekSnapshot(state, '2026-08-17', {
      generatedAt: '2026-08-17',
      filter: { openOnly: true },
    });
    expect(page).toContain('Open shifts');
    expect(page).not.toContain('Ava Chen');
    expect(page).not.toContain('Liam Torres');
  });

  it('escapes the filter description like every other piece of user content', () => {
    const page = buildWeekSnapshot(state, '2026-08-17', {
      generatedAt: '2026-08-17',
      filter: { roles: ['<script>alert(1)</script>'] },
    });
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('&lt;script&gt;');
  });
});
