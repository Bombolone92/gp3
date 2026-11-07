/**
 * Conversation UI (review pass 19, lead), driven in node through
 * tests/helpers/dom.js as the pass-16 file is: a fresh DOM and a fresh
 * module registry for every test, Puter faked at `puter.workers.exec`, the
 * toast, the theme, the modal layer and navigation mocked.
 */
import { readFileSync } from 'node:fs';
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
vi.mock('../src/lib/archive.js', async (importOriginal) => ({ ...(await importOriginal()), exportWorkspace: vi.fn(), transferWorkspace: vi.fn() }));

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;
let store = null;

/** A fresh DOM and fresh modules, with a small workspace open in the store: two channels the member is in and two teammates. */
async function boot({ width = 1280, ...env } = {}) {
  dom?.uninstall();
  dom = installDom({ width, ...env });
  vi.resetModules();
  globalThis.puter = { workers: { exec: async () => json({ code: 'not_found', message: 'nope' }, 404) } };
  ({ store } = await import('../src/lib/store.js'));
  const { api } = await import('../src/lib/api.js');
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = {
    id: 'abc123def0', name: 'Globex', owner: 'u-me',
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 3 }, c2: { id: 'c2', name: 'random', count: 3 } },
    members: {
      'u-me': { role: 'member', name: 'Me', username: 'me', color: 1 },
      u2: { role: 'member', name: 'Ana Rocha', username: 'ana', color: 2 },
      u3: { role: 'member', name: 'Ben Ito', username: 'ben', color: 3 },
    },
  };
  store.me = { role: 'member', channels: ['c1', 'c2'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  store.workspaces = [{ id: REF, name: 'Globex' }];
  return { store, api, dom };
}

afterEach(async () => {
  await dom?.tick(5);
  store?.stopPolling();
  dom?.uninstall();
  dom = null;
  store = null;
  vi.restoreAllMocks();
});

const message = (seq, user = 'u2') => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {} });

async function openConversation({ topic } = {}) {
  const { dom: d, api } = await boot();
  const { createConversationView } = await import('../src/ui/conversation.js');
  vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
  vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
  vi.spyOn(store, 'markRead').mockImplementation(() => {});
  if (topic !== undefined) store.ws.channels.c1.topic = topic;
  const msgs = [1, 2, 3].map((seq) => message(seq));
  Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: msgs });
  store.me.reads.c1 = 3;
  store.act.c.c1 = { s: 3 };
  const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
  document.body.append(view.el);
  await d.tick(5);
  return { d, api, view, msgs };
}

describe('the topic in the conversation header', () => {
  it('carries the whole topic as a tooltip, since the header cuts a long one with an ellipsis', async () => {
    const topic = 'This topic is deliberately very long so that the header has to cut it with an ellipsis rather than pushing the controls off the right edge of the window';
    const { view } = await openConversation({ topic });
    const btn = view.el.querySelector('.conv-topic');
    expect(btn.textContent).toBe(topic);
    expect(btn.getAttribute('title')).toBe(topic);
    view.destroy();
  });

  it('offers no tooltip on the "Add a topic" prompt, which is whole as it stands', async () => {
    const { view } = await openConversation();
    const btn = view.el.querySelector('.conv-topic');
    expect(btn.textContent).toBe('Add a topic');
    expect(btn.getAttribute('title')).toBeNull();
    view.destroy();
  });
});

describe('the bookmarks strip under the header', () => {
  const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector) => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, `a rule for ${selector}`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  it('scrolls sideways under a hidden scrollbar, so the control that manages the bookmarks keeps itself in view at the end of the strip', () => {
    // Ten bookmarks with long names run past the header's width. The strip
    // scrolls, showing no scrollbar, and the Edit/Add control came after
    // the last of them: off the screen, for anyone without a sideways
    // wheel, with nothing to say more bookmarks stood there. Pinned to the
    // strip's end, it stays in reach and covers what runs on under it.
    const bar = rule('.bookmarks-bar');
    expect(bar).toMatch(/overflow-x:\s*auto/);
    expect(bar).toMatch(/scrollbar-width:\s*none/);
    const add = rule('.bookmark-add');
    expect(add).toMatch(/position:\s*sticky/);
    expect(add).toMatch(/right:\s*0/);
    // Over what it covers: a bookmark scrolled under it ends clear of its edge.
    expect(add).toMatch(/box-shadow:[^;]*var\(--surface\)/);
    expect(add).toMatch(/z-index:\s*1/);
  });

  it('draws the Edit control after the last bookmark, where the pinning leaves it when the strip fits', async () => {
    const { view } = await openConversation();
    store.ws.channels.c1.bookmarks = [1, 2, 3].map((i) => ({ label: `Bookmark ${i}`, url: `https://example.com/${i}` }));
    store.emit('workspace');
    await dom.tick(2);
    const bar = view.el.querySelector('.bookmarks-bar');
    const kids = [...bar.children];
    expect(kids.slice(0, 3).every((k) => k.matches('a.bookmark'))).toBe(true);
    expect(kids[3].matches('button.bookmark-add')).toBe(true);
    expect(kids[3].getAttribute('aria-label')).toBe('Edit bookmarks');
    expect(kids).toHaveLength(4);
    view.destroy();
  });
});

