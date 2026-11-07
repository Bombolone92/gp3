// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeHex, openColorMenu, TEXT_COLORS, HIGHLIGHT_COLORS } from '../src/ui/colors.js';
import { closeMenu } from '../src/ui/menu.js';

afterEach(() => { closeMenu(); document.body.replaceChildren(); });

function palette(options = {}) {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  anchor.focus();
  const onPick = vi.fn();
  const { menu } = openColorMenu({ anchor, colors: TEXT_COLORS, onPick, ...options });
  return { menu, anchor, onPick };
}

function key(value) {
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
}

describe('color values', () => {
  it('normalizes hex and opaque CSS colors without confusing transparency with black', () => {
    expect(normalizeHex(' FF0000 ')).toBe('#ff0000');
    expect(normalizeHex('#0F0')).toBe('#00ff00');
    expect(normalizeHex('rgb(0, 0, 255)')).toBe('#0000ff');
    // A highlight stored in the file arrives by its name, in whichever case the reader reports it.
    expect(normalizeHex('YELLOW')).toBe('#ffff00');
    expect(normalizeHex('darkBlue')).toBe('#000080');
    expect(normalizeHex('lightGray')).toBe('#c0c0c0');
    expect(normalizeHex('constructor')).toBeNull();
    expect(normalizeHex('rgba(0, 0, 0, 1)')).toBe('#000000');
    expect(normalizeHex('rgba(0, 0, 0, 0)')).toBeNull();
    expect(normalizeHex('transparent')).toBeNull();
    expect(normalizeHex('auto')).toBeNull();
    expect(normalizeHex('not-a-color')).toBeNull();
  });
});

describe('color palette', () => {
  it('applies a preset or no color once and returns focus', () => {
    const p = palette({ colors: HIGHLIGHT_COLORS, label: 'Highlight color', noneLabel: 'No highlight' });
    p.menu.querySelector('[aria-label="Yellow"]').click();
    expect(p.onPick).toHaveBeenCalledExactlyOnceWith('#ffff00');
    expect(p.menu.isConnected).toBe(false);
    expect(document.activeElement).toBe(p.anchor);
    const n = palette({ noneLabel: 'No highlight' });
    n.menu.querySelector('.menu-item').click();
    expect(n.onPick).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('moves across swatch columns and rows with the arrow keys', () => {
    const { menu } = palette();
    const swatches = menu.querySelectorAll('button.swatch');
    expect(document.activeElement).toBe(swatches[0]);
    key('ArrowRight');
    expect(document.activeElement).toBe(swatches[1]);
    key('ArrowDown');
    expect(document.activeElement).toBe(swatches[9]);
    key('ArrowLeft');
    expect(document.activeElement).toBe(swatches[8]);
    key('ArrowUp');
    expect(document.activeElement).toBe(swatches[0]);
  });

  it('keeps native custom color changes pending until Apply, including window blur', () => {
    const { menu, onPick } = palette();
    const input = menu.querySelector('input[type="color"]');
    input.focus();
    window.dispatchEvent(new Event('blur'));
    expect(menu.isConnected).toBe(true);
    for (const color of ['#123456', '#abcdef']) {
      input.value = color;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    expect(onPick).not.toHaveBeenCalled();
    menu.querySelector('button[type="submit"]').click();
    expect(onPick).toHaveBeenCalledExactlyOnceWith('#abcdef');
    expect(menu.isConnected).toBe(false);
  });

  it('can reach custom Apply by keyboard and leave the last swatch row', () => {
    const { menu } = palette();
    menu.querySelectorAll('button.swatch')[63].focus();
    key('ArrowDown');
    expect(document.activeElement).toBe(menu.querySelector('.menu-item'));
    key('ArrowDown');
    expect(document.activeElement).toBe(menu.querySelector('input[type="color"]'));
    key('Tab');
    expect(document.activeElement).toBe(menu.querySelector('input[type="text"]'));
    key('Tab');
    expect(document.activeElement).toBe(menu.querySelector('button[type="submit"]'));
    expect(menu.isConnected).toBe(true);
  });

  it('accepts a typed hex color and rejects invalid input without clearing formatting', () => {
    const { menu, onPick } = palette();
    const input = menu.querySelector('input[type="text"]');
    input.value = 'oops';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    menu.querySelector('button[type="submit"]').click();
    expect(onPick).not.toHaveBeenCalled();
    expect(menu.isConnected).toBe(true);
    input.value = '#0F0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    menu.querySelector('button[type="submit"]').click();
    expect(onPick).toHaveBeenCalledExactlyOnceWith('#00ff00');
  });

  it('can apply the default custom black and cancels without a late picker change applying', () => {
    const first = palette();
    first.menu.querySelector('button[type="submit"]').click();
    expect(first.onPick).toHaveBeenCalledExactlyOnceWith('#000000');
    const second = palette();
    const input = second.menu.querySelector('input[type="color"]');
    input.focus();
    key('Escape');
    input.value = '#123456';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(second.onPick).not.toHaveBeenCalled();
    expect(second.menu.isConnected).toBe(false);
  });
});

it.each(['button.swatch', '.menu-item'])('ignores a cancelled or repeated %s choice', selector => {
  const cancelled = palette();
  const stale = cancelled.menu.querySelector(selector);
  closeMenu(); stale.click();
  expect(cancelled.onPick).not.toHaveBeenCalled();
  const picked = palette();
  const swatch = picked.menu.querySelector(selector);
  swatch.click(); swatch.click();
  expect(picked.onPick).toHaveBeenCalledOnce();
});

describe('swatch names', () => {
  it('names every swatch of both palettes, each name once, so the palette can be used without sight', async () => {
    const { COLOR_NAMES } = await import('../src/ui/colors.js');
    for (const colors of [TEXT_COLORS, HIGHLIGHT_COLORS]) {
      const names = colors.map((hex) => COLOR_NAMES[hex]);
      for (const name of names) expect(name).toMatch(/^[A-Z][a-z]+(?: [a-z]+)*$/);
      expect(new Set(names).size).toBe(colors.length);
    }
    expect(COLOR_NAMES['#980000']).toBe('Red berry');
    expect(COLOR_NAMES['#e6b8af']).toBe('Pale red berry');
    expect(COLOR_NAMES['#0b5394']).toBe('Darker blue');
    expect(COLOR_NAMES['#0c343d']).toBe('Darkest cyan');
    const { menu } = palette({ colors: TEXT_COLORS, label: 'Text color' });
    const labels = [...menu.querySelectorAll('button.swatch')].map((b) => b.getAttribute('aria-label'));
    expect(labels.some((l) => l.startsWith('#'))).toBe(false);
    expect(labels).toContain('Darker blue');
  });
});
