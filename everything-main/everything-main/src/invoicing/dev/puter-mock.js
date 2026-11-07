/**
 * Dev-only in-memory mock of the Puter SDK, served at /mock.html.
 * Lets you develop and test the full signed-in UI without a Puter account.
 * Starts empty so onboarding (and its sample-data path) is exercised too.
 * Not part of the production build (vite only builds index.html).
 */
(() => {
  const kv = new Map();
  const files = new Map();
  // What the fake email worker has already delivered: "<doc>|<address>" -> the
  // message digest it was sent, exactly as the real worker's KV keeps it.
  const mail = new Map();

  window.puter = {
    env: 'web',
    auth: {
      isSignedIn: () => true,
      getUser: async () => ({ username: 'demo', uuid: 'demo-user' }),
      signIn: async () => true,
      signOut: () => {},
    },
    kv: {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      set: async (k, v) => { kv.set(k, v); return true; },
      del: async (k) => { kv.delete(k); return true; },
    },
    fs: {
      read: async (path) => {
        if (!files.has(path)) {
          const err = new Error(`No such file: ${path}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        const value = files.get(path);
        return value instanceof Blob ? value : new Blob([value]);
      },
      write: async (path, data) => {
        files.set(path, data instanceof Blob || typeof data === 'string' ? data : String(data));
        return { path };
      },
      mkdir: async () => ({}),
      readdir: async () => [],
      stat: async (path) => {
        if (!files.has(path)) {
          const err = new Error(`No such file: ${path}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        const value = files.get(path);
        return { path, size: value instanceof Blob ? value.size : String(value).length };
      },
      // The real SDK removes a whole tree with { recursive: true }; the app
      // uses it to take a shared document's published files down at once.
      delete: async (path, opts) => {
        files.delete(path);
        if (opts?.recursive) {
          for (const key of [...files.keys()]) if (key.startsWith(`${path}/`)) files.delete(key);
        }
      },
    },
    hosting: {
      create: async (subdomain, dir) => ({ subdomain, root_dir: dir }),
      delete: async () => true,
      list: async () => [],
    },
    /**
     * The bridge the app sends email through (src/lib/mailer.js). Nothing
     * leaves the machine: the request is logged in full so the composed
     * message and its attachments can be read in the console, and the reply
     * has the shape the real worker's /send returns — including the
     * already-sent skip, so the "they already have this" path is reachable
     * here by pressing Send twice.
     */
    workers: {
      exec: async (url, init = {}) => {
        const body = JSON.parse(init.body || '{}');
        const key = (r) => `${body.document?.id}|${r.email}`;
        const results = (body.recipients || []).map((r) => {
          if (!body.force && mail.get(key(r)) === r.version) {
            return { email: r.email, status: 'skipped', reason: 'already_sent', at: Date.now() };
          }
          mail.set(key(r), r.version);
          return { email: r.email, status: 'sent', at: Date.now() };
        });
        console.log('[mock] email →', url, {
          subject: body.subject,
          body: body.body,
          to: (body.recipients || []).map((r) => r.email),
          attachments: (body.attachments || []).map((a) => `${a.filename} (${a.content.length} b64 chars)`),
          results,
        });
        const data = {
          ok: true,
          version: 'mock',
          sent: results.filter((r) => r.status === 'sent').length,
          skipped: results.filter((r) => r.status === 'skipped').length,
          failed: 0,
          suppressed: 0,
          cost: 0,
          results,
        };
        return { ok: true, status: 200, json: async () => data };
      },
    },
  };
})();
