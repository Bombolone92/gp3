import { describe, it, expect, beforeEach } from 'vitest';
import {
  SNAPSHOT_LIMIT,
  createMemorySnapshotFS,
  createSnapshotStore,
  describeReason,
  parseSnapshotName,
  snapshotName,
} from '../src/core/snapshots.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSeedData } from '../src/core/seed.js';

const state = (employees = 1, shifts = 1) => ({
  employees: Array.from({ length: employees }, (_, i) => ({ id: `e${i}`, name: `Person ${i}`, active: true })),
  shifts: Array.from({ length: shifts }, (_, i) => ({
    id: `s${i}`,
    date: '2026-08-20',
    start: '09:00',
    end: '17:00',
    role: 'Floor',
    assigneeId: 'e0',
  })),
  availability: {},
  swaps: [],
  attendance: {},
  settings: { currency: 'USD', shareSite: { subdomain: 'private' } },
});

/** A clock that ticks a minute per call, so names sort predictably. */
function clock(start = '2026-08-20T09:00:00.000Z') {
  let minute = 0;
  return () => {
    const at = new Date(new Date(start).getTime() + minute * 60000).toISOString();
    minute += 1;
    return at;
  };
}

describe('snapshot names', () => {
  it('round-trip a timestamp and a reason', () => {
    const name = snapshotName('2026-08-20T09:05:01.123Z', 'daily');
    expect(name).toBe('snapshot-2026-08-20T09-05-01-123Z-daily.json');
    expect(parseSnapshotName(name)).toEqual({
      at: '2026-08-20T09:05:01.123Z',
      date: '2026-08-20',
      reason: 'daily',
    });
  });

  it('sort by time as plain strings', () => {
    const names = [
      snapshotName('2026-08-20T09:00:00.000Z', 'daily'),
      snapshotName('2026-08-19T23:59:00.000Z', 'manual'),
      snapshotName('2026-08-21T00:01:00.000Z', 'wipe'),
    ];
    expect([...names].sort()).toEqual([names[1], names[0], names[2]]);
  });

  it('ignore anything that is not one of ours', () => {
    expect(parseSnapshotName('index.json')).toBeNull();
    expect(parseSnapshotName('snapshot-nonsense.json')).toBeNull();
  });

  it('name their reason in plain words', () => {
    expect(describeReason('wipe')).toBe('before wiping sample data');
    expect(describeReason('mystery')).toBe('automatic');
  });
});

describe('createSnapshotStore', () => {
  let fs;
  let snapshots;

  beforeEach(() => {
    fs = createMemorySnapshotFS();
    snapshots = createSnapshotStore(fs, { now: clock() });
  });

  it('starts empty', async () => {
    expect(await snapshots.list()).toEqual([]);
    expect(await snapshots.hasSnapshotOn('2026-08-20')).toBe(false);
  });

  it('writes a snapshot with its date, reason, and contents', async () => {
    const entry = await snapshots.save(state(2, 3), 'manual');
    expect(entry).toMatchObject({ reason: 'manual', date: '2026-08-20' });
    expect(entry.counts).toMatchObject({ employees: 2, shifts: 3 });
    expect(await snapshots.list()).toHaveLength(1);
    expect(await snapshots.hasSnapshotOn('2026-08-20')).toBe(true);
    expect(await snapshots.hasSnapshotOn('2026-08-19')).toBe(false);
  });

  it('dates a snapshot by the local day, not the UTC one', async () => {
    const late = createSnapshotStore(createMemorySnapshotFS(), {
      now: () => '2026-08-20T23:30:00.000Z',
    });
    const entry = await late.save(state(), 'daily');
    // Whatever the runner's zone, the entry agrees with the local
    // calendar rather than with the timestamp's UTC prefix.
    const localDay = new Date('2026-08-20T23:30:00.000Z');
    const expected = `${localDay.getFullYear()}-${String(localDay.getMonth() + 1).padStart(2, '0')}-${String(
      localDay.getDate()
    ).padStart(2, '0')}`;
    expect(entry.date).toBe(expected);
    expect(await late.hasSnapshotOn(expected)).toBe(true);
  });

  it('reads back a document the app can restore', async () => {
    const entry = await snapshots.save(state(2, 3), 'manual');
    const data = await snapshots.read(entry.name);
    expect(data).toMatchObject({ app: 'shifts', schemaVersion: 1 });
    expect(data.employees).toHaveLength(2);
    // The share-site pointer belongs to the account, not the data.
    expect(data.settings.shareSite).toBeUndefined();
  });

  it('lists newest first', async () => {
    await snapshots.save(state(), 'daily');
    await snapshots.save(state(), 'manual');
    const list = await snapshots.list();
    expect(list.map((e) => e.reason)).toEqual(['manual', 'daily']);
  });

  it('keeps the newest ten and prunes the rest, files included', async () => {
    for (let i = 0; i < SNAPSHOT_LIMIT + 3; i += 1) {
      await snapshots.save(state(), 'daily');
    }
    const list = await snapshots.list();
    expect(list).toHaveLength(SNAPSHOT_LIMIT);
    // The oldest three files are gone, not just unlisted.
    expect(fs.peek().filter((n) => n !== 'index.json')).toHaveLength(SNAPSHOT_LIMIT);
    expect(list[0].at > list[list.length - 1].at).toBe(true);
  });

  it('skips while offline instead of queueing a write', async () => {
    let online = false;
    const offlineStore = createSnapshotStore(fs, { now: clock(), online: () => online });
    expect(await offlineStore.save(state(), 'daily')).toBeNull();
    expect(fs.peek()).toEqual([]);
    online = true;
    expect(await offlineStore.save(state(), 'daily')).not.toBeNull();
  });

  it('never throws when storage refuses', async () => {
    const broken = createSnapshotStore(
      {
        list: async () => [],
        read: async () => {
          throw new Error('nope');
        },
        write: async () => {
          throw new Error('disk full');
        },
        remove: async () => {},
      },
      { now: clock() }
    );
    expect(await broken.save(state(), 'daily')).toBeNull();
  });

  it('rebuilds the list from file names when the index is gone', async () => {
    await snapshots.save(state(), 'daily');
    await snapshots.save(state(), 'wipe');
    await fs.remove('index.json');
    snapshots.invalidate();
    const list = await snapshots.list();
    expect(list.map((e) => e.reason)).toEqual(['wipe', 'daily']);
    // Contents are unknown without reading the files, and say so.
    expect(list[0].counts).toBeNull();
  });

  it('dates a rebuilt entry by the local day, not the UTC one in its name', async () => {
    const at = '2026-08-21T01:30:00.000Z';
    // No index: the list is rebuilt from the file name alone.
    const rebuilt = createSnapshotStore(
      createMemorySnapshotFS({ [snapshotName(at, 'daily')]: '{}' })
    );
    const localDay = new Date(at);
    const expected = `${localDay.getFullYear()}-${String(localDay.getMonth() + 1).padStart(2, '0')}-${String(
      localDay.getDate()
    ).padStart(2, '0')}`;
    expect((await rebuilt.list())[0].date).toBe(expected);
    expect(await rebuilt.hasSnapshotOn(expected)).toBe(true);
  });

  it('refuses a file that is not a usable backup', async () => {
    await fs.write('snapshot-2026-08-20T09-00-00-000Z-daily.json', '{"app":"something else"}');
    snapshots.invalidate();
    await expect(snapshots.read('snapshot-2026-08-20T09-00-00-000Z-daily.json')).rejects.toThrow(
      /not a Shifts backup/
    );
    await expect(snapshots.read('missing.json')).rejects.toThrow(/could not be read/);
  });
});

