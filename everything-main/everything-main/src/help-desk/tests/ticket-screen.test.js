/**
 * The ticket screen in jsdom: drafts, field edits, shortcuts and submits,
 * over the real app, backend and replica on the dev mock of the Puter SDK.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import axe from 'axe-core';

let app;
let unmount;
const root = document.createElement('div');
const tickets = [];

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 3000 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for the UI');
    await tick(20);
  }
}

async function go(hash) {
  location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await tick(30);
}

function typeInto(el, text) {
  el.focus();
  el.innerHTML = `<p>${text}</p>`;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeAll(async () => {
  localStorage.clear();
  await import('../dev/mock-puter.js');
  ({ app } = await import('../src/app.js'));
  const { mountShell } = await import('../src/views/shell.js');
  const { installShortcuts } = await import('../src/ui/shortcuts.js');
  const { currentUser } = await import('../src/client/puter.js');
  installShortcuts();
  document.body.append(root);
  app.user = await currentUser();
  await app.loadDoc();
  const desk = await app.createDesk({ name: 'Screen Desk', agentName: 'Olivia Owner' });
  await app.openDesk('local', desk);
  for (const [subject, email] of [['Alpha', 'a@example.com'], ['Bravo', 'b@example.com'], ['Charlie', 'c@example.com']]) {
    const res = await app.api.post('/tickets', { subject, requester: { email, name: email[0] }, comment: { html: `<p>${subject}</p>`, public: true } });
    app.replica.upsert('t', res.ticket);
    app.replica.upsert('u', res.requester);
    tickets.push(res.ticket);
  }
  location.hash = '#/home';
  unmount = mountShell(root);
  await tick(50);
});

afterAll(() => {
  unmount?.();
  app.replica?.close();
});

afterEach(async () => {
  await go('#/home');
  for (const t of tickets) app.drafts.delete(String(t.id));
  app.drafts.delete('new');
});

describe('ticket screen', () => {
  it('reopens a ticket with a saved reply draft', async () => {
    const t = tickets[0];
    await go(`#/tickets/${t.id}`);
    const editor = await until(() => root.querySelector('.editor-content'));
    typeInto(editor, 'Half written reply');
    await go('#/home');
    await go(`#/tickets/${t.id}`);
    const again = await until(() => root.querySelector('.editor-content'));
    expect(again.textContent).toContain('Half written reply');
    expect(root.querySelector('.submit-main')).toBeTruthy();
    expect(root.querySelector('.t-head').textContent).toContain('Alpha');
  });

  it('keeps every custom text field edited in a row', async () => {
    app.replica.setConfig('fields', [
      { id: 'order', title: 'Order number', type: 'text', active: true },
      { id: 'product', title: 'Product', type: 'text', active: true },
    ]);
    const t = tickets[0];
    await go(`#/tickets/${t.id}`);
    await until(() => root.querySelector('.t-props input[id*="order"]'));
    const order = root.querySelector('.t-props input[id*="order"]');
    const product = root.querySelector('.t-props input[id*="product"]');
    order.value = 'A-123';
    order.dispatchEvent(new Event('input', { bubbles: true }));
    product.value = 'Widget';
    product.dispatchEvent(new Event('input', { bubbles: true }));
    await go('#/home');
    expect(app.drafts.get(String(t.id))?.patch?.fields).toEqual({ order: 'A-123', product: 'Widget' });
    app.replica.setConfig('fields', []);
  });

  it('stays where the agent went when a submit finishes later', async () => {
    const t = tickets[1];
    localStorage.setItem('help-desk:after-submit', 'close');
    const real = app.updateTicket;
    let release;
    app.updateTicket = (...args) => new Promise((r) => { release = () => r(real.apply(app, args)); });
    try {
      await go(`#/tickets/${t.id}`);
      typeInto(await until(() => root.querySelector('.editor-content')), 'On its way');
      root.querySelector('.submit-main').click();
      await tick(10);
      await go('#/views');
      release();
      await tick(60);
      expect(location.hash).toMatch(/^#\/views/);
      expect(app.drafts.get(String(t.id))).toBeUndefined();
    } finally {
      app.updateTicket = real;
      localStorage.removeItem('help-desk:after-submit');
    }
  });

  it('keeps field changes made while a submit is saving, and locks the sent reply', async () => {
    const t = tickets[2];
    const real = app.updateTicket;
    let release;
    app.updateTicket = (...args) => new Promise((r) => { release = () => r(real.apply(app, args)); });
    try {
      await go(`#/tickets/${t.id}`);
      const editor = await until(() => root.querySelector('.editor-content'));
      typeInto(editor, 'First answer');
      root.querySelector('.submit-main').click();
      await tick(10);
      // Typing more into the reply being sent is not possible meanwhile.
      expect(editor.getAttribute('contenteditable')).toBe('false');
      const label = [...root.querySelectorAll('.t-props label')].find((l) => l.textContent === 'Priority');
      document.getElementById(label.htmlFor).click();
      [...document.querySelectorAll('.picker-option')].find((o) => o.textContent === 'Low').click();
      release();
      await until(() => !root.querySelector('.submit-main').disabled);
      await tick(30);
      expect(editor.getAttribute('contenteditable')).toBe('true');
      expect(editor.textContent).toBe('');
      expect(app.drafts.get(String(t.id))?.patch).toEqual({ priority: 'low' });
    } finally {
      app.updateTicket = real;
      app.drafts.delete(String(t.id));
    }
  });

  it('keeps customer notes being typed when other records change', async () => {
    const t = tickets[0];
    await go(`#/tickets/${t.id}`);
    const notes = await until(() => root.querySelector('.ctx-notes'));
    notes.focus();
    notes.value = 'Prefers email';
    // A change to another customer, then to this ticket's own customer.
    const other = app.replica.users.get(tickets[1].requester);
    app.replica.upsert('u', { ...other, updatedAt: Date.now() });
    expect(root.querySelector('.ctx-notes')).toBe(notes);
    const mine = app.replica.users.get(t.requester);
    app.replica.upsert('u', { ...mine, name: 'Ann Renamed', updatedAt: Date.now() });
    expect(root.querySelector('.ctx-notes')).toBe(notes);
    expect(document.activeElement).toBe(notes);
    // Once the agent leaves the field, the panel catches up.
    notes.blur();
    await tick(10);
    expect(root.querySelector('.t-context').textContent).toContain('Ann Renamed');
  });

  it('only updates the presence line when who is viewing changes', async () => {
    const api = app.api;
    const realPost = api.post;
    const members = app.replica.members;
    Object.defineProperty(api, 'isLocal', { value: false, configurable: true });
    app.replica.members = { ...members, other: { name: 'Ben', role: 'agent' } };
    const viewers = [{ name: 'Ben', typing: false }];
    api.post = async (path, body) => (path.endsWith('/presence') ? { viewers } : realPost.call(api, path, body));
    try {
      await go(`#/tickets/${tickets[2].id}`);
      const line = await until(() => root.querySelector('.t-presence span.presence') && root.querySelector('.t-presence'));
      const shown = line.firstChild;
      const editor = root.querySelector('.editor-content');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      await tick(20);
      expect(line.firstChild).toBe(shown);
      expect(line.textContent).toContain('Ben is also viewing');
    } finally {
      api.post = realPost;
      delete api.isLocal;
      app.replica.members = members;
    }
  });

  it('appends new messages to the conversation instead of redrawing it', async () => {
    const t = tickets[2];
    await go(`#/tickets/${t.id}`);
    const first = await until(() => root.querySelector('.t-events .ev-comment'));
    typeInto(root.querySelector('.editor-content'), 'Another reply');
    root.querySelector('.submit-main').click();
    await until(() => root.querySelector('.t-events').textContent.includes('Another reply'));
    expect(first.isConnected).toBe(true);
  });

  it('drops a subject edit when the subject is changed back', async () => {
    const t = tickets[1];
    await go(`#/tickets/${t.id}`);
    const title = await until(() => root.querySelector('.t-subject'));
    const rename = async (text) => {
      root.querySelector('.t-subject').click();
      const input = await until(() => document.querySelector('dialog[open] input'));
      input.value = text;
      document.querySelector('dialog[open] form').requestSubmit();
      await tick(20);
    };
    expect(title.textContent).toBe('Bravo');
    await rename('Bravo (urgent)');
    await rename('Bravo');
    await go('#/home');
    expect(app.drafts.get(String(t.id))?.patch?.subject).toBeUndefined();
  });

  it('saves a cleared custom field through a JSON request', async () => {
    const defs = [{ id: 'order', title: 'Order number', type: 'text', active: true }];
    await app.api.put('/cfg/fields', { value: defs });
    app.replica.setConfig('fields', defs);
    const t = tickets[0];
    const set = await app.api.post(`/tickets/${t.id}`, { patch: { fields: { order: 'A-1' } } });
    app.replica.upsert('t', set.ticket);
    const real = app.updateTicket;
    // A desk on a server gets the body as JSON, which drops undefined values.
    app.updateTicket = (id, body) => real.call(app, id, JSON.parse(JSON.stringify(body)));
    try {
      await go(`#/tickets/${t.id}`);
      const input = await until(() => root.querySelector('.t-props input[id*="order"]'));
      expect(input.value).toBe('A-1');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      root.querySelector('.submit-main').click();
      await until(() => !app.drafts.get(String(t.id)));
      await tick(30);
      const stored = (await app.api.get(`/tickets/${t.id}`)).ticket;
      expect(stored.fields?.order).toBeUndefined();
    } finally {
      app.updateTicket = real;
      await app.api.put('/cfg/fields', { value: [] });
      app.replica.setConfig('fields', []);
    }
  });

  it('sends only the custom fields the agent changed', async () => {
    const defs = [{ id: 'order', title: 'Order number', type: 'text', active: true }, { id: 'product', title: 'Product', type: 'text', active: true }];
    await app.api.put('/cfg/fields', { value: defs });
    app.replica.setConfig('fields', defs);
    const t = tickets[2];
    const set = await app.api.post(`/tickets/${t.id}`, { patch: { fields: { order: 'A-1', product: 'Old' } } });
    app.replica.upsert('t', set.ticket);
    const real = app.updateTicket;
    const sent = [];
    app.updateTicket = (id, body) => { sent.push(JSON.parse(JSON.stringify(body))); return real.call(app, id, body); };
    try {
      await go(`#/tickets/${t.id}`);
      const input = await until(() => root.querySelector('.t-props input[id*="product"]'));
      input.value = 'New';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      root.querySelector('.submit-main').click();
      await until(() => sent.length);
      expect(sent[0].patch.fields).toEqual({ product: 'New' });
    } finally {
      app.updateTicket = real;
      await app.api.put('/cfg/fields', { value: [] });
      app.replica.setConfig('fields', []);
    }
  });

  it('moves between context tabs with the arrow keys', async () => {
    await go(`#/tickets/${tickets[0].id}`);
    const bar = await until(() => root.querySelector('.ctx-tabs'));
    const selected = () => root.querySelector('.ctx-tabs [aria-selected="true"]');
    selected().focus();
    expect(selected().getAttribute('aria-label')).toBe('Customer');
    expect([...bar.querySelectorAll('[role=tab]')].map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    selected().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(selected().getAttribute('aria-label')).toBe('Knowledge');
    expect(document.activeElement).toBe(selected());
    expect(root.querySelector(`#${selected().getAttribute('aria-controls')}`).getAttribute('role')).toBe('tabpanel');
    selected().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(selected().getAttribute('aria-label')).toBe('Customer');
  });

  it('keeps focus on a property after choosing its value', async () => {
    const t = tickets[2];
    await go(`#/tickets/${t.id}`);
    const label = await until(() => [...root.querySelectorAll('.t-props label')].find((l) => l.textContent === 'Priority'));
    const btn = document.getElementById(label.htmlFor);
    btn.focus();
    btn.click();
    [...document.querySelectorAll('.picker-option')].find((o) => o.textContent === 'Urgent').click();
    expect(document.activeElement.classList.contains('select-btn')).toBe(true);
    expect([...document.activeElement.labels].map((l) => l.textContent)).toEqual(['Priority']);
  });

  it('starts the next new ticket empty after creating one', async () => {
    app.drafts.set('new', { html: '<p>Printer is on fire</p>', patch: {}, mode: 'public', attachments: [], subject: 'Fire', requester: tickets[0].requester });
    await go('#/tickets/new');
    const btn = await until(() => root.querySelector('.submit-main'));
    btn.click();
    await until(() => /^#\/tickets\/\d+$/.test(location.hash));
    await tick(30);
    expect(app.drafts.get('new')).toBeUndefined();
  });

  it('lets go of a draft when its tab is closed', async () => {
    const t = tickets[1];
    await go(`#/tickets/${t.id}`);
    typeInto(await until(() => root.querySelector('.editor-content')), 'Half a reply');
    const close = [...root.querySelectorAll('.tab-close')].find((b) => b.getAttribute('aria-label').includes(t.subject));
    close.click();
    await tick(30);
    expect(location.hash).not.toBe(`#/tickets/${t.id}`);
    expect(app.drafts.get(String(t.id))).toBeUndefined();
  });

  it('keeps keyboard focus in the header and fields when the ticket changes live', async () => {
    const t = tickets[0];
    await go(`#/tickets/${t.id}`);
    const more = await until(() => root.querySelector('.t-head [aria-label="More ticket actions"]'));
    more.focus();
    const bump = (over = {}) => {
      const cur = app.replica.tickets.get(t.id);
      app.replica.upsert('t', { ...cur, ...over, updatedAt: cur.updatedAt + 1000, ver: (cur.ver || 0) + 1 });
    };
    bump();
    expect(document.activeElement.getAttribute('aria-label')).toBe('More ticket actions');
    const label = [...root.querySelectorAll('.t-props label')].find((l) => l.textContent === 'Priority');
    document.getElementById(label.htmlFor).focus();
    bump({ priority: 'low' });
    expect([...document.activeElement.labels].map((l) => l.textContent)).toEqual(['Priority']);
  });

  it('finds any open ticket to merge into, not only the first 300', async () => {
    const many = Array.from({ length: 320 }, (_, i) => ({ id: 9000 + i, subject: `Old ${i}`, status: 'open', requester: 999, tags: [], createdAt: i + 1, updatedAt: i + 1, ver: 1 }));
    app.replica.upsertMany('t', many);
    try {
      await go(`#/tickets/${tickets[0].id}`);
      (await until(() => root.querySelector('[aria-label="More ticket actions"]'))).click();
      [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Merge into another ticket')).click();
      const pick = await until(() => document.querySelector('dialog[open] .select-btn'));
      pick.click();
      const search = await until(() => document.querySelector('.picker-search'));
      search.value = '#9000';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await tick(300);
      expect([...document.querySelectorAll('.picker-option')].map((o) => o.textContent)).toContainEqual(expect.stringContaining('#9000 Old 0'));
    } finally {
      document.querySelector('.picker-search')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      [...document.querySelectorAll('dialog[open] .btn')].find((b) => b.textContent === 'Cancel')?.click();
      for (const x of many) app.replica.tickets.delete(x.id);
    }
  });

  it('waits for the writing assistant before submitting', async () => {
    const t = tickets[1];
    const chat = window.puter.ai.chat;
    let answer;
    window.puter.ai.chat = () => new Promise((r) => { answer = r; });
    try {
      await go(`#/tickets/${t.id}`);
      typeInto(await until(() => root.querySelector('.editor-content')), 'thx will fix');
      root.querySelector('[aria-label="Writing assistant"]').click();
      [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Improve writing')).click();
      await tick(10);
      const submit = root.querySelector('.submit-main');
      expect(submit.disabled).toBe(true);
      const sent = app.updateTicket;
      let calls = 0;
      app.updateTicket = (...args) => { calls++; return sent.apply(app, args); };
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, ctrlKey: true, bubbles: true }));
      await tick(10);
      expect(calls).toBe(0);
      delete app.updateTicket;
      answer({ message: { content: 'Thanks, we will fix it.' } });
      await until(() => !root.querySelector('.submit-main').disabled);
      expect(root.querySelector('.editor-content').textContent).toContain('Thanks, we will fix it.');
    } finally {
      window.puter.ai.chat = chat;
      delete app.updateTicket;
    }
  });

  it('has no serious accessibility violations', async () => {
    await go(`#/tickets/${tickets[1].id}`);
    await until(() => root.querySelector('.t-events .ev-comment'));
    const res = await axe.run(root, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
    const serious = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});

describe('shortcuts', () => {
  const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));

  it('leaves type-ahead in a menu to the menu', async () => {
    const t = tickets[1];
    await go(`#/tickets/${t.id}`);
    const more = await until(() => root.querySelector('[aria-label="More ticket actions"]'));
    more.click();
    await until(() => document.querySelector('.popover.menu'));
    key(document.activeElement, 'c');
    await tick(30);
    expect(location.hash).toBe(`#/tickets/${t.id}`);
    expect(document.activeElement.textContent).toMatch(/^Copy/);
    key(document.activeElement, 'Escape');
  });

  it('leaves Alt+Arrow to the editor while typing', async () => {
    await go(`#/tickets/${tickets[0].id}`);
    await go(`#/tickets/${tickets[1].id}`);
    const editor = await until(() => root.querySelector('.editor-content'));
    editor.focus();
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', altKey: true, bubbles: true, cancelable: true });
    editor.dispatchEvent(ev);
    await tick(30);
    expect(location.hash).toBe(`#/tickets/${tickets[1].id}`);
    expect(ev.defaultPrevented).toBe(false);
    // Outside a field it still moves between tabs.
    root.querySelector('.t-head').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }));
    await tick(30);
    expect(location.hash).not.toBe(`#/tickets/${tickets[1].id}`);
  });

  it('closes an open menu when the page changes', async () => {
    await go(`#/tickets/${tickets[2].id}`);
    const more = await until(() => root.querySelector('[aria-label="More ticket actions"]'));
    more.click();
    await until(() => document.querySelector('.popover.menu'));
    await go('#/home');
    expect(document.querySelector('.popover')).toBeNull();
  });

  it('Alt+Left from a list goes to the last tab, Alt+Right to the first', async () => {
    for (const t of tickets) await go(`#/tickets/${t.id}`);
    const ids = app.tabs.map((t) => String(t.id));
    await go('#/home');
    const press = (k) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, altKey: true, bubbles: true, cancelable: true }));
    press('ArrowLeft');
    await tick(30);
    expect(location.hash).toBe(`#/tickets/${ids[ids.length - 1]}`);
    await go('#/home');
    press('ArrowRight');
    await tick(30);
    expect(location.hash).toBe(`#/tickets/${ids[0]}`);
  });
});

describe('ticket table', () => {
  const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  it('leaves Enter on a column header to the sort button', async () => {
    await go('#/views/sys-unsolved');
    const firstRow = await until(() => root.querySelector('.tt tbody tr[data-id]'));
    firstRow.focus();
    const subject = [...root.querySelectorAll('.tt thead .sort-btn')].find((b) => b.textContent.includes('Subject'));
    subject.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    subject.dispatchEvent(ev);
    await tick(30);
    expect(location.hash).toMatch(/^#\/views/);
    expect(ev.defaultPrevented).toBe(false);
    // A live sync may have redrawn the rows meanwhile; press Enter on the one shown.
    key(root.querySelector('.tt tbody tr[data-id]'), 'Enter');
    await tick(30);
    expect(location.hash).toMatch(/^#\/tickets\//);
  });
});

describe('another help desk', () => {
  it('keeps each desk\'s reply drafts to itself', async () => {
    const t = tickets[0];
    await go(`#/tickets/${t.id}`);
    typeInto(await until(() => root.querySelector('.editor-content')), 'Refund approved for Alpha');
    await go('#/home');
    const [server, first] = app.ref.split('/');
    const other = await app.createDesk({ name: 'Other Desk', agentName: 'Olivia Owner' });
    await app.openDesk('local', other);
    await app.api.post('/tickets', { subject: 'Other ticket', requester: { email: 'z@example.com', name: 'Zed' }, comment: { html: '<p>Hi</p>', public: true } });
    expect(app.drafts.get(String(t.id))).toBeUndefined();
    expect(app.lastListRoute).toBe('#/views/sys-mine');
    await app.openDesk(server, first);
    expect(app.drafts.get(String(t.id))?.html).toContain('Refund approved for Alpha');
  });
});

describe('leaving the workspace', () => {
  it('asks before switching desks with unsaved changes', async () => {
    const { guardLeave } = await import('../src/ui/router.js');
    const unguard = guardLeave(() => true);
    const switches = [];
    const onSwitch = (e) => switches.push(e.detail);
    app.addEventListener('switch', onSwitch);
    try {
      root.querySelector('.desk-switch').click();
      [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Other Desk')).click();
      await until(() => document.querySelector('dialog[open]'));
      expect(document.querySelector('dialog[open]').textContent).toContain('Discard your changes?');
      [...document.querySelectorAll('dialog[open] .btn')].find((b) => b.textContent === 'Keep editing').click();
      await tick(30);
      expect(switches).toEqual([]);
    } finally {
      unguard();
      app.removeEventListener('switch', onSwitch);
    }
  });


  it('does not mount a screen that was still loading', async () => {
    const main = root.querySelector('main');
    location.hash = '#/reports';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    unmount();
    const count = main.childElementCount;
    await tick(200);
    expect(main.dataset.view).not.toBe('reports');
    expect(main.childElementCount).toBe(count);
    unmount = null;
  });
});
