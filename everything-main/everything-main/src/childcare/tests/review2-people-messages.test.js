// @vitest-environment jsdom
/** Second adversarial review: the Messages screen. */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { bootViews, go, app, tick, asFamily, asDirector } from './review2-people-harness.js';
import { messagesName, sendMessage } from '../src/core/messages.js';

const uploads = [];
vi.mock('../src/files.js', async (orig) => {
  const real = await orig();
  return {
    ...real,
    // A slow upload, as on a phone connection.
    saveFile: async (f) => {
      uploads.push(f.name);
      await new Promise((r) => setTimeout(r, 80));
      return { id: `att-${uploads.length}`, name: f.name, type: f.type, size: f.size, path: `messages/x/${f.name}` };
    },
    fileUrl: async () => 'blob:x',
  };
});

let main;
beforeAll(async () => {
  main = await bootViews();
});
afterEach(() => asDirector());

const kid = () => app.store.all('students').find((s) => s.status === 'active');

describe('messages', () => {
  it('pressing Enter twice while photos upload sends one message', async () => {
    const s = app.store.all('students').filter((x) => x.status === 'active')[1];
    await go(`#/messages/${s.id}`);
    const before = app.store.all(messagesName(s.id)).length;
    const form = main.querySelector('form.composer');
    const fileInput = form.querySelector('input[type=file]');
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['x'], 'park.png', { type: 'image/png' })] });
    fileInput.dispatchEvent(new Event('change'));
    const input = main.querySelector('.msg-input');
    input.value = 'Look at this';
    uploads.length = 0;
    const enter = () => main.querySelector('.msg-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    enter();
    await tick(10);
    enter();
    await tick(250);
    expect(uploads).toEqual(['park.png']);
    expect(app.store.all(messagesName(s.id)).length).toBe(before + 1);
    // The sent photo is no longer waiting in the composer.
    expect(main.querySelectorAll('.upload-thumb').length).toBe(0);
  });

  it('a draft in the composer survives a sync that redraws the conversation', async () => {
    const s = kid();
    await go(`#/messages/${s.id}`);
    const input = main.querySelector('.msg-input');
    input.focus();
    input.value = 'Ava had a great day, she';
    // Another device edits a child, which redraws the inbox.
    app.store.patch('students', app.store.all('students')[1].id, { dietary: 'Vegetarian' });
    await tick(30);
    const now = main.querySelector('.msg-input');
    expect(now.value).toBe('Ava had a great day, she');
    expect(document.activeElement).toBe(now);
  });

  it('typing in the conversation search with a conversation open keeps focus in the search', async () => {
    const s = app.store.all('students').filter((x) => x.status === 'active')[2];
    await go(`#/messages/${s.id}`);
    await tick(30);
    const search = main.querySelector('.inbox-tools input[type=search]');
    search.focus();
    search.value = 'a';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(250);
    expect(document.activeElement).toBe(main.querySelector('.inbox-tools input[type=search]'));
  });

  it('a family with two children can go back from a conversation to the list on a phone', async () => {
    const g = app.store.all('guardians').find((x) => (x.studentIds || []).filter((id) => app.store.get('students', id)?.status === 'active').length >= 2);
    asFamily(g);
    await go('#/messages');
    await go('#/messages?x=1');
    expect(main.querySelector('.inbox').classList.contains('has-thread')).toBe(true);
    main.querySelector('[aria-label="Back to conversations"]').click();
    await tick(30);
    expect(main.querySelector('.inbox').classList.contains('has-thread')).toBe(false);
  });

  it("the family demo does not open another family's conversation from a link", async () => {
    const g = app.store.all('guardians').find((x) => (x.studentIds || []).length);
    const other = app.store.all('students').find((s) => !g.studentIds.includes(s.id));
    asFamily(g);
    await go(`#/messages/${other.id}`);
    expect(main.querySelector('.msg-input')).toBeNull();
    expect(main.textContent).not.toContain(other.firstName + "'s teachers");
  });

  it('a redraw keeps the reader where they scrolled to in a conversation', async () => {
    // jsdom has no layout: give the conversation log a scrollable size.
    const tops = new WeakMap();
    const isLog = (el) => el.classList?.contains('msg-log');
    const desc = (name) => Object.getOwnPropertyDescriptor(Element.prototype, name) || Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    const orig = { scrollTop: desc('scrollTop'), scrollHeight: desc('scrollHeight'), clientHeight: desc('clientHeight') };
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, get() { return isLog(this) ? tops.get(this) || 0 : orig.scrollTop.get.call(this); }, set(v) { if (isLog(this)) tops.set(this, Math.max(0, Math.min(v, 700))); else orig.scrollTop.set.call(this, v); } });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return isLog(this) ? 1000 : orig.scrollHeight.get.call(this); } });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return isLog(this) ? 300 : orig.clientHeight.get.call(this); } });
    try {
      const s = app.store.all('students').filter((x) => x.status === 'active')[3];
      sendMessageFrom(s.id, 'family', 'Hello');
      await go(`#/messages/${s.id}`);
      for (let i = 0; i < 50 && !main.querySelector('.msg-log .msg'); i++) await tick(20);
      await tick(30);
      expect(main.querySelector('.msg-log').scrollTop).toBe(700);
      main.querySelector('.msg-log').scrollTop = 120;
      app.store.patch('students', app.store.all('students')[0].id, { dietary: 'None' });
      await redrawn();
      expect(main.querySelector('.msg-log').scrollTop).toBe(120);
      // Sending a message still jumps to it.
      sendMessageFrom(s.id, 'staff', 'On our way');
      await redrawn();
      expect(main.querySelector('.msg-log').scrollTop).toBe(700);
    } finally {
      delete HTMLElement.prototype.scrollTop;
      delete HTMLElement.prototype.scrollHeight;
      delete HTMLElement.prototype.clientHeight;
    }
  });
});

describe('announcements', () => {
  it('a linked announcement is scrolled to once, not again on every sync', async () => {
    const a = app.store.all('announcements')[0];
    let scrolls = 0;
    const orig = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function () {
      if (this.id === `ann-${a.id}`) scrolls++;
    };
    try {
      await go(`#/messages?tab=announcements&id=${a.id}`);
      await tick(80);
      expect(scrolls).toBe(1);
      app.store.patch('students', app.store.all('students')[0].id, { dietary: 'Halal' });
      await tick(30);
      app.store.patch('rooms', app.store.all('rooms')[0].id, { ageRange: '1 to 2' });
      await tick(80);
      expect(scrolls).toBe(1);
    } finally {
      HTMLElement.prototype.scrollIntoView = orig;
    }
  });
});

/** Waits for the conversation log to be rebuilt, then for its scroll to settle. */
async function redrawn() {
  const old = document.querySelector('.msg-log');
  for (let i = 0; i < 100 && document.querySelector('.msg-log') === old; i++) await tick(10);
  await tick(30);
}

function sendMessageFrom(studentId, from, text) {
  return sendMessage(app.store, { studentId, from, text, author: from === 'staff' ? 'Director' : 'Family' });
}