describe('the Puter adapter', () => {
  it('refuses a name that would reach outside the snapshot folder', async () => {
    const calls = [];
    const puter = {
      fs: {
        readdir: async () => [],
        read: async (p) => {
          calls.push(p);
          return '{}';
        },
        write: async (p) => calls.push(p),
        delete: async (p) => calls.push(p),
      },
    };
    const { createPuterSnapshotFS } = await import('../src/core/snapshots.js');
    const fs = createPuterSnapshotFS(puter);
    await fs.read('snapshot-2026-08-20T09-00-00-000Z-daily.json');
    expect(calls[0]).toBe('shifts-snapshots/snapshot-2026-08-20T09-00-00-000Z-daily.json');
    await expect(fs.read('../../secrets.json')).rejects.toThrow(/Invalid snapshot name/);
    await expect(fs.remove('nested/path.json')).rejects.toThrow(/Invalid snapshot name/);
    expect(calls).toHaveLength(1);
  });
});

describe('restore points around destructive actions', () => {
  let store;
  let snapshots;
  let reasons;

  beforeEach(async () => {
    snapshots = createSnapshotStore(createMemorySnapshotFS(), { now: clock() });
    reasons = [];
    store = createStore(createMemoryBackend(), {
      now: () => '2026-08-20T09:00:00.000Z',
      today: () => '2026-08-20',
      beforeReplace: async (reason, state) => {
        reasons.push(reason);
        await snapshots.save(state, reason);
      },
    });
    await store.init();
  });

  it('snapshots before a backup import, a sample load, and a wipe', async () => {
    await store.addEmployee({ name: 'Ava' });
    await store.loadSampleData(buildSeedData());
    await store.wipeSampleData();
    await store.importData({
      app: 'shifts',
      schemaVersion: 1,
      employees: [],
      shifts: [],
      availability: {},
      swaps: [],
      attendance: {},
      settings: {},
    });

    expect(reasons).toEqual(['sample', 'wipe', 'import']);
    const list = await snapshots.list();
    expect(list.map((e) => e.reason)).toEqual(['import', 'wipe', 'sample']);
    // The one taken before the sample load still holds the single
    // employee that was there at the time.
    const beforeSample = list[list.length - 1];
    expect(beforeSample.counts.employees).toBe(1);
  });

  it('lets a restore name its own reason', async () => {
    await store.importData(
      {
        app: 'shifts',
        schemaVersion: 1,
        employees: [],
        shifts: [],
        availability: {},
        swaps: [],
        attendance: {},
        settings: {},
      },
      { reason: 'restore' }
    );
    expect(reasons).toEqual(['restore']);
  });

  it('carries on when the restore point fails', async () => {
    const failing = createStore(createMemoryBackend(), {
      beforeReplace: async () => {
        throw new Error('storage unavailable');
      },
    });
    await failing.init();
    await failing.loadSampleData(buildSeedData());
    expect(failing.state.employees.length).toBeGreaterThan(0);
  });

  it('takes none when nothing destructive happens', async () => {
    await store.addEmployee({ name: 'Ava' });
    await store.addShift({ date: '2026-08-21', start: '09:00', end: '17:00', role: 'Floor' });
    expect(reasons).toEqual([]);
    expect(await snapshots.list()).toEqual([]);
  });
});
