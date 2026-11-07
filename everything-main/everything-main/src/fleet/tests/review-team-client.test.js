// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadWorker, fakeKV, OWNER, SAM } from './review-team-helpers.js';
import { app } from '../src/app.js';
import * as team from '../src/team.js';

// jsdom's Blob has no arrayBuffer(); the worker and the app both use it.
Blob.prototype.arrayBuffer ??= function () {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsArrayBuffer(this);
  });
};

const URL_ = 'https://fleet-abc.puter.work';
let w;
let userKV;
beforeEach(() => {
  w = loadWorker();
  userKV = fakeKV();
});
afterEach(() => {
  delete globalThis.puter;
  app.user = null;
  app.workspaces = null;
  app.team = null;
});

async function join(role, user) {
  const inv = (await w.api(OWNER, { op: 'invite', role })).body;
  return (await w.api(user, { op: 'join', token: inv.token })).body;
}

describe('leaving a fleet', () => {
  it('takes the person off the team, not only off their own list', async () => {
    await join('member', SAM);
    globalThis.puter = { kv: userKV, workers: { exec: w.exec(SAM) } };
    app.user = { uuid: 'user-2', username: 'sam' };
    app.workspaces = { current: URL_, own: {}, joined: [{ url: URL_, business: 'Acme', role: 'member' }] };
    await team.leaveWorkspace(URL_);
    expect((await userKV.get('fl1:workspaces')).joined).toEqual([]);
    expect((await w.api(OWNER, { op: 'members' })).body.members).toEqual([]);
  });

  it('still leaves when the team server cannot be reached', async () => {
    globalThis.puter = {
      kv: userKV,
      workers: {
        exec: async () => {
          throw new Error('offline');
        },
      },
    };
    app.user = { uuid: 'user-2', username: 'sam' };
    app.workspaces = { current: URL_, own: {}, joined: [{ url: URL_, business: 'Acme', role: 'member' }] };
    await team.leaveWorkspace(URL_);
    expect(await userKV.get('fl1:workspaces')).toMatchObject({ current: 'own', joined: [] });
  });
});

describe('worker upgrades', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function setup(serverBuild, bundleBuild) {
    const writes = [];
    globalThis.puter = { fs: { write: async (p) => writes.push(p) } };
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/health')) return new Response(JSON.stringify({ ok: true, build: serverBuild }));
      return new Response(`// fleet-team-worker build=${bundleBuild}\nrouter;`);
    };
    return writes;
  }

  it('updates an older server', async () => {
    const writes = setup('2', '3');
    expect(await team.updateWorkerIfNeeded({ url: URL_, path: '/olivia/AppData/x/fleet-team-worker.js' })).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it('never puts an older build back over a newer one', async () => {
    // An outdated copy of the app (another device, a cached bundle).
    const writes = setup('4', '3');
    expect(await team.updateWorkerIfNeeded({ url: URL_, path: '/olivia/AppData/x/fleet-team-worker.js' })).toBe(false);
    expect(writes).toHaveLength(0);
  });
});

