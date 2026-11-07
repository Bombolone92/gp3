import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openCompose, isDraftSending, discardComposer } from '../src/ui/compose.js';

/**
 * Undo send: the hold between pressing Send and the message going, and the
 * way back from it.
 */

const draftStore = () => {
  const held = new Map();
  return {
    list: () => [...held.values()],
    get: (id) => held.get(id) ?? null,
    get count() { return held.size; },
    save(draft) {
      held.set(draft.id, draft);
      return true;
    },
    remove(id) {
      return held.delete(id);
    },
  };
};

let posts;
let drafts;

const ready = ({ undoSend = 5, ...extra } = {}) => {
  const modal = openCompose({
    username: 'me', mailPath: '/me/.mail', prefill: null, drafts, undoSend, ...extra,
  });
  const input = modal.panel.querySelector('#compose-to');
  input.value = 'ana@example.com';
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  modal.panel.querySelector('#compose-subject').value = 'Numbers';
  const body = modal.panel.querySelector('.rte-body');
  body.innerHTML = '<div>the figures</div>';
  body.dispatchEvent(new Event('input', { bubbles: true }));
  return modal;
};

const submit = (modal) => modal.panel.querySelector('.compose-form')
  .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

const toasts = () => [...document.querySelectorAll('.toast')].map((node) => node.textContent);
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  posts = [];
  drafts = draftStore();
  globalThis.puter = {
    ui: {}, APIOrigin: 'https://api.example', authToken: 't',
    fs: { write: async () => {} },
  };
  globalThis.fetch = async (url, init) => {
    posts.push({ url, body: init.body });
    return { ok: true, json: async () => ({}) };
  };
});

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('.modal-root, .toast').forEach((node) => node.remove());
  delete globalThis.puter;
  delete globalThis.fetch;
});

