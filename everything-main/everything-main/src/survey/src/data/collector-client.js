/**
 * The builder's side of the response collector: deploys the collector worker
 * into the signed-in user's account on first use, keeps it on the current
 * version, and wraps its admin API.
 *
 * Deployment follows the calendar app's RSVP worker, which has run this
 * pattern in production:
 *   - one worker per user, named after them (sv-<username>), so share links
 *     read well: survey.puter.com/r/#<username>/<collector id>;
 *   - the admin secret lives only in the user's own KV (sv:worker); the
 *     deployed source carries just its SHA-256;
 *   - a deploy is finished only once the live worker answers /admin/ping
 *     with the expected version (propagation takes 5 to 30 seconds);
 *   - the config is saved before verifying, so a reload can never deploy a
 *     second worker and orphan the links the first one handed out;
 *   - concurrent callers share one in-flight deploy.
 */
import { WORKER_VERSION } from './worker-version.js';

// The worker's source text is only needed to deploy or upgrade it.
const buildWorkerSource = async (hash) => (await import('./worker-source.js')).buildWorkerSource(hash);

export const WORKER_CFG_KEY = 'sv:worker';
// Where workers deployed before per-deployment paths keep their source.
const SOURCE_PATH = 'collector-worker.js';

export function coerce(value) {
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

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Worker names to try, best first. Names are global across Puter, so a
 *  taken name falls back to a suffixed one and finally a random one. Every
 *  name starts with `sv-`; the rest is the label share links carry. */
export function workerNameCandidates(username) {
  const base = String(username == null ? '' : username)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '');
  const names = [];
  if (base.length >= 2) names.push(`sv-${base}`, `sv-${base}-${randomHex(2)}`);
  names.push(`sv-x${randomHex(5)}`);
  return names;
}

/** The share-link label for a worker name, and back. */
export const labelOf = (name) => String(name).replace(/^sv-/, '');
export const workerUrlFor = (label) => `https://sv-${label}.puter.work`;