describe('turning on team access', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function ownerStore(collections, settings) {
    const { createStore } = await import('../src/core/store.js');
    const { createMemoryBackend } = await import('../src/core/backend.js');
    const { bucketOf } = await import('../src/core/schema.js');
    const store = createStore({ backend: createMemoryBackend({ collections, settings }, { bucketOf }), flushDelay: 0 });
    await store.init();
    return store;
  }

  /** Puter as the owner's app sees it, with the worker behind exec. */
  function ownerPuter({ failOp = null, files = {} } = {}) {
    const deleted = [];
    const exec = w.exec(OWNER);
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/health')) return new Response(JSON.stringify(await w.health()));
      return new Response('// fleet-team-worker build=3\nrouter;');
    };
    globalThis.puter = {
      kv: userKV,
      fs: {
        write: async (p) => ({ path: `/olivia/AppData/app/${p}` }),
        read: async (p) => {
          if (!(p in files)) throw new Error('not found');
          return new Blob([files[p]]);
        },
      },
      workers: {
        create: async (name) => ({ url: `https://${name}.puter.work` }),
        delete: async (name) => deleted.push(name),
        exec: async (url, init) => {
          if (failOp && JSON.parse(init.body).op === failOp) return new Response(JSON.stringify({ ok: false, error: 'server_error' }), { status: 500 });
          return exec(url, init);
        },
      },
    };
    return { deleted };
  }

  it('removes the half-made server when the data cannot be copied', async () => {
    const store = await ownerStore({ vehicles: [{ id: 'v1', name: 'Van' }] });
    const { deleted } = ownerPuter({ failOp: 'put' });
    await expect(team.enableTeam({ store })).rejects.toThrow();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatch(/^fleet-/);
  });

  it('stops, and removes the server, when it never comes online', async () => {
    const store = await ownerStore({ vehicles: [{ id: 'v1', name: 'Van' }] });
    const { deleted } = ownerPuter();
    globalThis.fetch = async (url) => (String(url).endsWith('/health') ? new Response('', { status: 503 }) : new Response('// fleet-team-worker build=3\nrouter;'));
    vi.useFakeTimers();
    try {
      const done = team.enableTeam({ store }).then(() => 'resolved', (err) => err.message);
      await vi.advanceTimersByTimeAsync(40000);
      expect(await done).toMatch(/did not come online/);
    } finally {
      vi.useRealTimers();
    }
    expect(deleted).toHaveLength(1);
    expect(w.kv.data.has('fl1:r:vehicles:v1')).toBe(false);
  });

  it('carries the issue, work order, and purchase order numbers over', async () => {
    const store = await ownerStore({ issues: [{ id: 'i1', number: 7 }], workOrders: [{ id: 'w1', number: 3 }] }, { numbering: { purchaseOrder: 120 } });
    ownerPuter();
    await team.enableTeam({ store });
    await join('driver', SAM);
    // A driver cannot move the counter ahead, so it must already be there.
    expect((await w.api(SAM, { op: 'next', kind: 'issue', atLeast: 8 })).body.number).toBe(8);
    expect((await w.api(OWNER, { op: 'next', kind: 'workOrder' })).body.number).toBe(4);
    expect((await w.api(OWNER, { op: 'next', kind: 'purchaseOrder' })).body.number).toBe(120);
  });

  it('says why a file was not copied', async () => {
    const store = await ownerStore({ vehicles: [{ id: 'v1', name: 'Van', photo: { name: 'van.jpg', path: 'files/vehicles/x-van.jpg', type: 'image/jpeg' } }] });
    ownerPuter();
    const { skipped } = await team.enableTeam({ store });
    expect(skipped).toEqual(['van.jpg (could not be copied)']);
  });
});

describe('role changes', () => {
  it('picks up a role the owner changed since joining', async () => {
    await join('driver', SAM);
    await w.api(OWNER, { op: 'setRole', uuid: 'user-2', role: 'admin' });
    await w.api(OWNER, { op: 'saveSettings', settings: { company: { name: 'Acme Haulage' } } });
    globalThis.puter = { kv: userKV, workers: { exec: w.exec(SAM) } };
    app.user = { uuid: 'user-2', username: 'sam' };
    app.workspaces = { current: URL_, own: {}, joined: [{ url: URL_, business: 'Acme', role: 'driver' }] };
    app.team = { url: URL_, role: 'driver', business: 'Acme' };
    expect(await team.refreshMembership(userKV, URL_)).toBe(true);
    expect(app.team).toMatchObject({ role: 'admin', business: 'Acme Haulage' });
    expect((await userKV.get('fl1:workspaces')).joined[0]).toMatchObject({ role: 'admin', business: 'Acme Haulage' });
  });
});

