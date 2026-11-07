// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { openMenu, closeMenu } from '../src/ui/menu.js';
import { stylesheet, declared } from './helpers/css.js';

afterEach(() => { closeMenu(); document.body.replaceChildren(); });

// The account menu gave "Sign in to Puter" a hint, "Save spreadsheets to your own cloud", that the menu
// never rendered: menu items had no hint. It is now a muted second line under the label, and the item's
// description rather than part of its name.
describe('a menu item hint', () => {
  it('is rendered as a second line and spoken as the description of an item named by its label', () => {
    openMenu({ x: 10, y: 10, items: [{ label: 'Sign in', hint: 'Save spreadsheets to your own cloud' }, { label: 'Plain' }] });
    const [withHint, plain] = document.querySelectorAll('.menu-item');
    const hint = withHint.querySelector('.menu-hint');
    expect(hint.textContent).toBe('Save spreadsheets to your own cloud');
    expect(withHint.querySelector('.menu-label').contains(hint)).toBe(true);
    expect(withHint.getAttribute('aria-label')).toBe('Sign in');
    expect(withHint.getAttribute('aria-describedby')).toBe(hint.id);
    expect(hint.id).toBeTruthy();
    expect(plain.querySelector('.menu-hint')).toBeNull();
    expect(plain.hasAttribute('aria-describedby')).toBe(false);
    expect(plain.hasAttribute('aria-label')).toBe(false);
  });

  it('is styled as a muted line of its own', () => {
    const rule = declared(stylesheet('components.css'), '.menu-hint');
    expect(rule.display).toBe('block');
    expect(rule.color).toBe('var(--ink-3)');
    expect(parseFloat(rule['font-size'])).toBeLessThan(13.5);
  });
});

describe('the account menu', () => {
  let sdk, anchor;
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    sdk = {
      env: 'web',
      auth: { isSignedIn: () => false, signIn: vi.fn(async () => {}), getUser: async () => null, signOut: vi.fn() },
      kv: { get: async () => null, set: async () => true },
    };
    vi.stubGlobal('puter', sdk);
    anchor = document.createElement('button');
    document.body.append(anchor);
  });
  afterEach(async () => {
    const { session } = await import('../src/lib/session.js');
    session.state = 'unknown';
    session.user = null;
    vi.unstubAllGlobals();
  });

  it('shows why to sign in under the sign-in item', async () => {
    const { session } = await import('../src/lib/session.js');
    const { openAppMenu } = await import('../src/ui/appmenu.js');
    await session.init();
    openAppMenu(anchor);
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.getAttribute('aria-label') === 'Sign in to Puter');
    expect(item).toBeTruthy();
    expect(item.querySelector('.menu-hint').textContent).toBe('Save spreadsheets to your own cloud');
  });
});
