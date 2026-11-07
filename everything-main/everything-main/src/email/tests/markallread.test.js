import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * Mark all as read, over the sample inbox, which arrives entirely unread.
 */

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

let root;

const mount = () => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
  });
};

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);
const unreadRows = () => rows().filter((row) => row.classList.contains('unread'));
const button = () => root.querySelector('[aria-label="Mark all as read"]');
const inboxCount = () => root.querySelector('.nav-item .nav-count').textContent;
const lastToast = () => [...document.querySelectorAll('.toast')].pop()?.textContent ?? '';

const openFolder = async (label) => {
  [...root.querySelectorAll('.nav-item')]
    .find((item) => item.textContent.includes(label))
    .click();
  await settle();
};

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
});

describe('Mark all as read', () => {
  it('reports a listing failure without silently marking only the loaded page', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    let fail = false;
    const interrupted = { ...fs, readdir: async (path) => {
      if (fail && path.startsWith(`${objectsPath}/`)) throw new Error('offline');
      return fs.readdir(path);
    } };
    renderApp(root, {
      fs: interrupted, mailPath, objectsPath, sample: true, account: { username: 'sample' }, pageSize: 5,
    });
    await settle(400);
    const before = unreadRows().length;
    expect(before).toBeGreaterThan(0);
    expect(root.querySelector('.btn-more')).not.toBeNull();
    fail = true;
    button().click();
    await settle();
    expect(unreadRows()).toHaveLength(before);
    expect(lastToast()).toContain('Could not mark all as read: offline');
    expect(button().disabled).toBe(false);
    expect(button().hidden).toBe(false);

    fail = false;
    button().click();
    await settle();
    expect(lastToast()).toContain('14 messages marked as read.');
    expect(unreadRows()).toHaveLength(0);
    while (root.querySelector('.btn-more')) {
      root.querySelector('.btn-more').click();
      await settle();
    }
    expect(unreadRows()).toHaveLength(0);
  });

  it('does not mark a different folder when the original listing fails after navigation', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    let failNext = false;
    let rejectListing;
    const interrupted = { ...fs, readdir: (path) => {
      if (failNext && path === objectsPath) {
        failNext = false;
        return new Promise((resolve, reject) => { rejectListing = reject; });
      }
      return fs.readdir(path);
    } };
    renderApp(root, {
      fs: interrupted, mailPath, objectsPath, sample: true, account: { username: 'sample' },
    });
    await settle(400);
    rows()[0].querySelector('[aria-label^="Archive"]').click();
    await settle(400);
    await openFolder('Archive');
    const archivedUnread = unreadRows().length;
    expect(archivedUnread).toBeGreaterThan(0);
    await openFolder('Inbox');
    failNext = true;
    button().click();
    await settle(50);
    expect(rejectListing).toBeTypeOf('function');
    await openFolder('Archive');
    rejectListing(new Error('offline'));
    await settle();
    expect(unreadRows()).toHaveLength(archivedUnread);
    expect(lastToast()).toContain('Could not mark all as read: offline');
    expect(button().disabled).toBe(false);
  });

  it('marks every message in the folder read, and can be undone', async () => {
    mount();
    await settle(400);
    const before = unreadRows().length;
    expect(before).toBeGreaterThan(1);
    expect(button().hidden).toBe(false);
    expect(inboxCount()).not.toBe('');

    button().click();
    await settle();

    expect(unreadRows()).toHaveLength(0);
    expect(inboxCount()).toBe('');
    expect(lastToast()).toContain('marked as read.');
    // Nothing left to mark, so nothing left to offer.
    expect(button().hidden).toBe(true);

    [...document.querySelectorAll('.toast-action')].pop().click();
    await settle();
    expect(unreadRows()).toHaveLength(before);
    expect(button().hidden).toBe(false);
  });

  it('marks only what is on screen in Starred', async () => {
    mount();
    await settle(400);
    const all = rows();
    all[2].querySelector('.star-btn').click();
    await settle(120);
    await openFolder('Starred');
    expect(rows()).toHaveLength(1);
    expect(button().hidden).toBe(false);

    button().click();
    await settle();
    expect(lastToast()).toContain('1 message marked as read.');

    await openFolder('Inbox');
    // Everything but the starred one is still unread.
    expect(unreadRows()).toHaveLength(all.length - 1);
  });

  it('is not offered in Starred when nothing starred is unread', async () => {
    mount();
    await settle(400);
    await openFolder('Starred');
    expect(rows()).toHaveLength(0);
    // The inbox behind the filter is entirely unread; this view is not.
    expect(button().hidden).toBe(true);

    await openFolder('Inbox');
    rows()[2].querySelector('.star-btn').click();
    await settle(120);
    await openFolder('Starred');
    expect(button().hidden).toBe(false);
    button().click();
    await settle();
    expect(button().hidden).toBe(true);
  });

  it('hands the keyboard on when the button hides itself', async () => {
    mount();
    await settle(400);
    button().focus();
    button().click();
    await settle();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement.isConnected).toBe(true);
    expect(document.activeElement.closest('[hidden]')).toBe(null);
  });
});
