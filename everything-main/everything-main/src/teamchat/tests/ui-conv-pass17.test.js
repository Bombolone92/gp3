/**
 * Conversation UI (review pass 17), driven in node through
 * tests/helpers/dom.js as the pass-16 file is: a fresh DOM and a fresh
 * module registry for every test, Puter faked at `puter.workers.exec`, the
 * toast, the theme, the modal layer and navigation mocked.
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
// The export of a workspace is minutes of network work; the tests hold it and let it go.
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
  // The views' own frame-later work (a box's sizing, a list's landing) lands
  // while the page is still up, so no timer runs on a page that is gone.
  await dom?.tick(5);
  store?.stopPolling();
  if (store) {
    for (const t of store._readTimers?.values() || []) clearTimeout(t);
    store._readTimers?.clear();
  }
  store = null;
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
  vi.restoreAllMocks();
});

describe('Join in Browse channels', () => {
  it('says the channel is joined here when its host did not answer, closes and opens it, rather than the network’s words over a re-armed Join', async () => {
    const { dom: d } = await boot();
    const { toast } = await import('../src/ui/toast.js');
    const { navigate } = await import('../src/lib/router.js');
    const { openModal } = await import('../src/ui/modal.js');
    // A channel hosted by another workspace, not yet joined.
    store.ws.channels.c3 = { id: 'c3', name: 'joint', count: 2, shared: { host: 'Acme', ref: 'ffffffffff@acme-test', ch: 'h1' } };
    // The store's own behaviour for a host that does not answer (see
    // store.joinChannel): the join is recorded here and kept, the network's
    // failure thrown all the same.
    vi.spyOn(store, 'joinChannel').mockImplementation(async (id) => {
      store.me.channels = [...store.me.channels, id];
      store.emit('workspace');
      throw new Error('Failed to fetch');
    });
    toast.mockClear();
    navigate.mockClear();
    const { browseChannelsDialog } = await import('../src/ui/dialogs.js');
    browseChannelsDialog();
    const modal = openModal.mock.results.at(-1).value;
    const join = document.querySelector('[aria-label="Join #joint"]');
    expect(join).toBeTruthy();
    join.click();
    await d.tick(5);
    // The channel is in the sidebar now: said so (and that the host is out
    // of reach), the dialog closed and the channel opened, as a join that
    // went through is.
    const said = toast.mock.calls.map((c) => c[0]);
    expect(said.some((t) => /Joined #joint here/.test(t) && /Acme/.test(t))).toBe(true);
    expect(said.some((t) => /Failed to fetch/.test(t))).toBe(false);
    expect(modal.close).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ ws: REF, conv: 'c3' });
  });

  it('keeps the dialog and re-arms Join with the refusal’s words when the join was refused', async () => {
    const { dom: d } = await boot();
    const { toast } = await import('../src/ui/toast.js');
    const { openModal } = await import('../src/ui/modal.js');
    store.ws.channels.c3 = { id: 'c3', name: 'joint', count: 2, shared: { host: 'Acme', ref: 'ffffffffff@acme-test', ch: 'h1' } };
    vi.spyOn(store, 'joinChannel').mockRejectedValue(Object.assign(new Error('This channel is no longer shared with your workspace'), { code: 'connection_ended' }));
    toast.mockClear();
    const { browseChannelsDialog } = await import('../src/ui/dialogs.js');
    browseChannelsDialog();
    const modal = openModal.mock.results.at(-1).value;
    const join = document.querySelector('[aria-label="Join #joint"]');
    join.focus();
    join.click();
    await d.tick(5);
    expect(toast.mock.calls.some((c) => /no longer shared/.test(c[0]))).toBe(true);
    expect(modal.close).not.toHaveBeenCalled();
    const again = document.querySelector('[aria-label="Join #joint"]');
    expect(again.disabled).toBe(false);
    expect(again.textContent).toBe('Join');
    expect(document.activeElement).toBe(again);
  });
});

const message = (seq, user = 'u2') => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {} });

/** A conversation column on #general with three messages and its intro (no older history), the store's writes stubbed. */
async function openConversation() {
  const { dom: d, api } = await boot();
  const { createConversationView } = await import('../src/ui/conversation.js');
  vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
  vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
  vi.spyOn(store, 'markRead').mockImplementation(() => {});
  Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
  const msgs = [1, 2, 3].map((seq) => message(seq));
  Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: msgs });
  store.me.reads.c1 = 3;
  store.act.c.c1 = { s: 3 };
  const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
  document.body.append(view.el);
  await d.tick(5);
  return { d, api, view, msgs };
}

