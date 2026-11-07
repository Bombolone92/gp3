import { describe, it, expect, beforeEach } from 'vitest';
import {
  countsText,
  isSnapshotName,
  KEEP_SNAPSHOTS,
  parseSnapshotName,
  prunable,
  snapshotCounts,
  snapshotDue,
  snapshotName,
  sortSnapshots,
} from '../src/core/snapshots.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

describe('snapshot names', () => {
  it('encodes the moment and the reason, and reads them back', () => {
    const name = snapshotName('2026-08-21T06:11:35.123Z', 'wipe');
    expect(name).toBe('hiring-2026-08-21T06-11-35Z-wipe.json');
    expect(parseSnapshotName(name)).toEqual({ name, at: '2026-08-21T06:11:35Z', reason: 'wipe' });
  });

  it('falls back to a known reason', () => {
    expect(snapshotName('2026-08-21T06:11:35Z', 'nonsense')).toContain('-manual.json');
  });

  it('recognizes only its own files', () => {
    expect(isSnapshotName('hiring-2026-08-21T06-11-35Z-daily.json')).toBe(true);
    expect(isSnapshotName('index.json')).toBe(false);
    expect(isSnapshotName('hiring-backup-2026-08-21.json')).toBe(false);
    expect(isSnapshotName('../../etc/passwd')).toBe(false);
    expect(isSnapshotName(undefined)).toBe(false);
    // A real-looking name with an impossible date is not a snapshot.
    expect(isSnapshotName('hiring-2026-13-45T99-99-99Z-daily.json')).toBe(false);
  });

  it('ignores a duplicate name, whatever the caller merged', () => {
    const name = snapshotName('2026-08-01T10:00:00Z', 'daily');
    expect(sortSnapshots([{ name, size: 10 }, { name, size: 10 }])).toHaveLength(1);
  });

  it('sorts newest first and ignores strangers', () => {
    const entries = [
      { name: snapshotName('2026-08-01T10:00:00Z', 'daily'), size: 10 },
      { name: 'index.json', size: 2 },
      { name: snapshotName('2026-08-03T10:00:00Z', 'wipe'), size: 30 },
    ];
    expect(sortSnapshots(entries).map((s) => s.reason)).toEqual(['wipe', 'daily']);
    expect(sortSnapshots(entries)[0].bytes).toBe(30);
  });
});

describe('prunable', () => {
  const daily = (day) => ({ name: snapshotName(`2026-08-${String(day).padStart(2, '0')}T10:00:00Z`, 'daily') });

  it('keeps the newest ten', () => {
    const list = Array.from({ length: 14 }, (_, i) => daily(i + 1));
    const gone = prunable(list);
    expect(gone).toHaveLength(14 - KEEP_SNAPSHOTS);
    expect(gone).toContain(daily(1).name);
    expect(gone).not.toContain(daily(14).name);
  });

  it('never prunes the most recent pre-destructive snapshot', () => {
    const guard = { name: snapshotName('2026-07-01T10:00:00Z', 'wipe') };
    const list = [guard, ...Array.from({ length: 12 }, (_, i) => daily(i + 1))];
    expect(prunable(list)).not.toContain(guard.name);
    // An older one is not spared twice.
    const older = { name: snapshotName('2026-06-01T10:00:00Z', 'restore') };
    expect(prunable([older, guard, ...Array.from({ length: 12 }, (_, i) => daily(i + 1))])).toContain(older.name);
  });

  it('keeps everything while there is room', () => {
    expect(prunable([daily(1), daily(2)])).toEqual([]);
    expect(prunable([])).toEqual([]);
  });
});

describe('snapshotDue', () => {
  it('is due with nothing kept, or once the newest is stale', () => {
    expect(snapshotDue([])).toBe(true);
    const list = [{ name: snapshotName('2026-08-20T10:00:00Z', 'daily') }];
    expect(snapshotDue(list, { now: new Date('2026-08-20T20:00:00Z') })).toBe(false);
    expect(snapshotDue(list, { now: new Date('2026-08-21T09:00:00Z') })).toBe(true);
    expect(snapshotDue(list, { now: new Date('2026-08-20T12:00:00Z'), hours: 1 })).toBe(true);
  });
});

describe('counts', () => {
  it('counts records and reads them out, listing only what there is', () => {
    const counts = snapshotCounts({ data: { jobs: [1, 2], candidates: [1], interviews: [], offers: 'nope' } });
    expect(counts).toEqual({ jobs: 2, candidates: 1, interviews: 0, scorecards: 0, offers: 0 });
    expect(countsText(counts)).toBe('1 candidate · 2 jobs');
    expect(countsText(snapshotCounts({}))).toBe('Empty');
    expect(countsText(null)).toBe('');
  });
});

