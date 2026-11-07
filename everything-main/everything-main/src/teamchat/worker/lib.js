/**
 * Small helpers for the worker: error shape, JSON responses, caller identity,
 * and the atomic block append. `me` is the worker runtime's global for the
 * owner's Puter resources; everything shared lives in `me.puter.kv`.
 */
import { KEYS, jsonBytes } from '../src/shared/blocks.js';

export class HttpError extends Error {
  constructor(status, code, message, headers = null) {
    super(message || code);
    this.status = status;
    this.code = code;
    // Headers the refusal carries besides its words (a 429's Retry-After).
    if (headers) this.headers = headers;
  }
}

export const kv = () => me.puter.kv;
export const fs = () => me.puter.fs;

/**
 * Build id of this bundle, compiled in by vite.worker.config.js from a hash
 * of the worker's source. The app compares it with the id in the bundle it
 * ships to know when an owner's deployed worker needs refreshing. Running
 * from source (tests, mock.html) reports 'dev'.
 */
export const WORKER_BUILD = typeof __WORKER_BUILD__ === 'string' ? __WORKER_BUILD__ : 'dev';
/** When the bundle was built, so two builds can be ordered (0 from source). */
export const WORKER_BUILT_AT = typeof __WORKER_BUILT_AT__ === 'number' ? __WORKER_BUILT_AT__ : 0;

/** The puter.js build the platform baked into this deploy (its preamble's first
 *  line); read on each call because the preamble exists only once deployed.
 *  Null from source (tests, mock.html). */
export const workerRuntime = () =>
  typeof __PUTER_PREAMBLE_VERSION__ === 'string' ? __PUTER_PREAMBLE_VERSION__ : null;

/**
 * Whose account this worker runs in. Each workspace owner deploys their own
 * copy, so only that account may create workspaces here: anyone else could
 * otherwise store data in the owner's KV at the owner's expense. The owner is
 * asked from the runtime (`me.puter.auth.getUser()`) and remembered in
 * `tc:config`; if the runtime cannot say, the first account to create a
 * workspace claims the worker (the deploy flow does so within seconds of
 * creating it). `tc:config.open` lets an owner run a shared worker anyone
 * may create workspaces on, the way the original single deployment worked.
 */
export const CONFIG_KEY = 'tc:config';
let configCache = null;

export async function serverConfig() {
  if (configCache) return configCache;
  const cfg = (await kv().get(CONFIG_KEY)) || {};
  if (!cfg.owner) {
    try {
      const info = me.puter.auth && typeof me.puter.auth.getUser === 'function' ? await me.puter.auth.getUser() : null;
      if (info && info.uuid) {
        cfg.owner = String(info.uuid);
        await kv().update(CONFIG_KEY, { owner: cfg.owner }).catch(() => {});
      }
    } catch {
      /* runtime cannot tell; the first creator claims it below */
    }
  }
  configCache = cfg;
  return cfg;
}

export async function setServerConfig(patch) {
  await kv().update(CONFIG_KEY, patch);
  configCache = null;
  return serverConfig();
}

/** Throw unless `uuid` may create workspaces on this worker (see serverConfig). */
export async function assertMayCreate(uuid) {
  const cfg = await serverConfig();
  if (cfg.open) return cfg;
  if (!cfg.owner) {
    await setServerConfig({ owner: uuid });
    return serverConfig();
  }
  if (cfg.owner !== uuid) fail(403, 'not_owner', 'Only the owner of this server can create workspaces on it');
  return cfg;
}

