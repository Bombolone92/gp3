// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app } from '../src/app.js';
import * as files from '../src/files.js';
import * as team from '../src/team.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { formatDate } from '../src/core/dates.js';
import { Blob as NodeBlob } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';

// jsdom's Blob cannot be read back (no arrayBuffer/text); Node's can.
globalThis.Blob = NodeBlob;

const WORKER_SOURCE = fs.readFileSync(path.join(__dirname, '../public/worker/legal-team-worker.js'), 'utf8');
const person = (uuid, username) => ({ puter: { auth: { getUser: async () => ({ uuid, username }) } } });
const OWNER = person('owner-1', 'eleanor');

/** The firm worker over in-memory KV and files, plus a puter.workers.exec for one caller. */
function loadWorker() {
  const routes = new Map();
  const router = { get: (p, fn) => routes.set(`GET ${p}`, fn), post: (p, fn) => routes.set(`POST ${p}`, fn) };
  new Function('router', WORKER_SOURCE)(router);
  const data = new Map();
  const kv = {
    data,
    get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
    set: async (k, v) => {
      if (Array.isArray(k)) for (const it of k) data.set(it.key, structuredClone(it.value));
      else data.set(k, structuredClone(v));
      return true;
    },
    del: async (k) => data.delete(k),
    expire: async () => true,
    incr: async (k, paths) => {
      if (typeof paths === 'number') {
        data.set(k, (Number(data.get(k)) || 0) + paths);
        return data.get(k);
      }
      const cur = data.get(k) || {};
      for (const [p, n] of Object.entries(paths)) cur[p] = (cur[p] || 0) + n;
      data.set(k, cur);
      return structuredClone(cur);
    },
    list: async ({ pattern, returnValues }) => ({
      items: [...data.keys()].filter((k) => k.startsWith(pattern)).sort().map((k) => (returnValues ? { key: k, value: structuredClone(data.get(k)) } : k)),
    }),
  };
  const stored = new Map();
  const fsys = {
    write: async (p, blob) => void stored.set(p, blob),
    read: async (p) => {
      if (!stored.has(p)) throw new Error('not found');
      return stored.get(p);
    },
    delete: async (p) => void stored.delete(p),
  };
  const me = { puter: { kv, fs: fsys, auth: { getUser: async () => ({ uuid: 'owner-1', username: 'eleanor' }) } } };
  const api = async (user, body) => {
    const res = await routes.get('POST /api')({ me, user, request: { json: async () => structuredClone(body) } });
    return { status: res.status, body: await res.json() };
  };
  const exec = (user) => async (url, init) => routes.get('POST /api')({ me, user, request: { json: async () => JSON.parse(init.body) } });
  return { kv, files: stored, api, exec };
}

