import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { pagedFs } from './pagedfs.js';

const mailPath = '/user/.mail';
const objectsPath = `${mailPath}/objects`;
const day = '2026-09-17';
const names = Array.from({ length: 125 }, (_, i) => `${String(i).padStart(8, '0')}--${btoa('Discussion')}`);
let root, fs, reads, pause, fail, composed, composeOptions;
const button = label => root.querySelector(`[aria-label="${label}"]`);
const cards = () => [...root.querySelectorAll('.msg-thread .msg-item')];
const count = () => root.querySelector('.thread-page-status')?.textContent;
const bodyReady = () => vi.waitFor(() => expect(cards().at(-1)?.querySelector('.msg-body')).toBeTruthy());
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
const open = async () => {
  renderApp(root, { fs, mailPath, objectsPath, sample: true, account: { username: 'user' },
    onCompose: (prefill, options) => { composed = prefill; composeOptions = options; } });
  await vi.waitFor(() => expect(root.querySelector('.row')).not.toBeNull());
  root.querySelector('.row').click();
  await vi.waitFor(() => {
    expect(root.querySelector('.msg-thread')?.getAttribute('aria-busy')).toBe('false');
    expect(root.querySelector('.msg-count')?.textContent).toBe('125');
  });
  await bodyReady();
};

beforeEach(() => {
  localStorage.clear();
  window.print = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  fs = pagedFs(objectsPath, { [day]: names });
  const readdir = fs.readdir;
  fs.readdir = (path, options) => path.startsWith(objectsPath) ? readdir(path, options) : Promise.resolve({ items: [] });
  reads = [];
  pause = null;
  fail = false;
  composed = null;
  fs.read = async (path, options = {}) => {
    const id = Number(path.split('/').at(-1).split('--')[0]);
    if (!options.byte_count) {
      reads.push(id);
      if (pause) await pause;
      if (fail) throw new Error('Synthetic body failure');
    }
    const raw = `From: Sender ${id} <sender${id}@example.com>\r\nTo: user@puter.com\r\nSubject: Discussion\r\nMessage-ID: <${id}@example.com>\r\nReferences: <root@example.com>\r\nContent-Type: text/plain\r\n\r\nMessage ${id}.`.padEnd(9000, ' ');
    return new Blob([options.byte_count ? raw.slice(0, options.byte_count) : raw]);
  };
});

afterEach(() => {
  root.replaceChildren();
  root.remove();
  document.querySelectorAll('.toast, .menu, .modal-root').forEach(node => node.remove());
  vi.restoreAllMocks();
  delete window.print;
});

