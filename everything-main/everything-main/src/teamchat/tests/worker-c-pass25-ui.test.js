/**
 * Twenty-fifth review pass, region C, the client side of the files routes:
 * the message box lets the worker know of an upload it took out again (see
 * DELETE /api/ws/:ws/files/:id in worker-c-pass25.test.js). A fake DOM drives
 * the real composer with the store's upload stubbed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/theme.js', () => ({ applyTheme: vi.fn(), currentTheme: () => 'system', isDark: () => false }));
vi.mock('../src/ui/modal.js', () => ({
  confirmDialog: vi.fn(async () => true),
  closeAllModals: vi.fn(),
  openModal: vi.fn(({ content, onClose }) => {
    document.body.append(content);
    const close = vi.fn(() => { content.remove(); onClose?.(); });
    return { close, panel: content, root: content };
  }),
}));
vi.mock('../src/lib/router.js', async (importOriginal) => ({ ...(await importOriginal()), navigate: vi.fn() }));

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;
let store = null;

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
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 2 } },
    members: { 'u-me': { role: 'member', name: 'Me', username: 'me', color: 1 }, u2: { role: 'member', name: 'Ana Rocha', username: 'ana', color: 2 } },
  };
  store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  store.workspaces = [{ id: REF, name: 'Globex' }];
  vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
  vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
  return { store, api, dom };
}

afterEach(async () => {
  await dom?.tick(5);
  store?.stopPolling();
  store = null;
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
  vi.restoreAllMocks();
});

describe('an upload taken out of the message box again', () => {
  it('is let go of on the worker: a chip removed after its file went up, and a file landing for a chip removed while it went up; not one that failed, nor one that is sent', async () => {
    const { dom: d, api } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    // Uploads held until finished here, in the order they began.
    const holds = [];
    vi.spyOn(store, 'uploadFor').mockImplementation((conv, file) => new Promise((resolve, reject) => holds.push({ file, resolve, reject })));
    const gone = vi.spyOn(api, 'deleteFile').mockResolvedValue({ ok: true });
    const onSend = vi.fn(async () => {});
    const box = createComposer({ onSend, convId: 'c1', typingConv: 'c1', draftKey: `${REF}:c1` });
    document.body.append(box.el);
    const input = box.el.querySelector('input[type="file"]');
    input.files = [{ name: 'a.pdf', size: 10, type: 'application/pdf' }, { name: 'b.pdf', size: 20, type: 'application/pdf' }, { name: 'c.pdf', size: 30, type: 'application/pdf' }, { name: 'd.pdf', size: 40, type: 'application/pdf' }];
    input.dispatchEvent(new Event('change'));
    await d.tick(6);
    expect(holds.map((h) => h.file.name)).toEqual(['a.pdf']);
    // a.pdf's chip removed while it is going up: when it lands, its bytes are let go of, under the id the worker gave it.
    box.el.querySelector('.chip button[aria-label="Remove a.pdf"]').click();
    expect(gone).not.toHaveBeenCalled();
    holds[0].resolve({ id: 'f-a', name: 'a.pdf', size: 10, type: 'application/pdf' });
    await d.tick(6);
    expect(gone.mock.calls).toEqual([[REF, 'f-a']]);
    // b.pdf lands and stands; removed after that, it is let go of.
    expect(holds.map((h) => h.file.name)).toEqual(['a.pdf', 'b.pdf']);
    holds[1].resolve({ id: 'f-b', name: 'b.pdf', size: 20, type: 'application/pdf' });
    await d.tick(6);
    box.el.querySelector('.chip button[aria-label="Remove b.pdf"]').click();
    expect(gone.mock.calls).toEqual([[REF, 'f-a'], [REF, 'f-b']]);
    // c.pdf's upload fails after its chip was removed: nothing landed, nothing to let go of.
    box.el.querySelector('.chip button[aria-label="Remove c.pdf"]').click();
    holds[2].reject(new Error('Files can be up to 10 MB'));
    await d.tick(6);
    expect(gone.mock.calls).toHaveLength(2);
    // d.pdf lands and is sent with the message: its file is the message's, and nothing is asked of the worker for it.
    holds[3].resolve({ id: 'f-d', name: 'd.pdf', size: 40, type: 'application/pdf' });
    await d.tick(6);
    expect([...box.el.querySelectorAll('.chip .chip-name')].map((n) => n.textContent)).toEqual(['d.pdf']);
    box.el.querySelector('textarea').value = 'here it is';
    box.el.querySelector('textarea').dispatchEvent(new Event('input'));
    expect(box.el.querySelector('.send-btn').disabled).toBe(false);
    box.el.querySelector('.send-btn').click();
    await d.tick(6);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect([onSend.mock.calls[0][0], onSend.mock.calls[0][1].map((a) => a.id)]).toEqual(['here it is', ['f-d']]);
    expect(gone.mock.calls).toHaveLength(2);
    box.destroy();
  });
});
