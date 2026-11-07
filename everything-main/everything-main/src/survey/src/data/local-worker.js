/**
 * Runs the collector worker inside the page, for the local demo mode. The
 * builder and the respondent page (another tab, same origin) each run their
 * own copy over the same localStorage-backed KV, so a survey published in the
 * builder can be answered in a second tab with no Puter account at all.
 */
import { createLocalKv } from './local-kv.js';

export const LOCAL_WORKER_URL = 'https://sv-local.puter.work';

function matchRoute(routes, method, pathname) {
  const uSegs = pathname.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.method !== method) continue;
    const pSegs = r.pattern.split('/').filter(Boolean);
    if (pSegs[pSegs.length - 1] === '*path') return { handler: r.handler, params: {} };
    if (pSegs.length !== uSegs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pSegs.length; i++) {
      if (pSegs[i].startsWith(':')) params[pSegs[i].slice(1)] = decodeURIComponent(uSegs[i]);
      else if (pSegs[i] !== uSegs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

export function instantiateWorker(source, { kv }) {
  const routes = [];
  const add = (method) => (pattern, handler) => routes.push({ method, pattern, handler });
  const router = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  const me = { puter: { kv } };
  new Function('router', 'me', `'use strict';\n${source}`)(router, me);

  async function handle(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const match = matchRoute(routes, method, u.pathname);
    if (!match) return new Response('{"error":"not_found"}', { status: 404 });
    const request = new Request(u.href, {
      method,
      headers: init.headers || {},
      body: method === 'GET' ? undefined : init.body,
    });
    const result = await match.handler({ request, params: match.params, me });
    return result instanceof Response
      ? result
      : new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  }
  return { handle, kv };
}

/** Which file the local "deployed" worker runs, like a Puter worker bound
 *  to its source file (see backend.js); the file itself is in local storage. */
export const LOCAL_WORKER_FILE_KEY = 'sv-local-worker-file';
const DEFAULT_FILE = 'collector-worker.js';

export function localWorkerFile(storage = globalThis.localStorage) {
  try {
    return storage.getItem(LOCAL_WORKER_FILE_KEY) || DEFAULT_FILE;
  } catch {
    return DEFAULT_FILE;
  }
}

/**
 * A fetch that answers LOCAL_WORKER_URL from an in-page worker and passes
 * everything else to the real network. The worker runs whatever source the
 * builder last "deployed" into local storage, re-instantiated when it
 * changes, the way a real redeploy behaves.
 */
export function localWorkerFetch(storage = globalThis.localStorage) {
  const kv = createLocalKv({ storage, namespace: 'sv-local-worker:' });
  let source = null;
  let worker = null;
  return async (url, init) => {
    if (!String(url).startsWith(LOCAL_WORKER_URL)) return fetch(url, init);
    // A short delay keeps local mode honest about loading states.
    await new Promise((r) => setTimeout(r, 120));
    let current = null;
    try {
      current = JSON.parse(storage.getItem(`sv-local-fs:${localWorkerFile(storage)}`));
    } catch {
      current = null;
    }
    if (typeof current !== 'string') return new Response('{"error":"not_found"}', { status: 404 });
    if (current !== source) {
      source = current;
      worker = instantiateWorker(source, { kv });
    }
    return worker.handle(String(url), init);
  };
}
