/**
 * Helpers for booting main.js against a fake Puter SDK (jsdom tests).
 */
import 'fake-indexeddb/auto';
import { beforeAll, vi } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
  HTMLCanvasElement.prototype.getContext ??= () => null;
  try {
    localStorage.setItem('fleet.alphaNoticeSeen', '1');
  } catch {}
});

export const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** A Puter SDK stand-in with an in-memory KV. */
export function fakePuter({ kvGet, exec } = {}) {
  const kv = new Map();
  return {
    kv: {
      data: kv,
      get: vi.fn(async (k) => (kvGet ? kvGet(k, kv) : (kv.get(k) ?? null))),
      set: vi.fn(async (k, v) => {
        if (Array.isArray(k)) for (const it of k) kv.set(it.key, it.value);
        else kv.set(k, v);
        return true;
      }),
      del: async (k) => kv.delete(k),
      incr: async (k, paths) => {
        const cur = kv.get(k) || {};
        for (const [p, n] of Object.entries(paths)) cur[p] = (cur[p] || 0) + n;
        kv.set(k, cur);
        return { ...cur };
      },
      list: async ({ pattern }) => ({ items: [...kv.keys()].filter((k) => k.startsWith(pattern)).map((key) => ({ key, value: kv.get(key) })) }),
    },
    auth: {
      isSignedIn: () => true,
      getUser: async () => ({ username: 'olivia', uuid: 'u-1' }),
      getProfilePicture: async () => null,
    },
    workers: { exec: exec || (async () => new Response(JSON.stringify({ ok: false }), { status: 500 })) },
  };
}

/** A team server that answers with the given role. */
export function teamExec(state) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    state.calls.push(body.op);
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (state.removed && body.op !== 'join') return reply({ ok: false, error: 'not_a_member', message: 'You are not a member of this fleet.' }, 403);
    if (body.op === 'join') {
      state.removed = false;
      return reply({ ok: true, role: state.role, business: 'Acme' });
    }
    if (body.op === 'whoami') return reply({ ok: true, uuid: 'u-1', username: 'olivia', role: state.role, business: 'Acme' });
    if (body.op === 'meta') return reply({ ok: true, meta: {} });
    if (body.op === 'settings') return reply({ ok: true, settings: null });
    if (body.op === 'load') return reply({ ok: true, records: [] });
    return reply({ ok: true });
  };
}

export async function boot(puter, hash = '#/') {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', `/${hash}`);
  globalThis.puter = puter;
  await import('../src/main.js');
  const { app } = await import('../src/app.js');
  for (let i = 0; i < 40 && !app.store && !document.querySelector('.welcome'); i++) await settle(10);
  // Let the first screen load, so it does not render into the next boot.
  for (let i = 0; i < 100 && app.store && !document.querySelector('main.content > *'); i++) await settle(10);
  await settle();
  return app;
}

