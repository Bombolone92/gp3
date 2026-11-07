/**
 * Dev-only in-memory Puter stub. Loaded by mock.html instead of the real
 * SDK so the app can be exercised in a browser without an account.
 * State lives in sessionStorage so reloads behave like a real session.
 */
(() => {
  const LS = 'pm-mock-state';
  let state = { kv: {}, fs: {} };
  try {
    const raw = sessionStorage.getItem(LS);
    if (raw) state = JSON.parse(raw);
  } catch {}

  const persist = () => {
    try { sessionStorage.setItem(LS, JSON.stringify(state)); } catch {}
  };

  const delay = (ms = 25) => new Promise((r) => setTimeout(r, ms));

  const blobToB64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  // mock.html?signedout exercises the intro page; the CTA "signs in".
  let signedIn = !new URLSearchParams(location.search).has('signedout');

  /**
   * A stand-in Drive, so "Add from Puter" and "Save to Puter" can be
   * exercised without an account. The open picker seeds a couple of files
   * the first time and then hands them back in turn.
   */
  const DRIVE = '/demo/Desktop';
  let pickIndex = 0;
  async function seedDrive() {
    const seeds = [
      { name: 'spec.txt', body: 'Mock spec living in Puter Drive.\n', type: 'text/plain' },
      { name: 'notes.md', body: '# Notes\n\nLinked, not copied.\n', type: 'text/markdown' },
    ];
    for (const s of seeds) {
      const path = `${DRIVE}/${s.name}`;
      if (state.fs[path]) continue;
      const blob = new Blob([s.body], { type: s.type });
      state.fs[path] = {
        b64: await blobToB64(blob),
        type: s.type,
        size: blob.size,
        modified: Math.floor(Date.now() / 1000),
      };
    }
    persist();
  }

  window.puter = {
    env: 'web',
    ui: {
      // No prompt(): a modal dialog would block the page, and the harness is
      // here to be driven. Each call hands back the next seeded file.
      async showOpenFilePicker({ multiple = false } = {}) {
        await seedDrive();
        await delay();
        const names = Object.keys(state.fs)
          .filter((p) => p.startsWith(`${DRIVE}/`))
          .map((p) => p.slice(DRIVE.length + 1))
          .sort();
        const picked = names[pickIndex++ % names.length];
        const path = `${DRIVE}/${picked}`;
        console.log(`[puter-mock] file picker → ${path}`);
        const item = {
          path, name: picked, size: state.fs[path].size, type: state.fs[path].type,
        };
        return multiple ? [item] : item;
      },
      async showSaveFilePicker(data, suggestedName) {
        await delay();
        const name = suggestedName || `export-${Date.now()}`;
        const path = `${DRIVE}/${name}`;
        console.log(`[puter-mock] save picker → ${path}`);
        const blob = data instanceof Blob ? data : new Blob([data]);
        state.fs[path] = {
          b64: await blobToB64(blob),
          type: blob.type,
          size: blob.size,
          modified: Math.floor(Date.now() / 1000),
        };
        persist();
        return { path, name, size: blob.size, type: blob.type };
      },
    },
    auth: {
      isSignedIn: () => signedIn,
      getUser: async () => { await delay(); return { username: 'demo', uuid: 'mock-uuid' }; },
      signIn: async () => { signedIn = true; return true; },
      signOut: () => { sessionStorage.removeItem(LS); },
    },
    kv: {
      async get(key) { await delay(); return key in state.kv ? state.kv[key] : null; },
      async set(key, value) { await delay(); state.kv[key] = value; persist(); return true; },
      async del(key) { await delay(); delete state.kv[key]; persist(); return true; },
    },
    fs: {
      async write(path, data) {
        await delay();
        const blob = data instanceof Blob ? data : new Blob([data]);
        state.fs[path] = {
          b64: await blobToB64(blob),
          type: blob.type,
          size: blob.size,
          modified: Math.floor(Date.now() / 1000),
        };
        persist();
        return { path };
      },
      async readdir(dir) {
        await delay(5);
        const prefix = `${dir}/`;
        const seen = new Map();
        for (const [key, entry] of Object.entries(state.fs)) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          const cut = rest.indexOf('/');
          const name = cut < 0 ? rest : rest.slice(0, cut);
          if (seen.has(name)) continue;
          seen.set(name, {
            name,
            path: `${prefix}${name}`,
            is_dir: cut >= 0,
            size: cut < 0 ? (entry.size ?? 0) : 0,
            modified: entry.modified ?? 0,
          });
        }
        if (!seen.size) {
          const err = new Error(`No such directory: ${dir}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        return [...seen.values()];
      },
      async stat(path) {
        await delay(5);
        const entry = state.fs[path];
        if (!entry) {
          const err = new Error(`No such file: ${path}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        return { path, modified: entry.modified ?? 0, size: entry.size ?? 0 };
      },
      async read(path) {
        await delay();
        const entry = state.fs[path];
        if (!entry) {
          const err = new Error(`No such file: ${path}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        const res = await fetch(entry.b64);
        return res.blob();
      },
      async delete(path, { recursive = false } = {}) {
        await delay();
        if (state.fs[path]) delete state.fs[path];
        else if (recursive) {
          for (const key of Object.keys(state.fs)) {
            if (key.startsWith(`${path}/`)) delete state.fs[key];
          }
        }
        persist();
      },
    },
  };
})();
