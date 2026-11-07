/**
 * Dev-only Puter stub, loaded when the page is opened with `?mock`.
 * Provides just enough of the SDK surface for local development:
 * auth is always signed in, and the KV store persists to localStorage.
 */

const PREFIX = 'hiring.mockkv:';

globalThis.puter = {
  env: 'web',
  auth: {
    isSignedIn: () => true,
    getUser: async () => ({ uuid: 'mock-user', username: 'demo' }),
    signIn: async () => true,
    signOut: () => {},
  },
  fs: (() => {
    /* Files persist in localStorage next to the KV data. Keeping them in
       memory while the KV survives reloads manufactured exactly the
       corrupt state the real backend guards against: after a refresh the
       candidate still listed "resume.pdf · 240 KB" but Download threw
       "No such file", and a Published badge pointed at pages that no
       longer existed. Base64 in localStorage caps capacity well under
       the app's 10 MB attachment limit — a too-big dev upload now fails
       loudly at write time instead of silently vanishing on reload. */
    const FS_PREFIX = 'hiring.mockfs:';
    const paths = () =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith(FS_PREFIX))
        .map((k) => k.slice(FS_PREFIX.length));
    const missing = (path) => {
      const err = new Error(`No such file: ${path}`);
      err.code = 'subject_does_not_exist';
      return err;
    };
    return {
      async write(path, data) {
        const blob = data instanceof Blob ? data : new Blob([data]);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        localStorage.setItem(FS_PREFIX + path, JSON.stringify({ b64: btoa(binary), type: blob.type }));
        return { path };
      },
      async read(path) {
        const raw = localStorage.getItem(FS_PREFIX + path);
        if (raw === null) throw missing(path);
        const { b64, type } = JSON.parse(raw);
        const binary = atob(b64);
        const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
        return new Blob([bytes], { type });
      },
      async delete(path, opts = {}) {
        if (opts.recursive) {
          for (const key of paths()) {
            if (key === path || key.startsWith(`${path}/`)) localStorage.removeItem(FS_PREFIX + key);
          }
          return;
        }
        if (localStorage.getItem(FS_PREFIX + path) === null) throw missing(path);
        localStorage.removeItem(FS_PREFIX + path);
      },
      async readdir(path) {
        const prefix = `${path}/`;
        return paths()
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .map((key) => ({ name: key.slice(prefix.length), path: key }));
      },
    };
  })(),
  hosting: {
    async create(subdomain, dirPath) {
      return { subdomain, root_dir: { path: dirPath } };
    },
    async update(subdomain, dirPath) {
      return { subdomain, root_dir: { path: dirPath } };
    },
    async delete() {
      return true;
    },
  },
  kv: {
    async get(key) {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? null : raw;
    },
    async set(key, value) {
      localStorage.setItem(PREFIX + key, value);
      return true;
    },
    async del(key) {
      localStorage.removeItem(PREFIX + key);
      return true;
    },
  },
};

console.info('[hiring] Using the local Puter mock — data lives in localStorage.');
