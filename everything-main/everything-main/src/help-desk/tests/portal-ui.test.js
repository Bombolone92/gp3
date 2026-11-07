/**
 * The public help center in jsdom, over a stubbed fetch to its server.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountPortal } from '../src/portal/portal.js';
import { parse } from '../src/ui/router.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
function json(body, status = 200) {
  return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body };
}
const KEY = 'k'.repeat(24);
const baseInfo = () => ({ desk: 'desk111', name: 'Acme', portal: { enabled: true, title: 'Acme Help' }, kb: { categories: [], sections: [] }, fields: [] });
const ticket = (over = {}) => ({ id: 5, subject: 'Help', status: 'open', createdAt: 1, updatedAt: 1, csat: null, csatEnabled: true, followUp: null, ...over });

let root = null;
afterEach(() => {
  root?.remove();
  root = null;
  vi.useRealTimers();
});

/** Mount the help center at `hash` with `routes(method, path, body)` answering fetches. */
async function mount(hash, routes, info = baseInfo()) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push(`${method} ${u.pathname}`);
    if (u.pathname === '/p/desk111') return json(info);
    if (u.pathname === '/p/desk111/articles') return json({ articles: [] });
    const res = await routes?.(method, u.pathname, init.body ? JSON.parse(init.body) : null);
    return res || json({}, 404);
  });
  location.hash = hash;
  root = document.createElement('div');
  document.body.append(root);
  mountPortal(root, parse());
  await tick(20);
  return calls;
}

describe('request form', () => {
  it('requires a required checkbox before sending', async () => {
    const info = baseInfo();
    info.fields = [{ id: 'terms', title: 'I accept the terms', type: 'checkbox', required: true }];
    const calls = await mount('#/help/hd-a/desk111/new', () => json({ id: 9, key: KEY }), info);
    const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type(root.querySelector('input[type=email]'), 'ann@x.io');
    for (const el of root.querySelectorAll('input.input:not([type=email]), textarea')) type(el, 'Something');
    const submit = [...root.querySelectorAll('button')].find((b) => /submit request/i.test(b.textContent));
    submit.click();
    await tick(20);
    const box = root.querySelector('input[type=checkbox]');
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false);
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(root.textContent).toContain('I accept the terms is required');
    box.checked = true;
    submit.click();
    await tick(20);
    expect(calls.filter((c) => c === 'POST /p/desk111/requests').length).toBe(1);
  });
});

describe('sign-in required', () => {
  it('offers to sign in instead of a form that cannot be sent', async () => {
    const info = baseInfo();
    info.portal.signInRequired = true;
    let signedIn = false;
    window.puter = { auth: { isSignedIn: () => signedIn, signIn: async () => { signedIn = true; }, getUser: async () => ({ uuid: 'u1', username: 'ann', email: 'ann@x.io' }) } };
    try {
      await mount('#/help/hd-a/desk111/new', null, info);
      expect(root.querySelector('form')).toBeNull();
      const btn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Sign in with Puter');
      btn.click();
      await tick(30);
      expect(root.querySelector('form.hc-form')).toBeTruthy();
    } finally {
      delete window.puter;
    }
  });
});

describe('navigation', () => {
  it('starts each page at the top', async () => {
    await mount('#/help/hd-a/desk111');
    root.scrollTop = 800;
    location.hash = '#/help/hd-a/desk111/requests';
    await tick(30);
    expect(root.scrollTop).toBe(0);
  });

  it('drops a page that finishes loading after the visitor moved on', async () => {
    const arts = [{ id: 1, title: 'One', section: null, labels: [] }, { id: 2, title: 'Two', section: null, labels: [] }];
    const resolvers = {};
    globalThis.fetch = vi.fn(async (url) => {
      const u = new URL(url);
      if (u.pathname === '/p/desk111') return json(baseInfo());
      if (u.pathname === '/p/desk111/articles') return json({ articles: arts });
      const m = /articles\/(\d)$/.exec(u.pathname);
      if (m) return new Promise((r) => { resolvers[m[1]] = () => r(json({ article: arts[m[1] - 1], body: `<p>Body ${m[1]}</p>` })); });
      return json({}, 404);
    });
    location.hash = '#/help/hd-a/desk111/articles/1';
    root = document.createElement('div');
    document.body.append(root);
    mountPortal(root, parse());
    await tick(10);
    location.hash = '#/help/hd-a/desk111/articles/2';
    await tick(10);
    resolvers['2']();
    await tick(10);
    resolvers['1']();
    await tick(10);
    expect([...root.querySelectorAll('main h1')].map((x) => x.textContent)).toEqual(['Two']);
    expect(document.title).toMatch(/^Two/);
  });
});

