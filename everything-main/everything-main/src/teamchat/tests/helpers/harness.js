/**
 * Boots the real worker against the in-memory runtime once per test file and
 * hands tests a tiny HTTP client per caller. `reset()` swaps in fresh stores
 * between tests; the worker module itself only ever loads once.
 *
 * The fake runtime runs "in alice's account" by default: she is what
 * me.puter.auth.getUser() answers, so she is the one who may create
 * workspaces (pass { owner: null } for a runtime that cannot say).
 */
import { createMemoryKv, createMemoryFs, createWorkerRuntime, fakeAuthToken } from '../../dev/worker-runtime.js';
import { resetServerConfigCache, resetBatchGetSupport, resetIdentityCache } from '../../worker/lib.js';

export { fakeAuthToken };

const BASE = 'https://teamchat-api.test';

let runtime = null;

export const USERS = {
  alice: { uuid: 'u-alice-0000', username: 'alice' },
  bob: { uuid: 'u-bob-0000', username: 'bob' },
  carol: { uuid: 'u-carol-0000', username: 'carol' },
  dave: { uuid: 'u-dave-0000', username: 'dave' },
};

export async function boot(opts = {}) {
  const owner = 'owner' in opts ? opts.owner : USERS.alice;
  // Off by default (a user-scoped worker): a token with no app uid reads as
  // events unavailable, so events tests opt in with fakeAuthToken() and
  // everything else never triggers a mint attempt or a fetch call it would
  // have to stub.
  const authToken = 'authToken' in opts ? opts.authToken : null;
  resetServerConfigCache();
  resetBatchGetSupport();
  resetIdentityCache(); // tests swap callers between cases, and the harness reuses one token per user
  if (!runtime) {
    runtime = await createWorkerRuntime({
      kv: createMemoryKv(opts),
      fs: createMemoryFs(),
      owner,
      authToken,
      loadWorker: () => import('../../worker/index.js'),
    });
  } else {
    runtime.setStores({ kv: createMemoryKv(opts), fs: createMemoryFs(), owner, authToken });
  }
  return runtime;
}

/** A client bound to one caller (or null for anonymous). */
export function as(user) {
  const call = async (method, path, body, init = {}) => {
    const opts = { method, ...init };
    if (body !== undefined && !(body instanceof FormData)) {
      opts.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
      opts.body = JSON.stringify(body);
    } else if (body instanceof FormData) {
      opts.body = body;
    }
    const res = await runtime.dispatch(BASE + path, opts, user);
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : res;
    return { status: res.status, ok: res.ok, data };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p, b) => call('DELETE', p, b),
  };
}

/** Create a workspace as `owner` and join `others` through its invite code. */
export async function workspaceWith(owner, others = [], name = 'Acme') {
  const created = await as(owner).post('/api/workspaces', { name });
  if (!created.ok) throw new Error(`workspace creation failed: ${JSON.stringify(created.data)}`);
  const wsId = created.data.workspace.id;
  const boot = await as(owner).get(`/api/ws/${wsId}`);
  const code = boot.data.workspace.invite;
  for (const u of others) await as(u).post('/api/join', { code });
  const general = Object.values(boot.data.workspace.channels).find((c) => c.name === 'general');
  return { wsId, code, general };
}
