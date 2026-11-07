import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * Expand all and Collapse all over a conversation.
 */

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

let root;

const mount = () => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
  });
};

const open = async (subject) => {
  if (!root.querySelector('.row')) await settle(400);
  [...root.querySelectorAll('.row')]
    .find((row) => row.querySelector('.row-subject').textContent === subject)
    .click();
  await settle(400);
};

const cards = () => [...root.querySelectorAll('.msg-item')];
const openCards = () => cards().filter((card) => card.classList.contains('is-open'));
const fold = () => root.querySelector('.msg-toolbar [aria-label="Expand all"], .msg-toolbar [aria-label="Collapse all"]');

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
});

describe('Expand all / Collapse all', () => {
  it('folds a whole conversation away and opens it again', async () => {
    mount();
    await open('Thursday walkthrough');
    // Three unread messages open as three; the control offers to fold them.
    expect(openCards()).toHaveLength(3);
    expect(fold().getAttribute('aria-label')).toBe('Collapse all');

    fold().click();
    await settle(50);
    expect(openCards()).toHaveLength(0);
    expect(fold().getAttribute('aria-label')).toBe('Expand all');

    fold().click();
    await settle(300);
    expect(openCards()).toHaveLength(3);
    expect(fold().getAttribute('aria-label')).toBe('Collapse all');
  });

  it('follows a message opened or closed by hand', async () => {
    mount();
    await open('Thursday walkthrough');
    cards()[0].querySelector('.msg-item-toggle').click();
    await settle(50);
    expect(openCards()).toHaveLength(2);
    expect(fold().getAttribute('aria-label')).toBe('Expand all');
  });

  it('is not offered on a conversation of one', async () => {
    mount();
    await open('Welcome to your Puter mailbox');
    expect(fold().hidden).toBe(true);
  });
});
