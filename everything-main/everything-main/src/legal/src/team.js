/**
 * Shared firms. Puter KV and files are private to each account, so a firm
 * shared by several people runs through a Puter worker in the firm owner's
 * own account. When the owner turns team sign-in on, the app writes the
 * worker (public/worker/legal-team-worker.js) to their drive, deploys it with
 * puter.workers.create, and copies the firm's records and files into it.
 * From then on everyone (owner included) reads and writes through
 * puter.workers.exec, which forwards each person's own session for the
 * worker to check.
 *
 * Which firm a signed-in person is working in is stored in their own KV:
 *   lg1:workspaces  { current: 'own' | <workerUrl>, own: { url? }, joined: [{ url, business, role }] }
 */
import { COLLECTIONS } from './core/store.js';
import { app } from './app.js';
import { createIdbCache } from './core/cache.js';

export const WORKER_FILE = 'legal-team-worker.js';
export const WORKER_BUNDLE_URL = './worker/legal-team-worker.js';
const WS_KEY = 'lg1:workspaces';
const NAME_PREFIX = 'legalfirm-';

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
  return `https://${new URL(url).hostname.toLowerCase()}`;
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
    throw new TeamError(0, 'network', 'Could not reach the firm server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not json */
  }
  // Joining or leaving answers "not a member" as a matter of course; that is not a removal.
  if (res.status === 403 && data?.error === 'not_a_member' && op !== 'join' && op !== 'leave') {
    globalThis.dispatchEvent?.(new CustomEvent('legal:removed', { detail: { url } }));
  }
  if (!res.ok || !data?.ok) {
    throw new TeamError(
      res.status,
      data?.error || `http_${res.status}`,
      data?.message || (res.status >= 500 ? 'The firm server did not answer. Try again in a moment.' : `Request failed (${res.status})`),
    );
  }
  return data;
}

/** Storage backend that talks to a team worker (same interface as core/backend.js). */
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

// ---- Workspaces -------------------------------------------------------------------

// The last list this device read, so a failed read never opens the
// person's own firm in place of their shared one.
const localWsKey = () => (app.user?.uuid ? `legal.workspaces.${app.user.uuid}` : null);

function rememberWorkspaces(ws) {
  try {
    if (localWsKey()) localStorage.setItem(localWsKey(), JSON.stringify(ws));
  } catch {
    /* storage unavailable */
  }
}

function recallWorkspaces() {
  try {
    return localWsKey() ? JSON.parse(localStorage.getItem(localWsKey()) || 'null') : null;
  } catch {
    return null;
  }
}

export async function loadWorkspaces(kv) {
  let ws;
  try {
    ws = (await kv.get(WS_KEY)) || {};
    rememberWorkspaces(ws);
  } catch (err) {
    ws = recallWorkspaces();
    if (!ws) throw err;
  }
  return { current: ws.current || 'own', own: ws.own || {}, joined: Array.isArray(ws.joined) ? ws.joined : [] };
}

export async function saveWorkspaces(kv, ws) {
  await kv.set(WS_KEY, ws);
  rememberWorkspaces(ws);
}

/** The worker URL to use right now, or null for the person's own KV. */
export function activeWorker(ws) {
  if (ws.current === 'own') return ws.own?.url || null;
  return ws.joined.find((j) => j.url === ws.current)?.url || ws.own?.url || null;
}

/**
 * Bring a joined firm's role and name up to date: the owner may have
 * promoted or demoted this person since they joined. Resolves the saved
 * workspaces, or null when nothing changed or the server could not say.
 */
export async function refreshJoined(kv, ws, url, opts) {
  try {
    const entry = ws.joined.find((j) => j.url === url);
    const me = await call(url, 'whoami', {}, opts);
    if (!entry || (me.role !== 'admin' && me.role !== 'member')) return null;
    const business = me.business || entry.business;
    if (entry.role === me.role && entry.business === business) return null;
    const next = { ...ws, joined: ws.joined.map((j) => (j.url === url ? { ...j, role: me.role, business } : j)) };
    await saveWorkspaces(kv, next);
    return next;
  } catch {
    return null;
  }
}

// ---- Deploying ----------------------------------------------------------------------

