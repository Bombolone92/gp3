import { describe, it, expect } from 'vitest';
import { UNDERLINE_STYLES, cssColorToHex, parseUnderline, underlinePatch, applyUnderline } from '../src/lib/underline.js';

describe('underline styles', () => {
  it('reads colors the painter reports, preserving explicit black', () => {
    expect(cssColorToHex('rgb(0, 0, 255)')).toBe('#0000ff');
    expect(cssColorToHex('rgba(255, 0, 0, 1)')).toBe('#ff0000');
    expect(cssColorToHex('#0F0')).toBe('#00ff00');
    expect(cssColorToHex('rgb(0, 0, 0)')).toBe('#000000');
    expect(cssColorToHex('rgba(0, 0, 0, 0)')).toBeNull();
    expect(cssColorToHex('currentcolor')).toBeNull();
  });

  it('reads the underline from a run\'s computed decoration', () => {
    expect(parseUnderline({ textDecorationLine: 'underline', textDecorationStyle: 'wavy', textDecorationColor: 'rgb(255, 0, 0)' })).toEqual({ style: 'wave', color: '#ff0000' });
    expect(parseUnderline({ textDecorationLine: 'underline line-through', textDecorationStyle: 'double', textDecorationColor: 'rgb(0, 0, 0)' })).toEqual({ style: 'double', color: '#000000' });
    expect(parseUnderline({ textDecorationLine: 'underline', textDecorationStyle: 'solid' })).toEqual({ style: 'single', color: null });
    expect(parseUnderline({ textDecorationLine: 'none', textDecorationStyle: 'wavy' })).toBeNull();
    expect(parseUnderline({})).toBeNull();
    expect(UNDERLINE_STYLES.map((s) => s.id)).toEqual(['single', 'double', 'thick', 'dotted', 'dash', 'wave']);
  });

  it('builds the inline patch and applies it', async () => {
    const black = parseUnderline({ textDecorationLine: 'underline', textDecorationColor: 'rgb(0, 0, 0)' });
    expect(underlinePatch({ ...black, style: 'double' })).toEqual({ underline: { style: 'double', color: '000000' } });
    expect(underlinePatch({ style: 'wave', color: '#ff0000' })).toEqual({ underline: { style: 'wave', color: 'FF0000' } });
    expect(underlinePatch({ style: 'double' })).toEqual({ underline: { style: 'double', color: null } });
    expect(underlinePatch({ style: 'bogus' })).toEqual({ underline: { style: 'single', color: null } });
    expect(underlinePatch({ style: 'none' })).toEqual({ underline: false });
    const calls = [];
    const api = { format: { apply: async (i) => { calls.push(i); return { success: true }; } } };
    const target = { kind: 'selection', start: { kind: 'text', blockId: 'p', offset: 0 }, end: { kind: 'text', blockId: 'p', offset: 3 } };
    await applyUnderline(api, target, { style: 'dotted', color: '#0000ff' });
    expect(calls[0]).toEqual({ target, inline: { underline: { style: 'dotted', color: '0000FF' } } });
    await expect(applyUnderline({ format: { apply: async () => ({ success: false, failure: { message: 'no' } }) } }, target, {})).rejects.toThrow('no');
  });
});
