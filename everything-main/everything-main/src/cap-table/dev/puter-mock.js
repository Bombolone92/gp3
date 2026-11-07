/**
 * Dev-only in-memory mock of the Puter SDK, served at /mock.html.
 * Lets you develop and test the full signed-in UI without a Puter account.
 * Not part of the production build (vite only builds index.html).
 *
 * Query params:
 *   ?signedout=1   show the public landing page
 *   ?env=app       simulate running inside Puter (no sign-out offered)
 * Combine both to verify that the Puter shell bypasses the landing page.
 */
(() => {
  const params = new URLSearchParams(location.search);
  const kv = new Map();
  let signedIn = !params.has('signedout');

  window.puter = {
    env: params.get('env') === 'app' ? 'app' : 'web',
    auth: {
      isSignedIn: () => signedIn,
      signIn: async () => { signedIn = true; },
      signOut: () => { signedIn = false; },
      getUser: async () => ({ uuid: 'mock-user', username: 'demo' }),
    },
    kv: {
      get: async (key) => (kv.has(key) ? kv.get(key) : null),
      set: async (key, value) => { kv.set(key, value); return true; },
      add: async (key, values) => {
        const previous = kv.get(key) ?? [];
        if (!Array.isArray(previous)) throw new Error('Expected a list');
        const next = [...previous, ...values];
        kv.set(key, next);
        return next;
      },
      del: async (key) => kv.delete(key),
    },
    fs: (() => {
      const files = new Map();
      return {
        write: async (path, data) => {
          files.set(path, data instanceof Blob ? data : new Blob([data ?? '']));
          return { path, name: path.split('/').pop() };
        },
        read: async (path) => {
          if (!files.has(path)) throw new Error(`No such file: ${path}`);
          return files.get(path);
        },
        delete: async (path) => files.delete(path),
      };
    })(),
  };
})();
