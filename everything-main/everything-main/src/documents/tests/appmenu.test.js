// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openAppMenu } from '../src/ui/appmenu.js';
import { closeMenu } from '../src/ui/menu.js';
import { applyTheme, currentTheme } from '../src/ui/theme.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

let anchor;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('puter', { env: 'web' });
  applyTheme('system');
  anchor = document.createElement('button');
  document.body.append(anchor);
});
afterEach(() => {
  closeMenu(); document.body.replaceChildren(); applyTheme('system');
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

const radios = () => [...document.querySelectorAll('.menu [role="radiogroup"][aria-label="Appearance"] [role="radio"]')];

it('offers the themes as one radio group reflecting the current choice', () => {
  applyTheme('dark');
  openAppMenu(anchor);
  const buttons = radios();
  expect(buttons.map((b) => b.textContent)).toEqual(['System', 'Light', 'Dark']);
  expect(buttons.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
  expect(buttons.map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
});

it('switches the theme on click and with the arrow keys', () => {
  openAppMenu(anchor);
  const buttons = radios();
  buttons[1].click();
  expect(currentTheme()).toBe('light');
  expect(buttons.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
  buttons[1].focus();
  buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  expect(currentTheme()).toBe('dark');
  expect(document.activeElement).toBe(buttons[2]);
  buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  expect(currentTheme()).toBe('system');
  expect(document.querySelector('.menu')).not.toBeNull();
});

it('moves past the theme group with the up and down arrows without changing the theme', () => {
  openAppMenu(anchor);
  const buttons = radios();
  buttons[0].focus();
  buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(currentTheme()).toBe('system');
  expect(buttons.includes(document.activeElement)).toBe(false);
  // Coming back up lands on the chosen theme, not the last option.
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(buttons[0]);
  expect(currentTheme()).toBe('system');
  expect(buttons.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
});

it('keeps the dark page option in view and enables it as soon as the dark theme is picked', () => {
  openAppMenu(anchor);
  const item = () => [...document.querySelectorAll('.menu-item')].find((button) => button.querySelector('.menu-label')?.firstChild?.textContent === 'Dark page');
  expect(item().disabled).toBe(true);
  radios()[2].click();
  expect(currentTheme()).toBe('dark');
  expect(item().disabled).toBe(false);
  radios()[1].click();
  expect(item().disabled).toBe(true);
  radios()[2].click();
  item().click();
  expect(document.documentElement.dataset.page).toBe('dark');
  expect(localStorage.getItem('documents:dark-page')).toBe('1');
});
