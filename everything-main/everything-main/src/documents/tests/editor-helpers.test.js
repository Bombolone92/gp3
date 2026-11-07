// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { normalizeUrl, fitImage, fitWidthZoom, fitPageZoom } from '../src/lib/editor-helpers.js';
import { normalizeHex } from '../src/ui/colors.js';

describe('normalizeUrl', () => {
  it.each([
    ['https://[2001:db8::1]/guide', 'https://[2001:db8::1]/guide'],
    ['[2001:db8::1]:8443/guide', 'https://[2001:db8::1]:8443/guide'],
    ['http://[::1]:5173', 'http://[::1]:5173/'],
    ['[::1]', 'https://[::1]/'],
  ])('accepts a valid IPv6 link: %s', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it.each(['https://[invalid]/', 'https://[2001:db8::1', '[::1]:70000', 'ftp://[::1]/file'])('rejects an invalid or unsupported IPv6 link: %s', (input) => {
    expect(normalizeUrl(input)).toBeNull();
  });

  it('adds https to bare domains and keeps valid absolute URLs', () => {
    expect(normalizeUrl('puter.com')).toBe('https://puter.com/');
    expect(normalizeUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
    expect(normalizeUrl(' https://example.com/editor ')).toBe('https://example.com/editor');
    expect(normalizeUrl('mailto:hi@example.com')).toBe('mailto:hi@example.com');
    expect(normalizeUrl('#section-2')).toBe('#section-2');
    expect(normalizeUrl('localhost:5173')).toBe('https://localhost:5173/');
  });

  it('rejects things that are not web links', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('just words')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('ftp://files.example.com')).toBeNull();
  });
});

describe('fitImage', () => {
  it('keeps small images and scales wide ones into the page column', () => {
    expect(fitImage(300, 150)).toEqual({ width: 300, height: 150, unit: 'px' });
    expect(fitImage(1240, 620)).toEqual({ width: 620, height: 310, unit: 'px' });
    expect(fitImage(1000, 500, 500)).toEqual({ width: 500, height: 250, unit: 'px' });
    expect(fitImage(0, 10)).toBeNull();
  });
});

