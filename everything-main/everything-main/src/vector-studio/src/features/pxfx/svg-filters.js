/**
 * Effect > SVG Filters: the built-in filter library, filters imported into
 * the document (root.svgFilters = [{ id, name, markup }]) and the
 * 'svgFilter' effect record { name, markup }, which carries its own
 * markup so it renders and exports without looking anything up.
 */
import { compileFilter, filtersFromSvg, filterOutset, renderFilter } from './svg-filter-render.js';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const wide = 'x="-25%" y="-25%" width="150%" height="150%"';
const f = (id, name, attrs, body) => ({ id: `builtin:${id}`, name, markup: `<filter ${NS} id="${id}" ${attrs}>${body}</filter>` });

/** Built-in filters (lengths in points). */
export const BUILTIN_FILTERS = [
  f('soft-shadow', 'Soft Shadow', wide, '<feGaussianBlur in="SourceAlpha" stdDeviation="3"/><feOffset dx="3" dy="4" result="s"/><feFlood flood-color="#000000" flood-opacity="0.4"/><feComposite in2="s" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>'),
  f('lifted-shadow', 'Lifted Shadow', 'x="-30%" y="-30%" width="170%" height="180%"', '<feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="b1"/><feOffset in="b1" dx="1" dy="2" result="o1"/><feGaussianBlur in="SourceAlpha" stdDeviation="8"/><feOffset dx="0" dy="10" result="o2"/><feMerge result="m"><feMergeNode in="o2"/><feMergeNode in="o1"/></feMerge><feComponentTransfer in="m" result="sh"><feFuncA type="linear" slope="0.35"/></feComponentTransfer><feMerge><feMergeNode in="sh"/><feMergeNode in="SourceGraphic"/></feMerge>'),
  f('inner-shadow', 'Inner Shadow', '', '<feComponentTransfer in="SourceAlpha" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer><feGaussianBlur in="inv" stdDeviation="2.5"/><feOffset dx="2" dy="3" result="b"/><feFlood flood-color="#000000" flood-opacity="0.55"/><feComposite in2="b" operator="in"/><feComposite in2="SourceAlpha" operator="in" result="sh"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="sh"/></feMerge>'),
  f('warm-glow', 'Warm Glow', wide, '<feMorphology in="SourceAlpha" operator="dilate" radius="1" result="d"/><feGaussianBlur in="d" stdDeviation="5" result="b"/><feFlood flood-color="#ffb02e"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>'),
  f('neon-edge', 'Neon Edge', wide, '<feMorphology in="SourceAlpha" operator="dilate" radius="1.5" result="d"/><feComposite in="d" in2="SourceAlpha" operator="out" result="ring"/><feFlood flood-color="#36f2ff"/><feComposite in2="ring" operator="in" result="line"/><feGaussianBlur in="line" stdDeviation="4" result="halo"/><feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/><feMergeNode in="line"/></feMerge>'),
  f('soft-bevel', 'Soft Bevel', '', '<feGaussianBlur in="SourceAlpha" stdDeviation="2.5" result="h"/><feSpecularLighting in="h" surfaceScale="4" specularConstant="0.9" specularExponent="28" lighting-color="#ffffff" result="spec"><feDistantLight azimuth="225" elevation="32"/></feSpecularLighting><feComposite in="spec" in2="SourceAlpha" operator="in" result="s"/><feDiffuseLighting in="h" surfaceScale="4" diffuseConstant="1" lighting-color="#ffffff" result="diff"><feDistantLight azimuth="225" elevation="50"/></feDiffuseLighting><feBlend in="diff" in2="SourceGraphic" mode="multiply" result="lit"/><feComposite in="lit" in2="SourceAlpha" operator="in" result="body"/><feComposite in="s" in2="body" operator="arithmetic" k2="0.7" k3="1"/>'),
  f('pressed', 'Pressed In', '', '<feConvolveMatrix order="3" kernelMatrix="-2 -1 0 -1 1 1 0 1 2" preserveAlpha="true" result="e"/><feComposite in="e" in2="SourceAlpha" operator="in"/>'),
  f('rough-edges', 'Rough Edges', 'x="-10%" y="-10%" width="120%" height="120%"', '<feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="3" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G"/>'),
  f('ripple', 'Ripple', 'x="-15%" y="-15%" width="130%" height="130%"', '<feTurbulence type="turbulence" baseFrequency="0.015 0.06" numOctaves="2" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="B"/>'),
  f('paper-grain', 'Paper Grain', '', '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="2" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="g"/><feComponentTransfer in="g" result="gc"><feFuncR type="linear" slope="0.5" intercept="0.6"/><feFuncG type="linear" slope="0.5" intercept="0.6"/><feFuncB type="linear" slope="0.5" intercept="0.6"/><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer><feBlend in="gc" in2="SourceGraphic" mode="multiply"/><feComposite in2="SourceAlpha" operator="in"/>'),
  f('clouds', 'Clouds', '', '<feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="5" seed="11" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.6 0 0 0 -0.45" result="c"/><feComposite in="c" in2="SourceGraphic" operator="atop"/>'),
  f('soft-blur', 'Soft Blur', 'x="-15%" y="-15%" width="130%" height="130%"', '<feGaussianBlur stdDeviation="1.5"/>'),
  f('heavy-blur', 'Heavy Blur', 'x="-40%" y="-40%" width="180%" height="180%"', '<feGaussianBlur stdDeviation="7"/>'),
  f('streak-blur', 'Streak Blur', 'x="-40%" y="-5%" width="180%" height="110%"', '<feGaussianBlur stdDeviation="9 0"/>'),
  f('focus-glow', 'Focus Glow', wide, '<feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'),
  f('grayscale', 'Grayscale', '', '<feColorMatrix type="saturate" values="0"/>'),
  f('sepia', 'Sepia Tone', '', '<feColorMatrix type="matrix" values="0.39 0.77 0.19 0 0  0.35 0.69 0.17 0 0  0.27 0.53 0.13 0 0  0 0 0 1 0"/>'),
  f('invert', 'Invert Colors', 'color-interpolation-filters="sRGB"', '<feComponentTransfer><feFuncR type="table" tableValues="1 0"/><feFuncG type="table" tableValues="1 0"/><feFuncB type="table" tableValues="1 0"/></feComponentTransfer>'),
  f('hue-shift', 'Hue Shift', '', '<feColorMatrix type="hueRotate" values="120"/>'),
  f('ink-duotone', 'Ink Duotone', 'color-interpolation-filters="sRGB"', '<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="table" tableValues="0.08 0.98"/><feFuncG type="table" tableValues="0.16 0.86"/><feFuncB type="table" tableValues="0.38 0.62"/></feComponentTransfer>'),
  f('punchy', 'High Contrast', 'color-interpolation-filters="sRGB"', '<feComponentTransfer><feFuncR type="linear" slope="1.6" intercept="-0.3"/><feFuncG type="linear" slope="1.6" intercept="-0.3"/><feFuncB type="linear" slope="1.6" intercept="-0.3"/></feComponentTransfer>'),
  f('posterize', 'Posterize', 'color-interpolation-filters="sRGB"', '<feComponentTransfer><feFuncR type="discrete" tableValues="0 0.33 0.67 1"/><feFuncG type="discrete" tableValues="0 0.33 0.67 1"/><feFuncB type="discrete" tableValues="0 0.33 0.67 1"/></feComponentTransfer>'),
  f('thicken', 'Thicken', 'x="-10%" y="-10%" width="120%" height="120%"', '<feMorphology operator="dilate" radius="1.5"/>'),
  f('thin', 'Thin', '', '<feMorphology operator="erode" radius="1"/>'),
  f('outline-ring', 'Outline Ring', 'x="-15%" y="-15%" width="130%" height="130%"', '<feMorphology in="SourceAlpha" operator="dilate" radius="3" result="d"/><feFlood flood-color="#1b1b1f"/><feComposite in2="d" operator="in" result="ring"/><feMerge><feMergeNode in="ring"/><feMergeNode in="SourceGraphic"/></feMerge>'),
];