describe('request page', () => {
  function requestRoutes(state) {
    return (method, path) => {
      if (path === '/p/desk111/requests/5' && method === 'GET') {
        if (state.failGet) throw new TypeError('network');
        return json({ ticket: state.ticket, requester: { name: 'Ann' }, events: state.events });
      }
      if (path.endsWith('/comments')) {
        state.posts++;
        state.events = [...state.events, { id: `x${state.events.length}`, at: 2, html: '<p>r</p>', by: { type: 'customer', name: 'Ann' } }];
        return json({ ticket: state.ticket });
      }
      if (path.endsWith('/solve')) return json({ ticket: { ...state.ticket, status: 'solved' } });
      if (path.endsWith('/rate')) return json({ ticket: state.ticket });
      return null;
    };
  }
  const hash = `#/help/hd-a/desk111/requests/5?key=${KEY}`;
  const typeIn = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };

  it('does not invite sending a reply twice when the refresh after it fails', async () => {
    const state = { posts: 0, ticket: ticket(), events: [{ id: 'a', at: 1, html: '<p>hi</p>', by: { type: 'customer', name: 'Ann' } }] };
    await mount(hash, requestRoutes(state));
    const text = root.querySelector('.hc-reply textarea');
    const send = root.querySelector('.hc-reply .btn-primary');
    typeIn(text, 'My reply');
    state.failGet = true;
    send.click();
    await tick(20);
    expect(text.value).toBe('');
    expect(send.disabled).toBe(true);
    send.click();
    await tick(20);
    expect(state.posts).toBe(1);
  });

  it('keeps a half-written reply when the page refreshes or is marked solved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const state = { posts: 0, ticket: ticket(), events: [{ id: 'a', at: 1, html: '<p>hi</p>', by: { type: 'customer', name: 'Ann' } }] };
    await mount(hash, requestRoutes(state));
    typeIn(root.querySelector('.hc-reply textarea'), 'half-written reply');
    root.querySelector('.hc-reply textarea').blur();
    state.ticket = ticket({ updatedAt: 99 });
    state.events = [...state.events, { id: 'b', at: 3, html: '<p>agent</p>', by: { type: 'agent', name: 'Bo' } }];
    await vi.advanceTimersByTimeAsync(30500);
    expect(root.textContent).toContain('agent');
    expect(root.querySelector('.hc-reply textarea').value).toBe('half-written reply');
    expect(root.querySelector('.hc-reply .btn-primary').disabled).toBe(false);
    [...root.querySelectorAll('.hc-reply button')].find((b) => b.textContent.includes('Mark as solved')).click();
    await tick(20);
    expect(root.querySelector('.hc-reply textarea').value).toBe('half-written reply');
  });

  it('keeps keyboard focus after replying, solving and rating', async () => {
    const state = { posts: 0, ticket: ticket(), events: [{ id: 'a', at: 1, html: '<p>hi</p>', by: { type: 'customer', name: 'Ann' } }] };
    await mount(hash, requestRoutes(state));
    const text = root.querySelector('.hc-reply textarea');
    typeIn(text, 'Thanks');
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await tick(30);
    expect(document.activeElement).toBe(root.querySelector('.hc-reply textarea'));
    [...root.querySelectorAll('.hc-reply button')].find((b) => b.textContent.includes('Mark as solved')).click();
    await tick(30);
    expect(document.activeElement.classList.contains('hc-rate-btn')).toBe(true);
    document.activeElement.click();
    root.querySelector('.hc-rate .btn-primary').click();
    await tick(30);
    expect(document.activeElement.textContent).toBe('Change rating');
    document.activeElement.click();
    expect(document.activeElement.classList.contains('hc-rate-btn')).toBe(true);
  });

  it('starts a changed rating from the comment already sent', async () => {
    const state = { posts: 0, ticket: ticket({ status: 'solved', csat: { score: 'bad', comment: 'Took three days' } }), events: [] };
    await mount(hash, requestRoutes(state));
    [...root.querySelectorAll('.hc-rate button')].find((b) => b.textContent === 'Change rating').click();
    expect(root.querySelector('.hc-rate textarea').value).toBe('Took three days');
  });

  it('keeps a rating comment when the rating is switched', async () => {
    const state = { posts: 0, ticket: ticket({ status: 'solved' }), events: [] };
    await mount(hash, requestRoutes(state));
    root.querySelector('.hc-rate-btn').click();
    typeIn(root.querySelector('.hc-rate textarea'), 'Quick and kind');
    root.querySelectorAll('.hc-rate-btn')[1].click();
    expect(root.querySelector('.hc-rate textarea').value).toBe('Quick and kind');
  });
});

describe('loading', () => {
  it('shows progress while a page loads, then only the page', async () => {
    let release;
    globalThis.fetch = vi.fn(async (url) => {
      const u = new URL(url);
      if (u.pathname === '/p/desk111') return json(baseInfo());
      if (u.pathname === '/p/desk111/articles') return json({ articles: [{ id: 1, title: 'One', section: null, labels: [] }] });
      if (u.pathname === '/p/desk111/articles/1') return new Promise((r) => { release = () => r(json({ article: { id: 1, title: 'One', section: null, labels: [] }, body: '<p>Body</p>' })); });
      return json({}, 404);
    });
    location.hash = '#/help/hd-a/desk111/articles/1';
    root = document.createElement('div');
    document.body.append(root);
    mountPortal(root, parse());
    await tick(250);
    const spinner = root.querySelector('main .hc-loading');
    expect(spinner && !spinner.hidden).toBe(true);
    release();
    await tick(20);
    expect(root.querySelector('main .hc-loading')).toBeNull();
    expect(root.querySelector('main h1').textContent).toBe('One');
  });
});

describe('phone menu', () => {
  it('opens Appearance from the menu button and returns there', async () => {
    await mount('#/help/hd-a/desk111');
    const menuBtn = root.querySelector('.hc-menu-btn');
    menuBtn.click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Appearance')).click();
    await tick(10);
    expect(menuBtn.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.hc-theme').getAttribute('aria-expanded')).toBe('false');
    document.querySelector('.popover').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(menuBtn);
  });
});
