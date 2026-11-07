import { imageInfo } from './images.js';
const fail = why => { throw new Error(`Unsupported SVG: ${why}.`); };
const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const specific = {
  maskUnits:['mask'], maskContentUnits:['mask'], filterUnits:['filter'], primitiveUnits:['filter'],
  type:['feColorMatrix'], values:['feColorMatrix'], in:['feColorMatrix'], result:['feColorMatrix'],
};
export const svgResourceAttributes = new Set(Object.keys(specific));

export function validateSvgResourceAttribute(node, name, value) {
  if (!specific[name]?.includes(node.localName)) fail(`attribute ${name} on ${node.localName}`);
  if (name.endsWith('Units') && !['userSpaceOnUse','objectBoundingBox'].includes(value)) fail(`invalid ${name}`);
}

export function embeddedSvgRaster(value, budget) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || !match[2].length || match[2].length % 4) fail('embedded image must be base64 PNG or JPEG');
  let bytes;
  try { bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)); }
  catch { fail('invalid embedded image encoding'); }
  const info = imageInfo(bytes);
  if (info.mime !== match[1]) fail('embedded image MIME mismatch');
  budget.pixels += info.width * info.height;
  if (budget.pixels > 16000000) fail('embedded image pixels exceed the preview limit');
}

export function validateSvgEffects(root, ids) {
  if (!root.querySelector('mask,filter,feColorMatrix,image')) return;
  for (const filter of root.querySelectorAll('filter')) {
    const results = new Set(['SourceGraphic','SourceAlpha']);
    let primitives = 0;
    for (const child of filter.children) {
      if (['title','desc'].includes(child.localName)) continue;
      if (child.localName !== 'feColorMatrix' || ++primitives > 32) fail('filter primitive or complexity');
      if ([...child.children].some(n => !['title','desc'].includes(n.localName))) fail('color matrix child');
      const input = child.getAttribute('in');
      if (input && !results.has(input)) fail('unresolved filter input');
      const type = child.getAttribute('type') || 'matrix';
      const counts = {matrix:20,saturate:1,hueRotate:1,luminanceToAlpha:0};
      if (!Object.hasOwn(counts,type)) fail('color matrix type');
      if (child.hasAttribute('values') && type !== 'luminanceToAlpha') {
        const tokens = child.getAttribute('values').trim().split(/[\s,]+/);
        if (tokens.length !== counts[type] || tokens.some(s => !number.test(s) || !Number.isFinite(Number(s)))) fail('color matrix values');
        if (type === 'saturate' && (Number(tokens[0]) < 0 || Number(tokens[0]) > 1)) fail('saturation value');
      }
      if (child.hasAttribute('result')) {
        const name = child.getAttribute('result');
        if (!/^[A-Za-z_][\w.:-]*$/.test(name) || ['SourceGraphic','SourceAlpha','BackgroundImage','BackgroundAlpha','FillPaint','StrokePaint'].includes(name)) fail('filter result name');
        results.add(name);
      }
    }
  }
  for (const node of root.querySelectorAll('feColorMatrix')) if (node.parentElement?.localName !== 'filter') fail('color matrix outside filter');

  // Include resource edges as well as containment/use edges: an SVG can be
  // small on disk but expand exponentially through reused masks. Cache subtree
  // costs while retaining an active path for cycles. This runs only for SVGs
  // using the newly supported resources, leaving existing use limits intact.
  const rules = [];
  for (const style of root.querySelectorAll('style')) {
    const css = style.textContent.replace(/\/\*[\s\S]*?\*\//g,'');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push([match[1],match[2]]);
  }
  const memo = new Map(), active = new Set();
  function visit(node, depth) {
    if (depth > 64 || active.has(node)) fail('circular or deep SVG resource reference');
    if (memo.has(node)) {
      const cached = memo.get(node);
      if (depth + cached.height > 64) fail('deep SVG resource reference');
      return cached;
    }
    active.add(node);
    const targets = new Set(node.children);
    const declarations = [...node.attributes].map(a => a.value);
    for (const [selector,value] of rules) {
      let matches = false; try { matches = node.matches(selector); } catch { /* Browser discards invalid selectors. */ }
      if (matches) declarations.push(value);
    }
    for (const value of declarations) for (const ref of value.matchAll(/url\(\s*#([\w.:-]+)\s*\)/gi)) {
      const target = ids.get(ref[1]); if (target) targets.add(target);
    }
    if (['use','linearGradient','radialGradient'].includes(node.localName)) for (const attr of node.attributes) {
      if (attr.localName === 'href' && ids.has(attr.value.slice(1))) targets.add(ids.get(attr.value.slice(1)));
    }
    let cost = 1, height = 0;
    for (const target of targets) {
      const child = visit(target,depth+1); cost += child.cost; height = Math.max(height,child.height+1);
      if (cost > 20000) fail('SVG resource complexity exceeds the preview limit');
    }
    const result = {cost,height}; active.delete(node); memo.set(node,result); return result;
  }
  visit(root,0);
}
