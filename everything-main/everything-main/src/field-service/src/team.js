/**
 * Team access. A business owner turns it on once: the app copies the team
 * worker (public/worker/field-service-team-worker.js) into their Puter drive
 * and deploys it with puter.workers.create, so the worker runs in, and stores
 * data in, the owner's own account. The owner's records are copied into it,
 * and from then on everyone in the business (owner included) reads and
 * writes through it with puter.workers.exec, which forwards each person's
 * own session for the worker to check.
 *
 * Which business a signed-in person is working in is stored in their own KV:
 *   fs1:workspaces  { current: 'own' | <workerUrl>, own: { url? }, joined: [{ url, business, role }] }
 */
import { COLLECTIONS } from './core/store.js';
import { app } from './app.js';
import { createIdbCache } from './core/cache.js';

export const WORKER_FILE = 'field-service-team-worker.js';
export const WORKER_BUNDLE_URL = './worker/field-service-team-worker.js';
const WS_KEY = 'fs1:workspaces';
const NAME_PREFIX = 'fieldsvc-';

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
    globalThis.dispatchEvent?.(new CustomEvent('fieldservice:removed', { detail: { url } }));
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
      return (await c('meta')).meta || {};
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
      return (await c('bump', { names })).meta || {};
    },
    async nextNumber(kind, atLeast = 1) {
      return (await c('next', { kind, atLeast })).number;
    },
  };
}

// ---- Workspaces -----------------------------------------------------------

// A copy on this device, so a failed read never boots an owner into the
// wrong business (whose list would then be saved over the real one).
const localWsKey = () => (app.user?.uuid ? `fieldservice.workspaces:${app.user.uuid}` : null);
function keepLocal(ws) {
  try {
    if (localWsKey()) localStorage.setItem(localWsKey(), JSON.stringify(ws));
  } catch {}
}

/** The person's businesses. Falls back to this device's copy; throws if neither can be read. */
export async function loadWorkspaces(kv) {
  let ws;
  try {
    ws = (await kv.get(WS_KEY)) || {};
    keepLocal(ws);
  } catch (err) {
    let local = null;
    try {
      local = localWsKey() && JSON.parse(localStorage.getItem(localWsKey()) || 'null');
    } catch {}
    if (!local || typeof local !== 'object') throw err;
    ws = local;
  }
  return { current: ws.current || 'own', own: ws.own || {}, joined: Array.isArray(ws.joined) ? ws.joined : [] };
}

