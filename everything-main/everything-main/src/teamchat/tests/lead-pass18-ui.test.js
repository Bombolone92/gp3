/**
 * Shell and conversation UI checked by the lead in review pass 18, driven
 * in node through tests/helpers/dom.js as the pass-17 shell tests are.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

vi.mock('../src/ui/conversation.js', () => ({
  createConversationView: (convId) => {
    const node = document.createElement('div');
    node.className = 'main';
    node.dataset.conv = convId;
    return { el: node, destroy() {}, renderHeader() {}, tab: () => 'messages', setTab() {}, jumpTo() {} };
  },
}));
vi.mock('../src/ui/huddle.js', () => ({
  mountHuddleDock() {},
  joinHuddleFlow() {},
  huddleButton() { return document.createElement('span'); },
  createHuddleBar() { return { el: document.createElement('div'), destroy() {} }; },
}));

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;

/** A fresh DOM and fresh modules; the store opens a small workspace when asked. */
async function boot({ hash = '', width = 1280, routes = {}, ...env } = {}) {
  dom?.uninstall();
  dom = installDom({ hash, width, ...env });
  vi.resetModules();
  const calls = [];
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
        calls.push(`${init.method || 'GET'} ${u.pathname}${u.search}`);
        const hit = Object.entries(routes).find(([k]) => u.pathname.endsWith(k));
        if (!hit) return json({ code: 'not_found', message: 'nope' }, 404);
        return hit[1](u.searchParams, init);
      },
    },
  };
  const { store } = await import('../src/lib/store.js');
  const open = () => {
    store.wsId = REF;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = {
      id: 'abc123def0', name: 'Globex',
      channels: { c1: { id: 'c1', name: 'general', def: true } },
      members: {
        'u-me': { role: 'member', name: 'Me', username: 'me' },
        'u-dan': { role: 'member', name: 'Dan Ito', username: 'dan' },
      },
    };
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.act = { c: {}, p: {}, w: 0, u: 0 };
    store.workspaces = [{ id: REF, name: 'Globex' }];
  };
  store.openWorkspace = async () => { open(); store.emit('workspace'); };
  store.startPolling = () => {};
  store.pokeSync = () => {};
  return { store, open, calls, dom };
}

afterEach(() => {
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
});

describe('a Threads view card whose root takes no reply', () => {
  const msg = (extra) => ({ seq: 1, user: 'u-dan', ts: 1000, text: 'the root of it', kind: 'msg', replyCount: 1, attachments: [], mentions: [], reactions: {}, ...extra });
  const reply = { seq: 1, user: 'u-me', ts: 1500, text: 'a reply', kind: 'msg', attachments: [], mentions: [], reactions: {} };

  async function cardFor(root) {
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/threads`,
      routes: {
        '/threads': () => json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: 2000, unread: 0, root }] }),
        '/messages': () => json({ messages: [reply], seq: 1 }),
      },
    });
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('threads');
    document.body.append(view.el);
    await ctx.dom.tick(10);
    const card = view.el.querySelector('.thread-card');
    expect(card).not.toBeNull();
    return { card, view, ctx };
  }

  it('offers the reply box under an ordinary message', async () => {
    const { card, view } = await cardFor(msg());
    expect(card.querySelector('textarea')).not.toBeNull();
    expect(card.querySelector('.thread-card-blocked')).toBeNull();
    view.destroy();
  });

  it('says the thread is closed, with no box, under a root that was deleted while its replies stand (as the panel does)', async () => {
    const { card, view } = await cardFor(msg({ deleted: true, text: '' }));
    expect(card.querySelector('textarea')).toBeNull();
    expect(card.querySelector('.thread-card-blocked')?.textContent).toBe('This thread is closed: its message was deleted');
    view.destroy();
  });

  it('offers no box under a line the worker wrote (someone joined), which the worker refuses a reply to', async () => {
    const { card, view } = await cardFor(msg({ kind: 'sys', text: 'joined' }));
    expect(card.querySelector('textarea')).toBeNull();
    expect(card.querySelector('.thread-card-blocked')?.textContent).toBe('System lines have no thread');
    view.destroy();
  });

  it('nor under a reminder', async () => {
    const { card, view } = await cardFor(msg({ kind: 'rem', text: 'remember this' }));
    expect(card.querySelector('textarea')).toBeNull();
    expect(card.querySelector('.thread-card-blocked')?.textContent).toBe('Reminders have no thread');
    view.destroy();
  });

  it('takes the box away when the root is deleted while the card is on screen (the parent window redraws the card)', async () => {
    const { card, view, ctx } = await cardFor(msg());
    expect(card.querySelector('textarea')).not.toBeNull();
    // The card draws the root from the channel's window when it holds it.
    const root = msg({ deleted: true, text: '' });
    Object.assign(ctx.store.conv('c1'), { loaded: true, seq: 1, messages: [root] });
    ctx.store.emit('messages', { conv: 'c1' });
    await ctx.dom.tick(5);
    const again = view.el.querySelector('.thread-card');
    expect(again.querySelector('textarea')).toBeNull();
    expect(again.querySelector('.thread-card-blocked')?.textContent).toBe('This thread is closed: its message was deleted');
    view.destroy();
  });
});

describe('Send now on a scheduled message a poll is sending this moment', () => {
  const entry = { id: 's1', conv: 'c1', dueAt: Date.now() + 3600_000, text: 'later on', kind: 'message' };
  const sending = () => json({ code: 'sending', message: 'This message is being sent already' }, 409);

  async function laterView(routes) {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/later`, routes });
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later');
    document.body.append(view.el);
    await ctx.dom.tick(10);
    [...view.el.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Scheduled').click();
    await ctx.dom.tick(10);
    expect(view.el.querySelectorAll('.sched-row').length).toBe(1);
    return { ...ctx, view };
  }

  it('reads the list again rather than marking the row "Not sent" with the worker\'s words', async () => {
    let list = () => json({ scheduled: [entry], reminders: [] });
    const puts = [];
    const ctx = await laterView({
      '/scheduled/s1': (_q, init) => { puts.push(JSON.parse(init.body)); return sending(); },
      '/scheduled': () => list(),
    });
    const { view, dom: d } = ctx;
    // The poll posted it meanwhile: the list read for the truth no longer holds it.
    list = () => json({ scheduled: [], reminders: [] });
    const asked = ctx.calls.filter((c) => c.startsWith('GET') && c.endsWith('/scheduled')).length;
    [...view.el.querySelectorAll('button')].find((b) => b.textContent === 'Send now').click();
    await d.tick(20);
    expect(puts).toEqual([{ sendNow: true }]);
    expect(ctx.calls.filter((c) => c.startsWith('GET') && c.endsWith('/scheduled')).length).toBe(asked + 1);
    expect(view.el.querySelectorAll('.sched-row').length).toBe(0);
    expect(view.el.querySelector('.not-sent')).toBeNull();
    view.destroy();
  });

  it('still marks the row "Not sent" when the post itself was refused (the channel archived)', async () => {
    const ctx = await laterView({
      '/scheduled/s1': () => json({ code: 'archived', message: 'This channel is archived' }, 403),
      '/scheduled': () => json({ scheduled: [entry], reminders: [] }),
    });
    const { view, dom: d } = ctx;
    [...view.el.querySelectorAll('button')].find((b) => b.textContent === 'Send now').click();
    await d.tick(20);
    expect(view.el.querySelectorAll('.sched-row.not-sent').length).toBe(1);
    expect(view.el.querySelector('.sched-why')?.textContent).toContain('This channel is archived');
    view.destroy();
  });
});