describe('undo send', () => {
  it('closes the dialog and holds the message, then sends it when the time is up', async () => {
    const modal = ready();
    submit(modal);
    await flush();

    expect(document.querySelector('.modal-root')).toBe(null);
    expect(posts).toHaveLength(0);
    expect(toasts().some((text) => text.includes('Sending to 1 recipient'))).toBe(true);
    expect(toasts().some((text) => text.includes('Undo'))).toBe(true);
    // Held, not gone: the draft is still in the store in case the tab is.
    expect(drafts.count).toBe(1);

    await vi.advanceTimersByTimeAsync(4000);
    expect(posts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1100);

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('https://api.example/email/send');
    expect(posts[0].body).toContain('Subject: Numbers');
    expect(toasts().some((text) => text.includes('Sent to 1 recipient.'))).toBe(true);
    expect(drafts.count).toBe(0);
  });

  it('brings the message back, intact, on Undo', async () => {
    const modal = ready();
    submit(modal);
    await flush();

    [...document.querySelectorAll('.toast-action')].pop().click();
    await flush();

    const reopened = document.querySelector('.modal-root');
    expect(reopened).not.toBe(null);
    expect(reopened.querySelector('#compose-subject').value).toBe('Numbers');
    expect(reopened.querySelector('.rte-body').textContent).toBe('the figures');
    expect([...reopened.querySelectorAll('.recipient-chip .chip-name')].map((n) => n.textContent))
      .toEqual(['ana@example.com']);

    // And nothing goes, however long it is left.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(posts).toHaveLength(0);
    expect(drafts.count).toBe(1);
  });

  it('brings the attachments back too, which the draft store does not hold', async () => {
    const modal = ready();
    const event = new Event('drop', { bubbles: true, cancelable: true });
    event.dataTransfer = {
      types: ['Files'],
      files: [{ name: 'q3.pdf', type: 'application/pdf', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }],
    };
    modal.panel.querySelector('.compose-form').dispatchEvent(event);
    await flush();
    expect(modal.panel.querySelector('.compose-attachments .chip').textContent).toContain('3 B');

    submit(modal);
    await flush();
    [...document.querySelectorAll('.toast-action')].pop().click();
    await flush();

    const reopened = document.querySelector('.modal-root');
    const chip = reopened.querySelector('.compose-attachments .chip');
    expect(chip).not.toBe(null);
    expect(chip.textContent).toContain('q3.pdf');
    expect(chip.textContent).toContain('3 B');
    // No note claiming the files were lost, because they were not.
    expect(reopened.querySelector('.compose-note')).toBe(null);
  });

  it('keeps the draft without delivering early when the page is being left', async () => {
    const modal = ready();
    submit(modal);
    await flush();
    expect(posts).toHaveLength(0);

    window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(posts).toHaveLength(0);
    expect(drafts.count).toBe(1);

    // The timer that would have sent it a second time finds nothing to do.
    await vi.advanceTimersByTimeAsync(6000);
    expect(posts).toHaveLength(0);
  });

  it('keeps an untouched reply stored for the length of the hold', async () => {
    // Nothing typed above the quote: as a draft this reads as blank, which is
    // what closing the dialog on it would ordinarily discard. Sent, it is a
    // message on its way, and the hold's promise is that leaving the page
    // keeps it.
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', drafts, undoSend: 5,
      prefill: {
        kind: 'reply', to: 'ana@example.com', subject: 'Re: Numbers',
        body: '\n\nOn Monday, Ana wrote:\n> the figures',
      },
    });
    submit(modal);
    await flush();
    expect(document.querySelector('.modal-root')).toBe(null);
    expect(posts).toHaveLength(0);
    expect(drafts.count).toBe(1);

    window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(drafts.count).toBe(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(posts).toHaveLength(0);
  });

  it('keeps an untouched reply stored while a direct send is still in flight', async () => {
    let answer;
    globalThis.fetch = () => new Promise((resolve) => { answer = resolve; });
    const modal = openCompose({
      username: 'me', mailPath: '/me/.mail', drafts, undoSend: 0,
      prefill: {
        kind: 'reply', to: 'ana@example.com', subject: 'Re: Numbers',
        body: '\n\nOn Monday, Ana wrote:\n> the figures',
      },
    });
    submit(modal);
    await flush();
    expect(drafts.count).toBe(1);

    // Closing while waiting is allowed, and keeps the draft: a failure that
    // arrives afterwards has to have something to fall back to.
    modal.close();
    await flush();
    expect(document.querySelector('.modal-root')).toBe(null);
    expect(drafts.count).toBe(1);

    answer({ ok: false, status: 500, json: async () => ({ message: 'Nope.' }) });
    await flush();
    expect(toasts().some((text) => text.includes('Nope.'))).toBe(true);
    expect(drafts.count).toBe(1);
  });

  it('keeps the draft, and says so, when the held send fails', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'Nope.' }) });
    const modal = ready();
    submit(modal);
    await vi.advanceTimersByTimeAsync(6000);

    expect(toasts().some((text) => text.includes('Nope.'))).toBe(true);
    expect(drafts.count).toBe(1);
  });

  it('says which draft is on its way, so Compose can pass over it', async () => {
    const modal = ready();
    submit(modal);
    await flush();
    const [held] = drafts.list();
    expect(isDraftSending({ username: 'me', mailPath: '/me/.mail', id: held.id })).toBe(true);
    // Another account's draft with the same id is not this one.
    expect(isDraftSending({ username: 'you', mailPath: '/you/.mail', id: held.id })).toBe(false);

    // What the Compose pill does with that answer: continue the newest draft
    // that is not going, or start a fresh message -- rather than being told
    // the held one is already sending and opening nothing.
    const resumable = drafts.list()
      .find((entry) => !isDraftSending({ username: 'me', mailPath: '/me/.mail', id: entry.id })) ?? null;
    expect(resumable).toBe(null);
    const fresh = openCompose({
      username: 'me', mailPath: '/me/.mail', prefill: null, drafts, undoSend: 5, draft: resumable,
    });
    expect(fresh.panel.isConnected).toBe(true);
    expect(fresh.panel.querySelector('.modal-title').textContent).toBe('New message');
    fresh.close(true);

    // Once the message has gone, nothing is on its way any more.
    await vi.advanceTimersByTimeAsync(6000);
    expect(isDraftSending({ username: 'me', mailPath: '/me/.mail', id: held.id })).toBe(false);
  });

  it('gives the held message up when its draft is discarded from the folder', async () => {
    const modal = ready();
    submit(modal);
    await flush();
    const [held] = drafts.list();
    expect(toasts().some((text) => text.includes('Sending to'))).toBe(true);

    // What the Drafts folder does to the row it shows for the held message.
    // Discarding it says "do not send this", and used to remove the row while
    // the hold fired on time regardless.
    expect(discardComposer({ username: 'me', mailPath: '/me/.mail', id: held.id })).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(drafts.count).toBe(0);
    expect(toasts().some((text) => text.includes('Sending to'))).toBe(false);
    expect(isDraftSending({ username: 'me', mailPath: '/me/.mail', id: held.id })).toBe(false);

    await vi.advanceTimersByTimeAsync(6000);
    expect(posts).toHaveLength(0);
  });

  it('does not announce a saved draft for a message that is on its way', async () => {
    const modal = ready();
    submit(modal);
    await flush();
    expect(toasts().some((text) => text.includes('Draft saved.'))).toBe(false);
  });

  it('sends immediately, from the dialog, when the hold is off', async () => {
    const modal = ready({ undoSend: 0 });
    submit(modal);
    await flush();
    expect(posts).toHaveLength(1);
    expect(toasts().some((text) => text.includes('Undo'))).toBe(false);
  });
});
