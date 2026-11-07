// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { stylesheet, declared, themeTokens, parseColor, contrast } from './helpers/css.js';
import { homeView } from '../src/views/home.js';
import { signInView } from '../src/views/gate.js';
import { session } from '../src/lib/session.js';

// Every wait on the shell screens was silent: the home list's skeleton rows are hidden from assistive
// tech on purpose, so nothing said the list was loading, that it had arrived, or that a search had
// narrowed it; and the gate's only sign that a sign-in was in flight was the button's own label,
// drawn at the disabled 45% (2.0:1) on a button the browser blurs the moment it is disabled.

let sdk, view;
const files = [
  { path: 'Spreadsheets/Budget.xlsx', name: 'Budget.xlsx', size: 12, modified: 2 },
  { path: 'Spreadsheets/Plan.xlsx', name: 'Plan.xlsx', size: 14, modified: 1 },
];

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  sdk = {
    env: 'web',
    auth: { isSignedIn: () => true, signIn: vi.fn(async () => {}), getUser: async () => ({ username: 'nariman', uuid: 'u-1' }) },
    kv: { get: async () => null, set: async () => true },
    fs: { readdir: vi.fn(async () => files), stat: async () => null, mkdir: async () => {} },
    ui: {},
  };
  vi.stubGlobal('puter', sdk);
});

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  session.state = 'unknown';
  session.user = null;
  vi.unstubAllGlobals();
});

const tick = async (n = 12) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

it('marks the home list busy while it loads and says what arrived', async () => {
  await session.init();
  let release;
  sdk.fs.readdir = vi.fn(() => new Promise((res) => { release = () => res(files); }));
  view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
  document.body.append(view.el);
  await tick(6);
  const list = view.el.querySelector('.file-list');
  const status = view.el.querySelector('[role="status"]');
  expect(list.getAttribute('aria-busy')).toBe('true');
  expect(status.textContent).toBe('Loading your spreadsheets…');
  release();
  await tick(20);
  expect(list.hasAttribute('aria-busy')).toBe(false);
  expect(status.textContent).toBe('2 spreadsheets');
});

it('says how a search narrowed the list, and when it matched nothing', async () => {
  await session.init();
  view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
  document.body.append(view.el);
  await tick(16);
  const status = view.el.querySelector('[role="status"]');
  const search = view.el.querySelector('.home-search');
  search.value = 'plan';
  search.dispatchEvent(new Event('input'));
  expect(status.textContent).toBe('1 spreadsheet containing "plan"');
  search.value = 'zzz';
  search.dispatchEvent(new Event('input'));
  expect(status.textContent).toBe('No spreadsheet names contain "zzz"');
  search.value = 'ZZZ';
  search.dispatchEvent(new Event('input'));
  expect(status.textContent).toBe('No spreadsheet names contain "ZZZ"');
});

it('announces a failed load through the same line', async () => {
  await session.init();
  sdk.fs.readdir = vi.fn(async () => { throw new Error('nope'); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
  document.body.append(view.el);
  await tick(20);
  expect(view.el.querySelector('[role="status"]').textContent).toMatch(/Could not load|offline/i);
  expect(view.el.querySelector('.file-list').hasAttribute('aria-busy')).toBe(false);
});

it('says what the gate is waiting for without taking the focus off the button', async () => {
  let release;
  const node = signInView({ title: 'Sign in', message: 'msg', onSignIn: () => new Promise((r) => { release = r; }), onSkip() {} });
  document.body.append(node);
  const cta = node.querySelector('.btn-primary');
  const status = node.querySelector('[role="status"]');
  cta.focus();
  cta.click();
  await Promise.resolve();
  expect(status.textContent).toBe('Waiting for Puter…');
  // The label and the accessible name stay put, and so does the keyboard.
  expect(cta.textContent).toBe('Sign in to Puter');
  expect(cta.disabled).toBe(false);
  expect(cta.getAttribute('aria-disabled')).toBe('true');
  expect(cta.getAttribute('aria-busy')).toBe('true');
  expect(document.activeElement).toBe(cta);
  release();
  await tick(4);
  expect(status.textContent).toBe('');
  expect(cta.hasAttribute('aria-disabled')).toBe(false);
  expect(cta.hasAttribute('aria-busy')).toBe(false);
  node.remove();
});

it('refuses a second click while the gate is waiting', async () => {
  const onSignIn = vi.fn(() => new Promise(() => {}));
  const node = signInView({ title: 'Sign in', message: 'msg', onSignIn, onSkip() {} });
  document.body.append(node);
  const cta = node.querySelector('.btn-primary');
  cta.click();
  await Promise.resolve();
  cta.click();
  cta.click();
  await Promise.resolve();
  expect(onSignIn).toHaveBeenCalledTimes(1);
  node.remove();
});

it('draws the waiting line at full strength and the waiting button dimmed', () => {
  const views = stylesheet('views.css');
  const components = stylesheet('components.css');
  expect(declared(views, '.auth-status').color).toBe('var(--ink-2)');
  // A button turned off with aria-disabled reads as off, the way a disabled one does.
  expect(declared(components, '.btn[aria-disabled="true"]').opacity).toBe('0.45');
  for (const theme of ['light', 'dark']) {
    const t = themeTokens(theme);
    expect(contrast(parseColor(t['ink-2']), parseColor(t.page)), theme).toBeGreaterThanOrEqual(4.5);
  }
});