describe('reading which fleet to open', () => {
  const failing = { get: async () => Promise.reject(new Error('KV unavailable')), set: async () => true };

  it('falls back to this device’s copy when Puter cannot be read', async () => {
    app.user = { uuid: 'owner-1', username: 'olivia' };
    const ws = { current: 'own', own: { url: URL_ }, joined: [{ url: 'https://fleet-b.puter.work', business: 'B', role: 'member' }] };
    await userKV.set('fl1:workspaces', ws);
    expect(await team.loadWorkspaces(userKV)).toEqual(ws);
    // A hiccup must not open the owner's old personal storage instead of the team.
    expect(await team.loadWorkspaces(failing)).toEqual(ws);
  });

  it('reports the failure when there is no copy to fall back to', async () => {
    app.user = { uuid: 'someone-new', username: 'n' };
    await expect(team.loadWorkspaces(failing)).rejects.toThrow('KV unavailable');
  });
});

describe('opening a teammate’s file', () => {
  it('never opens it as a page that runs in the app', async () => {
    // A driver uploads HTML and records it as an inspection photo of type
    // text/html (or SVG). Opened as is, its script would run with the app's
    // origin and could read the owner's Puter session.
    await join('driver', SAM);
    const html = Buffer.from('<script>steal()</script>').toString('base64');
    await w.api(SAM, { op: 'fileWrite', path: 'files/inspections/x-photo.html', data: html, type: 'text/html' });
    await w.api(SAM, { op: 'fileWrite', path: 'files/inspections/y-photo.svg', data: html, type: 'image/svg+xml' });
    await w.api(SAM, { op: 'fileWrite', path: 'files/inspections/z-photo.html', data: html, type: 'text/html' });
    globalThis.puter = { workers: { exec: w.exec(OWNER) } };
    app.team = { url: URL_, role: 'owner', business: '' };
    const made = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => (made.push(blob), `blob:${made.length}`);
    try {
      const { fileUrl } = await import('../src/files.js');
      await fileUrl({ path: 'files/inspections/x-photo.html', type: 'text/html' });
      await fileUrl({ path: 'files/inspections/y-photo.svg', type: 'image/svg+xml' });
      await fileUrl({ path: 'files/inspections/z-photo.html', type: '' });
    } finally {
      URL.createObjectURL = orig;
    }
    expect(made.map((b) => b.type)).toEqual(['application/octet-stream', 'application/octet-stream', 'application/octet-stream']);
  });

  it('still shows photos and PDFs inline', async () => {
    const png = Buffer.from('png').toString('base64');
    await w.api(OWNER, { op: 'fileWrite', path: 'files/fuel/a.png', data: png, type: 'image/png' });
    await w.api(OWNER, { op: 'fileWrite', path: 'files/fuel/b.pdf', data: png, type: 'application/pdf' });
    globalThis.puter = { workers: { exec: w.exec(OWNER) } };
    app.team = { url: URL_, role: 'owner', business: '' };
    const made = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => (made.push(blob), `blob:${made.length}`);
    try {
      const { fileUrl } = await import('../src/files.js');
      await fileUrl({ path: 'files/fuel/a.png', type: 'image/png' });
      await fileUrl({ path: 'files/fuel/b.pdf', type: 'application/pdf' });
    } finally {
      URL.createObjectURL = orig;
    }
    expect(made.map((b) => b.type)).toEqual(['image/png', 'application/pdf']);
  });
});

