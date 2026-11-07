import { MemoryKV } from '../src/server/memory-kv.js';
import { createBackend } from '../src/server/backend.js';

export const OWNER = { uuid: 'owner-uuid', username: 'olivia' };
export const AGENT = { uuid: 'agent-uuid', username: 'aaron' };
export const STRANGER = { uuid: 'stranger-uuid', username: 'sam' };

/** A backend over an in-memory store with a controllable clock. */
export function makeBackend({ email = null, files = true } = {}) {
  let now = Date.UTC(2026, 9, 1, 12, 0, 0);
  const clock = () => now;
  const kv = new MemoryKV({ now: clock });
  const stored = new Map();
  const fs = files
    ? {
        async write(path, blob) { stored.set(path, blob); return { path }; },
        async read(path) { return stored.get(path); },
        async delete(path) { for (const k of [...stored.keys()]) if (k === path || k.startsWith(`${path}/`)) stored.delete(k); },
      }
    : null;
  const sent = [];
  const mailer = email === null ? null : async (msg) => { sent.push(msg); return email(msg); };
  const backend = createBackend({ kv, fs, email: mailer, now: clock, ownerUuid: async () => OWNER.uuid });
  async function call(who, method, path, body, extra = {}) {
    now += 1; // every request happens a moment after the last
    const [p, q] = path.split('?');
    const query = Object.fromEntries(new URLSearchParams(q || ''));
    const res = await backend.handle({ method, path: p, query, body, who: async () => who, headers: {}, ...extra });
    return res;
  }
  async function ok(who, method, path, body, extra) {
    const res = await call(who, method, path, body, extra);
    if (res.status !== 200 && !res.response) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body ?? res.response;
  }
  return {
    kv, backend, call, ok, sent, stored,
    advance(ms) { now += ms; },
    get now() { return now; },
  };
}

/** Create a desk owned by OWNER, with AGENT invited and joined. */
export async function makeDesk(t, { withAgent = true, portal = false } = {}) {
  const { desk } = await t.ok(OWNER, 'POST', '/api/desks', { name: 'Acme Support', agentName: 'Olivia Owner', appUrl: 'https://help.example.com/', server: 'hd-test' });
  if (withAgent) {
    const { invite } = await t.ok(OWNER, 'POST', `/api/d/${desk}/invites`, { role: 'agent' });
    await t.ok(AGENT, 'POST', `/api/join/${desk}`, { code: invite.code, name: 'Aaron Agent' });
  }
  if (portal) await t.ok(OWNER, 'PUT', `/api/d/${desk}/meta`, { portal: { enabled: true, title: 'Acme Help' } });
  return desk;
}