describe('Add people to a channel, with more than fifty picked', () => {
  it('adds them fifty to a request and counts everyone the worker took, rather than sending one request the worker cuts at fifty', async () => {
    const { dom: d, api } = await boot();
    const { toast } = await import('../src/ui/toast.js');
    for (let i = 10; i < 70; i++) store.ws.members[`u${i}`] = { role: 'member', name: `Person ${i}`, username: `p${i}`, color: 1 };
    store.ws.channels.c3 = { id: 'c3', name: 'secret', private: true, members: ['u-me'], count: 1, createdBy: 'u-me', createdAt: 1_700_000_000_000 };
    store.me.channels.push('c3');
    // The worker keeps the first fifty of a request and answers with them alone.
    const add = vi.spyOn(api, 'addChannelMembers').mockImplementation(async (ws, ch, uuids) => ({ added: uuids.slice(0, 50) }));
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue(undefined);
    toast.mockClear();
    const { addChannelMembersDialog } = await import('../src/ui/dialogs.js');
    addChannelMembersDialog(store.ws.channels.c3);
    const items = [...document.querySelectorAll('.pick-item')];
    expect(items.length).toBeGreaterThanOrEqual(55);
    for (const item of items.slice(0, 55)) item.click();
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Add').click();
    await d.tick(5);
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[0][2]).toHaveLength(50);
    expect(add.mock.calls[1][2]).toHaveLength(5);
    expect(add.mock.calls.every((c) => c[0] === REF && c[1] === 'c3')).toBe(true);
    expect(toast.mock.calls.some((c) => c[0] === 'Added 55 people')).toBe(true);
  });
});

describe('the huddle dock going with the keyboard inside it', () => {
  /** The dock mounted, with the keyboard on a control of its own, and a column beside it with a Back button and a message box but no headphones (a view route). */
  async function dockWithFocus(env) {
    const { dom: d } = await boot(env);
    const { mountHuddleDock } = await import('../src/ui/huddle.js');
    const { el } = await import('../src/ui/dom.js');
    mountHuddleDock();
    const main = el('div.main', {}, el('button.back', { type: 'button' }, 'Back'), el('textarea'));
    document.body.append(main);
    const dock = document.querySelector('.huddle-dock');
    dock.hidden = false;
    const leave = el('button', { type: 'button' }, 'Leave');
    dock.append(leave);
    leave.focus();
    expect(document.activeElement).toBe(leave);
    store.huddle = null;
    store.emit('huddle');
    await d.tick(1);
    return { main, dock };
  }

  it('hands the keyboard to a control that is not a text box on a touch screen, so no keyboard slides up over the page', async () => {
    const { main, dock } = await dockWithFocus({ width: 390, coarse: true, hover: false });
    expect(dock.hidden).toBe(true);
    expect(document.activeElement).toBe(main.querySelector('.back'));
  });

  it('hands the keyboard to the message box on a desk, as before', async () => {
    const { main } = await dockWithFocus({ width: 1280 });
    expect(document.activeElement).toBe(main.querySelector('textarea'));
  });
});

describe('the mention list for someone alone in a channel', () => {
  it('says nobody else is there rather than "0 people", as the @here row says it', async () => {
    await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    store.ws.channels.c1.count = 1; // me alone
    store.ws.members = { 'u-me': store.ws.members['u-me'] };
    const composer = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1' });
    document.body.append(composer.el);
    // The caret at the end, as a browser's would be (the fake DOM keeps no selection of its own).
    const typed = (s) => { composer.textarea.value = s; composer.textarea.selectionStart = composer.textarea.selectionEnd = s.length; composer.textarea.dispatchEvent(new Event('input')); };
    typed('@');
    const rows = [...composer.el.querySelectorAll('.mention-pop .pick-item')].map((n) => [...n.querySelectorAll('.pick-text span')].map((s) => s.textContent).join(''));
    expect(rows.slice(0, 3)).toEqual([
      'Notify everyone in #general, nobody else in the channel',
      'Notify people active now, nobody else active now',
      'Notify the whole workspace, nobody else in the workspace',
    ]);
    // One other: a count, as before.
    store.ws.channels.c1.count = 2;
    store.ws.members.u2 = { role: 'member', name: 'Ana Rocha', username: 'ana', color: 2 };
    typed('@c');
    const again = [...composer.el.querySelectorAll('.mention-pop .pick-item')].map((n) => [...n.querySelectorAll('.pick-text span')].map((s) => s.textContent).join(''));
    expect(again[0]).toBe('Notify everyone in #general, 1 person');
    composer.destroy();
  });
});
