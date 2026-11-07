/**
 * Puter worker entry. Each help desk owner deploys this bundle into their own
 * Puter account (the app does it for them), so the desk's data lives in the
 * owner's key-value store and files, and every agent and help center visitor
 * reaches it through this worker.
 *
 * The runtime provides two globals: `router`, to register routes, and `me`,
 * the owner's Puter context (available inside handlers only).
 */
import { createBackend } from '../src/server/backend.js';
import { sha256 } from '../src/shared/ids.js';
import { readBody } from '../src/server/http.js';

/* global router, me */

const BUILD = {
  id: typeof __WORKER_BUILD__ === 'string' ? __WORKER_BUILD__ : 'dev',
  at: typeof __WORKER_BUILT_AT__ === 'number' ? __WORKER_BUILT_AT__ : 0,
};

const JSON_LIMIT = 2 * 1024 * 1024;
const FILE_LIMIT = 21 * 1024 * 1024;
const IDENTITY_TTL = 60 * 1000;
const identities = new Map();
let backend = null;
let ownerPromise = null;

function getBackend() {
  if (backend) return backend;
  backend = createBackend({
    kv: me.puter.kv,
    fs: me.puter.fs,
    email: (msg) => me.puter.email.sendTransactional(msg),
    ownerUuid: () => {
      // Only a known owner is remembered; a failed or empty lookup is retried.
      ownerPromise ||= me.puter.auth.getUser().then((u) => u?.uuid || null).catch(() => null).then((uuid) => {
        if (!uuid) ownerPromise = null;
        return uuid;
      });
      return ownerPromise;
    },
    build: BUILD,
    log: (e) => console.error(e),
  });
  return backend;
}

/** Who is calling, from the Puter session puter.workers.exec() attaches. */
async function identify(user) {
  if (!user || !user.puter) return null;
  const token = user.puter.authToken;
  const key = token ? await sha256(token) : null;
  const hit = key && identities.get(key);
  if (hit && hit.until > Date.now()) return hit.who;
  let info = null;
  try {
    info = await user.puter.auth.getUser();
  } catch {
    return null;
  }
  if (!info?.uuid) return null;
  const who = { uuid: String(info.uuid), username: String(info.username || '') };
  if (key) {
    if (identities.size > 2000) identities.clear();
    identities.set(key, { who, until: Date.now() + IDENTITY_TTL });
  }
  return who;
}

async function readJson(request) {
  const bytes = await readBody(request, JSON_LIMIT);
  if (!bytes) return { tooLarge: true };
  const text = new TextDecoder().decode(bytes);
  if (!text) return { body: null };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { invalid: true };
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function register(method, pattern) {
  const fn = router[method.toLowerCase()];
  fn.call(router, pattern, async ({ request, user, params }) => {
    const b = getBackend();
    const url = new URL(request.url);
    const headers = {};
    for (const name of ['content-type', 'x-file-name', 'x-real-ip']) {
      const v = request.headers.get(name);
      if (v) headers[name] = v;
    }
    let body = null;
    let raw = null;
    if (method === 'POST' && /\/files$/.test(url.pathname)) {
      // Uploads are for signed-in agents only; do not read the bytes otherwise.
      if (!user || !user.puter) return json(401, { error: 'unauthorized', message: 'Sign in with Puter to continue' });
      const bytes = await readBody(request, FILE_LIMIT);
      if (!bytes) return json(413, { error: 'too_large', message: 'Files can be up to 20 MB' });
      raw = new Blob([bytes], { type: request.headers.get('content-type') || 'application/octet-stream' });
    } else if (method === 'POST' || method === 'PUT') {
      const parsed = await readJson(request);
      if (parsed.tooLarge) return json(413, { error: 'too_large', message: 'That request is too large' });
      if (parsed.invalid) return json(400, { error: 'invalid_json', message: 'The request body is not valid JSON' });
      body = parsed.body;
    }
    let whoPromise = null;
    const res = await b.handle({
      method,
      path: url.pathname.replace(/\/+$/, '') || '/',
      params,
      query: Object.fromEntries(url.searchParams),
      headers,
      body,
      raw,
      who: () => (whoPromise ||= identify(user)),
    });
    if (res.response) return res.response;
    return json(res.status, res.body);
  });
}

// Register every backend route with the worker router up front; the backend
// itself is built on the first request, once `me` exists.
const table = createBackend({ kv: null }).routes.list;
for (const r of table) register(r.method, r.pattern);