describe('normalizeHex', () => {
  it('accepts the shapes the engine and inputs produce', () => {
    expect(normalizeHex('#FF0000')).toBe('#ff0000');
    expect(normalizeHex('00ff00')).toBe('#00ff00');
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    // The file format's "automatic" color is not a color the palette can mark.
    expect(normalizeHex('auto')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('insertionMessage', async () => {
  const { insertionMessage } = await import('../src/lib/editor-helpers.js');
  it('tells the user to click into the page when there is no caret yet, and reports other failures plainly', () => {
    expect(insertionMessage('editing-selection-required')).toBe('Click in the document where the text should go first');
    expect(insertionMessage('rejected')).toBe('Could not insert here');
    expect(insertionMessage(undefined)).toBe('Could not insert here');
  });
});

describe('exportText', async () => {
  const { EXPORT_FORMATS, exportText } = await import('../src/lib/editor-helpers.js');
  const api = { getHtml: async () => '<p>Hi <b>there</b></p>', getMarkdown: async () => 'Hi **there**', getText: async () => 'Hi there' };

  it('covers html, markdown, and text with matching extensions', () => {
    expect(EXPORT_FORMATS.map((f) => f.id)).toEqual(['html', 'md', 'txt']);
    expect(EXPORT_FORMATS.every((f) => f.ext && f.mime && f.label)).toBe(true);
  });

  it('wraps HTML in a standalone page and passes text formats through', async () => {
    const html = await exportText(api, EXPORT_FORMATS[0], 'My <doc>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>My &lt;doc&gt;</title>');
    expect(html).toContain('<p>Hi <b>there</b></p>');
    // The same page is published on the web and downloaded; it has to read on a phone.
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    // A published page's unguessable address must not travel to the sites it links to or loads pictures from.
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    // Nothing may run in the page: the print window opens it under the app's own origin.
    // Pictures may come from the document (data:) or from the web addresses the exporter keeps (https and http alike).
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'">`);
    expect(html).toMatch(/@media print \{ body \{ padding: 0\.5in 0; \} \}/);
    // Letter unless the document says otherwise.
    expect(html).toContain('@page { size: 8.5in 11in; margin: 1in; }');
    expect(html).toContain('max-width: 6.5in;');
  });

  it('lays the page out on the document\'s own paper size', async () => {
    const a4 = await exportText(api, EXPORT_FORMATS[0], 'x', { pageWidthIn: 8.27, pageHeightIn: 11.69 });
    expect(a4).toContain('@page { size: 8.27in 11.69in; margin: 1in; }');
    expect(a4).toContain('max-width: 6.27in;');
    // A size that could not be read is not written into the page.
    const broken = await exportText(api, EXPORT_FORMATS[0], 'x', { pageWidthIn: NaN, pageHeightIn: 0 });
    expect(broken).toContain('@page { size: 8.5in 11in; margin: 1in; }');
    expect(await exportText(api, EXPORT_FORMATS[1], 'x')).toBe('Hi **there**');
    expect(await exportText(api, EXPORT_FORMATS[2], 'x')).toBe('Hi there');
    expect(await exportText({ getText: async () => 'Note\uFFFC here' }, EXPORT_FORMATS[2], 'x')).toBe('Note here');
    await expect(exportText({ getText: async () => null }, EXPORT_FORMATS[2], 'x')).rejects.toThrow();
  });
});

describe('spacingToOoxml', async () => {
  const { spacingToOoxml } = await import('../src/lib/editor-helpers.js');
  it.each(['exact', 'atLeast'])('converts %s line heights from points', (lineRule) => {
    expect(spacingToOoxml({ before: 12, after: 6, line: 21, lineRule })).toEqual({ before: 240, after: 120, line: 420, lineRule });
    expect(spacingToOoxml({ before: 0, after: 0, line: 0, lineRule })).toBeNull();
    expect(spacingToOoxml({ before: 0, after: 0, line: 501, lineRule })).toBeNull();
  });
  it('converts points and multipliers to twips and 240ths', () => {
    expect(spacingToOoxml({ before: 12, after: '6', line: 1.5 })).toEqual({ before: 240, after: 120, line: 360, lineRule: 'auto' });
    expect(spacingToOoxml({ before: 0, after: 0, line: '1' })).toEqual({ before: 0, after: 0, line: 240, lineRule: 'auto' });
    expect(spacingToOoxml({ before: -1, after: 0, line: 1 })).toBeNull();
    expect(spacingToOoxml({ before: 0, after: 0, line: 0.2 })).toBeNull();
    expect(spacingToOoxml({ before: 'x', after: 0, line: 1 })).toBeNull();
  });
  it('leaves blank fields out so the paragraph keeps what its style gives', () => {
    expect(spacingToOoxml({ before: 12, after: NaN, line: '' })).toEqual({ before: 240 });
    expect(spacingToOoxml({ before: '', after: '', line: 2, lineRule: 'auto' })).toEqual({ line: 480, lineRule: 'auto' });
    expect(spacingToOoxml({ before: undefined, after: undefined, line: undefined })).toEqual({});
    expect(spacingToOoxml({ before: '', after: 501, line: '' })).toBeNull();
  });
});

describe('fitWidthZoom', async () => {
  const { fitWidthZoom } = await import('../src/lib/editor-helpers.js');
  it('fits the page width into the host with a margin, clamped to the zoom range', () => {
    expect(fitWidthZoom(390, 8.5)).toBe(41); // (390 - 48) / 816
    expect(fitWidthZoom(390, 11.69)).toBe(30);
    expect(fitWidthZoom(2000, 8.5)).toBe(100);
    expect(fitWidthZoom(60, 8.5, { min: 25 })).toBe(25);
    expect(fitWidthZoom(60, 8.5)).toBe(10);
    expect(fitWidthZoom(0, 8.5)).toBeNull();
    expect(fitWidthZoom(390, 0)).toBeNull();
  });
});

describe('fitPageZoom', () => {
  it('uses the tighter of width and height, with the same padding as fit-to-width', () => {
    // A Letter page (816 x 1056 px at 100%) in a wide, short host: height decides.
    expect(fitPageZoom(2000, 600, 8.5, 11)).toBe(Math.floor(((600 - 48) / 1056) * 100));
    // In a narrow, tall host the width decides and matches fit-to-width.
    expect(fitPageZoom(500, 3000, 8.5, 11)).toBe(fitWidthZoom(500, 8.5));
    expect(fitPageZoom(5000, 5000, 8.5, 11)).toBe(100);
    expect(fitPageZoom(5000, 5000, 8.5, 11, { max: 400 })).toBe(400);
    expect(fitPageZoom(3000, 1200, 8.5, 11, { max: 400 })).toBe(Math.floor(((1200 - 48) / 1056) * 100));
  });

  it('falls back to fit-to-width without a height and rejects empty hosts', () => {
    expect(fitPageZoom(900, 0, 8.5, 11)).toBe(fitWidthZoom(900, 8.5));
    expect(fitPageZoom(0, 600, 8.5, 11)).toBeNull();
  });
});

it('refuses a link with nothing after its scheme or hash', () => {
  expect(normalizeUrl('mailto:')).toBeNull();
  expect(normalizeUrl('tel:')).toBeNull();
  expect(normalizeUrl('#')).toBeNull();
  expect(normalizeUrl('mailto:hi@example.com')).toBe('mailto:hi@example.com');
  expect(normalizeUrl('#section-2')).toBe('#section-2');
});
