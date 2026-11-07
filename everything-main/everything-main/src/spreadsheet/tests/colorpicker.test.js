// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeHex, isHex, recentColors, rememberColor, customColorRows } from '../src/ui/colorpicker.js';

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
});

describe('custom colors', () => {
  it('normalizes hex codes', () => {
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc');
    expect(normalizeHex('abc')).toBe('#aabbcc');
    expect(normalizeHex(' #123456 ')).toBe('#123456');
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(isHex('#123456')).toBe(true);
    expect(isHex('#12345g')).toBe(false);
  });

  it('remembers the last six custom colors, newest first, without duplicates', () => {
    expect(recentColors()).toEqual([]);
    for (const c of ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777']) rememberColor(c);
    expect(recentColors()).toEqual(['#777777', '#666666', '#555555', '#444444', '#333333', '#222222']);
    rememberColor('#444444');
    expect(recentColors()[0]).toBe('#444444');
    expect(recentColors().length).toBe(6);
    rememberColor('nonsense');
    expect(recentColors().length).toBe(6);
  });

  it('builds recent swatches, a custom swatch, and a hex field that picks on Enter', () => {
    rememberColor('#abcdef');
    const picked = [];
    const rows = customColorRows({ current: '#abcdef', onPick: (hex) => picked.push(hex) });
    expect(rows.length).toBe(2);
    const recent = rows[0].querySelectorAll('.swatch');
    expect(recent.length).toBe(1);
    expect(recent[0].getAttribute('aria-checked')).toBe('true');
    recent[0].click();
    expect(picked).toEqual(['#abcdef']);
    const hex = rows[1].querySelector('.color-hex');
    expect(hex.value).toBe('#abcdef');
    hex.value = 'nope';
    hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(hex.classList.contains('invalid')).toBe(true);
    expect(picked.length).toBe(1);
    hex.value = '0F0';
    hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(picked[1]).toBe('#00ff00');
    expect(recentColors()[0]).toBe('#00ff00');
    expect(rows[1].querySelector('.swatch.custom')).not.toBeNull();
  });
});