/** Object URLs minted by the app, with the Blob behind each one. */
function captureObjectUrls() {
  const blobs = new Map();
  let n = 0;
  URL.createObjectURL = (blob) => {
    const url = `blob:test/${++n}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => blobs.delete(url);
  return blobs;
}

describe('document files', () => {
  beforeEach(() => {
    app.demo = true;
    app.team = null;
  });
  afterEach(() => {
    app.demo = false;
  });

  it('never opens an uploaded file as an active page under the app origin', async () => {
    const blobs = captureObjectUrls();
    const html = '<script>alert(localStorage.getItem("puter.auth.token"))</script>';
    // A colleague's document record can claim any type and any name.
    const ref = await files.saveFile(new Blob([html], { type: 'text/html' }), { name: 'brief.pdf' });
    const url = await files.fileUrl({ ...ref, type: 'text/html' });
    expect(blobs.get(url).type).not.toMatch(/html|xml|svg/i);
    const svg = await files.saveFile(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), { name: 'logo.svg' });
    const svgUrl = await files.fileUrl(svg);
    // SVG can still be shown as an image, but only from an origin-less data: URL.
    expect(svgUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
    // Plain images and PDFs keep their type so they preview.
    const pdf = await files.saveFile(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), { name: 'a.pdf' });
    expect(blobs.get(await files.fileUrl(pdf)).type).toBe('application/pdf');
    const png = await files.saveFile(new Blob(['x'], { type: 'image/png' }), { name: 'a.png' });
    expect(blobs.get(await files.fileUrl(png)).type).toBe('image/png');
  });
});

describe('document files in a shared firm', () => {
  let w;
  beforeEach(() => {
    w = loadWorker();
    app.demo = false;
    app.team = { url: 'https://legalfirm-abc.puter.work', role: 'owner' };
    globalThis.puter = { workers: { exec: w.exec(OWNER) } };
  });
  afterEach(() => {
    app.team = null;
    delete globalThis.puter;
  });

  it('uploads files whose names contain consecutive dots', async () => {
    const ref = await files.saveFile(new Blob(['hello'], { type: 'text/plain' }), { folder: 'm1', name: 'Smith v. Jones..final.txt' });
    expect(ref.name).toBe('Smith v. Jones..final.txt');
    expect(await (await files.readFile(ref)).text()).toBe('hello');
  });

  it('deletes sample documents, which have no stored file', async () => {
    const { buildSampleData } = await import('../src/core/sample.js');
    const doc = buildSampleData('2026-03-02').collections.documents.find((d) => d.file);
    await expect(files.deleteFile(doc.file)).resolves.toBeUndefined();
  });
});

/** A Puter account that can deploy the firm worker: drive, workers, and fetch for the bundle and health. */
function ownerAccount(w, { create } = {}) {
  const drive = new Map();
  const deployed = [];
  const deleted = [];
  const puter = {
    fs: {
      write: async (p, blob) => {
        drive.set(p, blob);
        return { path: `/eleanor/AppData/legal/${p}` };
      },
      read: async (p) => {
        if (!drive.has(p)) throw Object.assign(new Error('not found'), { code: 'subject_does_not_exist' });
        return drive.get(p);
      },
    },
    workers: {
      create:
        create ||
        (async (name) => {
          deployed.push(name);
          return { success: true, url: `https://${name}.puter.work` };
        }),
      delete: async (name) => void deleted.push(name),
      exec: w.exec(OWNER),
    },
  };
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/health')) return new Response(JSON.stringify({ ok: true, build: /build=(\w+)/.exec(WORKER_SOURCE)[1] }));
    return new Response(WORKER_SOURCE);
  };
  return { puter, drive, deployed, deleted };
}

describe('turning on team sign-in', () => {
  afterEach(() => {
    delete globalThis.puter;
  });

  it('does not report sample documents as not copied', async () => {
    const w = loadWorker();
    const acct = ownerAccount(w);
    globalThis.puter = acct.puter;
    const { buildSampleData } = await import('../src/core/sample.js');
    const store = createStore({ backend: createMemoryBackend(buildSampleData('2026-03-02')), flushDelay: 0 });
    await store.init();
    expect(store.all('documents').some((d) => d.file?.demoText)).toBe(true);
    const res = await team.enableTeam({ store });
    expect(res.skipped).toEqual([]);
    expect([...w.kv.data.keys()].some((k) => k.startsWith('lg1:r:documents:'))).toBe(true);
  });
});

describe('turning on team sign-in when it fails midway', () => {
  afterEach(() => {
    delete globalThis.puter;
  });

  it('removes the half-set-up firm server so a retry starts clean', async () => {
    const w = loadWorker();
    const acct = ownerAccount(w);
    acct.puter.workers.exec = async () => {
      throw new TypeError('Failed to fetch');
    };
    globalThis.puter = acct.puter;
    const store = createStore({ backend: createMemoryBackend({ collections: { matters: [{ id: 'm1', description: 'A' }] } }), flushDelay: 0 });
    await store.init();
    await expect(team.enableTeam({ store })).rejects.toThrow(/firm server/);
    expect(acct.deployed).toHaveLength(1);
    expect(acct.deleted).toEqual(acct.deployed);
  });
});

