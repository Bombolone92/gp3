import { describe, it, expect, beforeEach } from 'vitest';
import { buildBackup, describeBackup, validateBackup, BACKUP_SCHEMA_VERSION } from '../src/core/backup.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

let backend;
let store;

beforeEach(async () => {
  backend = createMemoryBackend();
  store = createStore(backend, {
    now: () => '2026-08-04T09:00:00.000Z',
    today: () => '2026-08-04',
  });
  await store.init();
});

async function seed() {
  const ava = await store.addEmployee({ name: 'Ava', role: 'Lead' });
  const liam = await store.addEmployee({ name: 'Liam', role: 'Barista' });
  const shift = await store.addShift({
    date: '2026-08-05',
    start: '09:00',
    end: '17:00',
    role: 'Floor',
    assigneeId: ava.id,
  });
  await store.addTimeOff(liam.id, { from: '2026-08-10', to: '2026-08-11', note: 'Trip' });
  await store.recordAttendance(shift.id, { status: 'present', clockIn: '09:00', clockOut: '17:00' });
  return { ava, liam, shift };
}

describe('buildBackup', () => {
  it('captures every collection plus settings and a schema version', async () => {
    await seed();
    const backup = buildBackup(store.state, { exportedAt: '2026-08-04T10:00:00.000Z' });
    expect(backup.app).toBe('shifts');
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(backup.exportedAt).toBe('2026-08-04T10:00:00.000Z');
    expect(backup.employees).toHaveLength(2);
    expect(backup.shifts).toHaveLength(1);
    expect(Object.keys(backup.attendance)).toHaveLength(1);
    expect(backup.settings).toBeTruthy();
    expect(validateBackup(backup)).toEqual([]);
  });

  it('leaves the share-site pointer out of the export', async () => {
    await store.updateSettings({ shareSite: { subdomain: 'shifts-abc' } });
    const backup = buildBackup(store.state);
    expect(backup.settings.shareSite).toBeUndefined();
  });
});

describe('validateBackup', () => {
  it('rejects non-backup values', () => {
    expect(validateBackup(null)).toHaveLength(1);
    expect(validateBackup([])).toHaveLength(1);
    expect(validateBackup({ app: 'other' })).toHaveLength(1);
    expect(validateBackup('{}')).toHaveLength(1);
  });

  it('rejects newer schema versions and missing collections', () => {
    const good = buildBackup(store.state);
    expect(validateBackup({ ...good, schemaVersion: BACKUP_SCHEMA_VERSION + 1 })[0]).toMatch(/newer/i);
    expect(validateBackup({ ...good, schemaVersion: 'x' })[0]).toMatch(/version/i);
    expect(validateBackup({ ...good, shifts: undefined })).not.toEqual([]);
    expect(validateBackup({ ...good, attendance: [] })).not.toEqual([]);
  });

  it('rejects malformed records inside collections', () => {
    const good = buildBackup(store.state);
    expect(validateBackup({ ...good, employees: [{ name: 'No id' }] })).not.toEqual([]);
    expect(validateBackup({ ...good, shifts: [{ id: 's1' }] })).not.toEqual([]);
  });
});

describe('describeBackup', () => {
  it('summarizes contents with counts', async () => {
    await seed();
    const text = describeBackup(buildBackup(store.state));
    expect(text).toContain('2 employees');
    expect(text).toContain('1 shift');
    expect(text).toContain('1 attendance record');
    expect(text).toContain('1 time-off entry');
  });
});

describe('store.importData', () => {
  it('replaces every collection and persists them', async () => {
    await seed();
    const backup = buildBackup(store.state);

    const fresh = createStore(createMemoryBackend());
    await fresh.init();
    await fresh.importData(JSON.parse(JSON.stringify(backup)));

    expect(fresh.state.employees.map((e) => e.name)).toEqual(['Ava', 'Liam']);
    expect(fresh.state.shifts).toHaveLength(1);
    expect(Object.keys(fresh.state.attendance)).toHaveLength(1);
    expect(fresh.state.settings.onboarded).toBe(true);
  });

  it('keeps the current account share site and rejects invalid files', async () => {
    await store.updateSettings({ shareSite: { subdomain: 'mine' } });
    const backup = buildBackup(store.state);
    backup.settings.shareSite = { subdomain: 'theirs' };
    await store.importData(backup);
    expect(store.state.settings.shareSite).toEqual({ subdomain: 'mine' });

    await expect(store.importData({ app: 'shifts' })).rejects.toThrow();
  });

  it('overwrites existing data completely', async () => {
    await seed();
    const emptyBackup = buildBackup({
      employees: [],
      shifts: [],
      availability: {},
      swaps: [],
      attendance: {},
      settings: { onboarded: true, sampleData: false, coverage: [] },
    });
    await store.importData(emptyBackup);
    expect(store.state.employees).toEqual([]);
    expect(store.state.shifts).toEqual([]);
    expect(backend.peek('employees')).toEqual([]);
  });
});
