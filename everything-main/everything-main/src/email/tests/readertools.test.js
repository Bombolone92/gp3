import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * The More menu at the end of the reader's toolbar, which on a narrow screen
 * stands in for the Expand all, Print and View source buttons. The CSS decides
 * when it is shown; what is checked here is that it offers the same three
 * things and that choosing one of them presses the same control.
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

const more = () => root.querySelector('.msg-toolbar .msg-tools');
const menuItems = () => [...document.querySelectorAll('.menu [role^="menuitem"]')];
const item = (label) => menuItems().find((node) => node.textContent.trim() === label);
const openCards = () => [...root.querySelectorAll('.msg-item.is-open')];

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
});

describe('the reader toolbar\'s More menu', () => {
  it('is hidden until the conversation has been read, like the buttons it stands for', async () => {
    mount();
    await settle(400);
    expect(more().hidden).toBe(true);
    await open('Thursday walkthrough');
    expect(more().hidden).toBe(false);
    expect(root.querySelector('.msg-toolbar [aria-label="Print"]').hidden).toBe(false);
  });

  it('offers to fold a conversation, print it, and show its source', async () => {
    mount();
    await open('Thursday walkthrough');
    more().click();
    expect(menuItems().map((node) => node.textContent.trim()))
      .toEqual(['Collapse all', 'Print', 'View source']);
    // View source is on or off, not one of a set.
    expect(item('View source').getAttribute('role')).toBe('menuitemcheckbox');
    expect(item('View source').getAttribute('aria-checked')).toBe('false');

    item('Collapse all').click();
    await settle(50);
    expect(openCards()).toHaveLength(0);
    expect(document.querySelector('.menu')).toBeNull();

    more().click();
    expect(item('Expand all')).toBeTruthy();
    item('View source').click();
    await settle(50);
    expect(root.querySelector('.msg-toolbar [aria-label="View source"]').getAttribute('aria-pressed')).toBe('true');

    more().click();
    expect(item('View source').getAttribute('aria-checked')).toBe('true');
    item('View source').click();
    await settle(50);
    expect(root.querySelector('.msg-toolbar [aria-label="View source"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('leaves folding out of a conversation of one', async () => {
    mount();
    await open('Welcome to your Puter mailbox');
    more().click();
    expect(menuItems().map((node) => node.textContent.trim())).toEqual(['Print', 'View source']);
  });

  it('goes with the reader when it closes', async () => {
    mount();
    await open('Thursday walkthrough');
    root.querySelector('.msg-toolbar [aria-label="Back to list"]').click();
    await settle(50);
    expect(more().hidden).toBe(true);
  });
});
