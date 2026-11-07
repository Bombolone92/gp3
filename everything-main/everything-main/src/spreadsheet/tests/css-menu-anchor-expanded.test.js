// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openMenu, closeMenu } from '../src/ui/menu.js';

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeMenu(); document.body.replaceChildren(); });

const items = [{ label: 'One', onSelect() {} }];

// The Undo and Redo buttons open their history on a right-click or a long press but declare no
// popup, since pressing them undoes. A closed menu left aria-expanded="false" on them, so a screen
// reader announced "Undo, collapsed" for a button that does not expand.
it('takes aria-expanded off an anchor that declares no popup once its menu closes', () => {
  const undo = document.createElement('button');
  document.body.append(undo);
  openMenu({ anchor: undo, items });
  expect(undo.getAttribute('aria-expanded')).toBe('true');
  closeMenu();
  expect(undo.hasAttribute('aria-expanded')).toBe(false);
});

it('keeps aria-expanded="false" on an anchor that is a menu button', () => {
  const button = document.createElement('button');
  button.setAttribute('aria-haspopup', 'menu');
  document.body.append(button);
  openMenu({ anchor: button, items });
  expect(button.getAttribute('aria-expanded')).toBe('true');
  closeMenu();
  expect(button.getAttribute('aria-expanded')).toBe('false');
});
