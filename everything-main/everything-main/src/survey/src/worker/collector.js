/**
 * Response collector: a Puter serverless worker deployed into the survey
 * creator's own account (see src/data/collector-client.js for deployment).
 *
 * Respondents have no Puter account and cannot reach the creator's storage,
 * so this worker stands between them: it serves published surveys and stores
 * responses in the creator's KV. It serves no HTML. The respondent page
 * (r/index.html on the app's own hosting) calls this JSON API.
 *
 * At deploy time src/shared/runtime.js is prepended to this file, so
 * validateResponse() and friends are in scope here, and every submission is
 * checked by exactly the code the respondent page used.
 *
 * Public API (respondents, no credentials). Requests are CORS "simple": GET,
 * or POST with a text/plain JSON body, so browsers send no preflight.
 *   GET  /api/c/<collectorId>            survey + collector, or a status
 *   POST /api/c/<collectorId>/unlock     { password } for protected links (returns a pass)
 *   POST /api/c/<collectorId>/responses  { answers, startedAt, rid?, password?, pass?, meta? }
 *
 * Admin API (the builder app), with `Authorization: Bearer <secret>`. Only
 * SHA-256(secret) is baked into the deployed source.
 *   GET  /admin/ping
 *   POST /admin/publish            { survey }
 *   POST /admin/collector          { collector }
 *   POST /admin/collector/delete   { id }
 *   POST /admin/survey/delete      { sid, collectors: [id] }
 *   GET  /admin/responses?sid=&limit=&cursor=   newest first
 *   POST /admin/responses/delete   { sid, keys: [key] }
 *   GET  /admin/stats
 *
 * KV layout (all keys start with svw: so they never mix with app data):
 *   svw:s:<surveyId>              published survey { survey, publishedAt }
 *   svw:c:<collectorId>           collector settings
 *   svw:r:<surveyId>:<responseId> one response; ids sort by submit time
 *   svw:n:<surveyId>              response count for the survey
 *   svw:nc:<collectorId>          response count for the collector
 *   svw:x:<collectorId>:<rid>     the response id a submission is stored under (expires)
 *
 * Each response is its own small key: a submission is one ~1 KB write that
 * never rewrites anything shared, and the app pages through them newest
 * first, so it only ever reads what it has not cached yet.
 */

const ADMIN_SECRET_HASH = '__SV_ADMIN_SECRET_HASH__';
const WORKER_VERSION = '__SV_WORKER_VERSION__';

const P_SURVEY = 'svw:s:';
const P_COLLECTOR = 'svw:c:';
const P_RESPONSE = 'svw:r:';
const P_COUNT = 'svw:n:';
const P_CCOUNT = 'svw:nc:';

// Byte limits (KV counts UTF-8 bytes, not characters).
const MAX_BODY = 256 * 1024;
const MAX_SURVEY = 350 * 1024;
// Wrong passwords allowed per link per 10-minute window.
const MAX_PASSWORD_TRIES = 20;
const P_PWFAIL = 'svw:pf:';
const P_SUBMITTED = 'svw:x:';
const RID_RE = /^[a-z0-9]{8,32}$/i;
const ID_RE = /^[a-z0-9]{6,32}$/i;
const KEY_RE = /^[a-z0-9]{6,40}$/i;

/* ---- Utilities ------------------------------------------------------------ */

function kvOf(ctx) {
  const owner = (ctx && ctx.me) || (typeof me !== 'undefined' ? me : null);
  return owner.puter.kv;
}

/** puter.kv values may come back parsed or as JSON strings. */
function coerce(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  let out = '';
  for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, '0');
  return out;
}

function randomChars(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += (b % 36).toString(36);
  return out;
}

/** Time-sortable response id: 9 base-36 digits of milliseconds (good until
 *  the year 5188) plus 6 random characters. */
