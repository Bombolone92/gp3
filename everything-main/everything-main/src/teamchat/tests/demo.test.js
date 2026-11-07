import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { boot, USERS } from './helpers/harness.js';
import { createMemoryKv } from '../dev/worker-runtime.js';
import { store } from '../src/lib/store.js';
import { api } from '../src/lib/api.js';
import { populateSampleData } from '../src/lib/demo.js';
import { parseHash } from '../src/lib/router.js';
import { USER_DOC_KEY } from '../src/lib/user.js';

let account;
let exec;

beforeEach(async () => {
  const runtime = await boot();
  account = createMemoryKv();
  exec = vi.fn((url, init) => runtime.dispatch(url, init, USERS.alice));
  vi.stubGlobal('puter', { kv: account, workers: { exec } });
  vi.stubGlobal('location', { hash: '#/' });
  store.identity = USERS.alice;
  store.user = {
    v: 1, profile: { name: 'Alice Demo' }, prefs: {},
    workspaces: [{ ref: 'existing01@teamchat-api', name: 'Existing workspace' }],
    worker: { url: 'https://teamchat-api.puter.work' },
  };
  store._composeProfile();
  store._composeWorkspaces();
  await account.set(USER_DOC_KEY, store.user);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  store.user = null;
  store.profile = null;
  store.identity = null;
  store.workspaces = [];
});

describe('console sample data', () => {
  it('creates persistent sample data, keeps existing workspaces, and navigates to it', async () => {
    const pending = populateSampleData();
    expect(populateSampleData()).toBe(pending);
    const workspace = await pending;
    expect(workspace).toMatchObject({ name: 'Northwind Studio', sample: true });
    expect(parseHash(location.hash).ws).toBe(workspace.id);
    const saved = await account.get(USER_DOC_KEY);
    expect(saved.workspaces).toHaveLength(2);
    expect(saved.workspaces[0].name).toBe('Existing workspace');
    expect(saved.workspaces[1]).toMatchObject({ ref: workspace.id, sample: true });
    expect(store.workspaces.some((w) => w.id === workspace.id && w.sample)).toBe(true);

    const data = await api.workspace(workspace.id);
    expect(data.workspace.members[USERS.alice.uuid].name).toBe('Alice Demo');
    expect(Object.keys(data.workspace.members)).toHaveLength(7);
    expect(Object.keys(data.workspace.channels)).toHaveLength(6);
    expect(Object.keys(data.me.dms)).toHaveLength(2);
    const general = Object.values(data.workspace.channels).find((c) => c.name === 'general');
    const page = await api.messages(workspace.id, general.id);
    expect(page.messages.length).toBeGreaterThan(50);
    expect(page.messages.some((m) => m.replyCount > 0)).toBe(true);

    const next = await populateSampleData();
    expect(next.id).not.toBe(workspace.id);
    expect((await account.get(USER_DOC_KEY)).workspaces).toHaveLength(3);
    expect((await api.messages(workspace.id, general.id)).messages).toEqual(page.messages);
  });

  it('rejects before creating anything when the account has not loaded', async () => {
    store.user = null;
    await expect(populateSampleData()).rejects.toThrow('Sign in');
    expect(exec).not.toHaveBeenCalled();
    expect(location.hash).toBe('#/');
  });

  it('surfaces a failure without navigating and allows another attempt', async () => {
    exec.mockRejectedValueOnce(new Error('Connection failed'));
    await expect(populateSampleData()).rejects.toThrow();
    expect(location.hash).toBe('#/');
    expect((await account.get(USER_DOC_KEY)).workspaces).toHaveLength(1);
    const workspace = await populateSampleData();
    expect(parseHash(location.hash).ws).toBe(workspace.id);
  });
});