describe('team sign-in settings: turning it on', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  const dialogWith = (text) => [...document.querySelectorAll('dialog')].find((d) => d.textContent.includes(text));
  let release;
  let acct;

  beforeEach(async () => {
    globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
    HTMLDialogElement.prototype.showModal ??= function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function () {
      this.open = false;
    };
    document.body.replaceChildren();
    const w = loadWorker();
    const gate = new Promise((r) => (release = r));
    acct = ownerAccount(w, {
      create: async (name) => {
        await gate;
        return { success: true, url: `https://${name}.puter.work` };
      },
    });
    acct.puter.kv = { get: async () => null, set: async () => true };
    globalThis.puter = acct.puter;
    app.demo = false;
    app.team = null;
    app.user = { username: 'eleanor', uuid: 'owner-1' };
    app.workspaces = { current: 'own', own: {}, joined: [] };
    app.store = createStore({
      backend: createMemoryBackend({
        collections: { documents: [{ id: 'd1', name: 'Engagement letter.pdf', file: { path: 'docs/firm/x-Engagement letter.pdf', name: 'Engagement letter.pdf', type: 'application/pdf', size: 10 } }] },
      }),
      flushDelay: 0,
    });
    await app.store.init();
    const { teamSection } = await import('../src/views/settings-team.js');
    document.body.append(teamSection());
    button(document.body, 'Turn on team sign-in').click();
    await tick();
    button(dialogWith('Turn on team sign-in?'), 'Turn on team sign-in').click();
    await tick();
  });
  afterEach(() => {
    delete globalThis.puter;
  });

  it('cannot be dismissed while the firm is being copied', async () => {
    const progress = dialogWith('Setting up your firm server');
    expect(progress.isConnected).toBe(true);
    progress.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(progress.isConnected).toBe(true);
    expect(progress.querySelector('[aria-label="Close"]')).toBeNull();
    release();
  });

  it('lists documents that could not be copied before reloading', async () => {
    release();
    for (let i = 0; i < 20 && dialogWith('Setting up your firm server'); i++) await tick();
    const notice = dialogWith('could not be copied');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain('Engagement letter.pdf');
  });
});

describe('leaving a shared firm', () => {
  afterEach(() => {
    delete globalThis.puter;
    app.workspaces = null;
  });

  it('gives up the membership on the firm server, not just the local entry', async () => {
    const w = loadWorker();
    const url = 'https://legalfirm-abc.puter.work';
    const daniel = person('u-2', 'daniel');
    const inv = (await w.api(OWNER, { op: 'invite' })).body;
    await w.api(daniel, { op: 'join', token: inv.token });
    const saved = [];
    globalThis.puter = { kv: { set: async (k, v) => saved.push(v) }, workers: { exec: w.exec(daniel) } };
    app.user = { username: 'daniel', uuid: 'u-2' };
    app.workspaces = { current: url, own: {}, joined: [{ url, business: 'Rivera Law', role: 'member' }] };
    await team.leaveWorkspace(url);
    expect(saved[0]).toMatchObject({ current: 'own', joined: [] });
    expect((await w.api(daniel, { op: 'meta' })).status).toBe(403);
  });
});

describe('a joined firm', () => {
  afterEach(() => {
    delete globalThis.puter;
  });

  it('picks up a role the owner changed since joining', async () => {
    const w = loadWorker();
    const url = 'https://legalfirm-abc.puter.work';
    const daniel = person('u-2', 'daniel');
    const inv = (await w.api(OWNER, { op: 'invite' })).body;
    await w.api(daniel, { op: 'join', token: inv.token });
    await w.api(OWNER, { op: 'saveSettings', settings: { firm: { name: 'Rivera Law' } } });
    await w.api(OWNER, { op: 'setRole', uuid: 'u-2', role: 'admin' });
    const saved = [];
    const kv = { set: async (k, v) => saved.push(v) };
    globalThis.puter = { workers: { exec: w.exec(daniel) } };
    const ws = { current: url, own: {}, joined: [{ url, business: 'Shared firm', role: 'member' }] };
    const next = await team.refreshJoined(kv, ws, url);
    expect(next.joined[0]).toEqual({ url, business: 'Rivera Law', role: 'admin' });
    expect(saved).toEqual([next]);
    // Nothing changed: nothing to save.
    expect(await team.refreshJoined(kv, next, url)).toBeNull();
    expect(saved).toHaveLength(1);
  });
});