describe('team access turned on from another device', () => {
  it('does nothing while team access is still off', async () => {
    const { createStore } = await import('../src/core/store.js');
    const { createMemoryBackend } = await import('../src/core/backend.js');
    const store = createStore({ backend: createMemoryBackend(), flushDelay: 0 });
    await store.init();
    await userKV.set('fl1:workspaces', { current: 'own', own: {}, joined: [] });
    globalThis.puter = { kv: userKV, workers: { exec: w.exec(OWNER) } };
    app.user = { uuid: 'owner-1', username: 'olivia' };
    app.workspaces = { current: 'own', own: {}, joined: [] };
    expect(await team.checkTeamTurnedOn(userKV, store)).toBe(false);
  });

  it('brings this device’s later changes over to the team server, then switches', async () => {
    const { createStore } = await import('../src/core/store.js');
    const { createMemoryBackend } = await import('../src/core/backend.js');
    const { bucketOf } = await import('../src/core/schema.js');
    let clock = '2026-10-01T00:00:00.000Z';
    // This device has the owner's fleet open in their own storage.
    const personal = createMemoryBackend({ collections: { vehicles: [{ id: 'v1', name: 'Van', updatedAt: '2026-10-01T00:00:00.000Z' }], fuel: [{ id: 'f0', date: '2026-09-02', volume: 5, updatedAt: '2026-09-02T00:00:00.000Z' }] } }, { bucketOf });
    // Writes stay queued, as when this device is offline or mid-debounce.
    const store = createStore({ backend: personal, flushDelay: 60000, now: () => clock });
    await store.init();
    // Meanwhile another device copied that fleet to the team server...
    const enabledAt = '2026-10-10T12:00:00.000Z';
    await w.api(OWNER, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1', name: 'Van', updatedAt: '2026-10-01T00:00:00.000Z' }] });
    await w.api(OWNER, { op: 'put', bucket: 'fuel_202609', records: [{ id: 'f0', date: '2026-09-02', volume: 5, updatedAt: '2026-09-02T00:00:00.000Z' }] });
    await userKV.set('fl1:workspaces', { current: 'own', own: { url: URL_, enabledAt }, joined: [] });
    // ...and a teammate already edited the van there.
    await w.api(OWNER, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1', name: 'Van (team)', updatedAt: '2026-10-11T09:00:00.000Z' }] });
    // This device kept working after the switch.
    clock = '2026-10-11T10:00:00.000Z';
    store.put('fuel', { id: 'f1', date: '2026-10-11', volume: 40 });
    store.remove('fuel', 'f0');

    globalThis.puter = { kv: userKV, workers: { exec: w.exec(OWNER) } };
    app.user = { uuid: 'owner-1', username: 'olivia' };
    app.workspaces = { current: 'own', own: {}, joined: [] };
    app.team = null;
    expect(await team.checkTeamTurnedOn(userKV, store)).toBe(true);
    expect(w.kv.data.get('fl1:r:fuel_202610:f1')).toMatchObject({ volume: 40 });
    expect(w.kv.data.has('fl1:r:fuel_202609:f0')).toBe(false);
    // The teammate's newer edit is kept.
    expect(w.kv.data.get('fl1:r:vehicles:v1').name).toBe('Van (team)');
    expect(w.kv.data.get('fl1:meta')).toMatchObject({ fuel_202610: 1, fuel_202609: 1 });
  });
});

describe('switching fleets', () => {
  it('sends changes still waiting to go out before switching', async () => {
    const { createStore } = await import('../src/core/store.js');
    const { createMemoryBackend } = await import('../src/core/backend.js');
    const { bucketOf } = await import('../src/core/schema.js');
    const backend = createMemoryBackend({}, { bucketOf });
    const store = createStore({ backend, flushDelay: 60000 });
    await store.init();
    globalThis.puter = { kv: userKV };
    app.user = { uuid: 'user-2', username: 'sam' };
    app.workspaces = { current: URL_, own: {}, joined: [{ url: URL_, business: 'Acme', role: 'driver' }] };
    app.store = store;
    // A driver logs fuel and switches to their own fleet straight away.
    store.put('fuel', { id: 'f1', date: '2026-10-11', volume: 40 });
    await team.switchWorkspace('own');
    expect(backend.peek('fuel_202610').map((r) => r.id)).toEqual(['f1']);
    expect((await userKV.get('fl1:workspaces')).current).toBe('own');
    app.store = null;
  });
});
