/**
 * Conversation UI (review pass 18), driven in node through
 * tests/helpers/dom.js as the pass-17 file is: a fresh DOM and a fresh
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
  vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
  vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
  return { store, api, dom };
}

afterEach(async () => {
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

const message = (seq, user = 'u2') => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {} });

describe('a file still going up when the box is left', () => {
  const file = { name: 'plan.pdf', size: 1234, type: 'application/pdf' };
  const uploaded = { id: 'f1', name: 'plan.pdf', size: 1234, type: 'application/pdf' };
  /** A message box on #general with "hello" typed and plan.pdf dropped in, its upload held until `finish` is called. */
  const boxWithUpload = async () => {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const { getDraft } = await import('../src/lib/drafts.js');
    let finish = null;
    let fail = null;
    vi.spyOn(store, 'uploadFor').mockImplementation(() => new Promise((r, j) => { finish = r; fail = j; }));
    const key = `${REF}:c1`;
    const open = () => {
      const box = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: key });
      document.body.append(box.el);
      return box;
    };
    const a = open();
    d.type(a.textarea, 'hello');
    const input = a.el.querySelector('input[type="file"]');
    input.files = [file];
    input.dispatchEvent(new Event('change'));
    await d.tick(1);
    expect(a.el.querySelector('.chip.uploading .chip-name')?.textContent).toBe('plan.pdf');
    const chips = (box) => [...box.el.querySelectorAll('.chip')].map((c) => `${c.querySelector('.chip-name').textContent}${c.classList.contains('uploading') ? ' (uploading)' : ''}`);
    return { d, a, open, key, getDraft, chips, finish: () => finish(uploaded), fail: (e) => fail(e) };
  };

  it('is in the box opened next on the same conversation, still going up, and lands there with the words typed since', async () => {
    const { d, a, open, key, getDraft, chips, finish } = await boxWithUpload();
    // The reader switches conversation and comes back before the upload has landed.
    a.destroy();
    a.el.remove();
    const b = open();
    expect(chips(b)).toEqual(['plan.pdf (uploading)']);
    expect(b.el.querySelector('.send-btn').disabled).toBe(true);
    d.type(b.textarea, 'hello world');
    finish();
    await d.tick(2);
    expect(chips(b)).toEqual(['plan.pdf']);
    expect(b.el.querySelector('.send-btn').disabled).toBe(false);
    // The draft has the words as they stand now and the file; the box that was left wrote nothing over them.
    expect(getDraft(key)).toMatchObject({ text: 'hello world', attachments: [uploaded] });
    b.destroy();
  });

  it('goes into the conversation’s draft, beside the words already saved there, when no box is open on it', async () => {
    const { d, a, open, key, getDraft, chips, finish } = await boxWithUpload();
    a.destroy();
    a.el.remove();
    expect(getDraft(key)).toMatchObject({ text: 'hello', attachments: [] });
    finish();
    await d.tick(2);
    expect(getDraft(key)).toMatchObject({ text: 'hello', attachments: [uploaded] });
    // Back in the conversation later: the file is in the box.
    const b = open();
    expect(chips(b)).toEqual(['plan.pdf']);
    b.destroy();
  });

  it('says so when it fails after the box was left, and leaves no chip behind in the box opened next', async () => {
    const { d, a, open, key, getDraft, chips, fail } = await boxWithUpload();
    const { toast } = await import('../src/ui/toast.js');
    toast.mockClear();
    a.destroy();
    a.el.remove();
    const b = open();
    expect(chips(b)).toEqual(['plan.pdf (uploading)']);
    fail(new Error('That file is too large'));
    await d.tick(2);
    expect(chips(b)).toEqual([]);
    expect(b.el.querySelector('.send-btn').disabled).toBe(false);
    expect(toast.mock.calls.some((c) => /too large/.test(c[0]))).toBe(true);
    expect(getDraft(key)).toMatchObject({ text: 'hello', attachments: [] });
    b.destroy();
  });
});

