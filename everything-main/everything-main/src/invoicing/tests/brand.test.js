import { describe, it, expect } from 'vitest';
import { isLogoDataUri, logoOf, normalizeHexColor, brandColorOf } from '../src/lib/brand.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('isLogoDataUri', () => {
  it('accepts base64 image data URIs', () => {
    expect(isLogoDataUri(PNG)).toBe(true);
    expect(isLogoDataUri('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(isLogoDataUri('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(true);
  });

  it('rejects anything that would reach outside the document', () => {
    expect(isLogoDataUri('https://example.com/logo.png')).toBe(false);
    expect(isLogoDataUri('/logo.png')).toBe(false);
    expect(isLogoDataUri('javascript:alert(1)')).toBe(false);
    expect(isLogoDataUri('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    // Not base64: an URL-encoded SVG could carry quotes into the attribute.
    expect(isLogoDataUri('data:image/svg+xml,<svg onload="x">')).toBe(false);
    expect(isLogoDataUri('')).toBe(false);
    expect(isLogoDataUri(undefined)).toBe(false);
  });
});

describe('logoOf', () => {
  it('returns the logo of a settings blob, or null', () => {
    expect(logoOf({ business: { logo: PNG } })).toBe(PNG);
    expect(logoOf({ business: { logo: `  ${PNG}  ` } })).toBe(PNG);
    expect(logoOf({ business: {} })).toBe(null);
    expect(logoOf({})).toBe(null);
    expect(logoOf({ business: { logo: 'http://x/y.png' } })).toBe(null);
  });
});

describe('normalizeHexColor', () => {
  it('expands and lowercases hex colors', () => {
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc');
    expect(normalizeHexColor('1F6F5C')).toBe('#1f6f5c');
    expect(normalizeHexColor('#1f6f5c')).toBe('#1f6f5c');
  });

  it('rejects anything that is not a hex color', () => {
    expect(normalizeHexColor('red')).toBe('');
    expect(normalizeHexColor('#12345')).toBe('');
    expect(normalizeHexColor('rgb(0,0,0)')).toBe('');
    expect(normalizeHexColor('#abc; background:url(x)')).toBe('');
    expect(normalizeHexColor('')).toBe('');
    expect(normalizeHexColor(null)).toBe('');
  });
});

describe('brandColorOf', () => {
  it('reads the tint from settings and defaults to none', () => {
    expect(brandColorOf({ brandColor: '#ABC' })).toBe('#aabbcc');
    expect(brandColorOf({})).toBe('');
    expect(brandColorOf(null)).toBe('');
  });
});
