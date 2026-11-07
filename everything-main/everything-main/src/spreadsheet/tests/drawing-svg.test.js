// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { drawingSvg } from '../src/core/drawingml-svg.js';
import { pictureNode } from '../src/ui/picture.js';
import { drawingText } from '../src/core/drawingml-text.js';
import { fontKeyFor } from '../src/core/format.js';

const node = (name, attrs = {}, children = [], text) => ({ name, attrs, children, text });
const src = text => `data:image/svg+xml;base64,${Buffer.from(text).toString('base64')}`;
const body = props => drawingText(node('sp', {}, [node('txBody', {}, [node('bodyPr', props), node('p', {}, [node('r', {}, [node('rPr', { sz: '2100' }, [node('latin', { typeface: 'Cambria' })]), node('t', {}, [], 'Résumé & 日本語')])])])]), [0, 0, 952500, 285750], () => null, fontKeyFor);
const svg = text => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 952500 285750" preserveAspectRatio="none">${text}</svg>`;

it.each([{}, { horzOverflow: 'clip' }, { vertOverflow: 'clip' }, { horzOverflow: 'clip', vertOverflow: 'clip' }])('honors independent DrawingML text overflow axes: %j', props => {
  const root = drawingSvg(src(svg(body(props))));
  expect(root).not.toBeNull();
  expect(root.style.overflow).toBe('visible');
  const fo = root.querySelector('foreignObject'), text = fo.firstElementChild;
  expect(fo.getAttribute('overflow')).toBe('visible');
  expect(text.style.overflowX).toBe(props.horzOverflow === 'clip' ? 'clip' : 'visible');
  expect(text.style.overflowY).toBe(props.vertOverflow === 'clip' ? 'clip' : 'visible');
  expect(text.textContent).toBe('Résumé & 日本語');
  expect(text.querySelector('span').style.fontFamily).toContain('Caladea');
});

it('uses accessible inline text with the same rotation/flips and isolated images for ordinary SVG', () => {
  const image = { type: 'image', src: src(svg(body({}))), drawingShape: true, title: 'Revenue annotation', rotation: 27, flipH: true };
  const root = pictureNode(image);
  expect(root.localName).toBe('svg');
  expect(root.getAttribute('role')).toBe('img');
  expect(root.getAttribute('aria-label')).toBe(image.title);
  expect(root.style.transform).toContain('rotate(27deg)');
  expect(root.style.transform).toContain('scale(-1, 1)');
  expect(pictureNode({ ...image, drawingShape: false }).localName).toBe('img');
});

it.each([
  '<script>alert(1)</script>',
  '<g onload="alert(1)"/>',
  '<path fill="url(https://example.invalid/a)"/>',
  '<image href="https://example.invalid/a.png"/>',
  '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="https://example.invalid/a"/></div></foreignObject>',
  '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="background:url(https://example.invalid/a)"/></foreignObject>',
  '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="position:fixed;inset:0"/></foreignObject>',
  '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="color:var(--external)"/></foreignObject>',
  '<foreignObject><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/></foreignObject>',
])('keeps unsupported or active SVG in its isolated image context: %s', unsafe => {
  const source = src(svg(body({}) + unsafe));
  expect(drawingSvg(source)).toBeNull();
  expect(pictureNode({ drawingShape: true, src: source }).localName).toBe('img');
});

it('rejects malformed XML, entity definitions and excessive trees', () => {
  expect(drawingSvg(src('<svg>foreignObject'))).toBeNull();
  expect(drawingSvg(src('<!DOCTYPE svg [<!ENTITY boom "hello">]>' + svg(body({}))))).toBeNull();
  expect(drawingSvg(src(svg('<g>'.repeat(65) + body({}) + '</g>'.repeat(65))))).toBeNull();
});
