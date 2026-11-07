/**
 * Turning on team access: a help desk that so far ran only in the owner's
 * browser moves behind a server (a Puter worker in the owner's own account).
 * The worker normally reads the same key-value store the browser wrote, so
 * the desk is simply there; when it is not, its records are copied over.
 *
 * Everything the flow touches is injected, so it can be tested without
 * Puter: { kv, request, deployServer, findOwnServer, saveServer,
 * rememberDesk, forgetDesk }.
 */

export const STEPS = [
  { id: 'server', label: 'Start your server' },
  { id: 'reach', label: 'Connect the help desk' },
  { id: 'copy', label: 'Copy your data' },
  { id: 'finish', label: 'Finish setting up' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function healthy(request, name) {
  try {
    const h = await request(name, 'GET', '/health', { retries: 0 });
    return !!h?.ok;
  } catch {
    return false;
  }
}

/** Reuse the owner's server when it still answers, else find or deploy one. */
export async function ensureServer(deps, { known = null, onProgress } = {}) {
  if (known?.name && (await healthy(deps.request, known.name))) return known;
  const found = await deps.findOwnServer();
  if (found?.name && (await healthy(deps.request, found.name))) return { ...found, build: found.build || null };
  return deps.deployServer({ onProgress });
}

/** 'ok' when the desk answers on the server, 'missing' when it does not exist there. */
export async function reachDesk(deps, server, desk, { attempts = 4, delay = 1500 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await deps.request(server, 'GET', `/api/d/${desk}/bootstrap`, { retries: 0 });
      return 'ok';
    } catch (e) {
      if (e?.status === 404 && (e.code === 'no_desk' || e.code === 'not_found')) return 'missing';
      if (e?.status === 403) throw new Error('The server answered, but your account is not an agent on this help desk there.');
      last = e;
      await sleep(delay);
    }
  }
  throw new Error(`The server did not answer (${last?.message || 'no response'}). Try again in a minute.`);
}

/** Copy every record of a desk from the owner's own store to the server. */
export async function copyDesk(deps, server, desk, { onProgress, batch = 500 } = {}) {
  const prefix = `hd:${desk}:`;
  let cursor;
  let copied = 0;
  do {
    const opts = { pattern: prefix, returnValues: true, limit: batch };
    if (cursor) opts.cursor = cursor;
    const page = await deps.kv.list(opts);
    const items = (Array.isArray(page) ? page : page?.items || [])
      .filter((it) => it && typeof it.key === 'string' && !it.key.startsWith(`${prefix}ch:`) && !it.key.startsWith(`${prefix}pr:`))
      .map((it) => ({ key: it.key, value: it.value }));
    if (items.length) {
      await deps.request(server, 'POST', `/api/import/${desk}`, { body: { items } });
      copied += items.length;
      onProgress?.(copied);
    }
    cursor = Array.isArray(page) ? null : page?.cursor || null;
  } while (cursor);
  return copied;
}

/**
 * The whole flow. `onStep(id, state, detail)` reports progress with state
 * 'active' | 'done' | 'skipped' | 'error'. Resolves to { server, copied }.
 */
export async function goOnline(deps, { desk, deskName, known, appUrl, onStep = () => {} }) {
  let step = 'server';
  try {
    onStep('server', 'active');
    const server = await ensureServer(deps, { known, onProgress: (text) => onStep('server', 'active', text) });
    await deps.saveServer({ name: server.name, path: server.path || null, build: server.build || null });
    onStep('server', 'done', server.name);

    step = 'reach';
    onStep('reach', 'active');
    let state = await reachDesk(deps, server.name, desk);
    onStep('reach', 'done');

    step = 'copy';
    let copied = 0;
    if (state === 'missing') {
      onStep('copy', 'active');
      copied = await copyDesk(deps, server.name, desk, { onProgress: (n) => onStep('copy', 'active', `${n.toLocaleString()} records copied`) });
      state = await reachDesk(deps, server.name, desk);
      if (state !== 'ok') throw new Error('The data was copied but the help desk did not appear on the server.');
      onStep('copy', 'done', `${copied.toLocaleString()} records copied`);
    } else onStep('copy', 'skipped', 'Already available');

    step = 'finish';
    onStep('finish', 'active');
    await deps.request(server.name, 'PUT', `/api/d/${desk}/meta`, { body: { server: server.name, appUrl } });
    await deps.rememberDesk({ server: server.name, desk, name: deskName, role: 'owner' });
    await deps.forgetDesk(`local/${desk}`).catch(() => {});
    onStep('finish', 'done');
    return { server: server.name, copied };
  } catch (e) {
    onStep(step, 'error', friendlyError(e));
    throw e;
  }
}

/** Turn platform errors into something the owner can act on. */
export function friendlyError(e) {
  const msg = String(e?.message || e || 'Something went wrong');
  if (/verif/i.test(msg)) return 'Puter needs a confirmed email address before it can run a server for you. Confirm your email in your Puter account settings, then try again.';
  if (/insufficient_funds|credit/i.test(msg)) return 'Your Puter account is out of usage credit. Add credit or upgrade your plan, then try again.';
  if (/Failed to fetch|NetworkError|offline|reach/i.test(msg)) return 'Could not reach Puter. Check your connection and try again.';
  return msg;
}
