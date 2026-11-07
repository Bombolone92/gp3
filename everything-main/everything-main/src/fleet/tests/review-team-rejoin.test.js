// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadWorker, fakeKV, person, OWNER } from './review-team-helpers.js';

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
});

describe('opening a new invitation to a fleet already in the list', () => {
  it('uses the invitation, so someone removed meanwhile gets back in', async () => {
    const URL_ = 'https://fleet-abc.puter.work';
    const w = loadWorker();
    const SAM = person('user-2', 'sam');
    // Sam joined once, was removed while his app was closed, and now has a new link.
    const first = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    await w.api(SAM, { op: 'join', token: first.token });
    await w.api(OWNER, { op: 'removeMember', uuid: 'user-2' });
    const again = (await w.api(OWNER, { op: 'invite', role: 'driver' })).body;

    const kv = fakeKV();
    await kv.set('fl1:workspaces', { current: 'own', own: {}, joined: [{ url: URL_, business: 'Acme', role: 'member' }] });
    globalThis.puter = {
      kv,
      auth: { isSignedIn: () => true, getUser: async () => ({ uuid: 'user-2', username: 'sam' }), getProfilePicture: async () => null },
      workers: { exec: w.exec(SAM) },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = '<div id="app"></div>';
    location.hash = `#/join?w=fleet-abc&t=${again.token}`;
    await import('../src/main.js');
    for (let i = 0; i < 100 && !w.kv.data.has('flt:m:user-2'); i++) await new Promise((r) => setTimeout(r, 10));
    expect(w.kv.data.get('flt:m:user-2')).toMatchObject({ role: 'driver' });
    for (let i = 0; i < 100 && (await kv.get('fl1:workspaces')).current !== URL_; i++) await new Promise((r) => setTimeout(r, 10));
    expect(await kv.get('fl1:workspaces')).toMatchObject({ current: URL_, joined: [{ url: URL_, role: 'driver' }] });
    // Let the boot finish before the test environment is torn down.
    const { app } = await import('../src/app.js');
    for (let i = 0; i < 300 && !document.querySelector('main.content > *'); i++) await new Promise((r) => setTimeout(r, 10));
    expect(app.store).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
  });
});
