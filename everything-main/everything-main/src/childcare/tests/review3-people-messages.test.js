// @vitest-environment jsdom
/** Third review: the Messages composer and conversation scrolling. */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { bootViews, go, app, tick } from './review2-people-harness.js';
import { messagesName, sendMessage } from '../src/core/messages.js';

vi.mock('../src/files.js', async (orig) => {
  const real = await orig();
  return {
    ...real,
    // A slow upload, as on a phone connection.
    saveFile: async (f) => {
      await new Promise((r) => setTimeout(r, 80));
      return { id: `att-${f.name}`, name: f.name, type: f.type, size: f.size, path: `messages/x/${f.name}` };
    },
    fileUrl: async () => 'blob:x',
  };
});

let main;
beforeAll(async () => {
  main = await bootViews();
});

const active = () => app.store.all('students').filter((x) => x.status === 'active');

function attach(form, name) {
  const fileInput = form.querySelector('input[type=file]');
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['x'], name, { type: 'image/png' })] });
  fileInput.dispatchEvent(new Event('change'));
}

describe('composer', () => {
  it('a photo attached while a removed photo was uploading stays in the composer', async () => {
    const s = active()[4];
    await go(`#/messages/${s.id}`);
    const form = main.querySelector('form.composer');
    attach(form, 'park.png');
    form.querySelector('.msg-input').value = 'Look';
    form.requestSubmit();
    await tick(10);
    // While it uploads: take the first photo out and attach another.
    form.querySelector('[aria-label="Remove park.png"]').click();
    attach(form, 'slide.png');
    await tick(200);
    expect([...form.querySelectorAll('.upload-thumb button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Remove slide.png']);
  });
});

describe('conversation scroll', () => {
  it('opening an unread conversation shows its newest messages even when the next frame comes before the scroll', async () => {
    // jsdom has no layout: give the conversation log a scrollable size.
    const tops = new WeakMap();
    const isLog = (el) => el.classList?.contains('msg-log');
    const desc = (name) => Object.getOwnPropertyDescriptor(Element.prototype, name) || Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    const orig = { scrollTop: desc('scrollTop'), scrollHeight: desc('scrollHeight'), clientHeight: desc('clientHeight') };
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, get() { return isLog(this) ? tops.get(this) || 0 : orig.scrollTop.get.call(this); }, set(v) { if (isLog(this)) tops.set(this, Math.max(0, Math.min(v, 700))); else orig.scrollTop.set.call(this, v); } });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return isLog(this) ? 1000 : orig.scrollHeight.get.call(this); } });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return isLog(this) ? 300 : orig.clientHeight.get.call(this); } });
    const raf = globalThis.requestAnimationFrame;
    try {
      const [x, y] = active().slice(5, 7);
      const from = (sid, text) => sendMessage(app.store, { studentId: sid, from: 'family', text, author: 'Family' });
      from(x.id, 'Hello');
      await go(`#/messages/${x.id}`);
      for (let i = 0; i < 50 && !main.querySelector('.msg-log .msg'); i++) await tick(20);
      await tick(30);
      main.querySelector(`a.thread-item[href="#/messages/${y.id}"]`).click();
      await tick(30);
      // A new message makes the first conversation unread again; its messages are already loaded.
      from(x.id, 'Are you there?');
      await tick(30);
      expect(app.store.isOpen(messagesName(x.id))).toBe(true);
      // Chrome often draws the next frame right after a click, before a 0 ms timer.
      globalThis.requestAnimationFrame = (fn) => queueMicrotask(fn);
      main.querySelector(`a.thread-item[href="#/messages/${x.id}"]`).click();
      await tick(50);
      expect(main.querySelector('.msg-log').scrollTop).toBe(700);
    } finally {
      globalThis.requestAnimationFrame = raf;
      delete HTMLElement.prototype.scrollTop;
      delete HTMLElement.prototype.scrollHeight;
      delete HTMLElement.prototype.clientHeight;
    }
  });
});
