import { describe, it, expect, vi, afterEach } from 'vitest';
import { installDom } from './helpers/dom.js';

const REF = 'abc123def0@globex.puter.work';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;
let store = null;

/** A fresh DOM and fresh modules, with a workspace open in the store where the admin is in one of two channels and there is a guest. */
async function boot() {
  dom?.uninstall();
  dom = installDom({ width: 1280 });
  vi.resetModules();
  globalThis.puter = { workers: { exec: async () => json({ code: 'not_found', message: 'nope' }, 404) } };
  ({ store } = await import('../src/lib/store.js'));
  const { api } = await import('../src/lib/api.js');
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = {
    id: 'abc123def0', name: 'Globex', owner: 'u-me',
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 3 } },
    members: {
      'u-me': { role: 'owner', name: 'Me', username: 'me', color: 1 },
      g1: { role: 'guest', name: 'Gus Guest', username: 'gus', color: 2 },
    },
  };
  store.me = { role: 'owner', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  store.workspaces = [{ id: REF, name: 'Globex' }];
  return { store, api, dom };
}

afterEach(() => {
  store?.stopPolling();
  dom?.uninstall();
  dom = null;
  vi.restoreAllMocks();
});

describe('the Guests dialog', () => {
  it('says how many private channels the admin is not in a guest is in, beside the channels it can name', async () => {
    const { api, dom: d } = await boot();
    vi.spyOn(api, 'guests').mockResolvedValue({ guests: [{ uuid: 'g1', channels: ['c1'], hidden: 2, joinedAt: 1 }] });
    const { guestsDialog } = await import('../src/ui/dialogs.js');
    guestsDialog();
    await d.tick(5);
    const row = document.querySelector('.pick-list .pick-item');
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('#general, 2 private channels you are not in');
  });

  it('names one such channel in the singular, and a guest in none the admin can see by that count alone', async () => {
    const { api, dom: d } = await boot();
    vi.spyOn(api, 'guests').mockResolvedValue({ guests: [{ uuid: 'g1', channels: [], hidden: 1, joinedAt: 1 }] });
    const { guestsDialog } = await import('../src/ui/dialogs.js');
    guestsDialog();
    await d.tick(5);
    const row = document.querySelector('.pick-list .pick-item');
    expect(row.textContent).toContain('1 private channel you are not in');
    expect(row.textContent).not.toContain('no channels');
  });

  it('still reads "no channels" for a guest in none at all', async () => {
    const { api, dom: d } = await boot();
    vi.spyOn(api, 'guests').mockResolvedValue({ guests: [{ uuid: 'g1', channels: [], joinedAt: 1 }] });
    const { guestsDialog } = await import('../src/ui/dialogs.js');
    guestsDialog();
    await d.tick(5);
    expect(document.querySelector('.pick-list .pick-item').textContent).toContain('no channels');
  });
});