/** Forget the cached config (tests swap stores between cases). */
export function resetServerConfigCache() {
  configCache = null;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function fail(status, code, message, headers = null) {
  throw new HttpError(status, code, message, headers);
}

/**
 * Let the runtime finish `deferred` after the answer has gone out. A Puter
 * worker's event carries `waitUntil` (the service-worker method): the
 * promise keeps the isolate alive without holding the response, which is
 * what lets the search index, the pushes and the change signal ride behind
 * a post rather than in front of it. A runtime without it (the tests, the
 * browser harness) is waited on instead, so the same work is done either
 * way and nothing is silently dropped.
 */
async function settleDeferred(ctx, deferred) {
  if (!deferred.length) return;
  const all = Promise.all(deferred);
  if (typeof ctx?.waitUntil === 'function') {
    try {
      ctx.waitUntil(all);
      return;
    } catch {
      /* a runtime that declares waitUntil but refuses it: wait here instead */
    }
  }
  await all;
}

/**
 * Say how long the answer took, and how much of that was spent asking Puter
 * who the caller is (`auth`, and 0 where a cached identity answered it —
 * see IDENTITY_TTL_MS). The rest is the store, which is round trips in a
 * row, so `total - auth` divided by the calls a route makes is what one
 * round trip to the store is costing right now.
 *
 * A standard Server-Timing header, so it shows up in a browser's network
 * panel with no tooling: this is the one number that says whether a slow
 * write is the store, the identity call, or the network in front of both,
 * and without it that has to be guessed at.
 */
function timed(res, ctx, startedAt) {
  try {
    const auth = authMs.get(ctx?.user);
    const parts = [`total;dur=${Date.now() - startedAt}`];
    if (auth !== undefined) parts.push(`auth;dur=${auth}`);
    res.headers.set('Server-Timing', parts.join(', '));
    // Readable from a browser, which otherwise sees no header it was not
    // given. Added to whatever the route already exposed rather than written
    // over it: a download names its file in a header of its own, and this is
    // the one place every answer passes through.
    const exposed = res.headers.get('Access-Control-Expose-Headers');
    const names = new Set((exposed ? exposed.split(',') : []).map((n) => n.trim()).filter(Boolean));
    names.add('Server-Timing');
    res.headers.set('Access-Control-Expose-Headers', [...names].join(', '));
  } catch {
    /* a response whose headers cannot be set is answered as it stands */
  }
  return res;
}

/** The host this worker is reached at (teamchat-xxx.puter.work), learned from requests, for links in pushes. */
export let workerHost = null;

/**
 * Wrap a route handler: thrown HttpErrors become JSON error responses with
 * the same { error, code, message } shape Puter itself uses; anything else
 * is a 500 that says so without leaking a stack. The handler is also given
 * `ctx.defer(work)` for anything the answer does not depend on (see
 * settleDeferred).
 */
export function route(fn) {
  return async (ctx) => {
    // Work the answer does not depend on (see `defer` below), collected while
    // the handler runs and handed to the runtime once the answer is ready.
    const startedAt = Date.now();
    const deferred = [];
    ctx.defer = (work) => {
      const p = typeof work === 'function' ? Promise.resolve().then(work) : work;
      deferred.push(Promise.resolve(p).catch((e) => console.error('deferred work failed', e)));
    };
    try {
      if (ctx?.request?.url) {
        try {
          workerHost = new URL(ctx.request.url).host.toLowerCase();
        } catch {
          /* keep the last known host */
        }
      }
      const out = await fn(ctx);
      await settleDeferred(ctx, deferred);
      return timed(out instanceof Response ? out : json(out), ctx, startedAt);
    } catch (e) {
      // Work already handed to `defer` stands whether the request went on to
      // fail or not: it is written, not undone, and abandoning it mid-flight
      // would leave the index (or a push) behind what the store holds.
      await settleDeferred(ctx, deferred);
      if (e instanceof HttpError) {
        return timed(json({ error: e.code, code: e.code, message: e.message }, e.status, e.headers || {}), ctx, startedAt);
      }
      // The detail goes to the worker's log; the client gets a fixed line, so
      // a storage or filesystem error never surfaces paths or internals.
      console.error(e);
      return timed(json({ error: 'internal', code: 'internal', message: 'Something went wrong on the server' }, 500), ctx, startedAt);
    }
  };
}

/**
 * How long an answered identity is reused for the token that earned it.
 *
 * Identifying a caller is an HTTP call to Puter (`getUser()` is a GET of
 * /whoami), made on every request this worker serves — a poll every few
 * seconds from every open tab, and once more for every message, read,
 * reaction and keystroke burst. It is also the one thing that cannot be
 * folded into a store read or deferred behind the answer, because
 * everything else a request does depends on knowing who is asking.
 *
 * So an answer is kept for this long, against a hash of the token that
 * earned it. The cost is that a session ended elsewhere — signed out,
 * revoked — goes on being accepted by an already-running isolate for up to
 * this long. Half a minute is short against how long a Puter session lives
 * and close to the poll interval the app already runs on, and it is the
 * whole of the exposure: nothing is cached across isolates, nothing is
 * written down, and a token that was never valid is never cached at all.
 * Lower it to 0 to turn the cache off entirely.
 */
export const IDENTITY_TTL_MS = 30_000;
/** Distinct tokens held at once before the cache is dropped whole; a workspace's worker sees one per signed-in member. */
const IDENTITY_MAX = 500;
const identityCache = new Map();

/** Forget every cached identity (tests, and a deliberate flush). */
export function resetIdentityCache() {
  identityCache.clear();
}

/**
 * Who is calling. puter.workers.exec() forwards the caller's token, and the
 * runtime hands it to us as `user.puter`; asking Puter who that token belongs
 * to is the only trustworthy identity, so nothing in a request body is ever
 * believed about who sent it. The answer is then reused for a short while
 * (see IDENTITY_TTL_MS), which is the only way this call comes off the front
 * of a request at all.
 *
 * How long the call took is recorded against the request's own `user` object
 * (see authMs), so the answer can say so without a timer having to be
 * threaded through every caller.
 */
export const authMs = new WeakMap();

/** The cache key a caller's token falls under, or null where nothing may be cached for them. */
async function identityKey(user) {
  const token = typeof user?.puter?.authToken === 'string' ? user.puter.authToken : null;
  return token && IDENTITY_TTL_MS > 0 ? sha256(token) : null;
}

/**
 * Who the caller is, if that is already known — without asking Puter, and
 * without refusing anyone: null means "not known yet", never "not allowed".
 *
 * This is what lets a request make one read instead of two. Every key a
 * route wants is either the workspace's or the caller's, and the caller's
 * needs their uuid; with the uuid already in hand they all go in a single
 * batched read, where otherwise the workspace has to be read beside the
 * identity call and the caller's document after it. Costs a hash, no I/O.
 */
export async function peekIdentity(user) {
  if (!user || !user.puter) return null;
  const key = await identityKey(user);
  if (!key) return null;
  const hit = identityCache.get(key);
  if (hit && hit.until > Date.now()) {
    // Recorded as having cost nothing, so the answer still says what identity
    // cost on a route that never had to call identify at all.
    authMs.set(user, 0);
    return hit.id;
  }
  if (hit) identityCache.delete(key);
  return null;
}

export async function identify(user) {
  if (!user || !user.puter) fail(401, 'unauthorized', 'Sign in with Puter to continue');
  const key = await identityKey(user);
  if (key) {
    const hit = identityCache.get(key);
    if (hit && hit.until > Date.now()) {
      authMs.set(user, 0);
      return hit.id;
    }
    if (hit) identityCache.delete(key);
  }
  const started = Date.now();
  let info = null;
  try {
    const p = user.puter;
    info = p.auth && typeof p.auth.getUser === 'function' ? await p.auth.getUser() : await p.getUser();
  } catch {
    info = null;
  }
  authMs.set(user, Date.now() - started);
  if (!info || !info.uuid) fail(401, 'unauthorized', 'Your Puter session is not valid');
  const id = { uuid: String(info.uuid), username: String(info.username || '').toLowerCase() };
  if (key) {
    // Dropped whole rather than swept: the map is small, every entry lapses
    // on the same clock, and a worker serving enough accounts to reach the
    // cap loses one round of caching rather than growing without bound.
    if (identityCache.size >= IDENTITY_MAX) identityCache.clear();
    identityCache.set(key, { id, until: Date.now() + IDENTITY_TTL_MS });
  }
  return id;
}

/**
 * The most a JSON body may run to. Every body a member sends is small; the
 * largest legitimate one is an import's page (up to five hundred messages,
 * a few megabytes), so this is well clear of it. See readJson, which refuses
 * a declared length past it up front and measures the body itself besides.
 */
export const BODY_BYTES = 16 * 1024 * 1024;

/**
 * The bytes of a body that did not say how long it would be, read only as
 * far as the cap and then refused — the reader is cancelled, so nothing past
 * it is ever held. Chunks are kept as they arrive and decoded once at the
 * end, rather than each being decoded and concatenated onto a growing
 * string: that built an intermediate string per chunk and walked every byte
 * of every request in JavaScript, which on the small bodies every route
 * actually takes cost more than the parse itself.
 */
async function readCappedText(reader, max) {
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      reader.cancel().catch(() => {});
      fail(413, 'too_large', 'That request is too large');
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    joined.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * The request's JSON body as an object; anything else (no body, not JSON,
 * not an object) reads as {}. A body past BODY_BYTES is refused.
 *
 * `request.json()` is `text()` and `JSON.parse()` with nothing between them,
 * and the cap needs that seam: a body's declared length cannot be trusted,
 * since one sent chunked has none at all, so the size has to be judged on
 * the body itself. A length that is declared and over the cap is refused
 * before a byte is read; one that is declared and within it takes the
 * runtime's own decode, which is what nearly every request here is. Only a
 * body that announced nothing is walked in JavaScript (see readCappedText),
 * and then only far enough to refuse it — the case that cannot be trusted is
 * the one, and the only one, that pays for the check.
 */
export async function readJson(request) {
  // A header that is not there reads as null, and Number(null) is 0 — a
  // perfectly finite number, and one that would pass for a body declaring
  // itself empty. So the header's presence is judged before its value, or
  // every chunked body takes the path meant for one that said how long it is.
  const raw = request.headers?.get?.('content-length');
  const declared = raw == null || raw === '' ? NaN : Number(raw);
  const known = Number.isFinite(declared) && declared >= 0;
  if (known && declared > BODY_BYTES) fail(413, 'too_large', 'That request is too large');
  const reader = known ? null : request.body?.getReader?.();
  const text = reader ? await readCappedText(reader, BODY_BYTES) : await request.text();
  if (text.length > BODY_BYTES) fail(413, 'too_large', 'That request is too large');
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

export function query(request) {
  return new URL(request.url).searchParams;
}

/**
 * Append one message to a block atomically. kv.add appends to the array at
 * the `m` path without a read-modify-write, so two senders landing in the
 * same block cannot clobber each other. The read-modify-write fallback only
 * runs when the block key does not exist yet (the very first reply of a
 * thread, or a store where add refuses missing keys); blocks are otherwise
 * created ahead of time by ensureBlock.
 *
 * Answers the block's size in bytes as it stands with the message in it
 * (`bytes`), read off what the store handed back or off the block as read
 * back; the caller closes a block grown past its budget (see the worker's
 * writeMessage and BLOCK_BYTES). Null where the size is not known.
 */
export async function appendToBlock(conv, n, msg) {
  const key = KEYS.block(conv, n);
  let taken = false;
  try {
    const res = await kv().add(key, { m: [msg] });
    if (res && Array.isArray(res.m) && res.m.some((x) => x && x.s === msg.s)) return { bytes: jsonBytes(res) };
    // The store took the append but handed back something other than the
    // document (a count, a flag, nothing): the block is read back below and
    // left alone when the message is in it. Rewritten whole instead, as it
    // used to be, every post on such a store laid a copy of the block from
    // a moment before over whatever landed since (a reaction, an edit, a
    // deletion, another message appended into the same block), undoing it.
    taken = true;
  } catch {
    /* fall through */
  }
  const cur = await kv().get(key);
  const m = Array.isArray(cur?.m) ? cur.m.slice() : [];
  const present = m.some((x) => x && x.s === msg.s);
  if (taken && present) return { bytes: jsonBytes(cur) };
  if (!present) m.push(msg);
  m.sort((a, b) => a.s - b.s);
  const next = { ...(cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {}), m, x: cur?.x && typeof cur.x === 'object' ? cur.x : {} };
  await kv().set(key, next);
  return { bytes: jsonBytes(next) };
}

/** Create an empty block if it does not exist yet. Best effort; never throws. */
export async function ensureBlock(conv, n) {
  const key = KEYS.block(conv, n);
  try {
    const cur = await kv().get(key);
    if (!cur) await kv().set(key, { m: [], x: {} });
  } catch {
    /* the append path has its own fallback */
  }
}

/**
 * How many keys one batched read asks for. The store batches internally in
 * hundreds, so this is about the size of a single request and its answer,
 * not about concurrency.
 */
const GET_BATCH = 100;

/**
 * Whether this runtime's store has been found not to take a list of keys.
 * Such a store reads the list as one key: it either answers a single value
 * (the keys joined) or refuses the joined string for its length
 * (`key_too_large`). Either is a fact about the runtime, not about the call,
 * so it is remembered and the list form is not tried again — while any other
 * failure is the call's own and is raised, rather than quietly turning one
 * refusal into a hundred retries against a store already refusing.
 */
let batchGetUnsupported = false;

/**
 * Read several keys in as few round trips as the store allows: kv.get takes
 * a list and answers a list in the same order (null where a key is absent),
 * so five hundred member documents cost five calls rather than five hundred.
 * Read a dozen at a time under Promise.all, as they used to be, every fan-out
 * here — a guest's bootstrap, a broadcast's audience, an export's walk — paid
 * a round trip per dozen keys.
 */
export async function getMany(keys, batch = GET_BATCH) {
  if (!keys.length) return [];
  if (keys.length === 1) return [await kv().get(keys[0])];
  const out = [];
  for (let i = 0; i < keys.length; i += batch) {
    const slice = keys.slice(i, i + batch);
    if (!batchGetUnsupported) {
      let res;
      try {
        res = await kv().get(slice);
      } catch (e) {
        if (e?.code !== 'key_too_large') throw e;
        batchGetUnsupported = true;
      }
      if (!batchGetUnsupported) {
        if (Array.isArray(res) && res.length === slice.length) {
          out.push(...res);
          continue;
        }
        batchGetUnsupported = true;
      }
    }
    out.push(...(await Promise.all(slice.map((k) => kv().get(k)))));
  }
  return out;
}

/** Forget that verdict (tests swap stores between cases). */
export function resetBatchGetSupport() {
  batchGetUnsupported = false;
}

/** Hex SHA-256 of a string, for storing token secrets. */
export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compare two equal-length strings without short-circuiting on the first difference. */
export function timingSafeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
