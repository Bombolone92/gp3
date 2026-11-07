import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { versionsFolder, versionFileName, parseVersionName, listVersions, saveVersion, pruneVersions, dueForVersion, AUTO_VERSION_MS } from '../src/lib/versions.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx } from '../src/core/io.js';

function installMockPuter() {
  const fs = new Map();
  const dirs = new Set();
  const notFound = (p) => Object.assign(new Error(`${p} does not exist`), { code: 'subject_does_not_exist' });
  const item = (path, f) => ({ path, name: path.split('/').pop(), is_dir: !f, size: f?.size ?? null, modified: f?.modified ?? 1 });
  globalThis.puter = {
    env: 'web',
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'demo' }) },
    kv: { get: async () => null, set: async () => true },
    fs: {
      async mkdir(p) { dirs.add(p); return item(p); },
      async readdir(p) {
        const out = [...fs.entries()].filter(([k]) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/')).map(([k, f]) => item(k, f));
        if (!out.length && !dirs.has(p)) throw notFound(p);
        return out;
      },
      async read(p) { const f = fs.get(p); if (!f) throw notFound(p); return f.blob; },
      async write(p, blob) { fs.set(p, { blob, size: blob.size, modified: Date.now() / 1000 }); return item(p, fs.get(p)); },
      async delete(p) { fs.delete(p); },
      async stat(p) { if (fs.has(p)) return item(p, fs.get(p)); throw notFound(p); },
    },
    ui: {},
  };
  return fs;
}

describe('version names and folders', () => {
  it('preserves subsecond timestamps in newly named versions while reading older names', () => {
    const when = new Date('2026-09-11T12:00:00.123Z');
    const name = versionFileName(when, 'Checkpoint', 'a'.repeat(32));
    expect(parseVersionName(name)).toEqual({ at: when.getTime(), label: 'Checkpoint' });
    expect(parseVersionName('2026-09-11T12-00-00Z Checkpoint.xlsx')).toEqual({ at: when.getTime() - 123, label: 'Checkpoint' });
  });

  it('round-trips the timestamp and label, and files snapshots under the app folder', () => {
    const when = new Date(Date.UTC(2026, 7, 28, 13, 45, 10));
    expect(versionFileName(when, 'Before Q3: changes?')).toBe('2026-08-28T13-45-10Z Before Q3 changes.xlsx');
    expect(parseVersionName('2026-08-28T13-45-10Z Before Q3 changes.xlsx')).toEqual({ at: when.getTime(), label: 'Before Q3 changes' });
    expect(parseVersionName('2026-08-28T13-45-10Z.xlsx')).toEqual({ at: when.getTime(), label: '' });
    expect(parseVersionName('Budget.xlsx')).toBeNull();
    expect(versionsFolder('Spreadsheets/Budget.xlsx')).toBe('Spreadsheets/.versions/Budget');
    expect(versionsFolder('/u/Desktop/Budget.xlsx')).toMatch(/^Spreadsheets\/\.versions\/Budget [a-z0-9]+$/);
    expect(dueForVersion(null)).toBe(true);
    expect(dueForVersion(1000, 1000 + AUTO_VERSION_MS - 1)).toBe(false);
    expect(dueForVersion(1000, 1000 + AUTO_VERSION_MS)).toBe(true);
  });
});

