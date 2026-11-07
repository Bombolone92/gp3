// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps an unfinished game until New game is confirmed', async () => {
  const html = readFileSync('index.html', 'utf8');
  const page = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = page.body.innerHTML;
  localStorage.clear();
  localStorage.setItem('checkers-settings', JSON.stringify({ mode: 'local', movesOpen: true }));
  window.matchMedia = () => ({ matches: true, addEventListener() {} });
  // jsdom does not implement native dialog methods.
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.showModal = function () { this.open = true; };
    dialog.close = function () {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }

  await import('../src/main.js');
  const newGame = document.getElementById('new-game-btn');
  const dialog = document.getElementById('confirm-dialog');
  const moves = () => document.querySelectorAll('#move-list button.ply').length;
  const activate = (square) => document.querySelector(`[data-square="${square}"]`)
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  // A fresh board has no progress to discard.
  document.querySelector('[data-square="11"] .piece').dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
  expect(document.querySelectorAll('.drag-ghost')).toHaveLength(1);
  newGame.click();
  expect(dialog.open).toBe(false);
  expect(document.querySelectorAll('.drag-ghost, .drag-origin')).toHaveLength(0);
  activate(11);
  activate(15);
  expect(moves()).toBe(1);

  newGame.click();
  expect(dialog.open).toBe(true);
  expect(moves()).toBe(1);
  document.getElementById('confirm-no').click();
  expect(dialog.open).toBe(false);
  expect(moves()).toBe(1);

  newGame.click();
  document.getElementById('confirm-yes').click();
  expect(dialog.open).toBe(false);
  expect(moves()).toBe(0);
});