describe('the message list redrawn under a control outside its rows', () => {
  it('keeps the keyboard on the intro’s button when a teammate’s post redraws the list', async () => {
    const { d, view } = await openConversation();
    const details = () => [...view.el.querySelectorAll('.conv-intro button')].find((b) => b.textContent.trim() === 'Details');
    expect(details()).toBeTruthy();
    details().focus();
    expect(document.activeElement).toBe(details());
    // Someone posts: the list is drawn again, intro included.
    const conv = store.conv('c1');
    conv.messages = [...conv.messages, message(4)];
    conv.seq = 4;
    store.emit('messages', { conv: 'c1', reason: 'newer', added: [conv.messages[3]] });
    await d.tick(2);
    expect(view.el.querySelectorAll('.msg')).toHaveLength(4);
    expect(document.activeElement).toBe(details());
    view.destroy();
  });

  it('keeps the keyboard on "Load older messages" when another change redraws the list', async () => {
    const { d, view } = await openConversation();
    const conv = store.conv('c1');
    // Older history there, and the last page of it refused: the button to ask again stands at the top.
    conv.hasMore = true;
    store.emit('messages', { conv: 'c1', reason: 'older-failed' });
    await d.tick(2);
    const older = () => [...view.el.querySelectorAll('.msg-loader button')].find((b) => b.textContent === 'Load older messages');
    expect(older()).toBeTruthy();
    older().focus();
    // A reaction lands on a message: the list is drawn again; the button is still the button under the keyboard.
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(2);
    expect(older()).toBeTruthy();
    expect(document.activeElement).toBe(older());
    view.destroy();
  });
});

describe('the details dialog of a channel not joined', () => {
  it('draws the head with the name alone, and no stray word where the quick actions would be', async () => {
    const { dom: d } = await boot();
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const { openModal } = await import('../src/ui/modal.js');
    // A public channel the reader is previewing and has not joined.
    store.ws.channels.c3 = { id: 'c3', name: 'design', count: 2, createdBy: 'u2', createdAt: 1_700_000_000_000 };
    openDetailsDialog('c3');
    const content = openModal.mock.calls.at(-1)[0].content;
    await d.tick(2);
    const head = content.querySelector('.details-head');
    expect(head.textContent).toContain('design');
    expect(head.textContent).not.toMatch(/false|undefined|null/);
    expect(head.querySelector('.details-quick')).toBeNull();
  });
});

describe('offering to add people to a channel', () => {
  /** An admin in a workspace with one guest; #design is public and the admin is not in it. */
  const asAdminWithGuest = async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    store.ws.members.g1 = { role: 'guest', name: 'Gus Guest', username: 'gus', color: 4 };
    store.ws.channels.c3 = { id: 'c3', name: 'design', count: 2, createdBy: 'u2', createdAt: 1_700_000_000_000 };
    vi.spyOn(api, 'channelMembers').mockResolvedValue({ members: ['u2', 'u3'] });
    return { d, api };
  };
  const membersTab = async (d, convId) => {
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const { openModal } = await import('../src/ui/modal.js');
    openDetailsDialog(convId);
    const content = openModal.mock.calls.at(-1)[0].content;
    [...content.querySelectorAll('.details-tab')].find((t) => t.textContent.startsWith('Members')).click();
    await d.tick(3);
    return content;
  };
  const addGuestsRow = (content) => [...content.querySelectorAll('.member-add')].find((b) => b.textContent.trim() === 'Add guests') || null;

  it('shows the Members tab’s Add guests row to an admin in the channel, not to one outside it or in an archived one', async () => {
    const { d } = await asAdminWithGuest();
    // In #general: the row stands.
    expect(addGuestsRow(await membersTab(d, 'c1'))).toBeTruthy();
    // Outside #design: the worker refuses the add ("Join the channel to add people to it"), so the row is not offered.
    expect(addGuestsRow(await membersTab(d, 'c3'))).toBeNull();
    // In an archived channel: refused too, and not offered.
    store.ws.channels.c2.archived = true;
    expect(addGuestsRow(await membersTab(d, 'c2'))).toBeNull();
  });

  it('shows the opening card’s Add people to an admin in the channel, not to one previewing it', async () => {
    const { d } = await asAdminWithGuest();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    for (const id of ['c1', 'c3']) Object.assign(store.conv(id), { loaded: true, seq: 1, hasMore: false, messages: [message(1)] });
    const addPeople = (view) => [...view.el.querySelectorAll('.conv-intro button')].find((b) => b.textContent.trim() === 'Add people') || null;
    const joined = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(joined.el);
    await d.tick(3);
    expect(addPeople(joined)).toBeTruthy();
    joined.destroy();
    const previewing = createConversationView('c3', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(previewing.el);
    await d.tick(3);
    // The card is there, with its Details; Add people is not, since the admin is not in the channel.
    expect(previewing.el.querySelector('.conv-intro')).toBeTruthy();
    expect(addPeople(previewing)).toBeNull();
    previewing.destroy();
  });
});

