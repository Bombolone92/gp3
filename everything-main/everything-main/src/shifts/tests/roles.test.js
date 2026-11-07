import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildBackup } from '../src/core/backup.js';

let backend;
let store;

const shift = (role, date = '2026-08-05') => ({
  date,
  start: '09:00',
  end: '17:00',
  role,
});

beforeEach(async () => {
  backend = createMemoryBackend();
  store = createStore(backend, {
    now: () => '2026-08-04T09:00:00.000Z',
    today: () => '2026-08-04',
  });
  await store.init();
});

describe('role list management', () => {
  it('adds roles, rejects blanks and case-insensitive duplicates, keeps the list sorted', async () => {
    await store.addRole({ name: 'Close', color: '#8b5cf6' });
    await store.addRole({ name: 'Barista' });
    expect(store.state.settings.roles.map((r) => r.name)).toEqual(['Barista', 'Close']);
    await expect(store.addRole({ name: '  ' })).rejects.toThrow(/name/i);
    await expect(store.addRole({ name: 'barista' })).rejects.toThrow(/exists/i);
    expect(backend.peek('settings').roles).toHaveLength(2);
  });

  it('ensureRole appends unknown labels once and ignores blanks', async () => {
    await store.ensureRole('Barista');
    await store.ensureRole(' barista ');
    await store.ensureRole('');
    expect(store.state.settings.roles.map((r) => r.name)).toEqual(['Barista']);
  });
});

describe('rename cascade', () => {
  it('renames across shifts, employees, and coverage in one action', async () => {
    const emp = await store.addEmployee({ name: 'Ava', role: 'barista ' });
    await store.addShift(shift('Barista'));
    await store.addShift(shift('Floor', '2026-08-06'));
    await store.addCoverage({ role: 'Barista', days: [1], count: 1 });
    const role = await store.addRole({ name: 'Barista' });

    await store.updateRole(role.id, { name: 'Coffee Lead' });

    expect(store.state.shifts.map((s) => s.role).sort()).toEqual(['Coffee Lead', 'Floor']);
    expect(store.state.employees.find((e) => e.id === emp.id).role).toBe('Coffee Lead');
    expect(store.state.settings.coverage[0].role).toBe('Coffee Lead');
    expect(backend.peek('shifts').map((s) => s.role).sort()).toEqual(['Coffee Lead', 'Floor']);
    expect(backend.peek('employees')[0].role).toBe('Coffee Lead');
  });

  it('changes color without touching records and validates renames', async () => {
    await store.addShift(shift('Barista'));
    const role = await store.addRole({ name: 'Barista' });
    const other = await store.addRole({ name: 'Close' });

    await store.updateRole(role.id, { color: '#0ea5e9' });
    expect(store.state.settings.roles.find((r) => r.id === role.id).color).toBe('#0ea5e9');

    await expect(store.updateRole(role.id, { name: 'close' })).rejects.toThrow(/exists/i);
    await expect(store.updateRole(other.id, { name: ' ' })).rejects.toThrow(/name/i);
  });
});

describe('delete role', () => {
  it('keeps labels by default', async () => {
    await store.addShift(shift('Barista'));
    const role = await store.addRole({ name: 'Barista' });
    await store.deleteRole(role.id);
    expect(store.state.settings.roles).toEqual([]);
    expect(store.state.shifts[0].role).toBe('Barista');
  });

  it('clears records and drops matching coverage when asked', async () => {
    const emp = await store.addEmployee({ name: 'Ava', role: 'Barista' });
    await store.addShift(shift('Barista'));
    await store.addCoverage({ role: 'Barista', days: [1], count: 1 });
    await store.addCoverage({ role: 'Close', days: [2], count: 1 });
    const role = await store.addRole({ name: 'Barista' });

    await store.deleteRole(role.id, { clearRecords: true });

    expect(store.state.shifts[0].role).toBe('');
    expect(store.state.employees.find((e) => e.id === emp.id).role).toBe('');
    expect(store.state.settings.coverage.map((c) => c.role)).toEqual(['Close']);
  });
});

describe('soft migration', () => {
  it('seeds the role list from existing data on first load without one', async () => {
    // Simulate a pre-roles dataset: records exist, settings never had roles.
    await backend.save('shifts', [
      { id: 's1', ...shift('Barista') },
      { id: 's2', ...shift(' barista ', '2026-08-06') },
      { id: 's3', ...shift('Close', '2026-08-07') },
    ]);
    await backend.save('employees', [{ id: 'e1', name: 'Ava', role: 'Kitchen', active: true }]);
    await backend.save('settings', { onboarded: true, sampleData: false, coverage: [] });

    const migrated = createStore(backend);
    await migrated.init();
    expect(migrated.state.settings.roles.map((r) => r.name)).toEqual(['Barista', 'Close', 'Kitchen']);
    expect(backend.peek('settings').roles).toHaveLength(3);
  });

  it('does not reseed once a roles list exists, even an empty one', async () => {
    await backend.save('shifts', [{ id: 's1', ...shift('Barista') }]);
    await backend.save('settings', { onboarded: true, roles: [] });
    const rehydrated = createStore(backend);
    await rehydrated.init();
    expect(rehydrated.state.settings.roles).toEqual([]);
  });

  it('derives roles when importing a backup that predates them', async () => {
    await store.addShift(shift('Barista'));
    const backup = buildBackup(store.state);
    delete backup.settings.roles;

    const fresh = createStore(createMemoryBackend());
    await fresh.init();
    await fresh.importData(backup);
    expect(fresh.state.settings.roles.map((r) => r.name)).toEqual(['Barista']);
  });
});
