import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/** The message list's own keyboard, the way mail clients have always done it. */

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

let root;

const mount = async () => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
  });
  await settle();
};

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);
const press = (target, key) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
const focusedIndex = () => rows().indexOf(document.activeElement);

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
});

describe('arrowing through the list', () => {
  it('moves one row at a time, and stops at the ends', async () => {
    await mount();
    rows()[0].focus();
    press(rows()[0], 'ArrowDown');
    expect(focusedIndex()).toBe(1);
    press(document.activeElement, 'ArrowUp');
    expect(focusedIndex()).toBe(0);
    press(document.activeElement, 'ArrowUp');
    expect(focusedIndex()).toBe(0);
    press(document.activeElement, 'End');
    expect(focusedIndex()).toBe(rows().length - 1);
    press(document.activeElement, 'ArrowDown');
    expect(focusedIndex()).toBe(rows().length - 1);
    press(document.activeElement, 'Home');
    expect(focusedIndex()).toBe(0);
  });

  it('keeps the tab stop on the row the keyboard is on after an action', async () => {
    await mount();
    rows()[0].focus();
    press(rows()[0], 'ArrowDown');
    press(document.activeElement, 'ArrowDown');
    expect(focusedIndex()).toBe(2);
    // Marking it read repaints the list; the keyboard is still on the third
    // row, and so is the one place Tab can reach the list from.
    press(document.activeElement, 'u');
    await settle();
    expect(focusedIndex()).toBe(2);
    expect(rows().map((row) => row.tabIndex)).toEqual(rows().map((row, i) => (i === 2 ? 0 : -1)));
  });

  it('carries on from the row a control was clicked in', async () => {
    await mount();
    // Clicking a star or a tick box focuses that button, which is still the
    // row the reader is on.
    rows()[3].querySelector('.star-btn').focus();
    press(document.activeElement, 'ArrowDown');
    expect(focusedIndex()).toBe(4);

    rows()[4].querySelector('.row-check').focus();
    press(document.activeElement, 'ArrowUp');
    expect(focusedIndex()).toBe(3);
  });

  it('leaves Enter and Space to the control that has focus', async () => {
    await mount();
    const star = rows()[2].querySelector('.star-btn');
    star.focus();
    press(star, 'Enter');
    await settle(60);
    // The message did not open: the button answers its own activation keys.
    expect(root.querySelector('.app-frame').classList.contains('reading')).toBe(false);

    rows()[2].focus();
    press(rows()[2], 'Enter');
    await settle(120);
    expect(root.querySelector('.app-frame').classList.contains('reading')).toBe(true);
  });
});