function newResponseId(now) {
  return now.toString(36).padStart(9, '0') + randomChars(6);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Survey content and answers are personal data behind capability
      // links: nothing may be cached along the way.
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function fail(status, error, extra = {}) {
  return json({ error, ...extra }, status);
}

// What readJson returns for a body over the route's limit.
const TOO_LARGE = Object.freeze({ tooLarge: true });

/** The request's JSON object, null if it is not one, or TOO_LARGE. */
async function readJson(request, max = MAX_BODY) {
  try {
    // Refuse a body declared too large before reading it into memory; the
    // check below still covers bodies that do not declare their length.
    if (Number(request.headers.get('content-length')) > max) return TOO_LARGE;
    const text = await request.text();
    if (!text) return null;
    if (byteLength(text) > max) return TOO_LARGE;
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

async function isAdmin(request) {
  const auth = request.headers.get('authorization') || '';
  const m = /^Bearer\s+([a-f0-9]{32,128})$/i.exec(auth.trim());
  if (!m) return false;
  return (await sha256Hex(m[1])) === ADMIN_SECRET_HASH;
}

function admin(handler) {
  return async (ctx) => {
    if (!(await isAdmin(ctx.request))) return fail(401, 'unauthorized');
    try {
      return await handler(ctx);
    } catch (err) {
      return fail(500, 'server_error');
    }
  };
}

function guarded(handler) {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (err) {
      return fail(500, 'server_error');
    }
  };
}

/** Every entry under a prefix. Uses cursor paging when the runtime offers
 *  it; an older runtime that only returns arrays gets a single call. */
async function listAll(kv, prefix, values) {
  const out = [];
  let cursor;
  for (let guard = 0; guard < 1000; guard++) {
    const page = await kv.list({ pattern: `${prefix}*`, returnValues: values, limit: 1000, cursor });
    if (Array.isArray(page)) return page;
    out.push(...(page.items || []));
    cursor = page.cursor;
    if (!cursor) break;
  }
  return out;
}

/* ---- Survey and collector state ----------------------------------------- */

async function loadCollector(kv, cid) {
  if (!ID_RE.test(cid || '')) return null;
  const c = coerce(await kv.get(P_COLLECTOR + cid));
  return c && c.sid ? c : null;
}

async function loadSurvey(kv, sid) {
  const rec = coerce(await kv.get(P_SURVEY + sid));
  return rec && rec.survey ? rec : null;
}

/** Why a collector cannot take responses right now, or null if it can. */
async function blockedReason(kv, collector) {
  if (collector.status !== 'open') return 'closed';
  if (collector.closeAt && Date.now() >= Number(collector.closeAt)) return 'closed';
  const max = Number(collector.maxResponses) || 0;
  if (max > 0) {
    const n = Number(coerce(await kv.get(P_CCOUNT + collector.id))) || 0;
    if (n >= max) return 'full';
  }
  return null;
}

/** Check a password with a per-link limit on wrong guesses, so a short
 *  password cannot be found by scripting the unlock route. Returns null when
 *  it matches, or the error response to send. */
async function checkPassword(kv, collector, password) {
  if (!collector.passwordHash) return null;
  const key = `${P_PWFAIL}${collector.id}:${Math.floor(Date.now() / 600000)}`;
  // Take the attempt before checking, atomically: reading the count first
  // would let any number of guesses sent at once through.
  const n = await kv.incr(key);
  if (n === 1) await kv.expire(key, 900).catch(() => {});
  if (n > MAX_PASSWORD_TRIES) return fail(429, 'too_many_attempts');
  if (await passwordOk(collector, password)) {
    // The right password does not use up the link's allowance.
    await kv.decr(key).catch(() => {});
    return null;
  }
  return fail(403, 'wrong_password');
}

/*
 * Unlock passes. A respondent who unlocked a protected link gets a signed,
 * time-limited pass to submit with, so a run of wrong guesses by someone
 * else (which locks the link for 10 minutes) cannot stop them sending
 * their answers. Signed with a key only this worker's source holds, bound
 * to the link and its current password (changing it voids passes).
 */
const PASS_MS = 24 * 3600 * 1000;

async function passSignature(collector, exp) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`pass:${ADMIN_SECRET_HASH}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${collector.id}|${collector.passwordHash}|${exp}`));
  let out = '';
  for (const b of new Uint8Array(sig)) out += b.toString(16).padStart(2, '0');
  return out;
}

async function issuePass(collector) {
  const exp = Date.now() + PASS_MS;
  return `${exp}.${await passSignature(collector, exp)}`;
}

async function passOk(collector, pass) {
  const m = /^(\d{13,16})\.([0-9a-f]{64})$/.exec(typeof pass === 'string' ? pass : '');
  if (!m || Number(m[1]) < Date.now() || !collector.passwordHash) return false;
  return (await passSignature(collector, Number(m[1]))) === m[2];
}

async function passwordOk(collector, password) {
  if (!collector.passwordHash) return true;
  if (typeof password !== 'string' || !password) return false;
  return (await sha256Hex(`${collector.salt}:${password}`)) === collector.passwordHash;
}

