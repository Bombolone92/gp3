/**
 * Team access. A business owner turns it on once: the app copies the team
 * worker (public/worker/property-management-team-worker.js) into their Puter drive
 * and deploys it with puter.workers.create, so the worker runs in, and stores
 * data in, the owner's own account. The owner's records are copied into it,
 * and from then on everyone in the business (owner included) reads and
 * writes through it with puter.workers.exec, which forwards each person's
 * own session for the worker to check.
 *
 * Which business a signed-in person is working in is stored in their own KV:
 *   pm1:workspaces  { current: 'own' | <workerUrl>, own: { url? }, joined: [{ url, business, role }] }
 */
import { COLLECTIONS } from './core/store.js';
import { readMeta } from './core/backend.js';
import { app } from './app.js';
import { createIdbCache } from './core/cache.js';

export const WORKER_FILE = 'property-management-team-worker.js';
export const WORKER_BUNDLE_URL = './worker/property-management-team-worker.js';
const WS_KEY = 'pm1:workspaces';
const NAME_PREFIX = 'propmgmt-';

export class TeamError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Only worker URLs on Puter's worker domain are trusted. */
export function isTrustedWorkerUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^[a-z0-9-]+\.puter\.work$/i.test(u.hostname) && (u.pathname === '/' || u.pathname === '');
  } catch {
    return false;
  }
}

export function normalizeWorkerUrl(url) {
  const u = new URL(url);
  return `https://${u.hostname.toLowerCase()}`;
}

