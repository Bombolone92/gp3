import { describe, it, expect } from 'vitest';
import { parseLength, parseNumber, formatLength } from '../src/lib/units.js';
import { hexToRgb, rgbToHex, rgbToCmyk, cmykToRgb, rgbToHsb, hsbToRgb, parseCssColor } from '../src/lib/color.js';

describe('units', () => {
  it('parses lengths with unit suffixes into points', () => {
    expect(parseLength('1in')).toBeCloseTo(72);
    expect(parseLength('25.4 mm')).toBeCloseTo(72);
    expect(parseLength('2.54cm')).toBeCloseTo(72);
    expect(parseLength('3p6')).toBeCloseTo(42);
    expect(parseLength('10', 'mm')).toBeCloseTo(28.3465, 3);
  });

  it('accepts the spelled-out inch suffixes', () => {
    expect(parseLength('1 inch')).toBeCloseTo(72);
    expect(parseLength('2inches')).toBeCloseTo(144);
    expect(parseLength('1"')).toBeCloseTo(72);
  });

  it('evaluates arithmetic like design-tool fields', () => {
    expect(parseLength('100/4')).toBe(25);
    expect(parseLength('2*36pt + 4')).toBe(76);
    expect(parseLength('-(10 - 4)')).toBe(-6);
    expect(parseNumber('45°')).toBe(45);
  });

  it('rejects malformed input', () => {
    expect(parseLength('abc')).toBeNaN();
    expect(parseLength('')).toBeNaN();
    expect(parseLength('10 +')).toBeNaN();
  });

  it('formats in document units', () => {
    expect(formatLength(72, 'in')).toBe('1 in');
    expect(formatLength(72, 'mm')).toBe('25.4 mm');
  });
});

describe('color', () => {
  it('converts between hex, RGB, HSB and CMYK', () => {
    expect(rgbToHex(hexToRgb('#3c78dc'))).toBe('#3c78dc');
    expect(rgbToHex(hsbToRgb(rgbToHsb(hexToRgb('#3c78dc'))))).toBe('#3c78dc');
    expect(rgbToHex(cmykToRgb(rgbToCmyk(hexToRgb('#3c78dc'))))).toBe('#3c78dc');
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 100 });
  });

  it('parses CSS colors from SVG files', () => {
    expect(parseCssColor('red')).toEqual({ hex: '#ff0000', alpha: 1 });
    expect(parseCssColor('#abc').hex).toBe('#aabbcc');
    expect(parseCssColor('rgba(255, 0, 0, 0.5)')).toEqual({ hex: '#ff0000', alpha: 0.5 });
    expect(parseCssColor('none')).toBeNull();
  });
});
