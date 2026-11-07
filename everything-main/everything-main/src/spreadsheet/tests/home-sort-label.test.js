// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { closeMenu } from '../src/ui/menu.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  document.body.replaceChildren();
  // Each scenario starts with the default preference. Choosing Name in one
  // scenario persists it, just as it does between real home-screen visits.
  localStorage.clear();
});
afterEach(() => { closeMenu(); vi.restoreAllMocks(); document.body.replaceChildren(); });

const menuItem = (text) => [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes(text));

it('labels the sort button while the list is still loading and after a load error', async () => {
  let fail;
  vi.spyOn(P, 'listFiles').mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
  const view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
  document.body.append(view.el);
  const btn = view.el.querySelector('.home-sort');
  expect(btn.textContent).toContain('Last modified');
  fail(new Error('offline'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  expect(view.el.querySelector('.home-sort').textContent).toContain('Last modified');
  view.destroy?.();
});

// The button is on screen and usable in every state of the list, but was relabelled only on the way
// past the signed-out, loading and error branches: choosing a new order left it naming the old one.
it.each([
  ['a load error', () => vi.spyOn(P, 'listFiles').mockRejectedValue(new Error('offline'))],
  ['a load still in flight', () => vi.spyOn(P, 'listFiles').mockImplementation(() => new Promise(() => {}))],
])('renames the sort button when the order changes during %s', async (_when, arrange) => {
  arrange();
  const view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
  document.body.append(view.el);
  await new Promise((r) => setTimeout(r, 0));
  const btn = view.el.querySelector('.home-sort');
  expect(btn.textContent).toContain('Last modified');
  btn.click();
  menuItem('Name').click();
  expect(btn.textContent).toContain('Name');
  expect(btn.getAttribute('aria-label')).toBe('Sort spreadsheets by: Name');
  view.destroy?.();
});
