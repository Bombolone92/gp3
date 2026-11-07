// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { openMenu, closeMenu } from '../src/ui/menu.js';

afterEach(() => { closeMenu(); document.documentElement.style.removeProperty('--safe-l'); document.body.replaceChildren(); });

// A context menu opened at the left edge in landscape could sit under the notch: the
// positioning kept 8px from the viewport edge but not from the safe-area inset.
it('keeps a menu clear of the safe-area inset', () => {
  document.documentElement.style.setProperty('--safe-l', '44px');
  const resolved = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-l'));
  const menu = openMenu({ x: 2, y: 100, label: 'Cell', items: [{ label: 'Copy', onSelect() {} }, { label: 'Paste', onSelect() {} }] });
  const node = document.querySelector('.menu');
  const left = parseFloat(node.style.left);
  expect(left).toBeGreaterThanOrEqual(resolved ? 52 : 8);
  menu.close();
});
