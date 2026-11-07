import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * Reading on from an open conversation to the next or the previous one, by
 * the arrows in the reader's toolbar and by `j` and `k`.
 */

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

let root;

const mount = () => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
  });
};

const press = (key, target = document.body) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);
const subjectOf = (row) => row?.querySelector('.row-subject')?.textContent;
const openSubject = () => root.querySelector('.msg-subject')?.firstChild?.textContent;
const newer = () => root.querySelector('[aria-label="Newer conversation"]');
const older = () => root.querySelector('[aria-label="Older conversation"]');
const position = () => root.querySelector('.msg-position').textContent;

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
});

describe('moving through the list from the reader', () => {
  it('opens the older and the newer conversation from the toolbar', async () => {
    mount();
    await settle(400);
    const all = rows();
    all[1].click();
    await settle();
    expect(openSubject()).toBe(subjectOf(all[1]));
    expect(position()).toBe(`2 of ${all.length}`);

    older().click();
    await settle();
    expect(openSubject()).toBe(subjectOf(all[2]));
    expect(position()).toBe(`3 of ${all.length}`);

    newer().click();
    await settle();
    newer().click();
    await settle();
    expect(openSubject()).toBe(subjectOf(all[0]));
    expect(position()).toBe(`1 of ${all.length}`);
  });

  it('cannot go past either end', async () => {
    mount();
    await settle(400);
    const all = rows();
    all[0].click();
    await settle();
    expect(newer().disabled).toBe(true);
    expect(older().disabled).toBe(false);

    all[all.length - 1].click();
    await settle();
    expect(older().disabled).toBe(true);
    expect(newer().disabled).toBe(false);
  });

  it('answers j and k the same way while a message is open', async () => {
    mount();
    await settle(400);
    const all = rows();
    all[0].click();
    await settle();

    expect(press('j').defaultPrevented).toBe(true);
    await settle();
    expect(openSubject()).toBe(subjectOf(all[1]));

    press('k');
    await settle();
    expect(openSubject()).toBe(subjectOf(all[0]));

    // At the top, k has nowhere to go and says so by leaving the key alone.
    expect(press('k').defaultPrevented).toBe(false);
    expect(openSubject()).toBe(subjectOf(all[0]));
  });

  it('marks the row of whatever is open as the selected one', async () => {
    mount();
    await settle(400);
    const all = rows();
    all[0].click();
    await settle();
    older().click();
    await settle();
    expect(all[0].getAttribute('aria-selected')).toBe('false');
    expect(all[1].getAttribute('aria-selected')).toBe('true');
  });

  it('is not shown on the list', async () => {
    mount();
    await settle(400);
    expect(root.querySelector('.msg-nav').hidden).toBe(true);
    rows()[0].click();
    await settle();
    expect(root.querySelector('.msg-nav').hidden).toBe(false);
  });
});
