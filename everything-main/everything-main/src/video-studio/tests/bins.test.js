import { describe, it, expect } from 'vitest';
import {
  normalizeBins, createBin, renameBin, deleteBin, moveAssets, moveBin, childBins, binPath, assetsInBin, binItemCount,
  descendantIds, uniqueBinName, sortAssets, filterAssets, formatBytes,
} from '../src/model/bins.js';
import { normalizeProject, normalizeAsset } from '../src/model/project.js';
import { EditorStore } from '../src/model/store.js';
import { fixture } from './helpers.js';

const names = (list) => list.map((x) => x.name);

describe('media bin folders', () => {
  it('creates folders with unique names, nested under a parent', () => {
    const p = fixture();
    const a = createBin(p, 'B-roll');
    const b = createBin(p, 'B-roll');
    const c = createBin(p, 'Interviews', a.id);
    expect(names(childBins(p))).toEqual(['B-roll', 'B-roll 2']);
    expect(childBins(p, a.id).map((x) => x.id)).toEqual([c.id]);
    expect(binPath(p, c.id).map((x) => x.id)).toEqual([a.id, c.id]);
    expect(binPath(p, null)).toEqual([]);
    expect(b.parent).toBe(null);
    // An unknown parent falls back to the top level.
    expect(createBin(p, 'Loose', 'nope').parent).toBe(null);
    expect(uniqueBinName(p, 'B-roll')).toBe('B-roll 3');
  });

  it('renames, keeping names unique among siblings', () => {
    const p = fixture();
    const a = createBin(p, 'One');
    createBin(p, 'Two');
    expect(renameBin(p, a.id, '  Two ')).toBe(true);
    expect(a.name).toBe('Two 2');
    expect(renameBin(p, a.id, '')).toBe(false);
    expect(renameBin(p, 'missing', 'x')).toBe(false);
  });

  it('moves media into folders and back to the top level', () => {
    const p = fixture();
    const f = createBin(p, 'Clips');
    expect(moveAssets(p, ['vid', 'img', 'nope'], f.id)).toBe(2);
    expect(assetsInBin(p, f.id).map((a) => a.id).sort()).toEqual(['img', 'vid']);
    expect(assetsInBin(p, null).map((a) => a.id).sort()).toEqual(['aud', 'silent']);
    // Already there: nothing moves.
    expect(moveAssets(p, ['vid'], f.id)).toBe(0);
    expect(moveAssets(p, ['vid'], 'missing')).toBe(0);
    expect(moveAssets(p, ['vid'], null)).toBe(1);
    expect('folder' in p.assets.vid).toBe(false);
  });

  it('deleting a folder moves its media and subfolders up to its parent', () => {
    const p = fixture();
    const top = createBin(p, 'Top');
    const mid = createBin(p, 'Mid', top.id);
    const low = createBin(p, 'Low', mid.id);
    moveAssets(p, ['vid'], mid.id);
    moveAssets(p, ['img'], low.id);
    expect(binItemCount(p, top.id)).toBe(2);
    expect(deleteBin(p, mid.id)).toBe(true);
    expect(p.assets.vid.folder).toBe(top.id);
    expect(low.parent).toBe(top.id);
    expect(deleteBin(p, top.id)).toBe(true);
    expect('folder' in p.assets.vid).toBe(false);
    expect(p.assets.img.folder).toBe(low.id);
    expect(low.parent).toBe(null);
    deleteBin(p, low.id);
    // No folders left: the field goes away so the project looks like an old one.
    expect(p.bins).toBeUndefined();
    expect(Object.values(p.assets).every((a) => !a.folder)).toBe(true);
    expect(deleteBin(p, 'missing')).toBe(false);
  });

  it('moves folders but never into themselves', () => {
    const p = fixture();
    const a = createBin(p, 'A');
    const b = createBin(p, 'B', a.id);
    expect(moveBin(p, a.id, b.id)).toBe(false);
    expect(moveBin(p, a.id, a.id)).toBe(false);
    expect(moveBin(p, b.id, null)).toBe(true);
    expect(b.parent).toBe(null);
    expect(moveBin(p, a.id, b.id)).toBe(true);
    expect([...descendantIds(p, b.id)].sort()).toEqual([a.id, b.id].sort());
  });

  it('normalizes untrusted folders: bad ids, duplicates, missing parents and cycles', () => {
    const bins = normalizeBins([
      { id: 'a', name: 'A', parent: 'c' },
      { id: 'b', name: '', parent: 'a' },
      { id: 'c', name: 'C\nline', parent: 'b' }, // a -> c -> b -> a cycle
      { id: 'a', name: 'dup' },
      { id: '../x', name: 'evil' },
      { id: 'd', name: 'D', parent: 'zzz' },
      null,
      'nope',
    ]);
    expect(bins.map((b) => b.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(bins.find((b) => b.id === 'b').name).toBe('Folder');
    expect(bins.find((b) => b.id === 'c').name).toBe('C line');
    expect(bins.find((b) => b.id === 'd').parent).toBe(null);
    // Every folder reaches the top level.
    const byId = new Map(bins.map((b) => [b.id, b]));
    for (const b of bins) {
      const seen = new Set();
      let x = b;
      while (x.parent) {
        expect(seen.has(x.id)).toBe(false);
        seen.add(x.id);
        x = byId.get(x.parent);
      }
    }
    expect(normalizeBins(undefined)).toEqual([]);
  });

  it('loads projects with and without folders', () => {
    const old = normalizeProject(JSON.parse(JSON.stringify(fixture())));
    expect(old.bins).toBeUndefined();
    const raw = fixture();
    raw.bins = [{ id: 'f1', name: 'Shots', parent: null }];
    raw.assets.vid.folder = 'f1';
    raw.assets.img.folder = 'gone';
    const p = normalizeProject(JSON.parse(JSON.stringify(raw)));
    expect(p.bins).toEqual([{ id: 'f1', name: 'Shots', parent: null }]);
    expect(p.assets.vid.folder).toBe('f1');
    expect('folder' in p.assets.img).toBe(false);
    expect(normalizeProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(normalizeAsset({ id: 'x', kind: 'image', folder: 42 }).folder).toBeUndefined();
  });

  it('folder edits are undoable through the store', () => {
    const store = new EditorStore(fixture());
    let id;
    store.update('New folder', (p) => {
      id = createBin(p, 'Takes').id;
      moveAssets(p, ['vid'], id);
    }, { structural: false });
    store.update('Delete folder', (p) => deleteBin(p, id), { structural: false });
    expect(store.project.bins).toBeUndefined();
    store.undo();
    expect(store.project.bins.map((b) => b.name)).toEqual(['Takes']);
    expect(store.project.assets.vid.folder).toBe(id);
    store.undo();
    expect(store.project.bins).toBeUndefined();
    expect(store.project.assets.vid.folder).toBeUndefined();
  });
});

describe('media list sorting and filtering', () => {
  const list = [
    { id: '1', name: 'clip 10', kind: 'video', added: 3, duration: 5e6, size: 300 },
    { id: '2', name: 'Clip 2', kind: 'video', added: 1, duration: 20e6, size: 100 },
    { id: '3', name: 'photo', kind: 'image', added: 2, duration: 0, size: 900 },
    { id: '4', name: 'beat', kind: 'audio', added: 4, duration: 60e6, size: 50 },
  ];
  const ids = (l) => l.map((a) => a.id);

  it('sorts by each key in both directions without mutating', () => {
    const copy = [...list];
    expect(ids(sortAssets(list))).toEqual(['4', '1', '3', '2']); // newest first
    expect(ids(sortAssets(list, { key: 'added', dir: 'asc' }))).toEqual(['2', '3', '1', '4']);
    expect(ids(sortAssets(list, { key: 'name', dir: 'asc' }))).toEqual(['4', '2', '1', '3']); // natural, case-insensitive
    expect(ids(sortAssets(list, { key: 'duration', dir: 'desc' }))).toEqual(['4', '2', '1', '3']);
    expect(ids(sortAssets(list, { key: 'type', dir: 'asc' }))).toEqual(['2', '1', '3', '4']); // videos, photos, audio; ties by name
    expect(ids(sortAssets(list, { key: 'size', dir: 'asc' }))).toEqual(['4', '2', '1', '3']);
    expect(ids(sortAssets(list, { key: 'bogus' }))).toEqual(ids(sortAssets(list)));
    expect(list).toEqual(copy);
  });

  it('filters by kind and name', () => {
    expect(ids(filterAssets(list, { types: ['video'] }))).toEqual(['1', '2']);
    expect(ids(filterAssets(list, { types: ['image', 'audio'] }))).toEqual(['3', '4']);
    expect(ids(filterAssets(list, { types: [] }))).toEqual(['1', '2', '3', '4']);
    expect(ids(filterAssets(list, { query: ' CLIP ' }))).toEqual(['1', '2']);
    expect(ids(filterAssets(list, { types: ['audio'], query: 'clip' }))).toEqual([]);
  });

  it('formats file sizes', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(12_345)).toBe('12 KB');
    expect(formatBytes(3_400_000)).toBe('3.4 MB');
    expect(formatBytes(1_200_000_000)).toBe('1.2 GB');
    expect(formatBytes(-5)).toBe('0 B');
  });
});