describe('snapshots on the drive', () => {
  let fs;
  beforeAll(async () => { await workbookToXlsx(new Workbook()); });
  beforeEach(() => { fs = installMockPuter(); });
  afterEach(() => { delete globalThis.puter; });

  it('lists and retains the newest snapshot when several were saved within one second', async () => {
    const path = 'Spreadsheets/Plan.xlsx';
    const saved = [];
    for (const ms of [100, 900, 500]) {
      saved.push(await saveVersion(path, new Blob([String(ms)]), '', new Date(Date.UTC(2026, 8, 11, 12, 0, 0, ms))));
    }
    const expected = [saved[1], saved[2], saved[0]];
    expect((await listVersions(path)).map((v) => v.path)).toEqual(expected.map((v) => v.path));
    expect(await pruneVersions(path, 1)).toBe(2);
    expect((await listVersions(path)).map((v) => v.path)).toEqual([saved[1].path]);
    expect(await fs.get(saved[1].path).blob.text()).toBe('900');
  });

  it.each(['', 'Milestone'])('keeps concurrent snapshots labeled "%s" at the same instant as separate versions', async (label) => {
    const path = 'Spreadsheets/Plan.xlsx';
    const when = new Date('2026-09-10T12:00:00.000Z');
    const first = new Blob(['first']);
    const second = new Blob(['second']);
    const saved = await Promise.all([saveVersion(path, first, label, when), saveVersion(path, second, label, when)]);
    expect(saved[0].path).not.toBe(saved[1].path);
    expect(fs.get(saved[0].path).blob).toBe(first);
    expect(fs.get(saved[1].path).blob).toBe(second);
    expect(await listVersions(path)).toHaveLength(2);
    expect((await listVersions(path)).every((v) => v.label === label)).toBe(true);
    expect(await pruneVersions(path, 1)).toBe(label ? 0 : 1);
  });

  it('saves, lists newest first, prunes unlabeled extras but keeps labeled ones', async () => {
    const path = 'Spreadsheets/Plan.xlsx';
    const blob = new Blob(['x']);
    for (let i = 0; i < 5; i++) await saveVersion(path, blob, i === 2 ? 'keep me' : '', new Date(Date.UTC(2026, 0, 1 + i)));
    const all = await listVersions(path);
    expect(all.map((v) => v.at)).toEqual([...all.map((v) => v.at)].sort((a, b) => b - a));
    expect(all.length).toBe(5);
    expect(await pruneVersions(path, 2)).toBe(2);
    const left = await listVersions(path);
    expect(left.length).toBe(3);
    expect(left.some((v) => v.label === 'keep me')).toBe(true);
    expect(left.filter((v) => !v.label).length).toBe(2);
    expect(await listVersions('Spreadsheets/Nothing.xlsx')).toEqual([]);
    expect([...fs.keys()].every((k) => k.startsWith('Spreadsheets/.versions/Plan/'))).toBe(true);
  });

  it('is written by the document after a save when due, and a restore brings the old contents back', async () => {
    vi.useFakeTimers();
    try {
      const path = 'Spreadsheets/Plan.xlsx';
      const wb = new Workbook();
      const doc = new Doc({ wb, name: 'Plan', path });
      // The file is on the drive, as it is for any document that knows when it was last written.
      fs.set(path, { blob: new Blob(['x']), size: 1, modified: Date.now() / 1000 });
      doc.remoteModified = Date.now();
      wb.setInput(wb.sheets[0].id, 0, 0, 'first');
      await vi.advanceTimersByTimeAsync(2000);
      expect(doc.status).toBe('saved');
      await vi.advanceTimersByTimeAsync(50);
      let versions = await listVersions(path);
      expect(versions.length).toBe(1);
      // Another save soon after adds no snapshot; one after the interval does.
      wb.setInput(wb.sheets[0].id, 0, 0, 'second');
      await vi.advanceTimersByTimeAsync(2100);
      expect((await listVersions(path)).length).toBe(1);
      vi.setSystemTime(Date.now() + AUTO_VERSION_MS + 1000);
      wb.setInput(wb.sheets[0].id, 0, 0, 'third');
      await vi.advanceTimersByTimeAsync(2100);
      versions = await listVersions(path);
      expect(versions.length).toBe(2);
      // A labeled one by hand, then restore the oldest: the text comes back and a "Before restore" snapshot appears.
      vi.setSystemTime(Date.now() + 1000); // a new second, so the name differs from the automatic one
      await doc.saveVersion('Milestone');
      versions = await listVersions(path);
      expect(versions[0].label).toBe('Milestone');
      const oldest = versions[versions.length - 1];
      vi.setSystemTime(Date.now() + 1000);
      await doc.restoreVersion(oldest.path);
      expect(wb.getValue(wb.sheets[0].id, 0, 0)).toBe('first');
      expect(wb.dirty).toBe(true);
      expect((await listVersions(path)).some((v) => v.label === 'Before restore')).toBe(true);
      doc.destroy();
    } finally { vi.useRealTimers(); }
  });
});

it('keeps the histories of Budget.csv and Budget.xlsx apart', async () => {
  const { versionsFolder } = await import('../src/lib/versions.js');
  expect(versionsFolder('Spreadsheets/Budget.xlsx')).toBe('Spreadsheets/.versions/Budget');
  expect(versionsFolder('Spreadsheets/Budget.csv')).toBe('Spreadsheets/.versions/Budget csv');
  expect(versionsFolder('Spreadsheets/Budget.CSV')).toBe(versionsFolder('Spreadsheets/Budget.csv'));
  expect(versionsFolder('Spreadsheets/Budget.csv')).not.toBe(versionsFolder('Spreadsheets/Budget.xlsx'));
  expect(versionsFolder('Desktop/Budget.csv')).toMatch(/^Spreadsheets\/\.versions\/Budget csv \w+$/);
});

it('ages out the snapshots taken before a restore like automatic ones, keeping only the user\'s labels', async () => {
  const { saveVersion, listVersions, pruneVersions, RESTORE_LABEL } = await import('../src/lib/versions.js');
  const { installMockPuter } = await import('./helpers/mock-puter.js');
  installMockPuter();
  const path = 'Spreadsheets/Growth.xlsx';
  await saveVersion(path, new Blob(['keep']), 'Milestone');
  for (let i = 0; i < 40; i++) await saveVersion(path, new Blob([`r${i}`]), RESTORE_LABEL, new Date(2026, 0, 1, 0, i));
  await pruneVersions(path, 5);
  const left = await listVersions(path);
  expect(left.filter((v) => v.label === RESTORE_LABEL).length).toBeLessThanOrEqual(5);
  expect(left.some((v) => v.label === 'Milestone')).toBe(true);
  delete globalThis.puter;
});
