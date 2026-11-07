/**
 * Staff and family access. A director turns it on once: the app copies the
 * school worker (public/worker/childcare-team-worker.js) into their Puter
 * drive and deploys it with puter.workers.create, so the worker runs in, and
 * stores data in, the director's own account. Their records and photos are
 * copied into it, and from then on everyone at the school (director
 * included) reads and writes through it with puter.workers.exec, which
 * forwards each person's own session for the worker to check.
 *
 * Which school a signed-in person is working in is stored in their own KV:
 *   cc1:workspaces  { current: 'own' | <workerUrl>, own: { url? }, joined: [{ url, school, role }] }
 */
import { app } from './app.js';
import { createIdbCache } from './core/cache.js';
import { PREFIX, flattenMeta } from './core/keys.js';
import { pool } from './core/backend.js';
import { rememberWorkspaces } from './platform.js';

export const WORKER_FILE = 'childcare-team-worker.js';
export const WORKER_BUNDLE_URL = './worker/childcare-team-worker.js';
const WS_KEY = 'cc1:workspaces';
const NAME_PREFIX = 'childcare-';

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
  if (!p?.workers?.exec) throw new TeamError(0, 'no_sdk', 'Staff and family access needs Puter. Reload and try again.');
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
    throw new TeamError(0, 'network', 'Could not reach the school server. Check your connection.');
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
    globalThis.dispatchEvent?.(new CustomEvent('childcare:removed', { detail: { url } }));
  }
  if (!res.ok || !data?.ok) {
    throw new TeamError(res.status, data?.error || `http_${res.status}`, data?.message || (res.status >= 500 ? 'The school server did not answer. Try again in a moment.' : `Request failed (${res.status})`));
  }
  return data;
}

/** Storage backend that talks to a school worker (same interface as backend.js). */
export function createWorkerBackend(url, opts = {}) {
  const c = (op, payload) => call(url, op, payload, opts);
  return {
    kind: 'team',
    url,
    async loadMeta(keys) {
      return flattenMeta((await c('meta', { keys })).items || {});
    },
    async loadCollections(names) {
      const out = {};
      for (let i = 0; i < names.length; i += 40) Object.assign(out, (await c('load', { names: names.slice(i, i + 40) })).records || {});
      return out;
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
      const out = {};
      for (let i = 0; i < names.length; i += 60) Object.assign(out, flattenMeta((await c('bump', { names: names.slice(i, i + 60) })).items || {}));
      return out;
    },
    async nextNumber(kind, atLeast = 1, count = 1) {
      return (await c('next', { kind, atLeast, count })).number;
    },
  };
}

/** Upload one file to a school worker (multipart, no base64). */
export async function uploadFile(url, path, blob, { getPuter = () => globalThis.puter, timeoutMs = 120000 } = {}) {
  const form = new FormData();
  form.append('path', path);
  form.append('file', blob, path.split('/').pop());
  return rawRequest(url, '/files', { method: 'POST', body: form }, { getPuter, timeoutMs });
}

/** Download one file from a school worker. `ref`/`id` name the record that shows it (needed for families). */
export async function downloadFile(url, path, { ref, id, type, getPuter = () => globalThis.puter, timeoutMs = 120000 } = {}) {
  const q = new URLSearchParams({ path });
  if (ref) q.set('ref', ref);
  if (id) q.set('id', id);
  if (type) q.set('type', type);
  const res = await rawRequest(url, `/files?${q}`, { method: 'GET' }, { getPuter, timeoutMs, raw: true });
  return res.blob();
}

