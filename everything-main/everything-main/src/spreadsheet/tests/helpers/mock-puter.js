/** An in-memory Puter SDK for document tests; every file operation is recorded in `calls`. */
export function installMockPuter() {
  const fs = new Map();
  const kv = new Map();
  const calls = [];
  let uids = 0;
  const notFound = (p) => Object.assign(new Error(`${p} does not exist`), { code: 'subject_does_not_exist' });
  // A file keeps its id across rewrites and renames, as on the drive.
  const item = (path, f) => ({ path, name: path.split('/').pop(), is_dir: !f, size: f?.size ?? null, modified: f?.modified ?? 1, ...(f ? { uid: (f.uid ??= `uid-${++uids}`) } : {}) });
  globalThis.puter = {
    env: 'web',
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'demo', uuid: 'u-1' }) },
    kv: { get: async (k) => kv.get(k) ?? null, set: async (k, v) => { kv.set(k, v); return true; }, del: async (k) => { kv.delete(k); return true; } },
    fs: {
      async mkdir(p) { calls.push(['mkdir', p]); return item(p); },
      async readdir(p) {
        calls.push(['readdir', p]);
        // Like the SDK: the folder's direct children, subfolders as entries of their own.
        const out = new Map();
        for (const [k, f] of fs) {
          if (!k.startsWith(`${p}/`)) continue;
          const rest = k.slice(p.length + 1);
          const slash = rest.indexOf('/');
          if (slash < 0) out.set(k, item(k, f));
          else { const dir = `${p}/${rest.slice(0, slash)}`; if (!out.has(dir)) out.set(dir, item(dir)); }
        }
        if (!out.size) throw notFound(p);
        return [...out.values()];
      },
      async read(p) { const f = fs.get(p); if (!f) throw notFound(p); return f.blob; },
      async write(p, blob, { overwrite = true, dedupeName = false } = {}) {
        calls.push(['write', p]);
        // Like the SDK: a taken name is refused, or given a numbered variant when asked to dedupe.
        if (fs.has(p) && !overwrite) {
          if (!dedupeName) throw new Error('A file with that name already exists');
          const stem = p.replace(/\.[^./]+$/, '');
          const ext = p.slice(stem.length);
          let n = 1;
          while (fs.has(p)) p = `${stem} (${n++})${ext}`;
        }
        fs.set(p, { blob, size: blob.size, modified: Date.now() / 1000, uid: fs.get(p)?.uid });
        return item(p, fs.get(p));
      },
      async stat(p) {
        calls.push(['stat', p]);
        // Like the SDK: a file can be asked for by its id, wherever it is now.
        if (p && typeof p === 'object') {
          for (const [k, f] of fs) if (p.uid != null && f.uid === p.uid) return item(k, f);
          throw notFound(p.uid);
        }
        if (fs.has(p)) return item(p, fs.get(p));
        if ([...fs.keys()].some((k) => k.startsWith(`${p}/`))) return item(p);
        throw notFound(p);
      },
      async delete(p, options) { calls.push(['delete', p, options]); for (const k of [...fs.keys()]) if (k === p || k.startsWith(`${p}/`)) fs.delete(k); },
      async rename(p, newName) {
        calls.push(['rename', p, newName]);
        const dir = p.slice(0, p.lastIndexOf('/'));
        const target = `${dir}/${newName}`;
        for (const k of [...fs.keys()]) if (k === p || k.startsWith(`${p}/`)) { fs.set(target + k.slice(p.length), fs.get(k)); fs.delete(k); }
        // Like the server: a rename or move stamps the file as modified, though its bytes are the same.
        const f = fs.get(target);
        if (f) f.modified = Date.now() / 1000;
        return item(target, f);
      },
    },
    ui: {},
  };
  return { fs, calls, kv };
}
