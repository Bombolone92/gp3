/**
 * Each workspace owner runs the Teamchat worker in their own Puter account.
 * This module puts it there: it fetches the bundle the app ships
 * (public/worker/teamchat-worker.js), writes it to the user's drive, and
 * creates a worker from it with puter.workers.create(). The worker's KV is
 * then the database for every workspace the user owns, paid for by them.
 *
 * Updating is overwriting the same file (Puter redeploys at the same URL):
 * when the bundle's build id differs from the one a user's worker reports,
 * the app rewrites the file the next time that user opens it.
 */
import { WORKER_BUNDLE_URL, WORKER_NAME_PREFIX, SHARED_WORKER_URL } from '../config.js';
import { uid } from '../shared/ids.js';
import { api } from './api.js';

let bundlePromise = null;

/** The worker bundle shipped with this build of the app, plus its build id. */
export function fetchBundle() {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const res = await fetch(WORKER_BUNDLE_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('The worker bundle is missing from this build of the app (run npm run build:worker)');
      const source = await res.text();
      const m = /teamchat-worker build=([a-z0-9]+)(?: at=(\d+))?/.exec(source.slice(0, 200));
      if (!m) throw new Error('The worker bundle has no build id');
      return { source, build: m[1], builtAt: Number(m[2]) || 0 };
    })();
    bundlePromise.catch(() => { bundlePromise = null; });
  }
  return bundlePromise;
}

/** Forget the fetched bundle (tests ship several). */
export function resetBundleCache() {
  bundlePromise = null;
}

const FILE_NAME = 'teamchat-worker.js';

async function writeBundle(path, source) {
  const blob = new Blob([source], { type: 'application/javascript' });
  const item = await puter.fs.write(path, blob, { overwrite: true, dedupeName: false, createMissingParents: true });
  return item?.path || path;
}

/**
 * Wait until a freshly created or updated worker answers with the expected
 * build. Deploys propagate within seconds; give up quietly after a while and
 * let the first real request surface any problem.
 */
async function waitForBuild(url, build, { attempts = 20, delay = 1000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const h = await api.health(url);
      if (h?.ok && (!build || h.build === build)) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  return false;
}

/**
 * Create the user's worker. Returns { name, url, path, build }. Tries a few
 * random names in case one is taken (names are global on puter.work).
 */
export async function deployOwnWorker({ onProgress } = {}) {
  onProgress?.('Preparing your workspace server');
  const { source, build } = await fetchBundle();
  onProgress?.('Copying the server to your Puter drive');
  const path = await writeBundle(FILE_NAME, source);
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const name = `${WORKER_NAME_PREFIX}${uid(10)}`;
    onProgress?.(attempt ? 'Trying another server name' : 'Starting your workspace server');
    let dep = null;
    try {
      dep = await puter.workers.create(name, path);
    } catch (e) {
      lastError = e;
      // The call failed, yet the worker may have been made all the same (the
      // answer lost on the way, a timeout on a slow link): one of ours by
      // that name is taken as it is, rather than a second one made beside it
      // to sit in the account unused, and unfound, for good.
      dep = await ownWorkerNamed(name);
      if (!dep) continue;
    }
    const url = String(dep?.url || `https://${name}.puter.work`).replace(/\/+$/, '');
    onProgress?.('Waiting for the server to come up');
    await waitForBuild(url, build);
    return { name, url, path: dep?.file_path || path, build, createdAt: Date.now() };
  }
  throw new Error(`Could not create a worker in your Puter account: ${lastError?.message || lastError}`);
}

/** The user's own worker of exactly this name, from the account's list, or null (never another account's: names are global, the list is ours). */
async function ownWorkerNamed(name) {
  try {
    const list = await puter.workers.list();
    const items = Array.isArray(list) ? list : list?.items || [];
    return items.find((w) => w && w.name === name) || null;
  } catch {
    return null;
  }
}

/**
 * Look for a worker this app created earlier in the user's account, for when
 * the user's settings document was lost. Best effort; null when none.
 */
export async function findOwnWorker() {
  try {
    const list = await puter.workers.list();
    const items = Array.isArray(list) ? list : list?.items || [];
    const mine = items.filter((w) => String(w.name || '').startsWith(WORKER_NAME_PREFIX))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const w = mine[0];
    if (!w) return null;
    return { name: w.name, url: String(w.url || `https://${w.name}.puter.work`).replace(/\/+$/, ''), path: w.file_path || null, build: null };
  } catch {
    return null;
  }
}

/**
 * Bring the user's worker up to the shipped build if it is behind. Returns
 * the new build id when an update was written, null otherwise. Never throws:
 * a failed update leaves a working (older) worker in place.
 *
 * Only forward: a build id is a hash, so two that differ say nothing about
 * which is newer, and the app a device runs may be older than the worker
 * (the service worker keeps the last build until the reader asks to reload,
 * while another device already brought the worker up to date). The build
 * time settles it; a worker that cannot say when it was built is from before
 * the stamp, and is older.
 *
 * The build is answered only once the worker answers with it: the bundle
 * written, the worker is asked for its build until it says the new one (see
 * waitForBuild), and one that has not said so within the wait (a redeploy
 * slow to take, or a bundle the worker cannot start on) is answered as no
 * update, since none has taken. Answered as updated all the same, as it used
 * to be, the caller told the owner their server was updated to the latest
 * version and recorded the new build on their account while the server
 * still ran the old one, on every opening of the app. `wait` is the
 * caller's say over how long that is (tests).
 */
export async function updateOwnWorker(worker, reportedBuild, reportedBuiltAt = 0, { wait = { attempts: 10 } } = {}) {
  try {
    const { source, build, builtAt } = await fetchBundle();
    if (reportedBuild === build) return null;
    if (builtAt && Number(reportedBuiltAt) > builtAt) return null;
    let path = worker.path;
    if (!path && worker.name) {
      const info = await puter.workers.get(worker.name);
      path = info?.file_path || null;
    }
    if (!path) return null;
    await writeBundle(path, source);
    if (!(await waitForBuild(worker.url, build, wait))) {
      console.warn(`Worker update to ${build} was written but the worker has not come up on it yet`);
      return null;
    }
    return build;
  } catch (e) {
    console.warn('Worker update failed', e);
    return null;
  }
}

/** True when a configured shared worker replaces per-owner deploys. */
export function usesSharedWorker() {
  return !!SHARED_WORKER_URL;
}
