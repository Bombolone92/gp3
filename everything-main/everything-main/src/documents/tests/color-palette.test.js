// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { openTextColor } from '../src/views/text-color.js';
import { openTextHighlight } from '../src/views/text-highlight.js';
import { HIGHLIGHTS, highlightLabel } from '../src/engine/backgrounds.js';
import { closeMenu } from '../src/ui/menu.js';

afterEach(() => { closeMenu(); document.body.replaceChildren(); });
const key = key => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
function open(opener, value) {
  const anchor = document.createElement('button'); document.body.append(anchor); anchor.focus();
  const apply = vi.fn();
  return { ...opener(value, apply, { anchor }), anchor, apply };
}

it('shows and focuses the selected color, applies one swatch immediately and ignores stale clicks', () => {
  const { menu, apply, anchor } = open(openTextColor, 'FF0000');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement.getAttribute('aria-label')).toBe('Red');
  expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
  key('ArrowRight'); expect(document.activeElement.getAttribute('aria-label')).toBe('Orange');
  const swatch = document.activeElement; swatch.click(); swatch.click();
  expect(apply).toHaveBeenCalledExactlyOnceWith('FF9900');
  expect(menu.isConnected).toBe(false); expect(document.activeElement).toBe(anchor);
  expect(anchor.getAttribute('aria-expanded')).toBe('false');
});

it('renders all 16 exact OOXML highlights, with explicit removal and no arbitrary custom colors', () => {
  for (const [value, color] of Object.entries(HIGHLIGHTS)) {
    const { menu, apply } = open(openTextHighlight, value);
    expect(menu.querySelectorAll('[role="menuitemradio"]')).toHaveLength(17);
    expect(menu.querySelector('input')).toBeNull();
    const chosen = menu.querySelector('[aria-checked="true"]');
    expect(chosen.getAttribute('aria-label') || chosen.textContent).toBe(highlightLabel(value));
    if (color) {
      const probe = document.createElement('span'); probe.style.background = `#${color}`;
      expect(chosen.style.background).toBe(probe.style.background);
    }
    chosen.click(); expect(apply).toHaveBeenCalledExactlyOnceWith(value);
  }
});

it('leaves mixed selections unchanged on Escape or an outside press', () => {
  for (const dismiss of ['Escape', 'outside']) {
    const { menu, anchor, apply } = open(openTextHighlight, null);
    expect(menu.querySelector('[aria-checked="true"]')).toBeNull();
    expect(menu.textContent).toContain('mixed highlights');
    if (dismiss === 'Escape') key('Escape');
    else document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(apply).not.toHaveBeenCalled(); expect(menu.isConnected).toBe(false);
    expect(document.activeElement).toBe(anchor);
  }
});

it('validates inline hex, keeps native adjustments as drafts, and remembers custom colors', () => {
  const { menu, apply } = open(openTextColor, 'auto');
  const hex = menu.querySelector('input[type="text"]');
  hex.value = 'invalid'; hex.dispatchEvent(new Event('input'));
  menu.querySelector('[type="submit"]').click();
  expect(apply).not.toHaveBeenCalled(); expect(hex.getAttribute('aria-invalid')).toBe('true');
  const native = menu.querySelector('[type="color"]'); native.focus();
  window.dispatchEvent(new Event('blur'));
  native.value = '#123456'; native.dispatchEvent(new Event('input'));
  expect(menu.isConnected).toBe(true); expect(apply).not.toHaveBeenCalled();
  expect(hex.value).toBe('#123456');
  hex.value = '#abc'; hex.dispatchEvent(new Event('input'));
  menu.querySelector('[type="submit"]').click(); expect(apply).toHaveBeenCalledExactlyOnceWith('AABBCC');
  const next = open(openTextColor, 'AABBCC');
  expect(next.menu.querySelector('[aria-label="Recent text colors"] [aria-checked="true"]')).not.toBeNull();
  const stale = next.menu.querySelector('[type="submit"]');
  key('Escape'); stale.click(); expect(next.apply).not.toHaveBeenCalled();
});