/** One API call to a team worker. Throws TeamError with a readable message. */
export async function call(url, op, payload = {}, { timeoutMs = 30000, getPuter = () => globalThis.puter } = {}) {
  const p = getPuter();
  if (!p?.workers?.exec) throw new TeamError(0, 'no_sdk', 'Team access needs Puter. Reload and try again.');
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  let res;
  try {
    res = await p.workers.exec(`${url}/api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op, ...payload }),
      ...(ctl ? { signal: ctl.signal } : {}),
    });
  } catch {
    throw new TeamError(0, 'network', 'Could not reach the team server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not json */
  }
  if (res.status === 403 && data?.error === 'not_a_member' && op !== 'join') {
    globalThis.dispatchEvent?.(new CustomEvent('propertymgmt:removed', { detail: { url } }));
  }
  if (!res.ok || !data?.ok) {
    throw new TeamError(res.status, data?.error || `http_${res.status}`, data?.message || (res.status >= 500 ? 'The team server did not answer. Try again in a moment.' : `Request failed (${res.status})`));
  }
  return data;
}

/** Storage backend that talks to a team worker (same interface as backend.js). */
export function createWorkerBackend(url, opts = {}) {
  const c = (op, payload) => call(url, op, payload, opts);
  return {
    kind: 'team',
    url,
    async loadMeta() {
      return readMeta((await c('meta')).meta);
    },
    async loadCollection(name) {
      return (await c('load', { coll: name })).records || [];
    },
    async loadSettings() {
      return (await c('settings')).settings || null;
    },
    async putRecords(name, records) {
      for (let i = 0; i < records.length; i += 200) await c('put', { coll: name, records: records.slice(i, i + 200) });
    },
    async deleteRecords(name, ids) {
      for (let i = 0; i < ids.length; i += 200) await c('del', { coll: name, ids: ids.slice(i, i + 200) });
    },
    async saveSettings(settings) {
      await c('saveSettings', { settings });
    },
    async bumpVersions(names) {
      return readMeta((await c('bump', { names })).meta);
    },
    async nextNumber(kind, atLeast = 1) {
      return (await c('next', { kind, atLeast })).number;
    },
  };
}

// ---- Workspaces -----------------------------------------------------------

/**
 * Which companies this person has: their own (and its team server) and the
 * ones they joined. A brief failure is retried; a lasting one throws, since
 * guessing "own company only" would open the wrong data, and saving that
 * guess later would forget the team server and every company joined.
 */
export async function loadWorkspaces(kv, { attempts = 3, wait = 600 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const ws = (await kv.get(WS_KEY)) || {};
      return { current: ws.current || 'own', own: ws.own || {}, joined: Array.isArray(ws.joined) ? ws.joined : [] };
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, wait * i));
    }
  }
}

export async function saveWorkspaces(kv, ws) {
  await kv.set(WS_KEY, ws);
}

/**
 * Bring a joined company's saved role and name up to date (the owner may
 * have promoted this person, or renamed the company). Resolves the entry,
 * changed or not; never throws.
 */
export async function refreshMembership(kv, ws, url, opts = {}) {
  const entry = ws.joined.find((j) => j.url === url);
  if (!entry) return null;
  try {
    const me = await call(url, 'whoami', {}, opts);
    const next = { ...entry, role: me.role || entry.role, business: me.business || entry.business };
    if (next.role === entry.role && next.business === entry.business) return entry;
    ws.joined = ws.joined.map((j) => (j.url === url ? next : j));
    await saveWorkspaces(kv, ws);
    return next;
  } catch {
    return entry;
  }
}

/** The worker URL to use right now, or null for the person's own KV. */
export function activeWorker(ws) {
  if (ws.current === 'own') return ws.own?.url || null;
  return ws.joined.find((j) => j.url === ws.current)?.url || ws.own?.url || null;
}

// ---- Deploying ------------------------------------------------------------------

async function fetchBundle() {
  const res = await fetch(WORKER_BUNDLE_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error('The team server code is missing from this build of the app.');
  const source = await res.text();
  const m = /property-management-team-worker build=(\w+)/.exec(source.slice(0, 120));
  return { source, build: m ? m[1] : null };
}

function randomName() {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return NAME_PREFIX + [...b].map((x) => a[x % a.length]).join('');
}

async function waitForHealth(url, build, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${url}/health`, { cache: 'no-store' });
      const data = await res.json();
      if (data?.ok && (!build || data.build === build)) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Deploy the owner's team worker and copy their data into it.
 * onProgress(text) reports each step. Resolves { url, name, path }.
 */
export async function enableTeam({ store, onProgress = () => {} }) {
  // Copy what is in the account, not just what this device has loaded: a
  // record added on another device since would otherwise be left behind.
  onProgress('Loading your latest data');
  await store.sync({ force: true });
  await store.flush();
  if (!store.state.synced || !store.state.online || store.pendingCount()) {
    throw new Error('Your latest data could not be loaded or saved just now, so team sign-in was not turned on. Check your connection and try again.');
  }
  onProgress('Preparing your team server');
  const { source, build } = await fetchBundle();
  const blob = new Blob([source], { type: 'application/javascript' });
  const item = await puter.fs.write(WORKER_FILE, blob, { overwrite: true, dedupeName: false, createMissingParents: true });
  const path = item?.path || WORKER_FILE;
  let dep = null;
  let name = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 4 && !dep; attempt++) {
    name = randomName();
    onProgress(attempt ? 'Trying another server name' : 'Starting your team server');
    try {
      dep = await puter.workers.create(name, path);
      if (dep && dep.success === false) {
        lastErr = new Error((dep.errors || []).join(', ') || 'The worker could not be created.');
        dep = null;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (!dep) throw new Error(`Could not create the team server in your Puter account. ${lastErr?.message || ''}`.trim());
  const url = normalizeWorkerUrl(dep.url || `https://${name}.puter.work`);
  // A setup that does not finish removes its server, so retrying does not
  // leave unused workers behind in the account.
  const discard = async (err) => {
    try {
      await puter.workers.delete?.(name);
    } catch {
      /* best effort */
    }
    throw err;
  };
  onProgress('Waiting for the server to come online');
  if (!(await waitForHealth(url, build))) await discard(new Error('The team server did not come online. Try again in a minute.'));

  onProgress('Copying your business data');
  try {
    const backend = createWorkerBackend(url);
    await store.flush();
    const physical = store.physicalCollections();
    for (const phys of physical) await backend.putRecords(phys, store.physicalRecords(phys));
    await backend.saveSettings(store.state.settings);
    await backend.bumpVersions([...physical, 'settings']);
  } catch (err) {
    await discard(err);
  }

  // Files move too: the worker serves them from the owner's drive.
  const files = [];
  for (const coll of COLLECTIONS) {
    for (const r of store.all(coll)) {
      for (const a of r.attachments || []) files.push(a);
      if (r.photo?.path) files.push(r.photo);
    }
  }
  let copied = 0;
  const skipped = [];
  for (const att of files) {
    onProgress(`Copying files (${++copied} of ${files.length})`);
    try {
      const blob = await puter.fs.read(att.path);
      if (blob.size > 8 * 1024 * 1024) {
        skipped.push(att.name);
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      await call(url, 'fileWrite', { path: att.path, data: btoa(bin), type: att.type || blob.type || '' }, { timeoutMs: 120000 });
    } catch (err) {
      console.warn('[property-management] could not copy file', att.path, err);
      skipped.push(att.name);
    }
  }
  return { own: { url, name, path, build, enabledAt: new Date().toISOString() }, skipped };
}

/** Bring an owner's worker up to the build shipped with this app. Never throws. */
export async function updateWorkerIfNeeded(own) {
  try {
    if (!own?.url || !own?.path) return false;
    const health = await fetch(`${own.url}/health`, { cache: 'no-store' }).then((r) => r.json());
    const { source, build } = await fetchBundle();
    if (!build || health?.build === build) return false;
    await puter.fs.write(own.path, new Blob([source], { type: 'application/javascript' }), { overwrite: true, dedupeName: false });
    return true;
  } catch {
    return false;
  }
}

// ---- Invitations -----------------------------------------------------------------

export function inviteLink(workerUrl, token) {
  const base = location.href.split('#')[0].split('?')[0];
  const w = new URL(workerUrl).hostname.replace(/\.puter\.work$/i, '');
  return `${base}#/join?w=${encodeURIComponent(w)}&t=${encodeURIComponent(token)}`;
}

/** Parse a join link's query into { url, token } or null. */
export function parseJoin(query) {
  const w = String(query?.w || '');
  const t = String(query?.t || '');
  if (!/^[a-z0-9-]{3,63}$/i.test(w) || !/^[A-Za-z0-9]{12,64}$/.test(t)) return null;
  const url = `https://${w.toLowerCase()}.puter.work`;
  return isTrustedWorkerUrl(url) ? { url, token: t } : null;
}

/** Switch between the person's own business and ones they joined. */
export async function switchWorkspace(current) {
  const next = { ...app.workspaces, current };
  await saveWorkspaces(globalThis.puter.kv, next);
  location.hash = '#/';
  location.reload();
}

/** Stop being a member of a business (removes it from this person's list). */
export async function leaveWorkspace(url) {
  const ws = app.workspaces;
  // Do not keep a copy of a business you no longer belong to.
  if (app.user) await createIdbCache(`user:${app.user.uuid}:team:${url}`).clear().catch(() => {});
  const next = { ...ws, joined: ws.joined.filter((j) => j.url !== url), current: ws.current === url ? 'own' : ws.current };
  await saveWorkspaces(globalThis.puter.kv, next);
  location.hash = '#/';
  location.reload();
}
