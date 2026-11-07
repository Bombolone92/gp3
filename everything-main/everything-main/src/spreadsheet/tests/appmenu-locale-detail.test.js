// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { openAppMenu } from '../src/ui/appmenu.js';
import { session } from '../src/lib/session.js';
import { closeMenu } from '../src/ui/menu.js';
import { LOCALES, getLocale } from '../src/core/format.js';

let anchor;
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('puter', {
    env: 'web',
    auth: { isSignedIn: () => false, signIn: vi.fn(), getUser: async () => null, signOut: vi.fn() },
    kv: { get: async () => null, set: async () => true },
  });
  anchor = document.createElement('button');
  document.body.append(anchor);
});
afterEach(() => {
  closeMenu();
  document.body.replaceChildren();
  session.state = 'unknown';
  session.user = null;
  vi.unstubAllGlobals();
});

// The item read "Regional format (English (United States))…": nested parentheses. The locale is
// now the muted detail beside the label, in the slot menus use for shortcut hints, and the
// spoken name still carries it.
it('shows the current locale as a detail beside "Regional format", not inside its parentheses', async () => {
  await session.init();
  openAppMenu(anchor);
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.querySelector('.menu-label').textContent === 'Regional format…');
  expect(item).toBeTruthy();
  const localeName = LOCALES.find(([code]) => code === getLocale())?.[1] || getLocale();
  expect(localeName).not.toMatch(/^\s*$/);
  expect(item.querySelector('.menu-shortcut').textContent).toBe(localeName);
  expect(item.getAttribute('aria-label')).toBe(`Regional format, ${localeName}`);
  // A locale name is not a key combination.
  expect(item.hasAttribute('aria-keyshortcuts')).toBe(false);
  expect(item.textContent).not.toMatch(/\(\w[^()]*\(/);
});
