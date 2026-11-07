// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { closeAllModals, openModal } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
let view, listings;

/** Every listing of the templates folder waits until the test releases it. */
beforeEach(async () => {
  vi.useFakeTimers(); localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  listings = [];
  vi.spyOn(P, 'listFolder').mockImplementation(() => new Promise((resolve, reject) => listings.push({ resolve, reject })));
  view = homeView({ openPath: vi.fn(), newDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  // The gallery's own listing at mount.
  for (const listing of listings.splice(0)) listing.resolve([]);
  await vi.advanceTimersByTimeAsync(0);
});
afterEach(() => {
  view.destroy(); closeMenu(); closeAllModals(); vi.runAllTimers(); document.body.replaceChildren();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const templates = () => [...view.el.querySelectorAll('button')].find((b) => b.textContent === 'Templates');
const menuItems = () => [...document.querySelectorAll('.menu .menu-item, .menu .menu-note')].map((b) => b.textContent.trim());

it('opens at once with the built-in templates, then fills in the user\'s own', async () => {
  templates().click();
  await vi.advanceTimersByTimeAsync(0);
  const menu = document.querySelector('.menu[aria-label="Templates"]');
  expect(menu.getAttribute('aria-busy')).toBe('true');
  expect(menuItems()).toContain('Loading your templates…');
  // Item text carries the template's hint after its name.
  expect(menuItems().some((t) => t.startsWith('Letter'))).toBe(true);
  expect(listings).toHaveLength(1);
  listings[0].resolve([{ name: 'Mine.docx', path: 'Documents/Templates/Mine.docx', size: 1, modified: 1 }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(menuItems().some((t) => t.startsWith('Mine'))).toBe(true);
  expect(menuItems()).not.toContain('Loading your templates…');
  expect(document.querySelector('.menu[aria-busy="true"]')).toBeNull();
});

it('does not come back over a dialog opened while the listing was slow', async () => {
  templates().click();
  await vi.advanceTimersByTimeAsync(0);
  const modal = openModal({ title: 'Something else', content: document.createElement('div') });
  listings[0].resolve([]);
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('.menu[aria-label="Templates"]')).toBeNull();
  modal.close();
});

it('says when the user\'s templates could not be listed', async () => {
  templates().click();
  await vi.advanceTimersByTimeAsync(0);
  listings[0].reject(new Error('offline'));
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('.menu .menu-note')?.textContent).toContain('Could not load your templates');
  expect(menuItems().some((t) => t.startsWith('Letter'))).toBe(true);
});

it('keeps the keyboard on the template the user had moved to when the listing lands', async () => {
  templates().click();
  await vi.advanceTimersByTimeAsync(0);
  const label = () => document.activeElement?.querySelector('.menu-label')?.firstChild?.textContent;
  expect(label()).toBe('Letter');
  // The placeholder is a note, not a command that could be chosen.
  expect(document.querySelector('.menu .menu-note')?.textContent).toBe('Loading your templates…');
  for (let i = 0; i < 2; i++) document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  const moved = label();
  expect(moved).not.toBe('Letter');
  listings[0].resolve([{ name: 'Mine.docx', path: 'Documents/Templates/Mine.docx', size: 1, modified: 1 }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(menuItems().some((t) => t.startsWith('Mine'))).toBe(true);
  expect(label()).toBe(moved);
});