describe('team sign-in settings: members', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const url = 'https://legalfirm-abc.puter.work';
  const daniel = person('u-2', 'daniel');
  const sofia = person('u-3', 'sofia');
  const bob = person('u-4', 'bob');
  let w;

  async function join(who, role) {
    const inv = (await w.api(OWNER, { op: 'invite', role })).body;
    await w.api(who, { op: 'join', token: inv.token });
  }

  async function render(asWho, username, role) {
    globalThis.puter = { workers: { exec: w.exec(asWho) } };
    app.demo = false;
    app.user = { username, uuid: 'x' };
    app.team = { url, role, business: 'Rivera Law' };
    app.store = createStore({ backend: createMemoryBackend({}), flushDelay: 0 });
    await app.store.init();
    const { teamSection } = await import('../src/views/settings-team.js');
    const node = teamSection();
    document.body.replaceChildren(node);
    for (let i = 0; i < 10 && !node.querySelector('tbody'); i++) await tick();
    return node;
  }
  const row = (node, username) => [...node.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes(username));

  beforeEach(async () => {
    globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
    HTMLDialogElement.prototype.showModal ??= function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function () {
      this.open = false;
    };
    w = loadWorker();
    await join(daniel, 'admin');
    await join(sofia, 'admin');
    await join(bob, 'member');
  });
  afterEach(() => {
    delete globalThis.puter;
    app.team = null;
  });

  it('puts the role back to what it really is when a change fails', async () => {
    const node = await render(OWNER, 'eleanor', 'owner');
    const sel = row(node, 'bob').querySelector('select[name="role"]');
    sel.value = 'admin';
    sel.dispatchEvent(new Event('change'));
    for (let i = 0; i < 5; i++) await tick();
    expect(w.kv.data.get('lgt:m:u-4').role).toBe('admin');
    globalThis.puter.workers.exec = async () => {
      throw new TypeError('Failed to fetch');
    };
    sel.value = 'member';
    sel.dispatchEvent(new Event('change'));
    for (let i = 0; i < 5; i++) await tick();
    expect(sel.value).toBe('admin');
  });

  it('offers an admin only what an admin may change', async () => {
    const node = await render(daniel, 'daniel', 'admin');
    const roleOf = (u) => row(node, u).querySelector('select[name="role"]');
    const removeOf = (u) => [...row(node, u).querySelectorAll('button')].find((b) => b.textContent === 'Remove');
    // Other admins and themselves: only the owner changes or removes admins.
    expect(roleOf('sofia').disabled).toBe(true);
    expect(removeOf('sofia')).toBeUndefined();
    expect(roleOf('daniel').disabled).toBe(true);
    // Members, they manage.
    expect(roleOf('bob').disabled).toBe(false);
    expect(removeOf('bob')).toBeTruthy();
    const inviteRole = node.querySelector('select[name="inviteRole"]');
    expect([...inviteRole.options].map((o) => o.value)).toEqual(['member']);
  });

  it('offers an admin Revoke only on invitations to join as a member', async () => {
    await w.api(OWNER, { op: 'invite', role: 'admin', label: 'Partner' });
    await w.api(OWNER, { op: 'invite', role: 'member', label: 'Clerk' });
    const node = await render(daniel, 'daniel', 'admin');
    for (let i = 0; i < 10 && !node.querySelector('.invite-list'); i++) await tick();
    const revokeOf = (label) => [...[...node.querySelectorAll('.invite-item')].find((li) => li.textContent.includes(label)).querySelectorAll('button')].find((b) => b.textContent === 'Revoke');
    expect(revokeOf('Partner')).toBeUndefined();
    expect(revokeOf('Clerk')).toBeTruthy();
  });

  it('shows join and expiry dates in local time', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      // 9 pm on March 1 in Los Angeles is already March 2 in UTC.
      const evening = Date.UTC(2026, 2, 2, 5, 0);
      w.kv.data.set('lgt:m:u-4', { ...w.kv.data.get('lgt:m:u-4'), joinedAt: evening });
      const inv = (await w.api(OWNER, { op: 'invite', label: 'Paralegal' })).body;
      const key = [...w.kv.data.keys()].find((k) => k.startsWith('lgt:i:') && w.kv.data.get(k).label === 'Paralegal');
      w.kv.data.set(key, { ...w.kv.data.get(key), expiresAt: Date.now() + 86400000 });
      const node = await render(OWNER, 'eleanor', 'owner');
      expect(row(node, 'bob').textContent).toContain(formatDate('2026-03-01'));
      const local = new Date(Date.now() + 86400000);
      const iso = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
      expect(node.querySelector('.invite-list').textContent).toContain(`expires ${formatDate(iso)}`);
      expect(inv.token).toBeTruthy();
    } finally {
      process.env.TZ = tz;
      if (tz === undefined) delete process.env.TZ;
    }
  });
});

