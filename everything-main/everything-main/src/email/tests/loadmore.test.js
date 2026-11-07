import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';

/** "Load older messages", and what happens when it lands somewhere else. */

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

const OBJECTS = '/user/.mail/objects';
const DAYS = ['2026-08-03', '2026-08-02', '2026-08-01'];

const raw = (n) => [
  `From: Sender ${n} <s${n}@example.com>`,
  'To: you@puter.email',
  `Subject: Message ${n}`,
  'Date: Mon, 17 Aug 2026 10:30:00 GMT',
  'Content-Type: text/plain; charset=utf-8',
  '',
  `Body of message ${n}.`,
].join('\r\n');

/**
 * Three day folders of thirty, so the first page stops with one folder still
 * unlisted. The oldest folder's first listing is held open, which is how the
 * batch is still in flight when the search takes the scroller over.
 */
const makeFs = (days = DAYS, heldDay = '2026-08-01') => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let heldOnce = false;

  const files = (day) => Array.from({ length: 30 }, (unused, i) => {
    const label = `${day} number ${String(i).padStart(2, '0')}`;
    const name = `${day}-${String(i).padStart(2, '0')}--${btoa(label).replace(/=+$/, '')}`;
    return { name, path: `${OBJECTS}/${day}/${name}`, is_dir: false, size: 200, modified: 0 };
  });

  return {
    release,
    async readdir(path) {
      if (path === OBJECTS) {
        return days.map((day) => ({ name: day, path: `${OBJECTS}/${day}`, is_dir: true }));
      }
      const day = path.split('/').pop();
      if (day === heldDay && !heldOnce) {
        heldOnce = true;
        await held;
      }
      return files(day);
    },
    async read(path) {
      return new Blob([raw(path.slice(-6))]);
    },
  };
};

let root;

beforeEach(() => {
  window.localStorage.clear();
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
  window.localStorage.clear();
});

describe('the Starred view over a folder with more to list', () => {
  it('does not claim there is nothing starred in mail it has not listed', async () => {
    const fs = makeFs();
    fs.release();
    renderApp(root, {
      fs, mailPath: '/user/.mail', objectsPath: OBJECTS,
      sample: true, account: { username: 'user' },
    });
    await settle(400);
    [...root.querySelectorAll('.nav-item')]
      .find((item) => item.textContent.includes('Starred')).click();
    await settle(200);

    const note = root.querySelector('.center-note').textContent;
    expect(note).toContain('loaded so far');
    expect(note).not.toContain('No starred messages.');
    expect(root.querySelector('.btn-more')).not.toBeNull();
  });
});

