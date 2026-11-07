// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Doc, AUTOSAVE_MS, RETRY_MS, SIGN_IN_TO_SAVE, versioning } from '../src/lib/doc.js';
import { session } from '../src/lib/session.js';

describe('saving without a Puter session', () => {
  let write, sdk;
  beforeEach(() => {
    vi.useFakeTimers();
    versioning.enabled = false;
    write = vi.fn(async (path) => ({ path, name: path.split('/').pop() }));
    sdk = {
      env: 'web',
      _signedIn: false,
      auth: {
        isSignedIn: () => sdk._signedIn,
        signIn: vi.fn(async () => { sdk._signedIn = true; }),
        getUser: vi.fn(async () => (sdk._signedIn ? { username: 'nariman' } : null)),
      },
      fs: { mkdir: async () => {}, stat: async () => null, write },
    };
    vi.stubGlobal('puter', sdk);
  });
  afterEach(() => {
    session.state = 'unknown';
    session.user = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    versioning.enabled = true;
  });

  it('is not gated before the SDK has been asked', async () => {
    const doc = Doc.blank();
    doc.attach(async () => new Blob(['work']));
    doc.changed();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('holds autosaves and refuses explicit saves until someone signs in', async () => {
    await session.init();
    expect(session.signedOut).toBe(true);
    expect(session.username).toBe('Guest');
    const doc = Doc.blank();
    const exporter = vi.fn(async () => new Blob(['work']));
    doc.attach(exporter);
    doc.changed();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + RETRY_MS);
    expect(exporter).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(doc.status).toBe('unsaved');
    expect(doc.dirty).toBe(true);

    await expect(doc.save({ auto: true })).resolves.toBe(false);
    await expect(doc.save()).rejects.toThrow(SIGN_IN_TO_SAVE);
    await expect(doc.flush()).rejects.toThrow(SIGN_IN_TO_SAVE);
    // The SDK's own dialog is never triggered by the model.
    expect(sdk.auth.signIn).not.toHaveBeenCalled();
    expect(doc.dirty).toBe(true);

    expect(await session.signIn()).toBe(true);
    expect(session.signedIn).toBe(true);
    expect(session.username).toBe('nariman');
    await expect(doc.save()).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(doc.path).toBe('Documents/Untitled document.docx');
    expect(doc.dirty).toBe(false);
  });

  it('shares one sign-in dialog between concurrent callers and reports a dismissed one', async () => {
    await session.init();
    let finish;
    sdk.auth.signIn.mockImplementationOnce(() => new Promise((resolve) => { finish = () => { sdk._signedIn = true; resolve(); }; }));
    const changes = vi.fn();
    session.addEventListener('change', changes);
    const first = session.signIn();
    const second = session.signIn();
    expect(sdk.auth.signIn).toHaveBeenCalledTimes(1);
    finish();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(changes).toHaveBeenCalledTimes(1);
    session.removeEventListener('change', changes);

    session.state = 'out';
    sdk._signedIn = false;
    sdk.auth.signIn.mockRejectedValueOnce(new Error('User cancelled the authentication'));
    expect(await session.signIn()).toBe(false);
    expect(session.signedOut).toBe(true);
  });

  it('follows a sign-in the SDK performed on its own', async () => {
    await session.init();
    const changes = vi.fn();
    session.addEventListener('change', changes);
    session.signedInAs({ username: 'nariman' });
    expect(session.signedIn).toBe(true);
    expect(session.username).toBe('nariman');
    expect(changes).toHaveBeenCalledTimes(1);
    session.removeEventListener('change', changes);
  });
});
