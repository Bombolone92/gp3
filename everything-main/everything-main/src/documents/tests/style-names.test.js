import { it, expect } from 'vitest';
import { styleDisplayName } from '../src/lib/style-names.js';

it('shows built-in style names in display form and leaves custom names alone', () => {
  expect(styleDisplayName('heading 1')).toBe('Heading 1');
  expect(styleDisplayName('footnote text')).toBe('Footnote Text');
  expect(styleDisplayName('annotation text')).toBe('Comment Text');
  expect(styleDisplayName('toc 2')).toBe('TOC 2');
  expect(styleDisplayName('normal (web)')).toBe('Normal (Web)');
  expect(styleDisplayName('Title')).toBe('Title');
  expect(styleDisplayName('My custom STYLE')).toBe('My custom STYLE');
  expect(styleDisplayName('')).toBe('');
});
