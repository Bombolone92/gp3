import { it, expect, vi, afterEach } from 'vitest';
import { createMailbox } from '../src/lib/mailbox.js';
import { renderApp } from '../src/ui/app.js';
import { pagedFs } from './pagedfs.js';
import { needsSearchRead, parseQuery } from '../src/lib/search.js';

const path = '/scale/.mail/objects';
const day = '2026-09-17';
const fixture = (count = 200, options) => {
  const names = Array.from({ length: count }, (_, i) => `${String(i).padStart(6, '0')}--${btoa(`Message ${i}`)}`);
  const fs = pagedFs(path, { [day]: names }, options);
  fs.read = vi.fn(async p => new Blob([`From: Alice <alice@example.com>\r\nMessage-ID: <${p}>\r\n\r\nHello.`]));
  return { fs, mailbox: createMailbox({ fs, objectsPath: path }) };
};
afterEach(() => { document.body.replaceChildren(); });

it('stops recursive paging after the final consumer cancels and permits a clean retry', async () => {
  const { fs, mailbox } = fixture(200, { pageCap: 10 });
  await mailbox.open();
  fs.calls.length = 0;
  const controller = new AbortController();
  const listing = mailbox.listAll({ signal: controller.signal, onProgress: () => controller.abort() });
  await expect(listing).rejects.toMatchObject({ name: 'AbortError' });
  expect(fs.calls.filter(c => c.options.recursive)).toHaveLength(1);
  expect(mailbox.total).toBeNull();
  expect(await mailbox.listAll()).toHaveLength(200);
});

it('cancels one catalog listener without cancelling another consumer', async () => {
  const { mailbox } = fixture(200, { pageCap: 10 });
  await mailbox.open();
  const controller = new AbortController();
  const progress = vi.fn(() => controller.abort());
  const first = mailbox.listAll({ signal: controller.signal, onProgress: progress });
  const second = mailbox.listAll();
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  expect(await second).toHaveLength(200);
  expect(progress).toHaveBeenCalledTimes(1);
});

it('does not restart forever when every catalog is invalidated', async () => {
  const { mailbox } = fixture();
  await expect(mailbox.listAll({ onProgress: () => mailbox.forget() })).rejects.toThrow('Please retry');
  expect(mailbox.total).toBeNull();
});

it('prunes only definitive subject mismatches before reading headers', () => {
  const query = parseQuery('subject:invoice from:alice');
  expect(needsSearchRead(query, { subject: 'Other' })).toBe(false);
  expect(needsSearchRead(query, { subject: 'Invoice 42' })).toBe(true);
  expect(needsSearchRead(query, { subject: '' })).toBe(true);
  expect(needsSearchRead(parseQuery('before:2020-01-01 from:alice'), { day: '2026-01-01' })).toBe(true);
});

const mount = () => {
  const { fs } = fixture();
  const root = document.createElement('div');
  document.body.append(root);
  renderApp(root, { fs, objectsPath: path, mailPath: '/scale/.mail', sample: true, account: { username: 'scale' } });
  return { fs, root };
};
const search = (root, value) => {
  const input = root.querySelector('.search-input');
  input.value = value;
  input.dispatchEvent(new Event('search'));
};

it('reads only subject candidates, reports the whole search and retries failed candidates', async () => {
  const { fs, root } = mount();
  await vi.waitFor(() => expect(root.querySelectorAll('.row')).toHaveLength(60));
  fs.read.mockRejectedValueOnce(new Error('offline'));
  search(root, 'subject:"Message 0" from:alice');
  await vi.waitFor(() => expect(root.querySelector('.list-meta').textContent).toContain('could not read 1 message'));
  expect(fs.read).toHaveBeenCalledTimes(61);
  search(root, 'subject:"Message 0" from:alice');
  await vi.waitFor(() => expect(root.querySelector('.list-meta').textContent).toBe('1 result in 200 messages'));
  expect(fs.read).toHaveBeenCalledTimes(62);
  expect(root.querySelector('.row-subject').textContent).toBe('Message 0');
});

it('pages complete broad results with bounded rows and keyboard focus', async () => {
  const { root } = mount();
  await vi.waitFor(() => expect(root.querySelectorAll('.row')).toHaveLength(60));
  search(root, 'subject:Message');
  await vi.waitFor(() => expect(root.querySelector('.list-meta').textContent).toBe('200 results in 200 messages'));
  const subjects = [];
  for (let page = 0; page < 4; page++) {
    expect(root.querySelectorAll('.row').length).toBeLessThanOrEqual(60);
    subjects.push(...[...root.querySelectorAll('.row-subject')].map(node => node.textContent));
    const next = [...root.querySelectorAll('.result-pages button')].find(node => node.textContent === 'Next results');
    if (page < 3) {
      next.click();
      expect(document.activeElement).toBe(root.querySelector('.row'));
    } else expect(next.disabled).toBe(true);
  }
  expect(new Set(subjects).size).toBe(200);
  expect(subjects[0]).toBe('Message 199');
  expect(subjects.at(-1)).toBe('Message 0');
});
