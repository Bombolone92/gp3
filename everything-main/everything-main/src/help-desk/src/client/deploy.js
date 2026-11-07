/**
 * Puts the help desk server (a Puter worker) into the owner's own account.
 * The bundle ships with the app at worker/help-desk-worker.js; it is written
 * to the owner's drive and deployed with puter.workers.create(). Updating is
 * rewriting the same file, which redeploys at the same URL.
 */
import { sdk } from './puter.js';
import { serverApi } from './api.js';
import { randomId } from '../shared/ids.js';

export const WORKER_BUNDLE_URL = './worker/help-desk-worker.js';
const FILE_NAME = 'help-desk-worker.js';
const NAME_PREFIX = 'hd-';

let bundle = null;
export function fetchBundle() {
  bundle ||= (async () => {
    const res = await fetch(WORKER_BUNDLE_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('The server bundle is missing from this build of the app');
    const source = await res.text();
    const m = /help-desk-worker build=([a-z0-9]+) at=(\d+)/.exec(source.slice(0, 200));
    if (!m) throw new Error('The server bundle has no build id');
    return { source, build: m[1], builtAt: Number(m[2]) };
  })();
  bundle.catch(() => { bundle = null; });
  return bundle;
}

async function writeBundle(path, source) {
  const blob = new Blob([source], { type: 'application/javascript' });
  const item = await sdk().fs.write(path, blob, { overwrite: true, dedupeName: false, createMissingParents: true });
  return item?.path || path;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitForBuild(server, build, { attempts = 30, delay = 1500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const h = await serverApi.health(server);
      if (h?.ok && (!build || h.build === build)) return true;
    } catch {
      /* not up yet */
    }
    await sleep(delay);
  }
  return false;
}

async function ownWorker(name) {
  try {
    const list = await sdk().workers.list();
    const items = Array.isArray(list) ? list : list?.items || [];
    return items.find((w) => w?.name === name) || null;
  } catch {
    return null;
  }
}

/** Find a server this app deployed earlier in the user's account. */
export async function findOwnServer() {
  try {
    const list = await sdk().workers.list();
    const items = (Array.isArray(list) ? list : list?.items || []).filter((w) => String(w?.name || '').startsWith(NAME_PREFIX));
    items.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const w = items[0];
    return w ? { name: w.name, path: w.file_path || null } : null;
  } catch {
    return null;
  }
}

/** Deploy a new server. Returns { name, path, build }. */
export async function deployServer({ onProgress } = {}) {
  onProgress?.('Preparing the server');
  const { source, build } = await fetchBundle();
  onProgress?.('Copying the server to your Puter drive');
  const path = await writeBundle(FILE_NAME, source);
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const name = `${NAME_PREFIX}${randomId(10)}`;
    onProgress?.('Starting the server');
    let dep = null;
    try {
      dep = await sdk().workers.create(name, path);
    } catch (e) {
      lastError = e;
      dep = await ownWorker(name);
      if (!dep) continue;
    }
    onProgress?.('Waiting for the server to come online');
    await waitForBuild(name, build);
    return { name, path: dep?.file_path || path, build };
  }
  const msg = lastError?.message || String(lastError || 'unknown error');
  const hint = /verif/i.test(msg) ? ' Confirm your Puter account email address, then try again.' : '';
  throw new Error(`Could not create the server in your Puter account: ${msg}.${hint}`);
}

/**
 * Bring a deployed server up to the bundled build. Only ever moves forward
 * in time, so an old cached copy of the app never downgrades the server.
 */
export async function updateServer(server, reported) {
  try {
    const { source, build, builtAt } = await fetchBundle();
    if (reported?.build === build) return null;
    if (Number(reported?.builtAt) > builtAt) return null;
    let path = server.path;
    if (!path) path = (await sdk().workers.get(server.name))?.file_path || null;
    if (!path) return null;
    await writeBundle(path, source);
    return (await waitForBuild(server.name, build, { attempts: 15 })) ? build : null;
  } catch (e) {
    console.warn('Server update failed', e);
    return null;
  }
}