describe('the Bookmarks dialog’s Add while its save is out', () => {
  it('keeps the keyboard on Add through the wait and after a refusal, rather than dropping it to the page', async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    store.ws.channels.c1.bookmarks = [{ label: 'Roadmap', url: 'https://example.com/roadmap' }];
    const update = vi.spyOn(api, 'updateChannel').mockImplementation(() => new Promise((_, j) => setTimeout(() => j(new Error('You are offline')), 8)));
    const { bookmarksDialog } = await import('../src/ui/dialogs.js').then(() => import('../src/ui/bookmarks.js'));
    bookmarksDialog(store.ws.channels.c1);
    await d.tick(1);
    const form = document.querySelector('form.bm-form');
    const [label, url] = form.querySelectorAll('input');
    const add = form.querySelector('button[type="submit"]');
    d.type(label, 'Docs');
    d.type(url, 'https://example.com/docs');
    // Pressed as a button (Tab to it, then Enter; or a click): the keyboard is on Add.
    add.focus();
    expect(document.activeElement).toBe(add);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(1);
    // Waiting on the worker: held, and still under the keyboard.
    expect(add.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(add);
    // Enter again meanwhile adds nothing more.
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(30);
    expect(update).toHaveBeenCalledTimes(1);
    // Refused: the words stay in the form to try again, Add is live again, and the keyboard is still on it.
    expect(label.value).toBe('Docs');
    expect(add.getAttribute('aria-busy')).toBeNull();
    expect(add.disabled).toBe(false);
    expect(document.activeElement).toBe(add);
  });
});

/** A conversation column on #general with one message from Ana, and the forward dialog driven from its hover bar to #random. */
async function forwardToRandom() {
  const { dom: d } = await boot();
  const { toast } = await import('../src/ui/toast.js');
  const { navigate } = await import('../src/lib/router.js');
  const { openModal } = await import('../src/ui/modal.js');
  const { createConversationView } = await import('../src/ui/conversation.js');
  vi.spyOn(store, 'markRead').mockImplementation(() => {});
  const send = vi.spyOn(store, 'send').mockResolvedValue({ seq: 9 });
  Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
  Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [message(1)] });
  const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
  document.body.append(view.el);
  await d.tick(3);
  toast.mockClear();
  navigate.mockClear();
  view.el.querySelector('.msg [aria-label="Forward message"]').click();
  await d.tick(1);
  const modal = openModal.mock.results.at(-1).value;
  // #random picked as the target, and Forward pressed.
  const pick = [...document.querySelectorAll('.pick-item')].find((b) => b.textContent.includes('random'));
  expect(pick).toBeTruthy();
  pick.click();
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Forward').click();
  await d.tick(3);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toBe('c2');
  expect(modal.close).toHaveBeenCalled();
  return { d, view, toast, navigate };
}

describe('forwarding a message', () => {
  it('says where it went, with an Open that leads there', async () => {
    const { view, toast, navigate } = await forwardToRandom();
    const said = toast.mock.calls.find((c) => /Forwarded to/.test(c[0]));
    expect(said).toBeTruthy();
    expect(said[0]).toMatch(/^Forwarded to #?random$/);
    expect(said[1].action.label).toBe('Open');
    said[1].action.onClick();
    expect(navigate).toHaveBeenCalledWith({ ws: REF, conv: 'c2' });
    view.destroy();
  });

  it('opens the conversation in the workspace the message was forwarded in, not whichever is open when Open is pressed', async () => {
    const { view, toast, navigate } = await forwardToRandom();
    const said = toast.mock.calls.find((c) => /Forwarded to/.test(c[0]));
    expect(said).toBeTruthy();
    // The reader moves to another workspace before pressing Open on the toast (it stands for six seconds).
    store.wsId = 'ffffffffff@acme-test';
    said[1].action.onClick();
    expect(navigate).toHaveBeenCalledWith({ ws: REF, conv: 'c2' });
    view.destroy();
  });
});

describe('the Cancel transfer button of the Transfer ownership dialog', () => {
  it('takes one press at a time while the worker answers, the keyboard staying on it', async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'owner';
    store.me.role = 'owner';
    store.ws.members.u2.role = 'admin';
    store.ws.transferTo = 'u2';
    const transfer = vi.spyOn(api, 'transfer').mockImplementation(() => new Promise((r) => setTimeout(() => r({}), 8)));
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue(undefined);
    const { transferDialog } = await import('../src/ui/dialogs.js');
    transferDialog();
    const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel transfer');
    expect(cancel).toBeTruthy();
    cancel.focus();
    cancel.click();
    await d.tick(1);
    // A second press (a double click, Enter again) while the worker answers sends nothing more.
    cancel.click();
    await d.tick(1);
    expect(cancel.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(cancel);
    await d.tick(30);
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls[0][1]).toEqual({ cancel: true });
  });
});

