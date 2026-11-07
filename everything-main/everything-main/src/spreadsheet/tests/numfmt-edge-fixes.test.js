import { describe, expect, it } from 'vitest';
import { formatWithCode, codeColor } from '../src/core/numfmt.js';

describe('numbered section colours', () => {
  it('map [Color1] to [Color8] onto the legacy palette', () => {
    expect(codeColor(5, '[Color3]0')).toBe(codeColor(5, '[Red]0'));
    expect(codeColor(5, '[Color5]0')).toBe(codeColor(5, '[Blue]0'));
    expect(codeColor(5, '[Color1]0')).toBe('#000000');
    expect(codeColor(-5, '0;[Color3]-0')).toBe(codeColor(-5, '0;[Red]-0'));
    expect(codeColor(5, '[Color10]0')).toBe('#008000');
    expect(formatWithCode(5, '[Color3]0')).toBe('5');
  });
});

