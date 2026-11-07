import { afterEach, expect, it, vi } from 'vitest';
import { Doc, versioning } from '../src/lib/doc.js';
import { listVersions } from '../src/lib/versions.js';

let doc;
afterEach(() => { doc?.destroy(); vi.unstubAllGlobals(); versioning.enabled = true; });

it.each(['rename', 'remove'])('serializes manual version creation with %s', async (action) => {
  const files = new Map([['Documents/A.docx', new Blob(['original'])]]);
  const missing = () => Object.assign(new Error('Not found'), { code: 'ENOENT' });
  versioning.enabled = true;
  vi.stubGlobal('puter', { fs: {
    mkdir: async () => {},
    stat: async (path) => { if (!files.has(path)) throw missing(); return { path }; },
    readdir: async (dir) => [...files].filter(([path]) => path.startsWith(`${dir}/`))
      .map(([path, blob]) => ({ path, name: path.slice(dir.length + 1), size: blob.size })),
    write: async (path, blob) => { files.set(path, blob); return { path }; },
    rename: async (path, name) => {
      const target = path.slice(0, path.lastIndexOf('/') + 1) + name;
      const matches = [...files].filter(([key]) => key === path || key.startsWith(`${path}/`));
      if (!matches.length) throw missing();
      for (const [key, blob] of matches) { files.set(target + key.slice(path.length), blob); files.delete(key); }
    },
    delete: async (path, { recursive = false } = {}) => {
      for (const key of files.keys()) if (key === path || recursive && key.startsWith(`${path}/`)) files.delete(key);
    },
  } });
  doc = new Doc({ name: 'A', path: 'Documents/A.docx', blob: files.get('Documents/A.docx') });
  let release;
  doc.attach(() => new Promise((resolve) => { release = resolve; }));
  const snapshot = doc.saveVersionNow();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const changing = action === 'rename' ? doc.rename('B') : doc.remove();
  await Promise.resolve(); await Promise.resolve();
  release(new Blob(['snapshot'])); await Promise.all([snapshot, changing]);
  expect(await listVersions('Documents/A.docx')).toEqual([]);
  expect(await listVersions('Documents/B.docx')).toHaveLength(action === 'rename' ? 1 : 0);
});
