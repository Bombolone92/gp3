// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { confirmSignOut } from '../src/ui/appmenu.js';
import { closeAllModals } from '../src/ui/modal.js';

describe('signing out', () => {
  let beforeSignOut;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('puter', { auth: { signOut: vi.fn() } });
    vi.stubGlobal('location', { hash: '#/new', reload: vi.fn() });
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => {
    window.removeEventListener('app:before-signout', beforeSignOut);
    closeAllModals();
    vi.runAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  function saving(promise) {
    beforeSignOut = (event) => {
      event.detail?.waitUntil(promise);
      return promise;
    };
    window.addEventListener('app:before-signout', beforeSignOut);
  }
  function confirm() { document.querySelector('.modal-panel .btn-primary').click(); }

  it('waits for the actual save and SDK sign-out instead of a fixed delay', async () => {
    let saved, signedOut;
    saving(new Promise((resolve) => { saved = resolve; }));
    puter.auth.signOut.mockReturnValue(new Promise((resolve) => { signedOut = resolve; }));
    const done = confirmSignOut();
    confirm();
    await vi.advanceTimersByTimeAsync(1000);
    expect(puter.auth.signOut).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
    saved(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(puter.auth.signOut).toHaveBeenCalledTimes(1);
    expect(location.reload).not.toHaveBeenCalled();
    signedOut();
    await done;
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it.each(['false', 'rejected'])('keeps the session and editor when saving returns %s', async (failure) => {
    let settle;
    const pending = new Promise((resolve, reject) => { settle = failure === 'false' ? () => resolve(false) : () => reject(new Error('offline')); });
    saving(pending);
    const done = confirmSignOut();
    confirm();
    await vi.advanceTimersByTimeAsync(0);
    settle();
    await done;
    expect(puter.auth.signOut).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
    expect(location.hash).toBe('#/new');
  });

  it('does not request a save or sign out when cancelled', async () => {
    const save = vi.fn();
    beforeSignOut = save;
    window.addEventListener('app:before-signout', beforeSignOut);
    const done = confirmSignOut();
    document.querySelector('.modal-panel .btn-ghost').click();
    await done;
    expect(save).not.toHaveBeenCalled();
    expect(puter.auth.signOut).not.toHaveBeenCalled();
  });
});
