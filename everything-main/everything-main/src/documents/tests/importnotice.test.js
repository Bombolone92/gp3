// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { importNotice } from '../src/ui/importnotice.js';
import { IMPORTABLE, IMPORT_ACCEPT, OPENABLE, DOCUMENT_EXTENSIONS, mimeFor } from '../src/lib/puter.js';

it('accepts HWP and HWPX through device and Puter pickers, with their own MIME types', () => {
  for (const ext of ['hwp', 'hwpx']) {
    expect(IMPORTABLE.test(`한글.${ext.toUpperCase()}`)).toBe(true);
    expect(OPENABLE.test(`한글.${ext}`)).toBe(true);
    expect(DOCUMENT_EXTENSIONS).toContain(`.${ext}`);
    expect(IMPORT_ACCEPT).toContain(`.${ext}`);
  }
  expect(mimeFor('한글.HWP')).toBe('application/x-hwp');
  expect(mimeFor('한글.HWPX')).toBe('application/hwp+zip');
  expect(mimeFor('a.docx')).toContain('wordprocessingml.document');
});

it('shows a persistent conversion report using text content, not untrusted markup', () => {
  expect(importNotice(null)).toBeNull();
  const notice = importNotice({ format: 'HWP', sourceName: '<img src=x>.hwp', warnings: ['An equation was simplified.'] });
  expect(notice.tagName).toBe('DETAILS');
  expect(notice.querySelector('summary').textContent).toContain('1 conversion note');
  expect(notice.textContent).toContain('Changes save as a new .docx');
  expect(notice.textContent).toContain('An equation was simplified.');
  expect(notice.querySelector('img')).toBeNull();
});