async function rawRequest(url, path, init, { getPuter, timeoutMs, raw = false }) {
  const p = getPuter();
  if (!p?.workers?.exec) throw new TeamError(0, 'no_sdk', 'Staff and family access needs Puter. Reload and try again.');
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  let res;
  try {
    res = await p.workers.exec(`${url}${path}`, { ...init, ...(ctl ? { signal: ctl.signal } : {}) });
  } catch {
    throw new TeamError(0, 'network', 'Could not reach the school server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
  if (res.ok && raw) return res;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not json */
  }
  if (!res.ok || !data?.ok) throw new TeamError(res.status, data?.error || `http_${res.status}`, data?.message || `Request failed (${res.status})`);
  return data;
}

// ---- Workspaces -----------------------------------------------------------

export async function loadWorkspaces(kv) {
  const ws = (await kv.get(WS_KEY)) || {};
  return { current: ws.current || 'own', own: ws.own || {}, joined: Array.isArray(ws.joined) ? ws.joined : [] };
}

export async function saveWorkspaces(kv, ws) {
  await kv.set(WS_KEY, ws);
  if (app.user) rememberWorkspaces(app.user.uuid, ws);
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
  const m = /childcare-team-worker build=(\w+)/.exec(source.slice(0, 120));
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

/** Every record in this account's own KV, grouped by store name. */
async function ownRecords(kv) {
  const byName = new Map();
  let cursor;
  for (let guard = 0; guard < 10000; guard++) {
    const page = await kv.list({ pattern: `${PREFIX}r:`, returnValues: true, limit: 1000, ...(cursor ? { cursor } : {}) });
    const items = Array.isArray(page) ? page : page?.items || [];
    for (const it of items) {
      const rest = String(it.key).slice(`${PREFIX}r:`.length);
      const cut = rest.lastIndexOf(':');
      if (cut < 1 || !it.value || typeof it.value !== 'object') continue;
      const name = rest.slice(0, cut);
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(it.value);
    }
    cursor = Array.isArray(page) ? null : page?.cursor;
    if (!cursor) break;
  }
  return byName;
}

/** Every file under the app's own photo and document folders. */
async function ownFiles() {
  const out = [];
  for (const dir of ['media', 'students', 'messages', 'staff', 'school']) {
    let items = [];
    try {
      items = await puter.fs.readdir({ path: dir, recursive: true, depth: 4 });
    } catch {
      continue; // folder not created yet
    }
    for (const it of Array.isArray(items) ? items : items?.items || []) {
      if (it.is_dir) continue;
      const rel = String(it.path || '').split('/').slice(-3).join('/');
      if (rel.startsWith(`${dir}/`)) out.push({ path: rel, size: it.size || 0 });
    }
  }
  return out;
}

async function flushAll(store) {
  await store.flush();
  if (store.pendingCount()) throw new Error('Some of your changes are not saved yet. Check your connection and try again.');
}

/**
 * Deploy the director's school worker and copy their data into it.
 * onProgress(text) reports each step. Resolves { own, skipped }.
 */
export async function enableTeam({ store, onProgress = () => {} }) {
  onProgress('Preparing your school server');
  // The copy reads this account's KV, and afterwards the app works only
  // through the worker: anything not saved yet would be left behind.
  await flushAll(store);
  const { source, build } = await fetchBundle();
  const blob = new Blob([source], { type: 'application/javascript' });
  const item = await puter.fs.write(WORKER_FILE, blob, { overwrite: true, dedupeName: false, createMissingParents: true });
  const path = item?.path || WORKER_FILE;
  let dep = null;
  let name = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 4 && !dep; attempt++) {
    name = randomName();
    onProgress(attempt ? 'Trying another server name' : 'Starting your school server');
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
  if (!dep) throw new Error(`Could not create the school server in your Puter account. ${lastErr?.message || ''}`.trim());
  const url = normalizeWorkerUrl(dep.url || `https://${name}.puter.work`);
  onProgress('Waiting for the server to come online');
  await waitForHealth(url, build);

  onProgress('Copying your school records');
  const backend = createWorkerBackend(url);
  await flushAll(store);
  const byName = await ownRecords(puter.kv);
  let done = 0;
  for (const [n, recs] of byName) {
    await backend.putRecords(n, recs);
    onProgress(`Copying your school records (${++done} of ${byName.size})`);
  }
  await backend.saveSettings(store.state.settings);
  await backend.bumpVersions([...byName.keys(), 'settings']);

  // Photos and documents move too: the worker serves them from the director's drive.
  const files = await ownFiles();
  const skipped = [];
  let copied = 0;
  await pool(files, 3, async (f) => {
    onProgress(`Copying photos and files (${++copied} of ${files.length})`);
    try {
      await uploadFile(url, f.path, await puter.fs.read(f.path));
    } catch (err) {
      console.warn('[childcare] could not copy file', f.path, err);
      skipped.push(f.path.split('/').pop());
    }
  });
  return { own: { url, name, path, build, enabledAt: new Date().toISOString() }, skipped };
}

/** Bring an owner's worker up to the build shipped with this app. Never throws. */
export async function updateWorkerIfNeeded(own) {
  try {
    if (!own?.url || !own?.path) return false;
    const health = await fetch(`${own.url}/health`, { cache: 'no-store' }).then((r) => r.json());
    const { source, build } = await fetchBundle();
    if (!build || health?.build === build) return false;
    // Only ever move forward: a device still running an older copy of the
    // app (or a cached bundle) must not roll back a newer worker.
    if (Number(health?.build) >= Number(build)) return false;
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

/** Switch between the person's own school and ones they joined. */
export async function switchWorkspace(current) {
  const next = { ...app.workspaces, current };
  await saveWorkspaces(globalThis.puter.kv, next);
  location.hash = '#/';
  location.reload();
}

/** Stop being a member of a school (removes it from this person's list). */
export async function leaveWorkspace(url) {
  const ws = app.workspaces;
  // Do not keep a copy of a school you no longer belong to.
  if (app.user) await createIdbCache(`user:${app.user.uuid}:team:${url}`).clear().catch(() => {});
  const next = { ...ws, joined: ws.joined.filter((j) => j.url !== url), current: ws.current === url ? 'own' : ws.current };
  await saveWorkspaces(globalThis.puter.kv, next);
  location.hash = '#/';
  location.reload();
}
