/**
 * Thirteenth review pass, the lead's own findings: shell views driven in
 * node through tests/helpers/dom.js the way tests/ui-shell-pass12.test.js
 * drives them (a fresh DOM and module registry per test, Puter faked at
 * `puter.workers.exec`, the conversation column and huddle window stubbed).
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

async function boot({ hash = '', width = 1280, routes = {}, ...env } = {}) {
  dom?.uninstall();
  dom = installDom({ hash, width, ...env });
  vi.resetModules();
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
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
      channels: { c1: { id: 'c1', name: 'general', def: true }, c2: { id: 'c2', name: 'ops' } },
      members: {
        'u-me': { role: 'member', name: 'Me', username: 'me' },
        'u-dan': { role: 'member', name: 'Dan Ito', username: 'dan' },
      },
    };
    store.me = { role: 'member', channels: ['c1', 'c2'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.act = { c: {}, p: {}, w: 0, u: 0 };
    store.workspaces = [{ id: REF, name: 'Globex' }];
  };
  store.openWorkspace = async () => { open(); store.emit('workspace'); };
  store.startPolling = () => {};
  store.pokeSync = () => {};
  return { store, open, dom };
}

afterEach(() => {
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
});

describe('Files & links leaves the app\'s own permalinks out', () => {
  it('lists the shared address of a message and not the link back into this workspace beside it', async () => {
    const here = `https://app.test/#/ws/${encodeURIComponent(REF)}/c/c1/t/5`;
    const elsewhere = `https://app.test/#/ws/${encodeURIComponent('zzzz999999@teamchat-other')}/c/c9/m/2`;
    const foreign = `https://evil.example/#/ws/${encodeURIComponent(REF)}/c/c1/m/3`;
    const { open, dom: d } = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/files`,
      routes: {
        '/search': (q) => json(q.get('has') === 'link'
          ? { results: [
            { conv: 'c1', seq: 7, ts: 4000, user: 'u-me', text: `reply from me, also sent to the channel\n\n> Also sent from ${here}` },
            { conv: 'c1', seq: 6, ts: 3000, user: 'u-dan', text: `see https://example.org/spec and ${here}` },
            { conv: 'c2', seq: 2, ts: 2000, user: 'u-dan', text: `their thread ${elsewhere} and a look-alike ${foreign}` },
          ], indexed: true }
          : { results: [], indexed: true }),
      },
    });
    open();
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const page = createFilesPage();
    document.body.append(page.el);
    await d.tick(5);
    const names = [...page.el.querySelectorAll('.files-text strong')].map((n) => n.textContent);
    // The permalink into this workspace is gone from both messages; a link
    // into another workspace, and a foreign host wearing this workspace's
    // fragment, stay listed as the addresses they are.
    expect(names).toEqual(['https://example.org/spec', elsewhere.length > 80 ? `${elsewhere.slice(0, 77)}...` : elsewhere, foreign.length > 80 ? `${foreign.slice(0, 77)}...` : foreign]);
    // The message that held only the permalink leaves no row at all, and no
    // empty state either while other links are shown.
    expect(page.el.querySelectorAll('.files-row').length).toBe(3);
    page.destroy();
  });
});

describe('search snippets read as the message does', () => {
  it('takes the renderer\'s marks off the line and still marks the words', async () => {
    const { highlightSnippet } = await import('../src/lib/format.js');
    expect(highlightSnippet('also `code` and **bold** here', ['bold'])).toBe('also code and <mark>bold</mark> here');
    expect(highlightSnippet('Lead check **bold** _it_ ~gone~ `code`', ['gone'])).toBe('Lead check bold it <mark>gone</mark> code');
    // A quoted line loses its mark; a fenced block keeps its code (the index
    // reads it) and loses only the fences.
    expect(highlightSnippet('> quoted words\n\n```js\nconst a = 1;\n```', ['const'])).toBe('quoted words <mark>const</mark> a = 1;');
    // Underscores inside an address are the address's own, as in the message.
    expect(highlightSnippet('see https://example.org/x_y today', ['today'])).toBe('see https://example.org/x_y <mark>today</mark>');
    // Marks around the very word searched for do not keep it from being found.
    expect(highlightSnippet('a **needle** in the hay', ['needle'])).toBe('a <mark>needle</mark> in the hay');
  });
});

describe('previews read a permalink into this workspace as words', () => {
  it('previewText and highlightSnippet take an appLink naming, and leave every other address alone', async () => {
    const { previewText, highlightSnippet } = await import('../src/lib/format.js');
    const name = (u) => (u.endsWith('/t/5') ? 'thread in #general' : null);
    expect(previewText('reply from me\n\n> Also sent from https://app.test/#/ws/x/c/c1/t/5', 160, { appLink: name })).toBe('reply from me Also sent from thread in #general');
    expect(previewText('see https://example.org/spec and https://app.test/#/ws/x/c/c1/t/5.', 160, { appLink: name })).toBe('see https://example.org/spec and thread in #general.');
    // An address in a code span is code, and stays as written.
    expect(previewText('run `curl https://app.test/#/ws/x/c/c1/t/5` now', 160, { appLink: name })).toBe('run curl https://app.test/#/ws/x/c/c1/t/5 now');
    // Without a naming, as before.
    expect(previewText('at https://app.test/#/ws/x/c/c1/t/5', 160)).toBe('at https://app.test/#/ws/x/c/c1/t/5');
    expect(highlightSnippet('reply from me Also sent from https://app.test/#/ws/x/c/c1/t/5', ['reply'], 180, { appLink: name })).toBe('<mark>reply</mark> from me Also sent from thread in #general');
  });

  it('previewWords names what this client can name: this workspace, a conversation it may read, from this app', async () => {
    const { open } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    open();
    const { previewWords, appLinkWords } = await import('../src/ui/applink.js');
    const here = `https://app.test/#/ws/${encodeURIComponent(REF)}`;
    expect(appLinkWords(`${here}/c/c1/t/5`)).toBe('thread in #general');
    expect(appLinkWords(`${here}/c/c2/m/7`)).toBe('message in #ops');
    expect(appLinkWords(`${here}/c/c1/t/5/m/9`)).toBe('reply in #general');
    expect(appLinkWords(`${here}/c/c1`)).toBe('#general');
    // A channel this member is not in, another workspace, and a foreign host
    // wearing this workspace's fragment keep their address.
    expect(appLinkWords(`${here}/c/c9/m/2`)).toBeNull();
    expect(appLinkWords(`https://app.test/#/ws/${encodeURIComponent('zzzz999999@teamchat-other')}/c/c1/m/2`)).toBeNull();
    expect(appLinkWords(`https://evil.example/#/ws/${encodeURIComponent(REF)}/c/c1/m/3`)).toBeNull();
    expect(appLinkWords('https://example.org/spec')).toBeNull();
    expect(previewWords(`reply from me\n\n> Also sent from ${here}/c/c1/t/5`, 160)).toBe('reply from me Also sent from thread in #general');
    expect(previewWords(`fyi\n\n> quoted words\n\n${here}/c/c2/m/7`, 160)).toBe('fyi quoted words message in #ops');
  });
});

describe('the Integrations dialog and a private channel the admin is not in', () => {
  it('names the withheld channel plainly and keeps Rotate for an admin in it', async () => {
    const { open, dom: d } = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/c/c1`,
      routes: {
        '/webhooks': () => json({
          webhooks: [
            { id: 'w1', name: 'Deploys', ch: null, private: true, lastUsed: 0 },
            { id: 'w2', name: 'Alerts', ch: 'c1', lastUsed: 0 },
          ],
          bots: [{ id: 'b1', name: 'Reader', channels: ['c1'], hidden: 2, scopes: ['read'], lastUsed: 0 }],
        }),
      },
    });
    open();
    const { store } = await import('../src/lib/store.js');
    store.me.role = 'admin';
    const { integrationsDialog } = await import('../src/ui/dialogs.js');
    integrationsDialog();
    await d.tick(10);
    const rows = [...document.querySelectorAll('.details-row .details-text')].map((n) => n.textContent);
    expect(rows.find((t) => t.startsWith('Deploys'))).toContain('a private channel you are not in');
    expect(rows.find((t) => t.startsWith('Deploys'))).not.toContain('#?');
    expect(rows.find((t) => t.startsWith('Alerts'))).toContain('#general');
    expect(rows.find((t) => t.startsWith('Reader'))).toContain('#general, 2 private channels you are not in');
    // Rotate is not theirs for the withheld webhook and the bot; it is for the webhook they can see.
    const manage = (name) => [...document.querySelectorAll('button[aria-label^="Manage "]')].find((b) => b.getAttribute('aria-label') === `Manage ${name}`);
    const rotateState = async (name) => {
      manage(name).click();
      await d.tick(5);
      const item = [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Rotate token'));
      // Dimmed and inert (aria-disabled), still in the menu's walk, rather than a disabled button.
      const state = { disabled: item?.getAttribute('aria-disabled') === 'true', sub: item?.querySelector('.menu-sub')?.textContent || '' };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await d.tick(5);
      return state;
    };
    expect(await rotateState('Deploys')).toEqual({ disabled: true, sub: 'An admin in its private channel can rotate it' });
    expect(await rotateState('Reader')).toEqual({ disabled: true, sub: 'An admin in its private channel can rotate it' });
    expect(await rotateState('Alerts')).toEqual({ disabled: false, sub: 'The current token stops working' });
  });
});
