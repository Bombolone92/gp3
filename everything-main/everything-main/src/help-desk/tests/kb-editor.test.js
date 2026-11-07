/** The knowledge base article editor in jsdom, over a stubbed API. */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../src/app.js';
import * as kb from '../src/views/kb.js';
import { installShortcuts } from '../src/ui/shortcuts.js';
import { isMac } from '../src/ui/dom.js';

installShortcuts();
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
function fakeReplica(articles) {
  const t = new EventTarget();
  t.articles = new Map(articles.map((a) => [a.id, a]));
  t.cfg = { kb: { categories: [], sections: [] } };
  t.upsert = (k, a) => t.articles.set(a.id, a);
  t.drop = () => {};
  t.isAdmin = () => true;
  return t;
}
const pressSave = (target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: isMac, ctrlKey: !isMac, bubbles: true, cancelable: true }));

let cleanup = null;
let main = null;
function mountEditor(sub) {
  main = document.createElement('main');
  document.body.append(main);
  app.ref = 'x/y';
  app.helpCenterUrl = () => null;
  cleanup = kb.mount(main, { sub, route: { query: {} } });
}
afterEach(() => {
  cleanup?.();
  main?.remove();
  localStorage.clear();
});

describe('knowledge base editor', () => {
  it('does not save an article that has not loaded yet', async () => {
    const posts = [];
    app.replica = fakeReplica([{ id: 7, title: 'Draft A', status: 'draft', section: null, labels: [] }]);
    app.api = { get: () => new Promise(() => {}), post: async (path, body) => { posts.push([path, body]); return { article: { id: 7, ...body } }; } };
    mountEditor(['articles', '7', 'edit']);
    pressSave(main.querySelector('input'));
    await tick(10);
    expect(posts).toEqual([]);
  });

  it('creates a new article once when save is pressed twice', async () => {
    const posts = [];
    let n = 100;
    app.replica = fakeReplica([]);
    app.api = { get: async () => ({}), post: (path, body) => { posts.push([path, body]); return new Promise((r) => setTimeout(() => r({ article: { id: ++n, ...body } }), 20)); } };
    mountEditor(['new']);
    await tick(5);
    const title = main.querySelector('input.kb-title-input');
    title.value = 'New thing';
    title.dispatchEvent(new Event('input'));
    pressSave(title);
    pressSave(title);
    await tick(50);
    expect(posts.filter((p) => p[0] === '/articles').length).toBe(1);
  });
});

describe('knowledge base editor messages', () => {
  it('says a draft was published, and a live article updated', async () => {
    const shown = [];
    const observer = new MutationObserver(() => {
      for (const t of document.querySelectorAll('.toast-text')) if (!shown.includes(t.textContent)) shown.push(t.textContent);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    for (const status of ['draft', 'published']) {
      app.replica = fakeReplica([{ id: 8, title: 'D', status, section: null, labels: [] }]);
      app.api = { get: async () => ({ article: { id: 8, title: 'D', status, section: null, labels: [] }, body: '<p>hello</p>' }), post: async (path, body) => ({ article: { id: 8, ...body } }) };
      mountEditor(['articles', '8', 'edit']);
      await tick(20);
      main.querySelector('.kb-editor-bar .btn-primary').click();
      await tick(20);
      cleanup();
      main.remove();
      cleanup = null;
    }
    observer.disconnect();
    expect(shown).toContain('Article published.');
    expect(shown).toContain('Article updated in the help center.');
  });
});

describe('knowledge base article page', () => {
  it('does not publish an empty article', async () => {
    const posts = [];
    app.replica = fakeReplica([{ id: 9, title: 'Empty', status: 'draft', section: null, labels: [] }]);
    app.memberName = () => 'Olivia';
    app.api = { get: async () => ({ article: { id: 9, title: 'Empty', status: 'draft', section: null, labels: [] }, body: '' }), post: async (path, body) => { posts.push(body); return { article: { id: 9, title: 'Empty', ...body } }; } };
    mountEditor(['articles', '9']);
    await tick(30);
    const publish = [...main.querySelectorAll('.kb-actions button')].find((b) => b.textContent.includes('Publish'));
    publish.click();
    await tick(20);
    expect(posts).toEqual([]);
    expect(document.body.textContent).toContain('Write the article before publishing it.');
    // The article is not a live region that would be read out on each repaint.
    expect(main.querySelector('[aria-live]')).toBeNull();
  });
});