function deadline(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  return undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class WorkerError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createCollectorClient({
  kv,
  fs,
  workers,
  getUser,
  fetchFn = (...a) => fetch(...a),
  verifyAttempts = 8,
  verifyDelayMs = 1500,
  adminTimeoutMs = 25_000,
  onStatus = () => {},
}) {
  let cfg = null;
  let cfgSaved = false;
  let ensuring = null;
  let verifyBlockedUntil = 0;

  async function loadCfg() {
    const stored = coerce(await kv.get(WORKER_CFG_KEY));
    if (stored && stored.secret && stored.name) {
      cfg = stored;
      cfgSaved = true;
    }
    return cfg;
  }

  async function saveCfg() {
    await kv.set(WORKER_CFG_KEY, cfg);
    cfgSaved = true;
  }

  async function ping(url, secret) {
    const res = await fetchFn(`${url}/admin/ping`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: deadline(8000),
    });
    if (!res.ok) return null;
    return res.json();
  }

  async function verifyDeployed(url, secret) {
    let delay = verifyDelayMs;
    for (let i = 0; i < verifyAttempts; i++) {
      try {
        const data = await ping(url, secret);
        if (data && data.version === WORKER_VERSION) {
          verifyBlockedUntil = 0;
          return;
        }
      } catch {
        /* not propagated yet */
      }
      await sleep(delay);
      delay = Math.min(8000, delay + 2000);
    }
    verifyBlockedUntil = Date.now() + 120_000;
    throw new WorkerError('The response collector did not come online. Try again in a minute.', { code: 'verify' });
  }

  /** Our version, or a newer one deployed by a newer copy of the app. */
  function versionOk(v) {
    if (v === WORKER_VERSION) return true;
    const a = Number(v);
    const b = Number(WORKER_VERSION);
    return Number.isFinite(a) && Number.isFinite(b) && a > b;
  }

  async function ensureInner(depth = 0) {
    if (!cfg) await loadCfg();
    if (cfg && cfg.url && versionOk(cfg.version)) {
      if (!cfgSaved) await saveCfg();
      return cfg;
    }
    if (Date.now() < verifyBlockedUntil) {
      throw new WorkerError('The response collector is still starting. Try again shortly.', { code: 'cooldown' });
    }
    if (!workers || !fs) throw new WorkerError('Publishing needs a Puter account.', { code: 'unavailable' });

    if (cfg && cfg.name) {
      // Upgrade in place: same name and URL, so shared links keep working.
      onStatus('updating');
      const code = await buildWorkerSource(await sha256Hex(cfg.secret));
      let path = cfg.path || SOURCE_PATH;
      try {
        const info = await workers.get(cfg.name);
        if (info && info.file_path) path = info.file_path;
      } catch {
        /* keep the stored path */
      }
      await fs.write(path, code, { createMissingParents: true });
      await verifyDeployed(cfg.url, cfg.secret);
      cfg = { ...cfg, version: WORKER_VERSION };
      await saveCfg();
      onStatus('ready');
      return cfg;
    }

    onStatus('deploying');
    const secret = randomHex(32);
    const hash = await sha256Hex(secret);
    const code = await buildWorkerSource(hash);
    // Each deployment gets its own source file: a worker runs whatever its
    // file holds, so a shared path would let a tab deploying at the same
    // moment overwrite another tab's live worker with its own secret.
    const sourcePath = `collector-worker-${hash.slice(0, 12)}.js`;
    await fs.write(sourcePath, code, { createMissingParents: true });
    const discard = () => (fs.delete ? fs.delete(sourcePath).catch(() => {}) : null);
    const user = getUser ? await getUser() : null;
    let lastErr = null;
    for (const name of workerNameCandidates(user && user.username)) {
      // Another tab or device may have deployed meanwhile: adopt theirs.
      if (depth < 2 && (await loadCfg().catch(() => null))) {
        await discard();
        return ensureInner(depth + 1);
      }
      let dep = null;
      for (let attempt = 0; attempt < 2 && !dep; attempt++) {
        try {
          dep = await workers.create(name, sourcePath);
        } catch (err) {
          lastErr = err;
          if (/verif/i.test(String(err && (err.message || err.code || err)))) {
            await discard();
            throw new WorkerError('Verify the email address on your Puter account to start collecting responses.', {
              code: 'email_unverified',
            });
          }
          await sleep(400);
        }
      }
      if (!dep) continue;
      const url = String((dep && dep.url) || `https://${name}.puter.work`).replace(/\/+$/, '');
      cfg = { name, label: labelOf(name), url, secret, path: sourcePath, version: null, createdAt: Date.now() };
      cfgSaved = false;
      await saveCfg().catch(() => {});
      await verifyDeployed(url, secret);
      // A tab that deployed at the same moment may have won the KV write.
      const winner = coerce(await kv.get(WORKER_CFG_KEY).catch(() => null));
      if (winner && winner.name && winner.name !== name) {
        await workers.delete?.(name).catch(() => {});
        await discard();
        cfg = winner;
        cfgSaved = true;
        return cfg;
      }
      cfg = { ...cfg, version: WORKER_VERSION };
      await saveCfg();
      onStatus('ready');
      return cfg;
    }
    await discard();
    throw new WorkerError('Could not set up the response collector.', { code: 'deploy' });
  }

  function ensureWorker() {
    if (!ensuring) ensuring = ensureInner().finally(() => (ensuring = null));
    return ensuring;
  }

  async function call(path, { body, method } = {}) {
    const c = await ensureWorker();
    let res;
    try {
      res = await fetchFn(c.url + path, {
        method: method || (body ? 'POST' : 'GET'),
        headers: { authorization: `Bearer ${c.secret}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: deadline(adminTimeoutMs),
      });
    } catch (err) {
      throw new WorkerError('Could not reach the response collector. Check your connection.', { code: 'network' });
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      throw new WorkerError((data && data.error) || `Request failed (${res.status})`, {
        status: res.status,
        code: (data && data.error) || '',
      });
    }
    return data;
  }

  return {
    ensureWorker,
    /** The worker config if one was ever deployed, without deploying. */
    async peek() {
      return cfg || (await loadCfg().catch(() => null));
    },
    publish: (survey) => call('/admin/publish', { body: { survey } }),
    saveCollector: (collector) => call('/admin/collector', { body: { collector } }),
    deleteCollector: (id) => call('/admin/collector/delete', { body: { id } }),
    deleteSurvey: (sid, collectors) => call('/admin/survey/delete', { body: { sid, collectors } }),
    responsesPage: (sid, { limit = 500, cursor } = {}) =>
      call(`/admin/responses?sid=${encodeURIComponent(sid)}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    deleteResponses: (sid, keys) => call('/admin/responses/delete', { body: { sid, keys } }),
    /** Response counts; with `sid`, that survey's only (a collector
     *  older than version 5 answers with all of them, which also works). */
    stats: (sid) => call(sid ? `/admin/stats?sid=${encodeURIComponent(sid)}` : '/admin/stats'),
  };
}
