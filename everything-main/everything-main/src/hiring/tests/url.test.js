import { describe, it, expect } from 'vitest';
import { safeHttpUrl } from '../src/lib/url.js';

describe('safeHttpUrl', () => {
  it('passes http(s) URLs through, normalized', () => {
    expect(safeHttpUrl('https://example.com/page')).toBe('https://example.com/page');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
    expect(safeHttpUrl('  https://example.com  ')).toBe('https://example.com/');
  });

  it('upgrades scheme-less links to https', () => {
    expect(safeHttpUrl('linkedin.com/in/ada')).toBe('https://linkedin.com/in/ada');
    expect(safeHttpUrl('//cdn.example.com/x')).toBe('https://cdn.example.com/x');
  });

  it('recognizes host:port input as a host, not a scheme', () => {
    expect(safeHttpUrl('example.com:8080/path')).toBe('https://example.com:8080/path');
    expect(safeHttpUrl('localhost:3000')).toBe('https://localhost:3000/');
    expect(safeHttpUrl('1.2.3.4:8080')).toBe('https://1.2.3.4:8080/');
    // Real schemes are still detected and filtered.
    expect(safeHttpUrl('tel:123')).toBeNull();
  });

  it('rejects script-bearing and non-web schemes', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('JavaScript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHttpUrl('vbscript:x')).toBeNull();
    expect(safeHttpUrl('file:///etc/passwd')).toBeNull();
    expect(safeHttpUrl('mailto:a@b.com')).toBeNull();
  });

  it('rejects userinfo URLs, including a pasted email address', () => {
    expect(safeHttpUrl('ada@example.com')).toBeNull();
    expect(safeHttpUrl('https://ada@example.com')).toBeNull();
    expect(safeHttpUrl('https://user:pass@example.com')).toBeNull();
  });

  it('rejects empty and nonsense input', () => {
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl('   ')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl('asdf')).toBeNull();
  });

  it('keeps localhost usable for development links', () => {
    expect(safeHttpUrl('http://localhost:5173/x')).toBe('http://localhost:5173/x');
  });
});
