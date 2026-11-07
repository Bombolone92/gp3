// Storage, settings, history and sharing against an in-memory Puter mock.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setPuterForTests } from '../src/app/puter.js';
import * as storage from '../src/app/storage.js';
import { Settings, DEFAULTS } from '../src/app/settings.js';
import { recordVersion, listVersions } from '../src/app/history.js';
import { sharedWithMe } from '../src/app/share.js';

/** Minimal in-memory puter.fs + kv with Unix-second timestamps like the real API. */
function memoryPuter() {
  const files = new Map();
  const kv = new Map();
  let clock = 1_700_000_000;
  const norm = (p) => p.replace(/^\/+/, '');
  const fs = {
    async write(path, data) {
      const text = typeof data === 'string' ? data : await data.text();
      files.set(norm(path), { text, modified: ++clock });
      return { path: `/user/AppData/app-test/${norm(path)}`, name: norm(path).split('/').pop() };
    },
    async read(path) {
      const f = files.get(norm(path).replace(/^user\/AppData\/app-test\//, ''));
      if (!f) { const e = new Error('subject_does_not_exist'); e.code = 'subject_does_not_exist'; throw e; }
      return new Blob([f.text]);
    },
    async readdir(dir) {
      const d = norm(dir) + '/';
      const out = [];
      for (const [p, f] of files) if (p.startsWith(d) && !p.slice(d.length).includes('/')) out.push({ name: p.slice(d.length), path: p, size: f.text.length, modified: f.modified, is_dir: false });
      if (!out.length && ![...files.keys()].some((p) => p.startsWith(d))) { const e = new Error('subject_does_not_exist'); e.code = 'subject_does_not_exist'; throw e; }
      return out;
    },
    async delete(path) { files.delete(norm(path)); },
    async rename(path, name) { const f = files.get(norm(path)); files.delete(norm(path)); const np = norm(path).replace(/[^/]+$/, name); files.set(np, f); return { path: np }; },
    async listShared() { return { items: [{ name: 'Shared Board.circuits', path: '/bob/abc/Shared Board.circuits', owner: { username: 'bob' }, mode: 'write', modified: 1_700_000_100 }, { name: 'notes.txt', path: '/bob/x/notes.txt', owner: 'bob' }] }; },
  };
  return {
    env: 'web', files,
    auth: { isSignedIn: () => true },
    fs,
    kv: { get: async (k) => kv.get(k) ?? null, set: async (k, v) => { kv.set(k, v); return true; } },
    _kv: kv,
  };
}

let mock;
beforeEach(() => { localStorage.clear(); mock = memoryPuter(); setPuterForTests(mock); });
afterEach(() => setPuterForTests(null));

describe('cloud projects', () => {
  it('picks unique file names and lists projects newest first', async () => {
    const a = await storage.newLocation('Amp', 'p1');
    expect(a).toEqual({ type: 'cloud', path: 'Projects/Amp.circuits' });
    await storage.saveText(a, 'Amp', '{"x":1}');
    const b = await storage.newLocation('Amp', 'p2');
    expect(b.path).toBe('Projects/Amp (2).circuits');
    await storage.saveText(b, 'Amp', '{"x":2}');
    const list = await storage.listProjects();
    expect(list.map((p) => p.name)).toEqual(['Amp (2)', 'Amp']);
    expect(list[0].modified).toBeGreaterThan(1e12); // seconds converted to milliseconds
  });

  it('sanitizes names and round-trips text', async () => {
    const loc = await storage.newLocation('a/b:c*?', 'p');
    expect(loc.path).toBe('Projects/a-b-c-.circuits');
    const saved = await storage.saveText(loc, 'x', 'hello');
    expect(await storage.loadText(saved)).toBe('hello');
  });

  it('remembers recent projects without duplicates', async () => {
    const loc = { type: 'cloud', path: 'Projects/A.circuits' };
    storage.rememberRecent({ location: loc, name: 'A' });
    storage.rememberRecent({ location: { type: 'local', id: 'z' }, name: 'Z' });
    storage.rememberRecent({ location: loc, name: 'A' });
    expect(storage.recentProjects().map((r) => r.name)).toEqual(['A', 'Z']);
    storage.forgetRecent(loc);
    expect(storage.recentProjects().map((r) => r.name)).toEqual(['Z']);
  });

  it('uses local storage when signed out', async () => {
    setPuterForTests(null);
    expect(await storage.newLocation('Amp', 'p9')).toEqual({ type: 'local', id: 'p9' });
  });
});

describe('settings', () => {
  it('stores only values that differ from the defaults, locally and in one KV entry', async () => {
    const s = new Settings();
    expect(s.get('theme')).toBe(DEFAULTS.theme);
    s.set('units', 'mil');
    expect(JSON.parse(localStorage.getItem('circuits:settings'))).toEqual({ units: 'mil' });
    await new Promise((r) => setTimeout(r, 900));
    expect(mock._kv.get('circuits:settings:v1')).toEqual({ units: 'mil' });
    expect(new Settings().get('units')).toBe('mil');
  });

  it('merges settings saved in the account', async () => {
    mock._kv.set('circuits:settings:v1', { theme: 'dark', unknownKey: 1 });
    const s = new Settings();
    await s.syncFromCloud();
    expect(s.get('theme')).toBe('dark');
    expect(s.get('unknownKey')).toBeUndefined();
  });
});

describe('version history', () => {
  it('keeps versions on save, throttles autosaves, and lists newest first', async () => {
    const loc = { type: 'cloud', path: 'Projects/Amp.circuits' };
    let last = await recordVersion(loc, 'p1', '{"v":1}');
    expect(last).toBeGreaterThan(0);
    const again = await recordVersion(loc, 'p1', '{"v":2}', { auto: true, lastAt: last });
    expect(again).toBe(last); // within ten minutes of the last version
    await new Promise((r) => setTimeout(r, 5));
    last = await recordVersion(loc, 'p1', '{"v":3}');
    const list = await listVersions(loc, 'p1');
    expect(list.length).toBe(2);
    expect(list[0].date).toBeGreaterThanOrEqual(list[1].date);
  });

  it('returns no versions for a project that has none', async () => {
    expect(await listVersions({ type: 'cloud', path: 'Projects/X.circuits' }, 'none')).toEqual([]);
  });
});

describe('sharing', () => {
  it('lists projects shared with the user', async () => {
    const list = await sharedWithMe();
    expect(list).toEqual([{ name: 'Shared Board', location: { type: 'cloud', path: '/bob/abc/Shared Board.circuits' }, owner: 'bob', mode: 'write', modified: 1_700_000_100_000 }]);
  });
});