describe('arrowing through the messages', () => {
  it('steps between the rows with Up, Down, Home and End while a row holds the keyboard', async () => {
    const { d, view } = await openConversation();
    const rows = () => [...view.el.querySelectorAll('.msg')];
    expect(rows()).toHaveLength(3);
    rows()[0].focus();
    let ev = d.key(rows()[0], 'ArrowDown');
    expect(document.activeElement).toBe(rows()[1]);
    expect(ev.defaultPrevented).toBe(true);
    d.key(rows()[1], 'ArrowUp');
    expect(document.activeElement).toBe(rows()[0]);
    d.key(rows()[0], 'End');
    expect(document.activeElement).toBe(rows()[2]);
    d.key(rows()[2], 'Home');
    expect(document.activeElement).toBe(rows()[0]);
    // At the first row Up has nowhere to go: the key passes on to the browser.
    ev = d.key(rows()[0], 'ArrowUp');
    expect(document.activeElement).toBe(rows()[0]);
    expect(ev.defaultPrevented).toBe(false);
    view.destroy();
  });

  it('leaves a modified arrow, one during an IME composition, and the keys of a control inside the row alone', async () => {
    const { d, view } = await openConversation();
    const rows = () => [...view.el.querySelectorAll('.msg')];
    rows()[0].focus();
    // Alt+Down steps between conversations (a shortcut's), Shift+Down is nobody's here.
    expect(d.key(rows()[0], 'ArrowDown', { altKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(rows()[0]);
    expect(d.key(rows()[0], 'ArrowDown', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(rows()[0]);
    expect(d.key(rows()[0], 'ArrowDown', { isComposing: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(rows()[0]);
    // A button of the row's hover bar under the keyboard: its own arrows step through the bar.
    const bar = rows()[0].querySelector('.msg-actions button');
    bar.focus();
    d.key(bar, 'ArrowDown');
    expect(rows().some((r) => r === document.activeElement)).toBe(false);
    expect(rows()[0].contains(document.activeElement)).toBe(true);
    // The edit box: its arrows move the caret.
    const { startInlineEdit } = await import('../src/ui/message.js');
    store.conv('c1').messages[1].user = 'u-me';
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(2);
    expect(startInlineEdit(rows()[1])).toBe(true);
    const box = rows()[1].querySelector('.msg-edit-input');
    expect(document.activeElement).toBe(box);
    expect(d.key(box, 'ArrowDown').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(box);
    view.destroy();
  });

  it('steps from the thread’s message to its replies in the thread panel', async () => {
    const { dom: d } = await boot();
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    const root = { ...message(2), replyCount: 2 };
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [message(1), root] });
    Object.assign(store.conv('c1_t2'), { loaded: true, seq: 2, hasMore: false, messages: [message(1, 'u3'), message(2, 'u3')] });
    store.act.c.c1 = { s: 2 };
    const panel = document.createElement('div');
    document.body.append(panel);
    const thread = renderThreadPanel(panel, { convId: 'c1', seq: 2, onClose() {} });
    await d.tick(5);
    const rows = [...panel.querySelectorAll('.msg')];
    expect(rows).toHaveLength(3);
    expect(rows[0].classList.contains('thread-root')).toBe(true);
    rows[0].focus();
    d.key(rows[0], 'ArrowDown');
    expect(document.activeElement).toBe(rows[1]);
    d.key(rows[1], 'End');
    expect(document.activeElement).toBe(rows[2]);
    d.key(rows[2], 'Home');
    expect(document.activeElement).toBe(rows[0]);
    thread.destroy();
  });
});

describe('a name typed the way the app writes it into a dialog’s filter box', () => {
  /** A third channel the reader is not in, and a direct message with Ana, beside the small workspace. */
  const withOpsAndDm = async () => {
    const { dom: d, api } = await boot();
    store.ws.channels.c3 = { id: 'c3', name: 'ops', count: 2, createdBy: 'u2', createdAt: 1_700_000_000_000 };
    store.me.dms = { d1: { members: ['u-me', 'u2'], createdAt: 1_700_000_000_000 } };
    return { d, api };
  };
  const input = (label) => document.querySelector(`input[aria-label="${label}"]`);

  it('finds #ops in Browse channels', async () => {
    const { d } = await withOpsAndDm();
    const { browseChannelsDialog } = await import('../src/ui/dialogs.js');
    browseChannelsDialog();
    d.type(input('Search channels'), '#ops');
    await d.tick(1);
    const names = [...document.querySelectorAll('.pick-item [aria-label]')].map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Join #ops']);
  });

  it('finds @ana in the people picker of a new message', async () => {
    const { d } = await withOpsAndDm();
    const { newDmDialog } = await import('../src/ui/dialogs.js');
    newDmDialog();
    d.type(input('Search people'), '@ana');
    await d.tick(1);
    const names = [...document.querySelectorAll('.pick-item strong')].map((n) => n.textContent);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('Ana Rocha');
  });

  it('finds #general and @ana in Forward this message', async () => {
    const { d } = await withOpsAndDm();
    const { forwardMessageDialog } = await import('../src/ui/dialogs.js');
    forwardMessageDialog(message(1), { permalink: 'https://app.test/#/ws/abc123def0@teamchat-test/c/c1/m/1', author: store.member('u2'), conv: 'c1' });
    const box = input('Search channels and people');
    d.type(box, '#general');
    await d.tick(1);
    expect([...document.querySelectorAll('.pick-item strong')].map((n) => n.textContent)).toEqual(['general']);
    d.type(box, '@ana');
    await d.tick(1);
    expect([...document.querySelectorAll('.pick-item strong')].map((n) => n.textContent)).toEqual(['Ana Rocha']);
  });

  it('finds @ben in the Members dialog', async () => {
    const { d } = await withOpsAndDm();
    const { membersDialog } = await import('../src/ui/dialogs.js');
    membersDialog();
    d.type(input('Search members'), '@ben');
    await d.tick(1);
    const names = [...document.querySelectorAll('.pick-item strong')].map((n) => n.textContent);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('Ben Ito');
  });

  it('finds @ana on the Members tab of a channel’s details', async () => {
    const { d, api } = await withOpsAndDm();
    vi.spyOn(api, 'channelMembers').mockResolvedValue({ members: ['u-me', 'u2', 'u3'] });
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const { openModal } = await import('../src/ui/modal.js');
    openDetailsDialog('c1');
    const content = openModal.mock.calls.at(-1)[0].content;
    [...content.querySelectorAll('.details-tab')].find((t) => t.textContent.startsWith('Members')).click();
    await d.tick(3);
    d.type(content.querySelector('input[type="search"]'), '@ana');
    await d.tick(1);
    expect([...content.querySelectorAll('.member-row strong')].map((n) => n.textContent)).toEqual(['Ana Rocha']);
  });
});

describe('the Bookmarks dialog while a save is out', () => {
  const bookmarks = () => [{ label: 'Roadmap', url: 'https://example.com/roadmap' }, { label: 'Tracker', url: 'https://example.com/tracker' }, { label: 'Wiki', url: 'https://example.com/wiki' }];
  /** The dialog open on #general's three bookmarks, the worker slow to answer each save. */
  const openBookmarks = async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    store.ws.channels.c1.bookmarks = bookmarks();
    const update = vi.spyOn(api, 'updateChannel').mockImplementation((ws, id, patch) => new Promise((r) => setTimeout(() => r({ channel: { ...store.ws.channels.c1, bookmarks: patch.bookmarks } }), 8)));
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue(undefined);
    const { bookmarksDialog } = await import('../src/ui/dialogs.js').then(() => import('../src/ui/bookmarks.js'));
    bookmarksDialog(store.ws.channels.c1);
    await d.tick(1);
    const rows = () => [...document.querySelectorAll('.bm-row strong')].map((n) => n.textContent);
    return { d, update, rows };
  };

  it('takes a double click on Remove as one removal, not the next bookmark’s too', async () => {
    const { d, update, rows } = await openBookmarks();
    expect(rows()).toEqual(['Roadmap', 'Tracker', 'Wiki']);
    // The first click removes Roadmap and the list is drawn again at once,
    // Tracker's Remove now standing where Roadmap's was; the second click of
    // the double click lands there.
    document.querySelector('[aria-label="Remove Roadmap"]').click();
    await d.tick(1);
    document.querySelectorAll('.bm-row .icon-btn[aria-label^="Remove "]')[0].click();
    await d.tick(30);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][2].bookmarks.map((b) => b.label)).toEqual(['Tracker', 'Wiki']);
    expect(rows()).toEqual(['Tracker', 'Wiki']);
  });

  it('takes Enter twice in the Add form as one bookmark, not two', async () => {
    const { d, update, rows } = await openBookmarks();
    const form = document.querySelector('form.bm-form');
    const [label, url] = form.querySelectorAll('input');
    d.type(label, 'Docs');
    d.type(url, 'https://example.com/docs');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(1);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(30);
    expect(update).toHaveBeenCalledTimes(1);
    expect(rows()).toEqual(['Roadmap', 'Tracker', 'Wiki', 'Docs']);
    // The form is clear for the next one once the worker has answered.
    expect(label.value).toBe('');
  });

  it('still takes two quick presses of the same arrow as two moves, the keyboard staying with the bookmark', async () => {
    const { d, update, rows } = await openBookmarks();
    const down = () => document.querySelector('[aria-label="Move Roadmap down"]');
    down().focus();
    down().click();
    await d.tick(1);
    expect(rows()).toEqual(['Tracker', 'Roadmap', 'Wiki']);
    expect(document.activeElement).toBe(down());
    down().click();
    await d.tick(1);
    expect(rows()).toEqual(['Tracker', 'Wiki', 'Roadmap']);
    await d.tick(40);
    expect(update).toHaveBeenCalledTimes(2);
    expect(rows()).toEqual(['Tracker', 'Wiki', 'Roadmap']);
    expect(document.activeElement).toBe(document.querySelector('[aria-label="Move Roadmap up"]'));
  });
});

describe('the Leave and Delete rows of Workspace settings', () => {
  const slow = (value = {}) => () => new Promise((r) => setTimeout(() => r(value), 5));

  it('takes one press at a time on Leave workspace while the worker answers', async () => {
    const { dom: d, api } = await boot();
    store.ws.owner = 'u2';
    store.ws.members.u2.role = 'owner';
    vi.spyOn(store, 'leaveHosts').mockImplementation(slow());
    const remove = vi.spyOn(api, 'removeMember').mockImplementation(slow({}));
    vi.spyOn(store, 'carryRevocations').mockResolvedValue(undefined);
    vi.spyOn(store, 'closeWorkspace').mockImplementation(() => {});
    vi.spyOn(store, 'forgetWorkspace').mockResolvedValue(undefined);
    const { confirmDialog } = await import('../src/ui/modal.js');
    confirmDialog.mockClear();
    const { workspaceSettingsDialog } = await import('../src/ui/dialogs.js');
    workspaceSettingsDialog();
    const leave = [...document.querySelectorAll('button.details-row')].find((b) => b.textContent.includes('Leave workspace'));
    expect(leave).toBeTruthy();
    leave.focus();
    leave.click();
    await d.tick(1);
    // The question answered, the worker still out: a second press (Enter
    // again, a double click) asks nothing more and sends nothing more.
    leave.click();
    await d.tick(1);
    expect(leave.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(leave);
    await d.tick(30);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('takes one press at a time on Delete workspace while the worker answers', async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'owner';
    store.me.role = 'owner';
    vi.spyOn(store, 'disconnectHosts').mockImplementation(slow());
    const del = vi.spyOn(api, 'deleteWorkspace').mockImplementation(slow({}));
    vi.spyOn(store, 'closeWorkspace').mockImplementation(() => {});
    vi.spyOn(store, 'forgetWorkspace').mockResolvedValue(undefined);
    const { confirmDialog } = await import('../src/ui/modal.js');
    confirmDialog.mockClear();
    const { workspaceSettingsDialog } = await import('../src/ui/dialogs.js');
    workspaceSettingsDialog();
    const row = [...document.querySelectorAll('button.details-row')].find((b) => b.textContent.includes('Delete workspace'));
    expect(row).toBeTruthy();
    row.click();
    await d.tick(1);
    row.click();
    await d.tick(1);
    expect(row.getAttribute('aria-busy')).toBe('true');
    await d.tick(30);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
  });
});