describe('the quote card under a message that links to one of the app’s own lines', () => {
  /** #general open with one message whose text carries a permalink to message 3 of the reader's own space, which the store answers with `quoted`. */
  const withQuote = async (quoted) => {
    const { dom: d } = await boot();
    const { absoluteLink } = await import('../src/lib/router.js');
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    store.me.dms = { d1: { members: ['u-me'], createdAt: 1_700_000_000_000 } };
    vi.spyOn(store, 'quotedMessage').mockReturnValue({ value: quoted });
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    const link = absoluteLink({ ws: REF, conv: 'd1', message: 3 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [{ ...message(1), text: `see ${link}` }] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    expect(store.quotedMessage).toHaveBeenCalledWith('d1', 3);
    return view;
  };

  it('draws the card for a message', async () => {
    const view = await withQuote({ seq: 3, user: 'u-me', kind: 'msg', text: 'Notes for Friday', ts: 1_700_000_000_000, attachments: [], reactions: {} });
    const card = view.el.querySelector('.msg-quote');
    expect(card).toBeTruthy();
    expect(card.hidden).toBe(false);
    expect(card.textContent).toContain('Notes for Friday');
    view.destroy();
  });

  it('draws none for a reminder line, as for a system line', async () => {
    const view = await withQuote({ seq: 3, user: 'u-me', kind: 'rem', text: 'Remember the review', ts: 1_700_000_000_000, ref: { c: 'c1', s: 1 }, attachments: [], reactions: {} });
    expect(view.el.querySelector('.msg-quote')).toBeNull();
    view.destroy();
  });
});

/** A conversation column on #general with three messages read to the end and its intro (no older history), the store's writes stubbed. */
async function openConversation() {
  const { dom: d, api } = await boot();
  const { createConversationView } = await import('../src/ui/conversation.js');
  vi.spyOn(store, 'markRead').mockImplementation(() => {});
  Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
  const msgs = [1, 2, 3].map((seq) => message(seq));
  Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: msgs });
  store.me.reads.c1 = 3;
  store.act.c.c1 = { s: 3 };
  const open = () => {
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    return view;
  };
  const view = open();
  await d.tick(5);
  return { d, api, view, msgs, open };
}

