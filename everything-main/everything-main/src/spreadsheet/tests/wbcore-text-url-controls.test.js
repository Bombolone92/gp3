import { expect, it } from 'vitest';
import { textUrl, safeLinkUrl } from '../src/core/workbook.js';

// Browsers drop embedded control characters when parsing a URL, so typed text holding one
// must not become a link any more than a HYPERLINK address may.
it('does not turn text holding a control character into a link', () => {
  expect(textUrl('https://ok.example/\x01path')).toBeNull();
  expect(textUrl('https://ok.example/\x7f')).toBeNull();
  expect(textUrl('www.example.com/\x1b')).toBeNull();
  expect(textUrl('user@ok.example\x00')).toBeNull();
  expect(safeLinkUrl('https://ok.example/\x01path')).toBeNull();
  expect(textUrl('https://ok.example/path')).toBe('https://ok.example/path');
  expect(textUrl('www.example.com')).toBe('https://www.example.com');
});
