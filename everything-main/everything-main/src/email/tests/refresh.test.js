import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/** Refreshing a folder, which lists it again from scratch. */

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

let root;

const mount = async () => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
  });
  await settle();
};

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);

const tick = (row) => {
  const box = row.querySelector('.row-check');
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};

const ticked = () => rows()
  .filter((row) => row.querySelector('.row-check').checked)
  .map((row) => row.querySelector('.row-subject').textContent);

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
});

describe('refreshing a folder with messages ticked', () => {
  it('carries the selection over to the rows it rebuilt', async () => {
    await mount();
    tick(rows()[1]);
    tick(rows()[3]);
    const chosen = ticked();
    expect(chosen).toHaveLength(2);
    expect(root.querySelector('.list-meta').textContent).toBe('2 selected');

    root.querySelector('.list-toolbar .icon-btn[aria-label="Refresh this folder"]').click();
    await settle(500);

    // The rows are new objects over the same files, so the ticks have to
    // follow the messages rather than being left on rows that are gone --
    // the action bar was still offering to act on them.
    expect(ticked()).toEqual(chosen);
    expect(root.querySelector('.list-meta').textContent).toBe('2 selected');
    expect(root.querySelector('.list-actions').hidden).toBe(false);
  });
});