/** The collector settings a respondent's page needs, and nothing more. */
function publicCollector(c) {
  return {
    id: c.id,
    allowMultiple: c.allowMultiple !== false,
    thankYou: c.thankYou && (c.thankYou.title || c.thankYou.message || c.thankYou.redirect) ? c.thankYou : null,
  };
}

function brief(survey) {
  return { title: survey.title, theme: survey.theme, closedMessage: survey.options && survey.options.closedMessage };
}

/* ---- Public API ------------------------------------------------------------ */

async function openCollector(ctx) {
  const kv = kvOf(ctx);
  const collector = await loadCollector(kv, ctx.params.cid);
  if (!collector) return { error: fail(404, 'not_found') };
  const rec = await loadSurvey(kv, collector.sid);
  if (!rec) return { error: fail(404, 'not_found') };
  const reason = await blockedReason(kv, collector);
  // The link with it: a resend of a response stored before the link
  // filled up or closed is still acknowledged (see the responses route).
  if (reason) return { error: fail(410, reason, brief(rec.survey)), kv, collector };
  return { kv, collector, survey: rec.survey };
}

/** The response a submission id (rid) was stored under, if it was. */
async function storedFor(kv, collector, claim) {
  const prior = coerce(await kv.get(claim));
  const id = prior && typeof prior.id === 'string' && KEY_RE.test(prior.id) ? prior.id : null;
  const rec = id ? coerce(await kv.get(`${P_RESPONSE}${collector.sid}:${id}`)) : null;
  return { id, rec };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

router.get('/api/c/:cid', guarded(async (ctx) => {
  const r = await openCollector(ctx);
  if (r.error) return r.error;
  if (r.collector.passwordHash) return json({ locked: true, ...brief(r.survey) });
  return json({ survey: r.survey, collector: publicCollector(r.collector) });
}));

router.post('/api/c/:cid/unlock', guarded(async (ctx) => {
  const r = await openCollector(ctx);
  if (r.error) return r.error;
  const body = (await readJson(ctx.request)) || {};
  const denied = await checkPassword(r.kv, r.collector, body.password);
  if (denied) return denied;
  return json({ survey: r.survey, collector: publicCollector(r.collector), pass: await issuePass(r.collector) });
}));

router.post('/api/c/:cid/responses', guarded(async (ctx) => {
  const r = await openCollector(ctx);
  if (r.error && !r.collector) return r.error;
  const body = await readJson(ctx.request);
  if (r.error) {
    // Full or closed since: a resend of a response already stored (its
    // reply lost) is acknowledged rather than refused.
    const rid = body && body !== TOO_LARGE ? body.rid : '';
    if (RID_RE.test(rid || '')) {
      const { id, rec } = await storedFor(r.kv, r.collector, `${P_SUBMITTED}${r.collector.id}:${rid}`);
      if (rec) return json({ ok: true, id, outcome: rec.outcome === 'disqualified' ? 'disqualified' : 'complete' });
    }
    return r.error;
  }
  if (body === TOO_LARGE) return fail(413, 'too_large');
  if (!body) return fail(400, 'bad_request');
  // Honeypot: a field people never see, which form-filling bots do fill.
  if (body.hp) return json({ ok: true, id: null });
  // A pass from unlocking stands in for the password, past any lockout.
  if (!(await passOk(r.collector, body.pass))) {
    const denied = await checkPassword(r.kv, r.collector, body.password);
    if (denied) return denied;
  }

  const check = validateResponse(r.survey, body.answers);
  if (!check.ok) return fail(422, 'invalid', { errors: check.errors });

  const { kv, collector } = r;
  const outcome = check.outcome === 'disqualify' ? 'disqualified' : 'complete';
  // The page sends one id per visit and the response id chosen for it is
  // kept, so a resend (after a timeout, or a reply lost on the way back) is
  // acknowledged if that response was stored, and otherwise stores it under
  // the same id: never twice, and never lost to an attempt that failed.
  const claim = RID_RE.test(body.rid || '') ? `${P_SUBMITTED}${collector.id}:${body.rid}` : '';
  const now = Date.now();
  let id = null;
  if (claim) {
    let { id: known, rec } = await storedFor(kv, collector, claim);
    // Copies sent at the same moment (Submit pressed again while the first
    // is still on its way): only the first to count itself here picks the
    // response id; the others wait for it, then answer as a resend.
    if (!known) {
      const lock = `${claim}:n`;
      const first = (await kv.incr(lock)) === 1;
      await kv.expire(lock, 86400).catch(() => {});
      for (let i = 0; !first && !rec && i < 20; i++) {
        await pause(250);
        ({ id: known, rec } = await storedFor(kv, collector, claim));
      }
    }
    if (rec) return json({ ok: true, id: known, outcome });
    if (known) id = known;
    else {
      id = newResponseId(now);
      await kv.set(claim, { id });
      await kv.expire(claim, 86400).catch(() => {});
    }
  }
  id ||= newResponseId(now);
  const max = Number(collector.maxResponses) || 0;
  // With a limit, reserve a slot before writing so two respondents racing
  // for the last place cannot both get in, and give it back if this one is
  // over. Without one, the response is stored first and the counter (a
  // single hot key under a burst) is best effort.
  if (max > 0) {
    const n = await kv.incr(P_CCOUNT + collector.id);
    if (n > max) {
      await kv.decr(P_CCOUNT + collector.id);
      return fail(410, 'full', brief(r.survey));
    }
  }

  const started = Number(body.startedAt);
  const startedAt = Number.isFinite(started) && started <= now && now - started < 30 * 86400000 ? started : now;
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
  const record = {
    id,
    cid: collector.id,
    at: now,
    st: startedAt,
    outcome,
    answers: check.answers,
    meta: {
      device: ['desktop', 'tablet', 'mobile'].includes(meta.device) ? meta.device : 'unknown',
      lang: typeof meta.lang === 'string' ? meta.lang.slice(0, 20) : '',
    },
  };
  try {
    await kv.set(`${P_RESPONSE}${collector.sid}:${id}`, record);
  } catch (err) {
    if (max > 0) await kv.decr(P_CCOUNT + collector.id).catch(() => {});
    if (/too.?large|value_too_large/i.test(String(err && (err.code || err.message)))) return fail(413, 'too_large');
    throw err;
  }
  if (!max) await kv.incr(P_CCOUNT + collector.id).catch(() => {});
  await kv.incr(P_COUNT + collector.sid).catch(() => {});
  return json({ ok: true, id, outcome });
}));

/* ---- Admin API ----------------------------------------------------------- */

router.get('/admin/ping', admin(async () => {
  const runtime = typeof __PUTER_PREAMBLE_VERSION__ === 'string' ? __PUTER_PREAMBLE_VERSION__ : null;
  return json({ ok: true, version: WORKER_VERSION, runtime });
}));

router.post('/admin/publish', admin(async (ctx) => {
  // The survey limit applies to the stored record, checked below; the body
  // gets room for the JSON around it.
  const body = await readJson(ctx.request, MAX_SURVEY + 64 * 1024);
  if (body === TOO_LARGE) return fail(413, 'too_large');
  const survey = body && body.survey;
  if (!survey || !ID_RE.test(survey.id || '') || !Array.isArray(survey.pages)) return fail(400, 'bad_request');
  const record = { survey, publishedAt: Date.now() };
  if (byteLength(JSON.stringify(record)) > MAX_SURVEY) return fail(413, 'too_large');
  await kvOf(ctx).set(P_SURVEY + survey.id, record);
  return json({ ok: true, publishedAt: record.publishedAt });
}));

router.post('/admin/collector', admin(async (ctx) => {
  const body = await readJson(ctx.request);
  const c = body && body.collector;
  if (!c || !ID_RE.test(c.id || '') || !ID_RE.test(c.sid || '')) return fail(400, 'bad_request');
  const kv = kvOf(ctx);
  const prev = coerce(await kv.get(P_COLLECTOR + c.id)) || {};
  const next = {
    id: c.id,
    sid: c.sid,
    status: c.status === 'open' ? 'open' : 'closed',
    closeAt: Number(c.closeAt) > 0 ? Number(c.closeAt) : null,
    maxResponses: Number(c.maxResponses) > 0 ? Math.floor(Number(c.maxResponses)) : 0,
    allowMultiple: c.allowMultiple !== false,
    thankYou: c.thankYou && typeof c.thankYou === 'object'
      ? {
          title: String(c.thankYou.title || '').slice(0, 300),
          message: String(c.thankYou.message || '').slice(0, 3000),
          redirect: /^https?:\/\//i.test(c.thankYou.redirect || '') ? String(c.thankYou.redirect).slice(0, 2000) : '',
        }
      : null,
    passwordHash: prev.passwordHash || '',
    salt: prev.salt || '',
  };
  // `password` absent keeps the current one; '' removes it.
  if (typeof c.password === 'string') {
    if (c.password) {
      next.salt = randomChars(16);
      next.passwordHash = await sha256Hex(`${next.salt}:${c.password}`);
    } else {
      next.salt = '';
      next.passwordHash = '';
    }
  }
  await kv.set(P_COLLECTOR + c.id, next);
  return json({ ok: true });
}));

router.post('/admin/collector/delete', admin(async (ctx) => {
  const body = await readJson(ctx.request);
  if (!body || !ID_RE.test(body.id || '')) return fail(400, 'bad_request');
  await kvOf(ctx).del(P_COLLECTOR + body.id);
  await kvOf(ctx).del(P_CCOUNT + body.id);
  return json({ ok: true });
}));

router.post('/admin/survey/delete', admin(async (ctx) => {
  const body = await readJson(ctx.request);
  if (!body || !ID_RE.test(body.sid || '')) return fail(400, 'bad_request');
  const kv = kvOf(ctx);
  const keys = await listAll(kv, `${P_RESPONSE}${body.sid}:`, false);
  // In batches: one by one, a survey with thousands of responses outlasts
  // the app's request timeout.
  for (let i = 0; i < keys.length; i += 25) {
    await Promise.all(keys.slice(i, i + 25).map((key) => kv.del(typeof key === 'string' ? key : key.key)));
  }
  for (const cid of Array.isArray(body.collectors) ? body.collectors : []) {
    if (!ID_RE.test(cid)) continue;
    await kv.del(P_COLLECTOR + cid);
    await kv.del(P_CCOUNT + cid);
  }
  await kv.del(P_SURVEY + body.sid);
  await kv.del(P_COUNT + body.sid);
  return json({ ok: true, deleted: keys.length });
}));

router.get('/admin/responses', admin(async (ctx) => {
  const url = new URL(ctx.request.url);
  const sid = url.searchParams.get('sid') || '';
  if (!ID_RE.test(sid)) return fail(400, 'bad_request');
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 500));
  const cursor = url.searchParams.get('cursor') || undefined;
  const prefix = `${P_RESPONSE}${sid}:`;
  const page = await kvOf(ctx).list({ pattern: `${prefix}*`, returnValues: true, reverse: true, limit, cursor });
  const items = (Array.isArray(page) ? page.slice().reverse() : page.items || []).map((e) => ({
    key: e.key.slice(prefix.length),
    value: coerce(e.value),
  }));
  return json({ items, cursor: Array.isArray(page) ? null : page.cursor || null });
}));

