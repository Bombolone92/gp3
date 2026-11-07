/**
 * Dev-only in-memory mock of the Puter SDK, used by /mock.html so the full
 * signed-in UI can be exercised without a Puter account. Not part of the
 * production build. The AI mock returns a plausible receipt after a short
 * delay; append ?env=app to the URL to simulate running inside Puter.
 */
(() => {
  const kv = new Map();
  const files = new Map();
  const params = new URLSearchParams(location.search);
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  if (params.get('seed') !== '0') {
    // Start empty by default so onboarding shows; "?seed=1" is not needed because
    // the onboarding modal offers sample data directly.
  }

  const fsNotFound = (path) => Object.assign(new Error(`No such file: ${path}`), { code: 'subject_does_not_exist' });

  window.puter = {
    env: params.get('env') || 'web',
    appID: 'expenses-dev',
    auth: {
      isSignedIn: () => params.get('signedout') !== '1',
      getUser: async () => ({ username: 'demo', uuid: 'demo-user', email: 'demo@example.com' }),
      signIn: async () => { params.delete('signedout'); return true; },
      signOut: () => {},
    },
    kv: {
      get: async (k) => (kv.has(k) ? kv.get(k) : undefined),
      set: async (k, v) => { kv.set(k, JSON.parse(JSON.stringify(v))); return true; },
      del: async (k) => { kv.delete(k); return true; },
      list: async () => [...kv.keys()],
    },
    fs: {
      read: async (path) => {
        await delay(30);
        if (!files.has(path)) throw fsNotFound(path);
        const value = files.get(path);
        return value instanceof Blob ? value : new Blob([value]);
      },
      write: async (path, data) => {
        await delay(30);
        files.set(path, data instanceof Blob || typeof data === 'string' ? data : String(data));
        return { path, name: path.split('/').pop(), isDir: false, size: data?.size ?? String(data).length };
      },
      mkdir: async (path) => ({ path, isDir: true }),
      readdir: async (path) => [...files.keys()].filter((p) => p.startsWith(`${path}/`)).map((p) => ({ path: p, name: p.split('/').pop(), isDir: false })),
      delete: async (paths) => { for (const p of [].concat(paths)) { files.delete(p); for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k); } },
      stat: async (path) => { if (!files.has(path)) throw fsNotFound(path); return { path, name: path.split('/').pop(), isDir: false }; },
    },
    ai: {
      chat: async (prompt, media) => {
        await delay(1400);
        if (params.get('aifail') === '1') throw new Error('Insufficient credits');
        const merchants = ['Blue Fern Cafe', 'Northline Rail', 'Paper & Pen Supply', 'Harbor View Hotel', 'Metro Rideshare'];
        const cats = ['Meals', 'Travel', 'Office supplies', 'Lodging', 'Ground transport'];
        const i = Math.floor(Math.random() * merchants.length);
        const total = Math.round((8 + Math.random() * 180) * 100) / 100;
        const d = new Date(Date.now() - Math.floor(Math.random() * 6) * 86400000);
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const json = {
          merchant: merchants[i], date, total, tax: Math.round(total * 0.08 * 100) / 100, tip: null, currency: 'USD',
          category: cats[i], paymentMethod: 'Card', cardLast4: '4471',
          items: [{ name: 'Item A', amount: Math.round(total * 0.6 * 100) / 100 }, { name: 'Item B', amount: Math.round(total * 0.32 * 100) / 100 }],
          notes: media ? null : 'Text-only extraction', confidence: 0.82,
        };
        // Wrap in a code fence sometimes, like real models do.
        const text = Math.random() > 0.5 ? `\`\`\`json\n${JSON.stringify(json)}\n\`\`\`` : JSON.stringify(json);
        return { message: { role: 'assistant', content: text } };
      },
      img2txt: async () => { await delay(600); return 'BLUE FERN CAFE\n2026-08-20\nTOTAL 14.60'; },
    },
  };
})();