describe('Mark unread from here while the conversation stays open', () => {
  it('draws the New line at the marked message at once, keeps the keyboard on the row, and sends no read back while the reader stays', async () => {
    const { d, api, view, open } = await openConversation();
    vi.spyOn(api, 'markUnread').mockResolvedValue({});
    const rows = () => [...view.el.querySelectorAll('.msg')];
    expect(view.el.querySelector('.new-divider')).toBeNull();
    rows()[1].focus();
    store.markRead.mockClear();
    await store.markUnread('c1', 2);
    await d.tick(3);
    // The line stands right before the marked message, and the keyboard is still on that message.
    const line = view.el.querySelector('.new-divider');
    expect(line).toBeTruthy();
    expect(line.nextElementSibling).toBe(rows()[1]);
    expect(rows()[1].dataset.seq).toBe('2');
    expect(document.activeElement).toBe(rows()[1]);
    // The list is at the bottom, and the store holds the cursor the reader set: no read goes back up.
    expect(store.markRead).not.toHaveBeenCalled();
    // A teammate's post redraws the list: the line stays where it was.
    const conv = store.conv('c1');
    conv.messages = [...conv.messages, message(4)];
    conv.seq = 4;
    store.act.c.c1 = { s: 4 };
    store.emit('messages', { conv: 'c1', reason: 'newer', added: [conv.messages[3]] });
    await d.tick(3);
    expect(view.el.querySelector('.new-divider')?.nextElementSibling?.dataset.seq).toBe('2');
    view.destroy();
    // Opened again: the line is there, and reading to the end (the fresh list marks read as it lands) is what takes it away for the next visit.
    const again = open();
    await d.tick(5);
    expect(again.el.querySelector('.new-divider')?.nextElementSibling?.dataset.seq).toBe('2');
    expect(store.markRead).toHaveBeenCalledWith('c1', 4);
    again.destroy();
    store.me.reads.c1 = 4;
    const third = open();
    await d.tick(5);
    expect(third.el.querySelector('.new-divider')).toBeNull();
    third.destroy();
  });
});

describe('a file name carrying a bidi override', () => {
  // U+202E (right-to-left override) makes "invoice‮fdp.exe" read as "invoiceexe.pdf".
  const tricky = 'invoice‮fdp.exe';
  const CONTROLS = /[‪-‮⁦-⁩‎‏]/;

  it('is shown in the composer’s chip without the control characters, its letters in their order', async () => {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    vi.spyOn(store, 'uploadFor').mockResolvedValue({ id: 'f9', name: tricky, size: 10, type: 'application/octet-stream' });
    const box = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1' });
    document.body.append(box.el);
    const input = box.el.querySelector('input[type="file"]');
    input.files = [{ name: tricky, size: 10, type: 'application/octet-stream' }];
    input.dispatchEvent(new Event('change'));
    await d.tick(2);
    const chip = box.el.querySelector('.chip');
    expect(chip).toBeTruthy();
    expect(chip.querySelector('.chip-name').textContent).not.toMatch(CONTROLS);
    expect(chip.querySelector('.chip-name').textContent).toBe('invoicefdp.exe');
    expect(chip.querySelector('button').getAttribute('aria-label')).not.toMatch(CONTROLS);
    box.destroy();
  });

  it('is shown on the message’s file card and picture caption without them, the download keeping the file’s own name', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    const files = await import('../src/lib/files.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    const download = vi.spyOn(files, 'downloadAttachment').mockResolvedValue(undefined);
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    const doc = { id: 'f9', name: tricky, size: 10, type: 'application/octet-stream' };
    const m = { ...message(1), text: '', attachments: [doc, { id: 'p1', name: `photo${'‮'}gnp.js`, size: 10, type: 'image/png' }] };
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [m] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    const card = view.el.querySelector('.attachment');
    expect(card.querySelector('strong').textContent).toBe('invoicefdp.exe');
    expect(card.getAttribute('aria-label')).toBe('Download invoicefdp.exe');
    expect(view.el.querySelector('.att-caption-name').textContent).toBe('photognp.js');
    card.click();
    expect(download).toHaveBeenCalledWith(REF, doc);
    view.destroy();
  });
});

