import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { inlineDrawingPlaceholder } from '../src/engine/docx-drawing-preview.js';
import { decodeImages } from '../src/engine/images.js';
let dom;
beforeAll(() => { dom = new JSDOM(); });
afterAll(() => dom.window.close());
const drawing = (content = '<wp:extent cx="457200" cy="914400"/>', kind = 'inline') => new dom.window.DOMParser().parseFromString(`<w:drawing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><wp:${kind}>${content}</wp:${kind}></w:drawing>`, 'application/xml').documentElement;

it('reserves declared dimensions and effect extents without allocating a source bitmap', async () => {
  const assets = {}, node = drawing('<wp:extent cx="457200" cy="914400"/><wp:effectExtent l="9525" t="19050" r="28575" b="38100"/><wp:docPr id="1" name="Original" descr="Original description"/>');
  const before = new dom.window.XMLSerializer().serializeToString(node);
  const image = inlineDrawingPlaceholder(node, assets);
  expect(image).toMatchObject({ width: 457200, height: 914400, alt: 'Original description', previewPlaceholder: true, effectExtent: { left: 9525, top: 19050, right: 28575, bottom: 38100 } });
  expect(new dom.window.XMLSerializer().serializeToString(node)).toBe(before);
  const decoded = await decodeImages(assets);
  expect(decoded.get(image.assetId)).toMatchObject({ previewPlaceholder: true, width: 1, height: 1 });
  expect(inlineDrawingPlaceholder(node, assets).assetId).not.toBe(image.assetId);
});

it.each([
  ['<wp:extent cx="0" cy="914400"/>', 'inline'],
  ['<wp:extent cx="-1" cy="914400"/>', 'inline'],
  ['<wp:extent cx="457200"/>', 'inline'],
  ['<wp:extent cx="999999999999" cy="914400"/>', 'inline'],
  ['<wp:extent cx="457200" cy="914400"/><wp:extent cx="457200" cy="914400"/>', 'inline'],
  ['<wp:extent cx="457200" cy="914400"/><wp:effectExtent l="1" t="1" r="1"/>', 'inline'],
  ['<wp:extent cx="457200" cy="914400"/><a:xfrm rot="5400000"/>', 'inline'],
  ['<wp:extent cx="457200" cy="914400"/>', 'anchor'],
])('does not invent a frame for unsupported placement or invalid geometry: %s', (content, kind) => {
  const assets = {};
  expect(inlineDrawingPlaceholder(drawing(content, kind), assets)).toBeNull();
  expect(assets).toEqual({});
});
