/**
 * UI (review pass 22, lead), driven in node through tests/helpers/dom.js:
 * a fresh DOM and a fresh module registry for every test.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/theme.js', () => ({ applyTheme: vi.fn(), currentTheme: () => 'system', isDark: () => false }));
vi.mock('../src/lib/router.js', async (importOriginal) => ({ ...(await importOriginal()), navigate: vi.fn() }));

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;
let store = null;

/** A fresh DOM and fresh modules, with a small workspace open in the store. */
async function boot() {
  dom?.uninstall();
  dom = installDom({});
  vi.resetModules();
  globalThis.puter = { workers: { exec: async () => json({ code: 'not_found', message: 'nope' }, 404) } };
  ({ store } = await import('../src/lib/store.js'));
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
  return { store, dom };
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

describe('the message box and the draft another tab saved', () => {
  const KEY = `${REF}:c1`;

  it('writes nothing for a box nothing has changed in, so hiding or leaving that tab keeps the words and files another tab put in the draft', async () => {
    await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const { getDraft, setDraft } = await import('../src/lib/drafts.js');
    // This tab opens the conversation with no draft, and nothing is typed here.
    const composer = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: KEY });
    document.body.append(composer.el);
    // Another tab of the browser saves a draft for the same conversation:
    // words, and a file that has landed.
    setDraft(KEY, { text: 'from the other tab', attachments: [{ id: 'f1', name: 'plan.pdf', size: 1200, type: 'application/pdf' }] });
    // This tab is hidden, then the page goes: the box flushes its draft both times.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    await dom.tick(1);
    expect(getDraft(KEY)?.text).toBe('from the other tab');
    expect(getDraft(KEY)?.attachments?.map((a) => a.id)).toEqual(['f1']);
    composer.destroy?.();
    await dom.tick(1);
    expect(getDraft(KEY)?.text).toBe('from the other tab');
  });

  it('still writes what was typed or cleared here, over the draft as it stood', async () => {
    await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const { getDraft, setDraft } = await import('../src/lib/drafts.js');
    setDraft(KEY, { text: 'kept from before', attachments: [] });
    const composer = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: KEY });
    document.body.append(composer.el);
    const ta = composer.el.querySelector('textarea');
    expect(ta.value).toBe('kept from before');
    // Typed here: the draft follows on the page going.
    ta.value = 'typed here';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new Event('pagehide'));
    expect(getDraft(KEY)?.text).toBe('typed here');
    // Cleared here: the draft is gone.
    ta.value = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new Event('pagehide'));
    expect(getDraft(KEY)).toBeFalsy();
  });
});

/**
 * A message row with its hover bar, as the stylesheet draws it: the bar
 * is drawn only while the row is under the pointer or holds the keyboard
 * (`.msg:focus-within .msg-actions { display: flex }`), modelled here by
 * `hidden` toggled on the row's focusin/focusout, since the fake DOM knows
 * `hidden` but no stylesheet.
 */
function messageRow() {
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  const row = document.createElement('div');
  row.className = 'msg';
  row.setAttribute('tabindex', '0');
  const bar = document.createElement('div');
  bar.className = 'msg-actions';
  const more = document.createElement('button');
  more.type = 'button';
  more.setAttribute('aria-label', 'More actions');
  bar.append(more);
  row.append(bar);
  app.append(row);
  const draw = () => { bar.hidden = !row.contains(document.activeElement); };
  row.addEventListener('focusin', draw);
  row.addEventListener('focusout', () => queueMicrotask(draw));
  draw();
  return { row, bar, more };
}

describe('a dialog closing', () => {
  it('hands the keyboard back to an opener drawn only while its row holds it (a message\'s hover bar), through the row', async () => {
    dom = installDom({});
    vi.resetModules();
    const { openModal } = await import('../src/ui/modal.js');
    const { row, bar, more } = messageRow();
    // The reader is on the row, so the bar is drawn; the dialog (Delete
    // message?, Forward…) opens from its More button.
    row.focus();
    more.focus();
    expect(document.activeElement).toBe(more);
    const modal = openModal({ title: 'Delete message?', content: document.createElement('p') });
    await dom.tick(1);
    // The keyboard went into the dialog, so the row lost it and the bar is
    // not drawn any more.
    expect(row.contains(document.activeElement)).toBe(false);
    expect(bar.hidden).toBe(true);
    // Cancel: the keyboard comes back to the button it left, through the
    // row that draws it — not to the page body.
    modal.close();
    await dom.tick(250);
    expect(document.activeElement).toBe(more);
    expect(bar.hidden).toBe(false);
  });

  it('still hands it straight back to an opener that is drawn on its own', async () => {
    dom = installDom({});
    vi.resetModules();
    const { openModal } = await import('../src/ui/modal.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    const btn = document.createElement('button');
    btn.type = 'button';
    app.append(btn);
    btn.focus();
    const modal = openModal({ title: 'Settings', content: document.createElement('p') });
    await dom.tick(1);
    modal.close();
    await dom.tick(250);
    expect(document.activeElement).toBe(btn);
  });
});