describe('Add people when the people picked have left the workspace meanwhile', () => {
  it('says nobody was added because they are gone, not that everyone was already in', async () => {
    const { dom: d, api } = await boot();
    const { toast } = await import('../src/ui/toast.js');
    store.ws.channels.c3 = { id: 'c3', name: 'secret', private: true, members: ['u-me'], count: 1, createdBy: 'u-me', createdAt: 1_700_000_000_000 };
    store.me.channels.push('c3');
    vi.spyOn(api, 'addChannelMembers').mockResolvedValue({ added: [] });
    // The worker leaves out someone no longer in the workspace and answers with nobody added; the refresh after it brings the workspace without them.
    vi.spyOn(store, 'refreshAfterChange').mockImplementation(async () => { delete store.ws.members.u2; });
    toast.mockClear();
    const { addChannelMembersDialog } = await import('../src/ui/dialogs.js');
    addChannelMembersDialog(store.ws.channels.c3);
    [...document.querySelectorAll('.pick-item')].find((b) => b.textContent.includes('Ana Rocha')).click();
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Add').click();
    await d.tick(3);
    const said = toast.mock.calls.map((c) => c[0]);
    expect(said.some((t) => /already in the channel/.test(t))).toBe(false);
    expect(said.some((t) => /no longer in this workspace/.test(t))).toBe(true);
  });

  it('still says everyone was already in when they are all still here', async () => {
    const { dom: d, api } = await boot();
    const { toast } = await import('../src/ui/toast.js');
    store.ws.channels.c3 = { id: 'c3', name: 'secret', private: true, members: ['u-me'], count: 1, createdBy: 'u-me', createdAt: 1_700_000_000_000 };
    store.me.channels.push('c3');
    vi.spyOn(api, 'addChannelMembers').mockResolvedValue({ added: [] });
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue(undefined);
    toast.mockClear();
    const { addChannelMembersDialog } = await import('../src/ui/dialogs.js');
    addChannelMembersDialog(store.ws.channels.c3);
    [...document.querySelectorAll('.pick-item')].find((b) => b.textContent.includes('Ana Rocha')).click();
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Add').click();
    await d.tick(3);
    expect(toast.mock.calls.some((c) => c[0] === 'Everyone was already in the channel')).toBe(true);
  });
});

describe('a link cut short in a message', () => {
  it('carries its whole address in its title, while one drawn whole carries none', async () => {
    await boot();
    const { decorateLink } = await import('../src/ui/message.js');
    const { el } = await import('../src/ui/dom.js');
    // An address made to look like one place that ends at another: the host is after the @, past where the formatter cuts.
    const long = `https://accounts.example.com.${'a'.repeat(40)}@evil.example/login`;
    // As the formatter draws an address over 64 characters: its first 61 and an ellipsis.
    const cut = el('a', { href: long, target: '_blank', rel: 'noopener noreferrer nofollow' }, `${long.slice(0, 61)}...`);
    decorateLink(cut);
    expect(cut.getAttribute('title')).toBe(long);
    expect(cut.getAttribute('target')).toBe('_blank');
    expect(cut.textContent.endsWith('...')).toBe(true);
    const short = 'https://example.com/x';
    const whole = el('a', { href: short, target: '_blank' }, short);
    decorateLink(whole);
    expect(whole.getAttribute('title')).toBeNull();
  });
});

describe('the topic field of Edit channel', () => {
  it('saves on Enter, Shift+Enter breaking a line, and takes up to 250 characters', async () => {
    const { dom: d, api } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [message(1)] });
    const update = vi.spyOn(api, 'updateChannel').mockResolvedValue({ channel: store.ws.channels.c1 });
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue(undefined);
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    // The header's "Add a topic" opens Edit channel for a curator.
    view.el.querySelector('.conv-topic').click();
    const topic = document.querySelector('form textarea.textarea');
    expect(topic).toBeTruthy();
    expect(topic.getAttribute('maxlength')).toBe('250');
    d.type(topic, 'Ship it');
    // Shift+Enter is the box's own (a line break); a plain Enter saves.
    expect(d.key(topic, 'Enter', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(d.key(topic, 'Enter', { isComposing: true }).defaultPrevented).toBe(false);
    expect(update).not.toHaveBeenCalled();
    const ev = d.key(topic, 'Enter');
    await d.tick(2);
    expect(ev.defaultPrevented).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][2]).toEqual({ topic: 'Ship it' });
    view.destroy();
  });
});
