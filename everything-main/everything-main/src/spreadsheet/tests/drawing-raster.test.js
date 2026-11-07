// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { drawingRasterSource } from '../src/core/drawingml-raster.js';

const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const source = (x = 'visible', y = 'visible') => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="200 300 1000 400"><foreignObject width="100" height="40" overflow="visible"><div xmlns="http://www.w3.org/1999/xhtml" style="overflow-x:${x};overflow-y:${y}"><div><span style="font-family:Carlito,Arial;font-size:20px;font-weight:700;font-style:normal">Overflow</span></div></div></foreignObject></svg>`).toString('base64')}`;
let matrix;
// jsdom parses @font-face with a declaration parser that drops src and weight
// ranges. Supply CSSFontFaceRule declarations as a browser exposes them.
const faces = entries => vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([{ cssRules: entries.map(attrs => ({ type: 5, style: { getPropertyValue: k => attrs[k] || '' } })) }]);
beforeEach(() => {
  matrix = { a: 1, b: 0, c: 0, d: 1 };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.localName === 'span' ? rect(-12, -9, 145, 80) : rect(0, 0, 100, 40);
  });
  Object.defineProperty(SVGElement.prototype, 'getScreenCTM', { configurable: true, value: () => matrix });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); document.head.replaceChildren(); delete SVGElement.prototype.getScreenCTM; });

it.each([
  ['visible', 'visible', 190, 120], ['clip', 'visible', 100, 120],
  ['visible', 'clip', 190, 40], ['clip', 'clip', 100, 40],
])('measures visible text with independent %s/%s clipping and preserves the center', async (x, y, w, h) => {
  const obj = { drawingShape: true, w: 100, h: 40, rotation: 37, flipH: true };
  const result = await drawingRasterSource(source(x, y), obj);
  expect(result.w).toBe(w); expect(result.h).toBe(h);
  const xml = Buffer.from(result.src.split(',')[1], 'base64').toString();
  const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
  const box = doc.documentElement.getAttribute('viewBox').split(' ').map(Number);
  expect(box[0] + box[2] / 2).toBe(700);
  expect(box[1] + box[3] / 2).toBe(500);
  expect(obj).toEqual({ drawingShape: true, w: 100, h: 40, rotation: 37, flipH: true });
  expect(document.body.childElementCount).toBe(0);
});

it('keeps conservative bounds for a rotated single-axis clip', async () => {
  matrix = { a: .7, b: .7, c: -.7, d: .7 };
  expect(await drawingRasterSource(source('clip', 'visible'), { drawingShape: true, w: 100, h: 40 })).toMatchObject({ w: 190, h: 120 });
});