describe('the store keeping snapshots', () => {
  let backend;
  let store;
  let clock;

  beforeEach(async () => {
    backend = createMemoryBackend();
    clock = new Date('2026-08-21T09:00:00Z').getTime();
    store = createStore(backend, { now: () => new Date(clock).toISOString(), snapshots: true });
    await store.init();
  });

  const files = () => backend.filePaths().filter((p) => p.startsWith('hiring-backups/'));

  it('writes a snapshot with an index entry', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    await store.addCandidate({ name: 'Ada', jobId: job.id });
    const entry = await store.snapshot('manual');
    expect(entry.name).toBe('hiring-2026-08-21T09-00-00Z-manual.json');
    expect(entry.counts).toMatchObject({ jobs: 1, candidates: 1 });
    expect(files()).toContain(`hiring-backups/${entry.name}`);

    const [listed] = await store.listSnapshots();
    expect(listed).toMatchObject({ name: entry.name, reason: 'manual' });
    expect(listed.counts).toMatchObject({ candidates: 1 });
    expect(listed.bytes).toBeGreaterThan(0);

    const payload = await store.readSnapshot(entry.name);
    expect(payload.data.candidates[0].name).toBe('Ada');
  });

  it('takes one on load only when the last is stale', async () => {
    expect(await store.snapshotIfStale()).not.toBeNull();
    expect(await store.snapshotIfStale()).toBeNull();
    clock += 21 * 3600 * 1000;
    expect(await store.snapshotIfStale()).not.toBeNull();
    expect(await store.listSnapshots()).toHaveLength(2);
  });

  it('snapshots before a wipe, a restore, and a purge', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    const candidate = await store.addCandidate({ name: 'Ada', jobId: job.id });
    await store.wipeSampleData();
    expect((await store.listSnapshots())[0].reason).toBe('wipe');
    // The rate limit means one recovery point per run, not one per record.
    clock += 11 * 60 * 1000;
    const job2 = await store.addJob({ title: 'Designer' });
    const a = await store.addCandidate({ name: 'Grace', jobId: job2.id });
    const b = await store.addCandidate({ name: 'Lin', jobId: job2.id });
    await store.deleteCandidate(a.id);
    await store.deleteCandidate(b.id);
    const list = await store.listSnapshots();
    expect(list.filter((s) => s.reason === 'purge')).toHaveLength(1);
    expect(list[0].counts.candidates).toBe(2);
    void candidate;

    // Straight after the purge, with no clock advance: a restore replaces
    // everything, and its own recovery point must not be swallowed by the
    // limit that exists to keep a thirty-record purge to one file.
    const payload = await store.readSnapshot(list.find((s) => s.reason === 'wipe').name);
    await store.restoreBackup(payload);
    expect((await store.listSnapshots()).filter((s) => s.reason === 'restore')).toHaveLength(1);
    // The restore itself worked, from a snapshot the app took by itself.
    expect(store.state.candidates.map((c) => c.name)).toEqual(['Ada']);
    // And a wipe right after it is covered too, for the same reason.
    await store.wipeSampleData();
    expect((await store.listSnapshots()).filter((s) => s.reason === 'wipe')).toHaveLength(2);
  });

  it('prunes to the cap, sparing the pre-destructive one', async () => {
    await store.wipeSampleData(); // reason: wipe, the oldest of all
    for (let i = 0; i < KEEP_SNAPSHOTS + 2; i++) {
      clock += 3600 * 1000;
      await store.snapshot('daily');
    }
    const list = await store.listSnapshots();
    expect(list).toHaveLength(KEEP_SNAPSHOTS + 1);
    expect(list.some((s) => s.reason === 'wipe')).toBe(true);
    // The index tracks what survived, not what was written.
    expect(files().filter((p) => !p.endsWith('index.json'))).toHaveLength(KEEP_SNAPSHOTS + 1);
  });

  it('deletes one on request, and refuses anything else', async () => {
    const entry = await store.snapshot('manual');
    await expect(store.readSnapshot('../../secrets.json')).rejects.toThrow(/not a snapshot/i);
    await expect(store.deleteSnapshot('index.json')).rejects.toThrow(/not a snapshot/i);
    await store.deleteSnapshot(entry.name);
    expect(await store.listSnapshots()).toEqual([]);
    // Deleting what is already gone is the outcome we wanted.
    await store.deleteSnapshot(entry.name);
  });

  it('does nothing at all when snapshots are off', async () => {
    const plain = createStore(createMemoryBackend(), { snapshots: false });
    await plain.init();
    expect(await plain.snapshot('manual')).toBeNull();
    expect(await plain.snapshotIfStale()).toBeNull();
    expect(await plain.listSnapshots()).toEqual([]);
  });

  it('never lets a failed snapshot block the destructive action', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    backend.writeFile = async () => {
      throw new Error('drive unavailable');
    };
    await expect(store.deleteJob(job.id)).resolves.toBeUndefined();
    expect(store.state.jobs).toEqual([]);
  });
});