export async function saveWorkspaces(kv, ws) {
  await kv.set(WS_KEY, ws);
  keepLocal(ws);
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
  const m = /field-service-team-worker build=(\w+)/.exec(source.slice(0, 120));
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
  // A setup that fails from here on removes the half-made server, so a
  // retry does not leave another one behind in the owner's account.
  const discard = async (err) => {
    try {
      await puter.workers.delete(name);
    } catch {}
    throw err;
  };
  onProgress('Waiting for the server to come online');
  if (!(await waitForHealth(url, build))) await discard(new Error('The team server did not come online. Nothing was changed; try again in a few minutes.'));

  onProgress('Copying your business data');
  const backend = createWorkerBackend(url);
  try {
    await store.flush();
    // Copy the business as it is now: another device may have changed it
    // since this one last synced, and after the switch nobody reads the old
    // storage again.
    await store.sync();
    if (!store.state.online) throw new Error('Your latest data could not be read.');
    for (const coll of COLLECTIONS) {
      const recs = store.all(coll);
      if (recs.length) await backend.putRecords(coll, recs);
    }
    await backend.saveSettings(store.state.settings);
    await backend.bumpVersions([...COLLECTIONS, 'settings']);
  } catch (err) {
    await discard(new Error(`Your data could not be copied to the team server, so team sign-in was not turned on. ${err?.message || ''}`.trim()));
  }

  // Files move too: the worker serves them from the owner's drive.
  const files = [];
  for (const coll of COLLECTIONS) {
    for (const r of store.all(coll)) {
      for (const a of r.attachments || []) files.push(a);
      if (r.receipt) files.push(r.receipt);
    }
  }
  let copied = 0;
  const skipped = [];
  for (const att of files) {
    onProgress(`Copying files (${++copied} of ${files.length})`);
    try {
      const blob = await puter.fs.read(att.path);
      if (blob.size > 8 * 1024 * 1024) {
        skipped.push(`${att.name} (over 8 MB)`);
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      await call(url, 'fileWrite', { path: att.path, data: btoa(bin), type: att.type || blob.type || '' }, { timeoutMs: 120000 });
    } catch (err) {
      console.warn('[field-service] could not copy file', att.path, err);
      skipped.push(`${att.name} (could not be copied)`);
    }
  }
  return { own: { url, name, path, build, enabledAt: new Date().toISOString() }, skipped };
}

/**
 * Team sign-in was turned on from another device while this one kept
 * working in the owner's own storage. Bring this device's changes over: any
 * record newer than the team's copy (or missing there and changed around the
 * switch), and deletes not sent yet. Never overwrites a newer team edit.
 */
export async function carryOverToTeam(store, backend, enabledAt = '') {
  // Edits from a few minutes before the switch may have missed the copy.
  const since = enabledAt ? new Date(Date.parse(enabledAt) - 10 * 60 * 1000).toISOString() : '';
  const touched = [];
  for (const coll of COLLECTIONS) {
    const local = store.all(coll);
    if (!local.length) continue;
    const remote = new Map((await backend.loadCollection(coll)).map((r) => [r.id, r]));
    const newer = local.filter((r) => {
      const theirs = remote.get(r.id);
      return theirs ? (r.updatedAt || '') > (theirs.updatedAt || '') : (r.updatedAt || '') > since;
    });
    if (newer.length) {
      await backend.putRecords(coll, newer);
      touched.push(coll);
    }
  }
  const dels = new Map();
  for (const d of store.snapshot().pending.dels) (dels.get(d.coll) || dels.set(d.coll, []).get(d.coll)).push(d.id);
  for (const [coll, ids] of dels) {
    await backend.deleteRecords(coll, ids);
    if (!touched.includes(coll)) touched.push(coll);
  }
  if (touched.length) await backend.bumpVersions(touched);
  return touched;
}

/** Bring an owner's worker up to the build shipped with this app. Never throws. */
export async function updateWorkerIfNeeded(own) {
  try {
    if (!own?.url || !own?.path) return false;
    const health = await fetch(`${own.url}/health`, { cache: 'no-store' }).then((r) => r.json());
    const { source, build } = await fetchBundle();
    // Only ever move forward: an older app (or a cached bundle) on another
    // device must not put an old worker back.
    if (!build || (health?.build && !(Number(build) > Number(health.build)))) return false;
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

/** Save the business list, or say why nothing happened. */
async function saveOrReport(ws) {
  try {
    await saveWorkspaces(globalThis.puter.kv, ws);
    return true;
  } catch (err) {
    console.warn('[field-service] could not save the business list', err);
    const { toast } = await import('./ui/toast.js');
    toast('Could not reach Puter, so nothing was changed. Check your connection and try again.', { type: 'error' });
    return false;
  }
}

/** Switch between the person's own business and ones they joined. */
export async function switchWorkspace(current) {
  const next = { ...app.workspaces, current };
  if (!(await saveOrReport(next))) return;
  location.hash = '#/';
  location.reload();
}

/** Stop being a member of a business (removes it from this person's list). */
export async function leaveWorkspace(url) {
  const ws = app.workspaces;
  const next = { ...ws, joined: ws.joined.filter((j) => j.url !== url), current: ws.current === url ? 'own' : ws.current };
  if (!(await saveOrReport(next))) return;
  // Do not keep a copy of a business you no longer belong to.
  await app.store?.close();
  if (app.user) await createIdbCache(`user:${app.user.uuid}:team:${url}`).clear().catch(() => {});
  location.hash = '#/';
  location.reload();
}
