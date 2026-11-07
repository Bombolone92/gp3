// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { Doc, SIGN_IN_TO_SAVE } from '../src/lib/doc.js';
import { session } from '../src/lib/session.js';
import { installMockPuter } from './helpers/mock-puter.js';
import { storageScope } from '../src/lib/account-storage.js';
import { workbookToXlsx } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';

describe('working without a Puter session', () => {
  let calls;
  // SheetJS loads through a real dynamic import that fake timers cannot advance; warm it up first.
  beforeAll(async () => { await workbookToXlsx(new Workbook()); });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', memoryStorage());
    ({ calls } = installMockPuter());
    puter._signedIn = false;
    puter.auth = {
      isSignedIn: () => puter._signedIn,
      signIn: vi.fn(async () => { puter._signedIn = true; }),
      getUser: vi.fn(async () => (puter._signedIn ? { username: 'nariman', uuid: 'u-9' } : null)),
    };
    puter.kv = { get: vi.fn(async () => ({ theme: 'light' })), set: vi.fn(async () => true) };
  });
  afterEach(() => {
    session.state = 'unknown';
    session.user = null;
    session._localChanges = {};
    vi.useRealTimers();
    delete globalThis.puter;
  });

  const writes = () => calls.filter(([op, path]) => op === 'write' && !path.includes('/.versions/')).map(([, path]) => path);

  it('is not gated before the SDK has been asked', async () => {
    const doc = Doc.blank();
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, '1');
    await vi.advanceTimersByTimeAsync(1600);
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
  });

  it('holds autosaves and refuses explicit saves until someone signs in, then writes the edits', async () => {
    await session.init();
    expect(session.signedOut).toBe(true);
    expect(session.username).toBe('Guest');
    expect(storageScope()).toBe('guest');
    const doc = Doc.blank();
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'typed without an account');
    await vi.advanceTimersByTimeAsync(10000);
    expect(writes()).toEqual([]);
    expect(doc.status).toBe('unsaved');
    expect(doc.wb.dirty).toBe(true);
    // The local draft still keeps the edits.
    expect(localStorage.keys().some((key) => key.includes('guest'))).toBe(true);

    await expect(doc.save({ auto: true })).resolves.toBe(false);
    await expect(doc.save()).rejects.toThrow(SIGN_IN_TO_SAVE);
    expect(puter.auth.signIn).not.toHaveBeenCalled();

    expect(await session.signIn()).toBe(true);
    expect(session.signedIn).toBe(true);
    expect(session.username).toBe('nariman');
    expect(storageScope()).toBe('uuid:u-9');
    await expect(doc.save()).resolves.toBe(true);
    expect(writes()).toEqual(['Spreadsheets/Untitled spreadsheet.xlsx']);
    expect(doc.wb.dirty).toBe(false);
  });

  it('keeps settings in this browser without a session and carries them into the account at sign-in', async () => {
    await session.init();
    await session.setTheme('dark');
    expect(puter.kv.set).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('spreadsheet:settings:v1')).theme).toBe('dark');

    await session.signIn();
    // The account had a light theme; the choice made a moment ago wins and is persisted.
    expect(session.settings.theme).toBe('dark');
    await vi.waitFor(() => expect(puter.kv.set).toHaveBeenCalled());
    expect(puter.kv.set.mock.calls[0][1]).toMatchObject({ theme: 'dark' });
  });

  it('shares one sign-in dialog between concurrent callers and reports a dismissed one', async () => {
    await session.init();
    let finish;
    puter.auth.signIn.mockImplementationOnce(() => new Promise((resolve) => { finish = () => { puter._signedIn = true; resolve(); }; }));
    const first = session.signIn();
    const second = session.signIn();
    expect(puter.auth.signIn).toHaveBeenCalledTimes(1);
    finish();
    expect(await Promise.all([first, second])).toEqual([true, true]);

    session.state = 'out';
    puter._signedIn = false;
    puter.auth.signIn.mockRejectedValueOnce(new Error('User cancelled the authentication'));
    expect(await session.signIn()).toBe(false);
    expect(session.signedOut).toBe(true);
  });

  it('follows a sign-in the SDK performed on its own', async () => {
    await session.init();
    const changes = vi.fn();
    session.addEventListener('change', changes);
    puter._signedIn = true;
    session.signedInAs({ username: 'nariman' });
    await vi.waitFor(() => expect(session.signedIn).toBe(true));
    expect(session.username).toBe('nariman');
    expect(changes).toHaveBeenCalled();
    session.removeEventListener('change', changes);
  });
});