describe('which firm to open', () => {
  const url = 'https://legalfirm-abc.puter.work';
  beforeEach(() => {
    localStorage.clear();
    app.user = { username: 'eleanor', uuid: 'owner-1' };
  });

  it('keeps opening the shared firm when the firm list cannot be read', async () => {
    const data = new Map();
    let failing = false;
    const kv = {
      get: async (k) => {
        if (failing) throw new Error('Too many requests');
        return data.get(k) ?? null;
      },
      set: async (k, v) => void data.set(k, v),
    };
    await team.saveWorkspaces(kv, { current: 'own', own: { url }, joined: [] });
    expect(team.activeWorker(await team.loadWorkspaces(kv))).toBe(url);
    failing = true;
    expect(team.activeWorker(await team.loadWorkspaces(kv))).toBe(url);
    // Another person on this device has nothing remembered: the error stands.
    app.user = { username: 'daniel', uuid: 'u-2' };
    await expect(team.loadWorkspaces(kv)).rejects.toThrow();
  });

  it('does not offer to set up a second firm server when the firm list could not be read', async () => {
    app.demo = false;
    app.team = null;
    app.workspaces = { current: 'own', own: {}, joined: [], unverified: true };
    app.store = createStore({ backend: createMemoryBackend({}), flushDelay: 0 });
    await app.store.init();
    const { teamSection } = await import('../src/views/settings-team.js');
    const node = teamSection();
    expect([...node.querySelectorAll('button')].some((b) => b.textContent.includes('Turn on team sign-in'))).toBe(false);
    expect(node.textContent).toContain('could not be checked');
  });
});

describe('turning on team sign-in with older file names', () => {
  afterEach(() => {
    delete globalThis.puter;
  });

  it('copies a document whose stored name has ".." in it', async () => {
    const w = loadWorker();
    const acct = ownerAccount(w);
    globalThis.puter = acct.puter;
    const path = 'docs/m1/mabc123-Smith v. Jones..final.pdf';
    acct.drive.set(path, new Blob(['%PDF'], { type: 'application/pdf' }));
    const doc = { id: 'd1', matterId: 'm1', name: 'Smith v. Jones..final.pdf', file: { path, name: 'Smith v. Jones..final.pdf', type: 'application/pdf', size: 4 } };
    const store = createStore({ backend: createMemoryBackend({ collections: { documents: [doc] } }), flushDelay: 0 });
    await store.init();
    const res = await team.enableTeam({ store });
    expect(res.skipped).toEqual([]);
    const copied = w.kv.data.get('lg1:r:documents:d1');
    expect(copied.name).toBe('Smith v. Jones..final.pdf');
    expect(w.files.has(`legal-team/${copied.file.path}`)).toBe(true);
  });
});

describe('leaving a firm you were already removed from', () => {
  it('does not also report the removal ("You no longer have access")', async () => {
    const removed = vi.fn();
    window.addEventListener('legal:removed', removed);
    const exec = async () => new Response(JSON.stringify({ ok: false, error: 'not_a_member', message: 'You are not a member of this firm.' }), { status: 403 });
    await expect(team.call('https://legalfirm-abc.puter.work', 'leave', {}, { getPuter: () => ({ workers: { exec } }) })).rejects.toMatchObject({ code: 'not_a_member' });
    await expect(team.call('https://legalfirm-abc.puter.work', 'load', { coll: 'matters' }, { getPuter: () => ({ workers: { exec } }) })).rejects.toBeTruthy();
    window.removeEventListener('legal:removed', removed);
    // Only the ordinary request reports it.
    expect(removed).toHaveBeenCalledTimes(1);
  });
});