router.post('/admin/responses/delete', admin(async (ctx) => {
  const body = await readJson(ctx.request);
  if (!body || !ID_RE.test(body.sid || '') || !Array.isArray(body.keys)) return fail(400, 'bad_request');
  const kv = kvOf(ctx);
  let deleted = 0;
  for (const key of body.keys.slice(0, 1000)) {
    if (!KEY_RE.test(key)) continue;
    const full = `${P_RESPONSE}${body.sid}:${key}`;
    const rec = coerce(await kv.get(full));
    if (!rec) continue;
    await kv.del(full);
    deleted++;
    // A deleted link's counter is gone; decrementing would recreate it at -1.
    if (rec.cid && ID_RE.test(rec.cid) && (await kv.get(P_COLLECTOR + rec.cid))) await kv.decr(P_CCOUNT + rec.cid).catch(() => {});
  }
  if (deleted) await kv.decr(P_COUNT + body.sid, deleted).catch(() => {});
  return json({ ok: true, deleted });
}));

router.get('/admin/stats', admin(async (ctx) => {
  const kv = kvOf(ctx);
  // One survey's count (the results screen polls it every minute): one
  // read, not a listing of every survey's and link's counter.
  const sid = new URL(ctx.request.url).searchParams.get('sid');
  if (sid && ID_RE.test(sid)) return json({ surveys: { [sid]: Number(coerce(await kv.get(P_COUNT + sid))) || 0 }, collectors: {} });
  const surveys = {};
  const collectors = {};
  for (const e of await listAll(kv, P_COUNT, true)) surveys[e.key.slice(P_COUNT.length)] = Number(coerce(e.value)) || 0;
  for (const e of await listAll(kv, P_CCOUNT, true)) collectors[e.key.slice(P_CCOUNT.length)] = Number(coerce(e.value)) || 0;
  return json({ surveys, collectors });
}));

/* ---- Fallbacks: JSON for anything else ----------------------------------- */

router.get('/*path', async () => fail(404, 'not_found'));
router.post('/*path', async () => fail(404, 'not_found'));
