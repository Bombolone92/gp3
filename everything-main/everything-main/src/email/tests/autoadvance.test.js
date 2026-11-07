import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';
import { createSettings } from '../src/lib/settings.js';
import { memoryStorage } from '../src/lib/readstate.js';

/**
 * Auto-advance: archiving or deleting from the reader opens the next
 * conversation when the setting says so, and goes back to the list when it
 * does not.
 */

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

let root;

const mount = ({ advance = false } = {}) => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  const settings = createSettings('t', memoryStorage());
  settings.set('autoAdvance', advance);
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' }, settings,
  });
};

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);
const subjectOf = (row) => row?.querySelector('.row-subject')?.textContent;
const openSubject = () => root.querySelector('.msg-subject')?.firstChild?.textContent;
const reading = () => root.querySelector('.app-frame').classList.contains('reading');
const readerAction = (label) => [...root.querySelectorAll('.msg-actions-bar .icon-btn')]
  .find((btn) => btn.getAttribute('aria-label') === label);

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
});

describe('after archiving from the reader', () => {
  it('goes back to the list unless asked otherwise', async () => {
    mount();
    await settle(400);
    rows()[1].click();
    await settle();
    readerAction('Archive').click();
    await settle();
    expect(reading()).toBe(false);
  });

  it('opens the next conversation when asked to', async () => {
    mount({ advance: true });
    await settle(400);
    const all = rows();
    const after = subjectOf(all[2]);
    all[1].click();
    await settle();
    readerAction('Archive').click();
    await settle(400);
    expect(reading()).toBe(true);
    expect(openSubject()).toBe(after);
  });

  it('opens the newer one at the end of the list', async () => {
    mount({ advance: true });
    await settle(400);
    const all = rows();
    const before = subjectOf(all[all.length - 2]);
    all[all.length - 1].click();
    await settle();
    readerAction('Delete').click();
    await settle(400);
    expect(reading()).toBe(true);
    expect(openSubject()).toBe(before);
  });

  it('goes back to the list when nothing is left', async () => {
    mount({ advance: true });
    await settle(400);
    const all = rows();
    // Everything but one is archived from the list; the last is archived
    // from the reader.
    for (const row of all.slice(1)) {
      [...row.querySelectorAll('.row-action')]
        .find((b) => (b.getAttribute('aria-label') || '').startsWith('Archive')).click();
      await settle(60);
    }
    await settle();
    expect(rows()).toHaveLength(1);
    rows()[0].click();
    await settle();
    readerAction('Archive').click();
    await settle(400);
    expect(reading()).toBe(false);
  });
});
