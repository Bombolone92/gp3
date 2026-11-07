import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { openCompose, closeComposers } from '../src/ui/compose.js';
import { createSampleMailbox } from '../src/lib/sample.js';
import { fileSentCopy } from '../src/lib/mailbox.js';
import { buildMessage } from '../src/lib/compose.js';
import { conversationHistory, normalizeSubject } from '../src/lib/thread.js';

let root, mailbox, modal, compose;
const row = (subject = 'Thursday walkthrough') => [...root.querySelectorAll('.row')]
  .find((node) => normalizeSubject(node.querySelector('.row-subject').textContent) === normalizeSubject(subject));
const cards = () => [...root.querySelectorAll('.msg-item')];
const folder = async (label) => {
  [...root.querySelectorAll('.nav-item')].find((node) => node.textContent.includes(label)).click();
  await vi.waitFor(() => expect(row()).toBeTruthy());
};
const open = async (count = 3) => {
  await vi.waitFor(() => expect(row()).toBeTruthy());
  row().click();
  await vi.waitFor(() => expect(cards()).toHaveLength(count));
  await vi.waitFor(() => expect(root.querySelector('.msg-reply button')).toBeTruthy());
};
beforeEach(() => {
  mailbox = createSampleMailbox();
  root = document.createElement('div');
  document.body.append(root);
  vi.stubGlobal('puter', { fs: mailbox.fs, ui: {}, APIOrigin: 'https://api.example', authToken: 'test' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  compose = vi.fn((prefill, options) => {
    modal = openCompose({ username: 'sample', mailPath: mailbox.mailPath, prefill, ...options, undoSend: 0 });
  });
  renderApp(root, { ...mailbox, sample: true, account: { username: 'sample' }, onCompose: compose });
});
afterEach(() => {
  closeComposers();
  root.remove();
  document.querySelectorAll('.toast, .menu, .modal-root').forEach((node) => node.remove());
  vi.unstubAllGlobals();
});
const reply = async () => {
  await open();
  root.querySelector('.msg-reply button').click();
  const body = modal.panel.querySelector('.rte-body');
  body.textContent = 'My sent reply belongs in this conversation.';
  body.dispatchEvent(new Event('input', { bubbles: true }));
  modal.panel.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(cards()).toHaveLength(4));
  await vi.waitFor(() => expect(cards().at(-1).textContent).toContain('My sent reply belongs'));
};

describe('sent replies in the reader', () => {
  it('shows a real composer send immediately and on reopening from Inbox and Sent', async () => {
    await reply();
    expect(fetch).toHaveBeenCalledOnce();
    expect(root.querySelector('.msg-count').textContent).toBe('4');
    expect(cards().at(-1).classList.contains('is-open')).toBe(true);
    // Reopening the same row reloads history from storage rather than relying on cards.
    await open(4);
    await folder('Sent');
    await open(4);
    expect(cards().at(-1).textContent).toContain('My sent reply belongs');
    root.querySelector('.msg-reply button').click();
    const body = modal.panel.querySelector('.rte-body');
    body.textContent = 'One more follow-up from Sent.';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    modal.panel.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(cards()).toHaveLength(5));
    await vi.waitFor(() => expect(cards().at(-1).textContent).toContain('One more follow-up'));
  });

  it('keeps Sent copies in Sent when the Inbox conversation is archived', async () => {
    await reply();
    row().querySelector('[aria-label^="Archive"]').click();
    await vi.waitFor(() => expect(row()).toBeUndefined());
    await folder('Archive');
    await open(4);
    await folder('Sent');
    expect(row()).toBeTruthy();
  });

  it('does not replace another open conversation when filing finishes late', async () => {
    await open();
    root.querySelector('.msg-reply button').click();
    const [prefill, options] = compose.mock.calls[0];
    modal.close(true);
    const other = [...root.querySelectorAll('.row')].find((node) => node !== row());
    other.click();
    await vi.waitFor(() => expect(root.querySelector('.msg-subject').textContent).not.toContain('Thursday walkthrough'));
    const subject = root.querySelector('.msg-subject').textContent;
    const raw = buildMessage({ from: 'sample@puter.email', to: ['priya@example.com'], subject: prefill.subject,
      body: 'Late copy', date: new Date(), messageId: '<late@example.com>', inReplyTo: prefill.inReplyTo, references: prefill.references });
    const path = await fileSentCopy({ fs: mailbox.fs, mailPath: mailbox.mailPath, raw, subject: prefill.subject, date: new Date() });
    options.onFiled(path);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(root.querySelector('.msg-subject').textContent).toBe(subject);
  });
});

describe('cross-folder conversation identity', () => {
  const msg = (id, refs = [], extra = {}) => ({ path: id, name: id, subject: 'Re: Plans', messageId: id, references: refs, ...extra });
  it('follows reference chains through archived messages and deduplicates self-delivery', () => {
    const original = msg('<1>');
    const middle = msg('<2>', ['<1>']);
    const latest = msg('<3>', ['<2>']);
    expect(conversationHistory([original], [latest, middle, { ...latest, path: 'copy' }]))
      .toEqual([original, middle, latest]);
  });
  it('excludes unrelated messages even when subject and participants match', () => {
    const original = msg('<1>', [], { from: { email: 'a@example.com' } });
    expect(conversationHistory([original], [msg('<2>', ['<other>']), msg('<3>')])).toEqual([original]);
  });
  it('handles headerless originals only with a shared correspondent other than yourself', () => {
    const original = msg('', [], { path: 'original', from: { email: 'a@example.com' }, to: [{ email: 'me@example.com' }] });
    const reply = msg('<2>', [], { from: { email: 'me@example.com' }, to: [{ email: 'a@example.com' }] });
    const unrelated = msg('<3>', [], { from: { email: 'me@example.com' }, to: [{ email: 'b@example.com' }] });
    expect(conversationHistory([original], [reply, unrelated], new Set(['me@example.com']))).toEqual([original, reply]);
  });
});
