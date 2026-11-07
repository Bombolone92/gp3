import { MAX_DOCUMENT_CHARACTERS } from './text-limits.js';
import { parseXml } from './docx-xml.js';
import { vectorImage } from './vector-image-effects.js';
import { nativeSvgStrokes } from './svg-native-strokes.js';
import { validateSvgUses } from './svg-use.js';
import { svgResourceAttributes, validateSvgResourceAttribute, embeddedSvgRaster, validateSvgEffects } from './svg-resources.js';
export const SVG_MIME = 'image/svg+xml';
const SVG = 'http://www.w3.org/2000/svg', XLINK = 'http://www.w3.org/1999/xlink';
const elements = new Set('svg g defs use path rect circle ellipse line polyline polygon linearGradient radialGradient stop clipPath title desc style text tspan mask filter feColorMatrix image'.split(' '));
const properties = new Set('mask mask-type filter color-interpolation color-interpolation-filters fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity clip-path clip-rule color stop-color stop-opacity display visibility overflow transform vector-effect shape-rendering font-family font-size font-style font-weight font-stretch font-variant text-anchor letter-spacing word-spacing text-decoration dominant-baseline alignment-baseline baseline-shift direction unicode-bidi'.split(' '));
const attributes = new Set('id class version x y x1 x2 y1 y2 width height viewBox preserveAspectRatio d points cx cy r rx ry fx fy fr offset gradientUnits gradientTransform spreadMethod clipPathUnits dx dy rotate textLength lengthAdjust'.split(' '));
const fail = why => { throw new Error(`Unsupported SVG: ${why}.`); };
const localReference = value => /^#[A-Za-z_][\w.:-]*$/.test(value);
function presentation(value, references, property) {
  if (['mask','filter'].includes(property) && !/^(?:none|inherit|url\(\s*#[\w.:-]+\s*\))$/.test(value.trim())) fail(`unsupported ${property}`);
  if (property === 'mask-type' && !['luminance','alpha','inherit'].includes(value.trim())) fail('mask type');
  if (['color-interpolation','color-interpolation-filters'].includes(property) && !['sRGB','linearRGB','auto','inherit'].includes(value.trim())) fail('color interpolation');
  if (property === 'font-family') {
    // Only literal local family lists; no escapes, CSS functions or URLs.
    if (!/^(?:[\p{L}\p{N}_-]+(?:\s+[\p{L}\p{N}_-]+)*|"[\p{L}\p{N}_ .-]+"|'[\p{L}\p{N}_ .-]+')(?:\s*,\s*(?:[\p{L}\p{N}_-]+(?:\s+[\p{L}\p{N}_-]+)*|"[\p{L}\p{N}_ .-]+"|'[\p{L}\p{N}_ .-]+'))*$/u.test(value.trim())) fail('unsupported font family');
    return;
  }
  // No CSS escapes, imports, variables, custom properties or external resources.
  if (/[^\w\s#.,%()+\-:/]/.test(value)) fail('unsupported presentation syntax');
  const plain = value.replace(/url\(\s*(#[\w.:-]+)\s*\)/gi, (_, id) => { references.push(id.slice(1)); return ''; });
  if (/url\s*\(|(?:var|env|attr)\s*\(/i.test(plain) || /:|\//.test(plain)) fail('nonlocal or dynamic presentation');
}
function declarations(value, references) {
  for (const declaration of value.split(';').filter(s => s.trim())) {
    const match = /^\s*([a-z-]+)\s*:\s*([^;]+?)\s*$/.exec(declaration);
    if (!match || !properties.has(match[1])) fail('unsupported style declaration');
    presentation(match[2], references, match[1]);
  }
}
export function svgInfo(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 10 * 1024 * 1024) fail('image exceeds 10 MB');
  const doc = parseXml(bytes), root = doc.documentElement;
  if (root.namespaceURI !== SVG || root.localName !== 'svg') fail('missing SVG root');
  const ids = new Map(), references = [], stack = [[root, 0]];
  const rasterBudget = {pixels:0};
  let count = 0, textLength = 0, textSpans = 0;
  // Processing instructions can reference external stylesheets; never decode them.
  const nodes = [doc];
  while (nodes.length) { const node = nodes.pop(); if (node.nodeType === 7) fail('processing instructions'); nodes.push(...node.childNodes); }
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (++count + textSpans > 20000 || depth > 64) fail('drawing complexity exceeds the preview limit');
    if (node.namespaceURI !== SVG || !elements.has(node.localName) || node !== root && node.localName === 'svg') fail(`element ${node.localName}`);
    if (node.hasAttribute('id')) {
      const id = node.getAttribute('id'); if (!localReference('#' + id) || ids.has(id)) fail('invalid or duplicate IDs'); ids.set(id, node);
    }
    for (const attr of node.attributes) {
      if (attr.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
      if (attr.namespaceURI === 'http://www.w3.org/XML/1998/namespace' && attr.localName === 'space') {
        if (!['default', 'preserve'].includes(attr.value)) fail('invalid xml:space');
        continue;
      }
      if ((!attr.namespaceURI || attr.namespaceURI === XLINK) && attr.localName === 'href' && node.localName === 'image') {
        if (attr.namespaceURI === XLINK || !node.hasAttributeNS(XLINK,'href')) embeddedSvgRaster(attr.value, rasterBudget);
        if (node.hasAttribute('href') && node.hasAttributeNS(XLINK,'href') && node.getAttribute('href') !== node.getAttributeNS(XLINK,'href')) fail('conflicting embedded image references');
        continue;
      }
      if ((!attr.namespaceURI || attr.namespaceURI === XLINK) && attr.localName === 'href' && ['linearGradient', 'radialGradient', 'use'].includes(node.localName)) {
        if (!localReference(attr.value)) fail('nonlocal SVG reference');
        if (node.localName !== 'use' || attr.namespaceURI === XLINK || !node.hasAttributeNS(XLINK, 'href')) references.push(attr.value.slice(1));
        continue;
      }
      if (attr.namespaceURI) fail('namespaced attribute ' + attr.localName);
      if (attr.name === 'style') declarations(attr.value, references);
      else if (properties.has(attr.name)) presentation(attr.value, references, attr.name);
      else if (svgResourceAttributes.has(attr.name)) validateSvgResourceAttribute(node,attr.name,attr.value);
      else if (!attributes.has(attr.name)) fail('attribute ' + attr.name);
    }
    if (node.localName === 'style') {
      const css = node.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
      let end = 0;
      for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (css.slice(end, match.index).trim() || !/^[\w\s.#,>+~-]+$/.test(match[1])) fail('unsupported CSS rule');
        declarations(match[2], references); end = match.index + match[0].length;
      }
      if (css.slice(end).trim()) fail('unsupported CSS rule');
    } else if (!['title', 'desc', 'text', 'tspan'].includes(node.localName) && [...node.childNodes].some(n => (n.nodeType === 3 || n.nodeType === 4) && n.textContent.trim())) fail('unexpected drawing text');
    if (['text', 'tspan'].includes(node.localName)) for (const child of node.childNodes) if ([3, 4].includes(child.nodeType)) {
      textLength += child.textContent.length;
      if (textLength > MAX_DOCUMENT_CHARACTERS) fail('text exceeds 5,000,000 characters');
      // Account for the preview spans used to retain nonbreaking-space spacing.
      textSpans += (child.textContent.match(/\u00a0+/g) || []).length;
      if (count + textSpans > 20000) fail('drawing complexity exceeds the preview limit');
    }
    for (const child of node.children) stack.push([child, depth + 1]);
  }
  for (const id of references) if (!ids.has(id)) fail('missing local resource');
  validateSvgUses(root, ids);
  validateSvgEffects(root, ids);
  const dimension = name => {
    const value = root.getAttribute(name)?.trim(), match = /^(\d+(?:\.\d*)?|\.\d+)(px|pt|pc|in|cm|mm)?$/.exec(value || '');
    if (value === undefined || value === null || value === 'auto' || /^\d+(?:\.\d+)?%$/.test(value)) return undefined;
    if (!match) fail('explicit positive width and height are required');
    return Number(match[1]) * ({ px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 }[match[2]] || 1);
  };
  let width = dimension('width'), height = dimension('height');
  if (width === undefined || height === undefined) {
    const tokens = root.getAttribute('viewBox')?.trim().split(/[\s,]+/);
    if (!tokens || tokens.length !== 4 || !tokens.every(v => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v))) fail('a positive viewBox is required for automatic dimensions');
    const box = tokens.map(Number);
    if (!box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) fail('a positive viewBox is required for automatic dimensions');
    const ratio = box[2] / box[3];
    // A viewBox supplies an aspect ratio, not intrinsic pixel dimensions.
    // Fit ratio-only images into the CSS default object size (300 by 150).
    if (width === undefined && height === undefined) { width = Math.min(300, 150 * ratio); height = width / ratio; }
    else if (width === undefined) width = height * ratio;
    else height = width / ratio;
  }
  if (!(width > 0 && height > 0) || width > 8192 || height > 8192 || width * height > 16000000) fail('image dimensions exceed the preview limit');
  return { mime: SVG_MIME, width, height };
}

export async function decodeSvg(bytes) {
  const { width, height } = svgInfo(bytes);
  const doc = parseXml(bytes);
  const preview = nativeSvgStrokes(doc.documentElement, { width, height }, true);
  // Image context keeps SVG isolated from the application DOM. The original
  // vector is drawn at the requested canvas size, never its raster fallback.
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(preview)], { type: SVG_MIME })), image = new Image();
  try {
    image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) fail('empty decoded image');
    image.close = () => { image.removeAttribute('src'); URL.revokeObjectURL(url); };
    return vectorImage(image);
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