it('embeds matching same-origin font faces without fetching other weights or external fonts', async () => {
  faces([
    { 'font-family': 'Carlito', 'font-weight': '600 900', src: 'url("/fonts/carlito/test-bold.ttf")' },
    { 'font-family': 'Carlito', 'font-weight': '400', src: 'url("/fonts/carlito/test-regular.ttf")' },
    { 'font-family': 'Arial', 'font-weight': '700', src: 'url("https://example.invalid/font.ttf")' },
  ]);
  const notice = 'Font copyright & license <notice>';
  const fetcher = vi.fn().mockImplementation(async url => ({ ok: true, arrayBuffer: async () => url.endsWith('OFL.txt') ? new TextEncoder().encode(notice).buffer : Uint8Array.of(1, 2, 3).buffer }));
  vi.stubGlobal('fetch', fetcher);
  const result = await drawingRasterSource(source(), { drawingShape: true, w: 100, h: 40 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenCalledWith(new URL('/fonts/carlito/test-bold.ttf', window.location.href).href, { cache: 'force-cache' });
  expect(fetcher).toHaveBeenCalledWith(new URL('/fonts/carlito/OFL.txt', window.location.href).href, { cache: 'force-cache' });
  const xml = Buffer.from(result.src.split(',')[1], 'base64').toString();
  expect(xml).toContain('data:font/ttf;base64,AQID');
  expect(xml).not.toContain('example.invalid');
  expect(new DOMParser().parseFromString(xml, 'image/svg+xml').querySelector('metadata').textContent).toBe(notice);
});

it('removes its temporary layout after errors and leaves cropped/ordinary pictures unchanged', async () => {
  faces([{ 'font-family': 'Carlito', 'font-weight': '700', src: 'url("/fonts/failing.ttf")' }]);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(drawingRasterSource(source(), { drawingShape: true, w: 100, h: 40 })).rejects.toThrow('offline');
  expect(document.body.childElementCount).toBe(0);
  for (const obj of [{ w: 100, h: 40 }, { drawingShape: true, w: 100, h: 40, srcRect: { l: .1 } }]) expect(await drawingRasterSource(source(), obj)).toBeNull();
});

it.each(['absolute', 'oneCell'])('expands only the native raster fallback anchor, preserving its center and rotation: %s', async anchorMode => {
  const { exportDrawings } = await import('../src/core/xlsx-export-drawings.js');
  vi.stubGlobal('Image', class { set src(v) { this.onload(); } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AQID');
  const obj = { type: 'image', drawingShape: true, src: source(), w: 100, h: 40, dx: 60, dy: 70, rotation: 37, flipH: true, anchorMode, anchor: { r: 5, c: 3 } };
  const original = structuredClone(obj), xml = new Map(), media = new Map();
  await exportDrawings({}, { linkAt: () => null }, { id: 'sheet', charts: [obj] }, 1, { set: (p, s) => xml.set(p, s), binary: (p, b) => media.set(p, b), contentType() {} });
  const drawing = xml.get('/xl/drawings/drawing1.xml');
  expect(drawing).toContain(`cx="${190 * 9525}" cy="${120 * 9525}"`);
  expect(drawing).toContain('rot="2220000" flipH="1"');
  if (anchorMode === 'absolute') expect(drawing).toContain(`<xdr:pos x="${15 * 9525}" y="${30 * 9525}"/>`);
  else {
    expect(drawing).toContain(`<xdr:colOff>${15 * 9525}</xdr:colOff>`);
    expect(drawing).toContain(`<xdr:rowOff>${30 * 9525}</xdr:rowOff>`);
  }
  expect(media.get('/xl/media/image1_1.png')).toEqual(Uint8Array.of(1, 2, 3));
  expect(drawing).not.toContain('svgBlip');
  expect(obj).toEqual(original);
});

it.each([['400', 'normal', 'Regular'], ['600', 'normal', 'Bold'],
  ['400', 'italic', 'Italic'], ['700', 'italic', 'BoldItalic']])(
  'embeds the Open Sans %s/%s face with copyright and license notices', async (weight, style, face) => {
    faces([{ 'font-family': "'Open Sans'", 'font-weight': weight, 'font-style': style,
      src: `url("/fonts/opensans/test-${face}.ttf")` }]);
    const fetcher = vi.fn().mockImplementation(async url => ({ ok: true,
      arrayBuffer: async () => new TextEncoder().encode(url.endsWith('.txt') ? `Notice ${url}` : face).buffer }));
    vi.stubGlobal('fetch', fetcher);
    const svg = Buffer.from(source().split(',')[1], 'base64').toString()
      .replace('Carlito,Arial', "'Open Sans',Arial")
      .replace('font-weight:700', `font-weight:${weight}`).replace('font-style:normal', `font-style:${style}`);
    const result = await drawingRasterSource(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      { drawingShape: true, w: 100, h: 40 });
    const doc = new DOMParser().parseFromString(Buffer.from(result.src.split(',')[1], 'base64').toString(), 'image/svg+xml');
    expect(doc.querySelector('style').textContent).toContain(`data:font/ttf;base64,${Buffer.from(face).toString('base64')}`);
    expect(doc.querySelector('metadata').textContent).toContain('/fonts/opensans/README.txt');
    expect(doc.querySelector('metadata').textContent).toContain('/fonts/opensans/LICENSE.txt');
  });