async function fetchBundle() {
  const res = await fetch(WORKER_BUNDLE_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error('The firm server code is missing from this build of the app.');
  const source = await res.text();
  const m = /legal-team-worker build=(\w+)/.exec(source.slice(0, 120));
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

// Files stored before names had runs of dots collapsed: the firm server
// refuses ".." anywhere in a path, so they move to a path without it.
const teamPath = (path) => path.replace(/\.{2,}/g, '.');

/**
 * Deploy the owner's firm server and copy their data into it.
 * onProgress(text) reports each step. Resolves { own, skipped }.
 */
export async function enableTeam({ store, onProgress = () => {} }) {
  onProgress('Preparing your firm server');
  const { source, build } = await fetchBundle();
  const item = await puter.fs.write(WORKER_FILE, new Blob([source], { type: 'application/javascript' }), { overwrite: true, dedupeName: false, createMissingParents: true });
  const path = item?.path || WORKER_FILE;
  let dep = null;
  let name = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 4 && !dep; attempt++) {
    name = randomName();
    onProgress(attempt ? 'Trying another server name' : 'Starting your firm server');
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
  if (!dep) throw new Error(`Could not create the firm server in your Puter account. ${lastErr?.message || ''}`.trim());
  const url = normalizeWorkerUrl(dep.url || `https://${name}.puter.work`);
  onProgress('Waiting for the server to come online');
  await waitForHealth(url, build);

  onProgress('Copying your firm data');
  const backend = createWorkerBackend(url);
  try {
    await store.flush();
    for (const coll of COLLECTIONS) {
      let recs = store.all(coll);
      if (coll === 'documents') recs = recs.map((d) => (d.file?.path && teamPath(d.file.path) !== d.file.path ? { ...d, file: { ...d.file, path: teamPath(d.file.path) } } : d));
      if (recs.length) await backend.putRecords(coll, recs);
    }
    await backend.saveSettings(store.state.settings);
    await backend.bumpVersions([...COLLECTIONS, 'settings']);
  } catch (err) {
    // Do not leave a half-filled server behind; trying again starts fresh.
    await Promise.resolve()
      .then(() => puter.workers.delete?.(name))
      .catch(() => {});
    throw err;
  }

  // Document files move too: the worker serves them from the owner's drive.
  const files = store
    .all('documents')
    .map((d) => d.file)
    // Sample documents carry their text and have no file to copy.
    .filter((ref) => ref && typeof ref.demoText !== 'string');
  let copied = 0;
  const skipped = [];
  for (const ref of files) {
    onProgress(`Copying documents (${++copied} of ${files.length})`);
    try {
      const blob = await puter.fs.read(ref.path);
      if (blob.size > 8 * 1024 * 1024) {
        skipped.push(ref.name);
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      await call(url, 'fileWrite', { path: teamPath(ref.path), data: btoa(bin), type: ref.type || blob.type || '' }, { timeoutMs: 120000 });
    } catch (err) {
      console.warn('[legal] could not copy file', ref.path, err);
      skipped.push(ref.name);
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

// ---- Invitations ---------------------------------------------------------------------

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

/** Switch between the person's own firm and firms they joined. */
export async function switchWorkspace(current) {
  await saveWorkspaces(globalThis.puter.kv, { ...app.workspaces, current });
  location.hash = '#/';
  location.reload();
}

/**
 * Stop being a member of a firm: give up the membership on its server
 * (unless it is already gone) and remove the firm from this person's list.
 */
export async function leaveWorkspace(url, { removed = false } = {}) {
  const ws = app.workspaces;
  if (!removed) {
    try {
      await call(url, 'leave');
    } catch (err) {
      // Already removed, or a firm server from before leaving existed.
      if (err?.code !== 'not_a_member' && err?.code !== 'unknown_op') throw err;
    }
  }
  // Do not keep a local copy of a firm you no longer belong to.
  if (app.user)
    await createIdbCache(`user:${app.user.uuid}:team:${url}`)
      .clear()
      .catch(() => {});
  await saveWorkspaces(globalThis.puter.kv, { ...ws, joined: ws.joined.filter((j) => j.url !== url), current: ws.current === url ? 'own' : ws.current });
  location.hash = '#/';
  location.reload();
}