describe('a page that lands after a search has taken over', () => {
  it('reopens cleanly after cancelling a partly loaded older page, even if its last request finishes late', async () => {
    const days = ['06', '05', '04', '03', '02', '01'].map(day => `2026-08-${day}`);
    const fs = makeFs(days, '2026-08-03');
    renderApp(root, { fs, mailPath: '/user/.mail', objectsPath: OBJECTS,
      sample: true, account: { username: 'user' } });
    await settle(400);
    root.querySelector('.btn-more').click();
    await settle(60); // day 04 has appended; day 03 is still on the wire
    const nav = label => [...root.querySelectorAll('.nav-item')].find(node => node.textContent.includes(label)).click();
    nav('Archive');
    await settle(60);
    nav('Inbox');
    await settle(300);
    expect(rowsCount()).toBe(60);
    fs.release();
    await settle(100);
    expect(rowsCount()).toBe(60);
    expect(root.querySelector('.btn-more').disabled).toBe(false);
    root.querySelector('.btn-more').click();
    await settle(300);
    expect(rowsCount()).toBe(120);
    function rowsCount() { return root.querySelectorAll('.row').length; }
  });

  it.each([false, true])('keeps one page request and button after search is cleared (click again: %s)', async (clickAgain) => {
    const days = ['06', '05', '04', '03', '02', '01'].map((day) => `2026-08-${day}`);
    const fs = makeFs(days, '2026-08-04');
    renderApp(root, {
      fs, mailPath: '/user/.mail', objectsPath: OBJECTS,
      sample: true, account: { username: 'user' },
    });
    await settle(400);
    expect(root.querySelectorAll('.row')).toHaveLength(60);
    const first = root.querySelector('.row');
    root.querySelector('.btn-more').click();
    const input = root.querySelector('.search-input');
    try {
      input.value = 'subject:"2026-08-06 number 05"';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await settle(400);
      expect(root.querySelectorAll('.row')).toHaveLength(1);
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await settle(400);
      if (clickAgain) {
        const replacement = root.querySelector('.btn-more');
        expect(replacement.disabled).toBe(true);
        replacement.click();
      }
      fs.release();
      await settle(500);
      expect(root.querySelectorAll('.row')).toHaveLength(120);
      expect(root.querySelector('.row')).toBe(first);
      expect(root.querySelectorAll('.btn-more')).toHaveLength(1);
      expect(root.querySelector('.btn-more').disabled).toBe(false);
      root.querySelector('.btn-more').click();
      await settle(400);
      expect(root.querySelectorAll('.row')).toHaveLength(180);
      expect(root.querySelector('.btn-more')).toBeNull();
    } finally {
      fs.release();
    }
  });

  it('stays out of the result list', async () => {
    const fs = makeFs();
    renderApp(root, {
      fs, mailPath: '/user/.mail', objectsPath: OBJECTS,
      sample: true, account: { username: 'user' },
    });
    await settle(400);
    expect(root.querySelectorAll('.row')).toHaveLength(60);

    root.querySelector('.btn-more').click();
    await settle(60);

    const input = root.querySelector('.search-input');
    input.value = 'subject:"2026-08-03 number 05"';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(500);
    const found = [...root.querySelectorAll('.row')].filter((row) => !row.hidden).length;
    expect(found).toBeGreaterThan(0);

    fs.release();
    await settle(400);

    // The older page belongs to the folder, not to this result set: appending
    // it here left hidden rows, the folder's own empty panel and a second
    // "Load older messages" button in the middle of a search.
    expect([...root.querySelectorAll('.row')].filter((row) => !row.hidden)).toHaveLength(found);
    expect(root.querySelector('.btn-more')).toBeNull();
    expect(root.querySelector('.msglist').childNodes).toHaveLength(1);

    // And it was still listed: clearing the search shows the whole folder.
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(400);
    expect(root.querySelectorAll('.row')).toHaveLength(90);
  });
});

it('offers a retry after an older day fails and keeps the rows already loaded', async () => {
  const fs = makeFs();
  fs.release();
  let fail = true;
  const interrupted = { ...fs, readdir: (path) => {
    if (fail && path === `${OBJECTS}/2026-08-01`) return Promise.reject(new Error('offline'));
    return fs.readdir(path);
  } };
  renderApp(root, {
    fs: interrupted, mailPath: '/user/.mail', objectsPath: OBJECTS,
    sample: true, account: { username: 'user' },
  });
  await settle(400);
  expect(root.querySelectorAll('.row')).toHaveLength(60);
  const first = root.querySelector('.row');
  root.querySelector('.btn-more').click();
  await settle();
  const retry = root.querySelector('.btn-more');
  expect(retry).not.toBeNull();
  expect(retry.disabled).toBe(false);
  expect(retry.textContent).toBe('Retry loading messages');
  expect(document.querySelector('.toast').textContent).toContain('Could not load some messages: offline');
  expect(root.querySelectorAll('.row')).toHaveLength(60);
  expect(root.querySelector('.row')).toBe(first);
  fail = false;
  retry.click();
  await settle(400);
  expect(root.querySelectorAll('.row')).toHaveLength(90);
  expect(root.querySelector('.btn-more')).toBeNull();
});

it('offers a retry when none of the initial day folders could be loaded', async () => {
  const fs = makeFs();
  fs.release();
  let fail = true;
  const interrupted = { ...fs, readdir: (path) => {
    if (fail && path.startsWith(`${OBJECTS}/`)) return Promise.reject(new Error('offline'));
    return fs.readdir(path);
  } };
  renderApp(root, {
    fs: interrupted, mailPath: '/user/.mail', objectsPath: OBJECTS,
    sample: true, account: { username: 'user' },
  });
  await settle(400);
  expect(root.querySelector('.center').textContent).toContain('Could not load messages.');
  const retry = root.querySelector('.btn-more');
  expect(retry).not.toBeNull();
  fail = false;
  retry.click();
  await settle(400);
  expect(root.querySelectorAll('.row')).toHaveLength(60);
  expect(root.querySelector('.btn-more').textContent).toBe('Load older messages');
});
