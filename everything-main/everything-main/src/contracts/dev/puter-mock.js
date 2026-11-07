/**
 * Dev-only in-memory mock of the Puter SDK, used by /mock.html.
 * Lets you develop and test the full signed-in UI without a Puter account.
 * Not part of the production build (vite only builds index.html).
 *
 * The dataset starts empty so the onboarding flow runs; choose
 * "Explore with sample data" to fill it. puter.ai.chat returns a canned
 * obligation list after a short delay so the extraction flow is testable.
 */
(() => {
  const kv = new Map();
  const files = new Map();
  const sites = new Map();
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  window.puter = {
    env: 'web',
    appID: 'mock-app',

    auth: {
      isSignedIn: () => true,
      signIn: async () => true,
      signOut: () => {},
      getUser: async () => ({ username: 'demo-user', uuid: 'mock-uuid' }),
    },

    kv: {
      async get(k) {
        await delay(30);
        return kv.has(k) ? structuredClone(kv.get(k)) : null;
      },
      async set(k, v) {
        await delay(30);
        kv.set(k, structuredClone(v));
        return true;
      },
      async del(k) {
        kv.delete(k);
        return true;
      },
    },

    fs: {
      async read(path) {
        await delay(50);
        if (!files.has(path)) {
          const err = new Error(`No such file: ${path}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        return files.get(path);
      },
      async write(path, data) {
        await delay(50);
        files.set(path, data instanceof Blob ? data : new Blob([data]));
        return { path };
      },
      async delete(path) {
        await delay(30);
        for (const k of [...files.keys()]) {
          if (k === path || k.startsWith(`${path}/`)) files.delete(k);
        }
        return true;
      },
    },

    /* Static hosting, used by the calendar subscription feed. */
    hosting: {
      async create(subdomain, dir) {
        await delay(200);
        sites.set(subdomain, dir);
        return { subdomain, uid: `mock-${subdomain}` };
      },
      async list() {
        return [...sites].map(([subdomain, dir]) => ({ subdomain, root_dir: dir }));
      },
      async get(subdomain) {
        return sites.has(subdomain) ? { subdomain, root_dir: sites.get(subdomain) } : null;
      },
      async delete(subdomain) {
        await delay(100);
        sites.delete(subdomain);
        return true;
      },
      async update(subdomain, dir) {
        sites.set(subdomain, dir);
        return { subdomain, root_dir: dir };
      },
    },

    ai: {
      /* OCR: a canned read of a "scanned" page, so the fallback is testable. */
      async img2txt() {
        await delay(900);
        return [
          'SERVICE SCHEDULE (scanned)',
          'The Customer shall pay each invoice within 30 days of receipt.',
          'The Supplier shall provide a certificate of insurance annually.',
        ].join('\n');
      },

      async chat() {
        await delay(1200);
        return {
          message: {
            role: 'assistant',
            content: JSON.stringify([
              { text: 'Pay the monthly service fee within 15 days of invoice', owner: 'us', due: null },
              { text: 'Deliver the quarterly usage report', owner: 'them', due: null },
              { text: 'Give 30 days written notice before cancellation', owner: 'us', due: null },
              { text: 'Keep shared materials confidential', owner: 'mutual', due: null },
            ]),
          },
        };
      },
    },
  };
})();
