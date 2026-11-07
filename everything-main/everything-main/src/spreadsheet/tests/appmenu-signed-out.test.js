// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { openAppMenu } from '../src/ui/appmenu.js';
import { session } from '../src/lib/session.js';
import { closeMenu } from '../src/ui/menu.js';

const items = () => [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
const header = () => document.querySelector('.menu-header')?.textContent;

let sdk, anchor;
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  sdk = {
    env: 'web',
    _signedIn: false,
    auth: {
      isSignedIn: () => sdk._signedIn,
      signIn: vi.fn(async () => { sdk._signedIn = true; }),
      getUser: async () => (sdk._signedIn ? { username: 'nariman' } : null),
      signOut: vi.fn(),
    },
    kv: { get: async () => null, set: async () => true },
  };
  vi.stubGlobal('puter', sdk);
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

it('offers the sign-in instead of sign-out while nobody is signed in', async () => {
  await session.init();
  openAppMenu(anchor);
  expect(header()).toContain('Not signed in');
  expect(items().some((l) => l.startsWith('Sign in to Puter'))).toBe(true);
  expect(items().some((l) => l.startsWith('Sign out'))).toBe(false);
  [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.startsWith('Sign in to Puter')).click();
  await vi.waitFor(() => expect(sdk.auth.signIn).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(session.signedIn).toBe(true));

  openAppMenu(anchor);
  expect(header()).toContain('nariman');
  expect(items().some((l) => l.startsWith('Sign out'))).toBe(true);
  expect(items().some((l) => l.startsWith('Sign in to Puter'))).toBe(false);
});
