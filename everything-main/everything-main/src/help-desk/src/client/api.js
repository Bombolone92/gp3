/**
 * Talking to a help desk's backend. A desk is reached either through the
 * owner's Puter worker (`server` is the worker name) with the user's session
 * attached by puter.workers.exec(), or, before the owner has turned on team
 * access, by running the same backend code right here in the browser over
 * the owner's own key-value store (`server` is 'local').
 */
import { sdk, currentUser } from './puter.js';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error || 'error';
    this.field = body?.field;
    this.current = body?.current;
  }
}

/**
 * Whether an error says this person can no longer use the desk: it was
 * deleted, or they were removed. Other 403s and 404s (a worker that is being
 * redeployed, a proxy page) are passing trouble, not a reason to forget it.
 */
export function accessRevoked(e) {
  return (e?.status === 404 && e.code === 'no_desk') || (e?.status === 403 && e.code === 'not_member');
}

export const LOCAL = 'local';

export function serverUrl(server) {
  return `https://${server}.puter.work`;
}

let localBackend = null;
/** The backend code is only needed in local mode, so it loads on demand. */
async function local() {
  if (!localBackend) {
    const { createBackend } = await import('../server/backend.js');
    const p = sdk();
    localBackend = createBackend({
      kv: p.kv,
      fs: p.fs,
      email: null,
      ownerUuid: async () => (await currentUser()).uuid,
      log: (e) => console.error(e),
    });
  }
  return localBackend;
}

/** For tests and the offline demo. */
export function resetLocalBackend() {
  localBackend = null;
}

async function callLocal(method, path, { body = null, raw = null, headers = {} } = {}) {
  const [p, q] = path.split('?');
  const res = await (await local()).handle({
    method,
    path: p,
    query: Object.fromEntries(new URLSearchParams(q || '')),
    body: body === null ? null : structuredClone(body),
    raw,
    headers,
    who: async () => {
      const u = await currentUser();
      return { uuid: u.uuid, username: u.username };
    },
  });
  if (res.response) return res.response;
  if (res.status >= 400) throw new ApiError(res.status, res.body);
  return res.body;
}

async function parse(res) {
  const type = res.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, body || { message: res.status === 404 ? 'This help desk server could not be found' : `Request failed (${res.status})` });
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One request to a desk server. Retries reads on network errors. */
export async function request(server, method, path, { body = null, raw = null, headers = {}, signal, asResponse = false, retries = method === 'GET' ? 2 : 0 } = {}) {
  if (server === LOCAL) {
    const out = await callLocal(method, path, { body, raw, headers });
    return out;
  }
  const init = { method, headers: { ...headers }, signal };
  if (raw) init.body = raw;
  else if (body !== null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let attempt = 0;
  for (;;) {
    try {
      const res = await sdk().workers.exec(`${serverUrl(server)}${path}`, init);
      if (asResponse && res.ok) return res;
      if (res.status >= 500 && attempt < retries) throw Object.assign(new Error('server'), { retry: true });
      return await parse(res);
    } catch (e) {
      if (e instanceof ApiError || e?.name === 'AbortError' || attempt >= retries) {
        if (e instanceof ApiError || e?.name === 'AbortError') throw e;
        throw new ApiError(0, { error: 'offline', message: 'Could not reach the help desk server. Check your connection.' });
      }
      attempt++;
      await sleep(400 * 2 ** attempt);
    }
  }
}

/** A client bound to one desk. */
export class DeskApi {
  constructor(server, desk) {
    this.server = server;
    this.desk = desk;
    this.base = `/api/d/${desk}`;
  }

  get isLocal() {
    return this.server === LOCAL;
  }

  get(path, opts) { return request(this.server, 'GET', `${this.base}${path}`, opts); }
  post(path, body, opts) { return request(this.server, 'POST', `${this.base}${path}`, { ...opts, body: body ?? {} }); }
  put(path, body, opts) { return request(this.server, 'PUT', `${this.base}${path}`, { ...opts, body: body ?? {} }); }
  del(path, opts) { return request(this.server, 'DELETE', `${this.base}${path}`, opts); }

  upload(file) {
    return request(this.server, 'POST', `${this.base}/files`, {
      raw: file,
      headers: { 'x-file-name': encodeURIComponent(file.name || 'file'), 'content-type': file.type || 'application/octet-stream' },
    });
  }

  /** An attachment as a Blob (the worker needs the session, so no plain URL). */
  async fileBlob(id) {
    const res = await request(this.server, 'GET', `${this.base}/files/${id}`, { asResponse: true });
    return res.blob();
  }
}

/** Calls that are not bound to a desk. */
export const serverApi = {
  createDesk: (server, body) => request(server, 'POST', '/api/desks', { body }),
  join: (server, desk, body) => request(server, 'POST', `/api/join/${desk}`, { body }),
  invite: (server, desk, code) => request(server, 'GET', `/api/invite/${desk}/${encodeURIComponent(code)}`, { retries: 1 }),
  health: (server) => request(server, 'GET', '/health', { retries: 0 }),
};