/** Filters imported into a document. */
export function docFilters(doc) {
  const list = doc?.root?.svgFilters;
  return Array.isArray(list) ? list.filter((x) => x && typeof x.markup === 'string') : [];
}

/** Every filter offered for a document: built-ins first, then imported ones. */
const TAGGED = BUILTIN_FILTERS.map((x) => ({ ...x, builtin: true }));

export function allFilters(doc) {
  return [...TAGGED, ...docFilters(doc)];
}

/**
 * Add the <filter> definitions of an SVG file to the document (inside the
 * caller's transaction). Filters with the same markup are not duplicated;
 * names are made unique. Returns the added entries.
 */
export function importFilters(doc, text) {
  const found = filtersFromSvg(text);
  const cur = docFilters(doc);
  const names = new Set(cur.map((x) => x.name));
  const added = [];
  for (const x of found) {
    if (cur.some((c) => c.markup === x.markup) || added.some((c) => c.markup === x.markup)) continue;
    let name = x.name;
    for (let i = 2; names.has(name); i++) name = `${x.name} ${i}`;
    names.add(name);
    added.push({ id: `doc:${Date.now().toString(36)}${added.length}${Math.random().toString(36).slice(2, 6)}`, name, markup: x.markup });
  }
  if (added.length) doc.updateRoot({ svgFilters: [...cur, ...added] });
  return added;
}

/** The svgFilter record's compiled filter (null when the markup is unusable). */
export const recordFilter = (e) => (e?.markup ? compileFilter(e.markup) : null);

export { renderFilter, filterOutset, compileFilter };
