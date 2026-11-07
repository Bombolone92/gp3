// A stand-in for the Puter SDK used by the browser tests. Loaded in place of
// https://js.puter.com/v2/. State lives in localStorage so it survives
// reloads, and window.__puterConfig (set before load) picks the user and env.
(() => {
  const cfg = Object.assign({ user: 'ada', env: 'web', signedIn: true }, window.__puterConfig || {});
  const KEY = 'fake-puter-cloud';
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{"files":{},"shares":[],"clock":1000}');
  const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));
  const abs = (p) => (p.startsWith('/') ? p : `/${cfg.user}/AppData/app/${p}`);
  const real = (s, p) => s.shares.find((x) => x.masked === p && x.holder === cfg.user)?.target || abs(p);
  const fs = {
    async mkdir() {},
    async write(p, data) {
      const s = load();
      const path = real(s, p);
      const text = typeof data === 'string' ? data : await new Response(data).text();
      s.files[path] = { text, modified: ++s.clock };
      save(s);
      return { path, modified: s.clock, name: path.split('/').pop() };
    },
    async read(p) {
      const s = load();
      const f = s.files[real(s, p)];
      if (!f) throw Object.assign(new Error('Not found'), { code: 'subject_does_not_exist' });
      return new Blob([f.text]);
    },
    async readdir(dir) {
      const s = load();
      const base = abs(dir);
      return Object.entries(s.files)
        .filter(([k]) => k.startsWith(`${base}/`) && !k.slice(base.length + 1).includes('/'))
        .map(([k, f]) => ({ name: k.slice(base.length + 1), path: k, isDir: false, modified: f.modified }));
    },
    async delete(p) {
      const s = load();
      delete s.files[abs(p)];
      save(s);
    },
    async share(p, recipient, mode) {
      const s = load();
      const target = abs(p);
      if (recipient === cfg.user) throw Object.assign(new Error('self'), { code: 'cannot_share_with_self' });
      const ex = s.shares.find((x) => x.target === target && x.holder === recipient);
      if (ex) ex.mode = mode;
      else s.shares.push({ target, holder: recipient, mode, owner: cfg.user, masked: `/${cfg.user}/s${s.shares.length}/${target.split('/').pop()}` });
      save(s);
      return [{ mode, holder: { username: recipient } }];
    },
    async getShares(p) {
      return load().shares.filter((x) => x.target === abs(p)).map((x) => ({ mode: x.mode, holder: { username: x.holder } }));
    },
    async unshare(p, recipient) {
      const s = load();
      const target = p.startsWith('/') ? s.shares.find((x) => x.masked === p)?.target : abs(p);
      s.shares = s.shares.filter((x) => !(x.target === target && x.holder === recipient));
      save(s);
      return { revoked: 1 };
    },
    async listShared() {
      const s = load();
      return { items: s.shares.filter((x) => x.holder === cfg.user).map((x) => ({ path: x.masked, name: x.masked.split('/').pop(), isDir: false, mode: x.mode, owner: { username: x.owner }, modified: s.files[x.target]?.modified })) };
    },
  };
  window.puter = {
    env: cfg.env,
    fs,
    auth: {
      isSignedIn: () => cfg.signedIn,
      async getUser() {
        if (!cfg.signedIn) throw new Error('not signed in');
        return { uuid: `uuid-${cfg.user}`, username: cfg.user, is_temp: false };
      },
      async getProfilePicture() {
        return 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#2a9d8f"/></svg>');
      },
      async signIn() {
        cfg.signedIn = true;
        return { success: true };
      },
      signOut() {
        cfg.signedIn = false;
      },
    },
    net: {},
  };
})();