describe('paged conversation reader', () => {
  it('reaches every message in order without retaining off-page cards', async () => {
    await open();
    expect(cards()).toHaveLength(5);
    expect(count()).toBe('Messages 121–125 of 125');
    const latest = cards().at(-1);
    const listed = fs.calls.length;
    button('First messages in conversation').click();
    expect(cards()).toHaveLength(60);
    expect(count()).toBe('Messages 1–60 of 125');
    expect(document.activeElement).toBe(cards()[0].querySelector('.msg-expander'));
    expect(cards().map(card => card.querySelector('.msg-from-name').textContent))
      .toEqual(Array.from({ length: 60 }, (_, i) => `Sender ${i}`));
    button('Newer messages in conversation').click();
    expect(count()).toBe('Messages 61–120 of 125');
    expect(cards().map(card => card.querySelector('.msg-from-name').textContent))
      .toEqual(Array.from({ length: 60 }, (_, i) => `Sender ${i + 60}`));
    button('Newer messages in conversation').click();
    expect(count()).toBe('Messages 121–125 of 125');
    expect(cards().at(-1)).toBe(latest);
    expect(button('Newer messages in conversation').disabled).toBe(true);
    expect(fs.calls.length).toBe(listed);
    expect(reads).toEqual([124]);
  });

  it('answers the latest message even while reading an older page', async () => {
    await open();
    button('First messages in conversation').click();
    [...root.querySelectorAll('.msg-reply button')].find(node => node.textContent === 'Reply').click();
    expect(composed.inReplyTo).toBe('<124@example.com>');
    expect(composed.to).toBe('sender124@example.com');
    expect(composed.body).toContain('Message 124.');
    root.querySelector('.row .star-btn').click();
    button('Latest messages in conversation').click();
    expect(cards().at(-1).querySelector('.star-btn').getAttribute('aria-pressed')).toBe('true');
  });

  it('retains off-page history when a sent reply is filed', async () => {
    await open();
    button('First messages in conversation').click();
    [...root.querySelectorAll('.msg-reply button')].find(node => node.textContent === 'Reply').click();
    const name = `99999999--${btoa('Discussion')}`;
    const path = `${mailPath}/sent/${day}/${name}`;
    const readdir = fs.readdir;
    fs.readdir = (folder, options) => folder === `${mailPath}/sent`
      ? Promise.resolve({ items: options?.recursive
        ? [{ name, path, is_dir: false }]
        : [{ name: day, path: `${mailPath}/sent/${day}`, is_dir: true }] })
      : folder === `${mailPath}/sent/${day}` ? Promise.resolve({ items: [{ name, path, is_dir: false }] })
        : readdir(folder, options);
    await composeOptions.onFiled(path);
    await vi.waitFor(() => expect(root.querySelector('.msg-count')?.textContent).toBe('126'));
    expect(cards()).toHaveLength(6);
    expect(count()).toBe('Messages 121–126 of 126');
    expect(cards().at(-1).querySelector('.msg-body').textContent.trim()).toBe('Message 99999999.');
    button('First messages in conversation').click();
    expect(count()).toBe('Messages 1–60 of 126');
    expect(cards()[0].querySelector('.msg-from-name').textContent).toBe('Sender 0');
  });

  it('bounds bulk expansion and stops scheduling bodies after leaving the page', async () => {
    await open();
    button('First messages in conversation').click();
    let resume;
    pause = new Promise(resolve => { resume = resolve; });
    reads.length = 0;
    button('Expand messages on this page').click();
    await vi.waitFor(() => expect(reads).toHaveLength(4));
    const discarded = cards()[0];
    button('Latest messages in conversation').click();
    resume();
    await settle();
    expect(reads).toHaveLength(4);
    expect(discarded.isConnected).toBe(false);
    expect(discarded.querySelector('.msg-body')).toBeNull();
    expect(cards()).toHaveLength(5);
    expect(cards().at(-1).querySelector('.msg-body').textContent.trim()).toBe('Message 124.');
  });

  it('prints all messages and restores the bounded reader afterward', async () => {
    await open();
    button('First messages in conversation').click();
    const before = cards();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      const printed = [...root.querySelectorAll('.print-conversation .msg-body')];
      expect(printed).toHaveLength(125);
      expect(printed.map(node => node.textContent.trim())).toEqual(names.map((_, i) => `Message ${i}.`));
    });
    button('Print').click();
    await vi.waitFor(() => expect(print).toHaveBeenCalledOnce(), { timeout: 5000 });
    expect(root.querySelector('.print-conversation')).toBeNull();
    expect(cards()).toEqual(before);
    expect(count()).toBe('Messages 1–60 of 125');
    expect(reads.filter(id => id === 124)).toHaveLength(1);
  });

  it('does not print a partial document after a read failure and can retry', async () => {
    await open();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    fail = true;
    button('Print').click();
    await vi.waitFor(() => expect(button('Print').disabled).toBe(false));
    expect(print).not.toHaveBeenCalled();
    expect(root.querySelector('.print-conversation')).toBeNull();
    fail = false;
    button('Print').click();
    await vi.waitFor(() => expect(print).toHaveBeenCalledOnce(), { timeout: 5000 });
  });

  it('cancels print preparation when the reader is closed', async () => {
    await open();
    let resume;
    pause = new Promise(resolve => { resume = resolve; });
    reads.length = 0;
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    button('Print').click();
    await vi.waitFor(() => expect(reads).toHaveLength(4));
    button('Back to list').click();
    resume();
    await settle();
    expect(reads).toHaveLength(4);
    expect(print).not.toHaveBeenCalled();
    expect(root.querySelector('.print-conversation')).toBeNull();
  });
});
