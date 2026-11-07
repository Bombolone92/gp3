/**
 * Dev-only in-memory mock of the Puter SDK, served at /mock.html.
 * Lets you develop and test the full signed-in UI without a Puter account.
 * State persists to localStorage so reloads behave like a real backend
 * (clear it with localStorage.removeItem('pos:mock')). Not part of the
 * production build (vite only builds index.html).
 */
(() => {
  const LS = 'pos:mock';
  let state = { kv: {}, files: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(LS));
    if (saved && saved.kv && saved.files) state = saved;
  } catch {}

  const persist = () => {
    try { localStorage.setItem(LS, JSON.stringify(state)); } catch {}
  };

  window.puter = {
    env: 'web',
    auth: {
      isSignedIn: () => true,
      getUser: async () => ({ username: 'demo', uuid: 'demo-user' }),
      signIn: async () => true,
      signOut: () => { localStorage.removeItem(LS); },
    },
    kv: {
      get: async (k) => (k in state.kv ? state.kv[k] : null),
      set: async (k, v) => { state.kv[k] = v; persist(); return true; },
      del: async (k) => { delete state.kv[k]; persist(); return true; },
    },
    fs: {
      read: async (path) => {
        if (!(path in state.files)) {
          const err = new Error(`No such file: ${path}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        const stored = state.files[path];
        // Binary files (product photos) were stored as data URLs; decode back.
        if (typeof stored === 'string' && stored.startsWith('data:')) {
          return await (await fetch(stored)).blob();
        }
        return new Blob([stored]);
      },
      write: async (path, data) => {
        if (typeof data === 'string') {
          state.files[path] = data;
        } else if (data instanceof Blob) {
          // Keep binary as a data URL so it survives a reload like text does.
          state.files[path] = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(data);
          });
        } else {
          state.files[path] = String(data);
        }
        persist();
        return { path };
      },
      mkdir: async () => ({}),
      readdir: async () => [],
      delete: async (path) => { delete state.files[path]; persist(); },
    },
  };
})();
