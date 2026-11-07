/**
 * Client library (lead, review pass 24): the store driven in node as
 * tests/store.test.js drives it, with Puter faked at `puter.workers.exec`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const REF = 'abc123def0@teamchat-test';
let store = null;

/** A fresh store on a small workspace, its heartbeat due, as a tab that has just been touched. */
async function boot() {
  vi.resetModules();
  const urls = [];
  globalThis.puter = { workers: { exec: async (url) => { urls.push(new URL(url)); return new Response(JSON.stringify({ now: Date.now() - 2000, ts: Date.now(), c: {}, p: {}, w: 0, u: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } } };
  ({ store } = await import('../src/lib/store.js'));
  store.wsId = REF;
  store.identity = { uuid: 'u-me' };
  store.profile = { uuid: 'u-me', prefs: {} };
  store.ws = { id: 'abc123def0', members: { 'u-me': {} }, channels: {} };
  store.links = new Map();
  store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
  store._timer = setTimeout(() => {}, 60_000);
  store._lastHeartbeat = Date.now() - 60_000; // due
  store._lastInput = Date.now();
  return { urls };
}

afterEach(() => {
  if (store) {
    clearTimeout(store._timer);
    store._timer = null;
    store.stopPolling?.();
  }
  store = null;
  delete globalThis.document;
  delete globalThis.puter;
});

describe('presence from a tab put away', () => {
  it('lapses as before for a tab in the background, but not for one in a huddle: the call keeps the person here', async () => {
    const { urls } = await boot();
    // The tab is put away (another tab in front): no heartbeat goes.
    globalThis.document = { hidden: true };
    expect(store._present()).toBe(false);
    await store.poll();
    expect(urls[0].searchParams.get('hb')).toBeNull();
    // In a huddle from that tab, though: the person is on the call, and the
    // heartbeat goes with the next poll, as it does from a tab in view.
    store.huddle = {};
    expect(store._present()).toBe(true);
    await store.poll();
    expect(urls[1].searchParams.get('hb')).toBe('1');
    // The call over, the hidden tab lapses again.
    store.huddle = null;
    store._lastHeartbeat = Date.now() - 60_000;
    await store.poll();
    expect(urls[2].searchParams.get('hb')).toBeNull();
    // Back in view: present, huddle or not.
    globalThis.document = { hidden: false };
    expect(store._present()).toBe(true);
  });
});
