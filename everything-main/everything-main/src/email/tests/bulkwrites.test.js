import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * Bulk moves and deletes run a few at a time rather than one after another,
 * and the writes refused together before the app has asked for access share
 * the one permission request rather than being counted as failed.
 */

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

let root;

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
});

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);
const tickAll = async () => {
  const box = root.querySelector('.select-all');
  box.checked = true;
  box.dispatchEvent(new Event('change'));
  await settle(50);
};
const lastToast = () => [...document.querySelectorAll('.toast')].pop()?.textContent ?? '';
const openFolder = async (label) => {
  [...root.querySelectorAll('.nav-item')]
    .find((item) => item.textContent.includes(label))
    .click();
  await settle();
};

describe('bulk writes', () => {
  it('moves several messages at once rather than one after another', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    let inFlight = 0;
    let peak = 0;
    const slow = { ...fs, move: async (...args) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await settle(30);
      inFlight--;
      return fs.move(...args);
    } };
    renderApp(root, { fs: slow, mailPath, objectsPath, sample: true, account: { username: 'sample' } });
    await settle(400);
    await tickAll();
    root.querySelector('.list-actions [aria-label="Archive"]').click();
    await settle(900);

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(rows()).toHaveLength(0);
    expect(lastToast()).toContain('Archived 14 messages');
    // Every one of them landed where it was sent.
    await openFolder('Archive');
    expect(rows().length).toBeGreaterThan(0);
    expect(root.querySelector('.list-meta').textContent).toContain('14 messages');
  });

  it('asks for write access once when several refused writes are in flight, and retries them all', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    let granted = false;
    let asks = 0;
    const guarded = { ...fs, move: async (...args) => {
      await settle(20);
      if (!granted) throw new Error('forbidden');
      return fs.move(...args);
    } };
    renderApp(root, {
      fs: guarded, mailPath, objectsPath, sample: true, account: { username: 'sample' },
      requestWrite: async () => {
        asks++;
        await settle(60);
        granted = true;
        return true;
      },
    });
    await settle(400);
    await tickAll();
    root.querySelector('.list-actions [aria-label="Archive"]').click();
    await settle(1200);

    expect(asks).toBe(1);
    expect(rows()).toHaveLength(0);
    expect(lastToast()).toContain('Archived 14 messages');
    expect(lastToast()).not.toContain('could not be moved');
  });

  it('deletes forever a few at a time too, and a conversation\'s row goes when its last file has', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    let inFlight = 0;
    let peak = 0;
    const slow = { ...fs, delete: async (...args) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await settle(30);
      inFlight--;
      return fs.delete(...args);
    } };
    renderApp(root, { fs: slow, mailPath, objectsPath, sample: true, account: { username: 'sample' } });
    await settle(400);
    await tickAll();
    root.querySelector('.list-actions [aria-label="Delete"]').click();
    await settle(600);
    await openFolder('Trash');
    expect(rows().length).toBeGreaterThan(0);
    await tickAll();
    root.querySelector('.list-actions [aria-label="Delete forever"]').click();
    await settle(200);
    document.querySelector('.modal-root .btn-danger').click();
    await settle(900);

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(rows()).toHaveLength(0);
    expect(lastToast()).toContain('deleted permanently');
  });
});
