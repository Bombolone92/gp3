import {nativeOpacityDeclarations} from './svg-opacity-values.js';
import {MAX_DOCUMENT_CHARACTERS} from './text-limits.js';
const SVG = 'http://www.w3.org/2000/svg', XLINK = 'http://www.w3.org/1999/xlink';
const fail = why => { throw new Error(`Unsupported SVG: ${why}.`); };
// The native reference prefers legacy xlink:href over href. SVG 2 specifies the reverse.
// Independently recorded in svg-use-styles, last control.
export const nativeSvgUseHref = node => node.hasAttributeNS(XLINK, 'href') ? node.getAttributeNS(XLINK, 'href') : node.getAttribute('href');
const targets = new Set('g path rect circle ellipse line polyline polygon text use'.split(' '));

// Validate the instance graph before the browser can create any shadow trees.
// Source size alone does not bound recursively reused artwork.
export function validateSvgUses(root, ids) {
  if (!root.getElementsByTagNameNS(SVG, 'use').length) return;
  let count = 0, textLength = 0;
  const active = new Set();
  function visit(node, depth) {
    if (++count > 20000 || depth > 64) fail('SVG instance complexity exceeds the preview limit');
    if (active.has(node)) fail('circular use reference');
    active.add(node);
    if (node.localName === 'use') {
      for (const name of ['x', 'y']) if (node.hasAttribute(name)) {
        const value = node.getAttribute(name).trim();
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px|pt|pc|in|cm|mm|em|ex|%)?$/i.test(value) || !Number.isFinite(parseFloat(value))) fail('invalid use position');
      }
      if ([...node.children].some(n => !['title', 'desc'].includes(n.localName))) fail('use child element');
      const ref = nativeSvgUseHref(node);
      if (ref) {
        const target = ids.get(ref.slice(1));
        if (!target) fail('missing local resource');
        if (!targets.has(target.localName)) fail('use target ' + target.localName);
        visit(target, depth + 1);
      }
    }
    for (const child of node.childNodes) {
      if (child.nodeType === 1) visit(child, depth + 1);
      else if ([3, 4].includes(child.nodeType)) {
        textLength += child.textContent.length;
        if (textLength > MAX_DOCUMENT_CHARACTERS) fail(`SVG instance text exceeds ${MAX_DOCUMENT_CHARACTERS.toLocaleString('en-US')} characters`);
        if (['text', 'tspan'].includes(node.localName)) {
          count += (child.textContent.match(/\u00a0+/g) || []).length;
          if (count > 20000) fail('SVG instance complexity exceeds the preview limit');
        }
      }
    }
    active.delete(node);
  }
  visit(root, 0);
}

// Only the already validated simple selectors/declarations reach this module.
// Freeze *specified* declarations, not computed inherited values: each instance
// must inherit from its use element. The native reference retains selectors matched against the
// source's ancestors, unlike SVG 2's instance-scoped matching. Independent native
// evidence: svg-use-styles, first control. Do not freeze inherited computed CSS.
export function stylesheetRules(root) {
  const rules = [];
  for (const style of root.querySelectorAll('style')) {
    const css = style.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // CSS discards a rule whose selector list is invalid; do not turn an
      // otherwise harmless stylesheet into a failed image decode.
      try { root.matches(match[1]); } catch { continue; }
      for (const selector of match[1].split(',')) {
        const ids = (selector.match(/#[\w-]+/g) || []).length;
        const classes = (selector.match(/\.[\w-]+/g) || []).length;
        const types = selector.replace(/[.#][\w-]+/g, '').trim().split(/[\s>+~]+/).filter(Boolean).length;
        rules.push({ selector: selector.trim(), declarations: match[2], specificity: [ids, classes, types], order: rules.length });
      }
    }
  }
  return rules.sort((a, b) => a.specificity[0] - b.specificity[0] || a.specificity[1] - b.specificity[1] || a.specificity[2] - b.specificity[2] || a.order - b.order);
}

function freezeRules(root, rules) {
  for (const node of [root, ...root.querySelectorAll('*')]) {
    const declarations = rules.filter(rule => node.matches(rule.selector)).map(rule =>
      ['g','use'].includes(node.localName)?nativeOpacityDeclarations(rule.declarations):rule.declarations);
    if (declarations.length) {
      declarations.push(node.getAttribute('style') || '');
      node.setAttribute('style', declarations.join(';'));
    }
  }
  for (const node of root.querySelectorAll('style')) node.remove();
}

// Materialize drawable instances only in the disposable preview. This lets
// the existing native pen/opacity/text corrections inspect actual instance styles
// and transforms instead of the disconnected definitions. Native use remains
// inside clipPath, where strokes/paint opacity do not affect clipping geometry
// and a replacement g would not be a valid clipping child.
export function materializeSvgUses(root) {
  // Also fix precedence for native clipping instances, without expanding them.
  for (const use of root.querySelectorAll('use')) if (use.hasAttribute('href') && use.hasAttributeNS(XLINK, 'href')) use.setAttribute('href', nativeSvgUseHref(use));
  const drawableUses = [...root.querySelectorAll('use')].filter(node => !node.closest('clipPath'));
  if (!drawableUses.length) {
    if (root.querySelector('use')) freezeRules(root, stylesheetRules(root));
    return;
  }
  const source = root.cloneNode(true), rules = stylesheetRules(source);
  freezeRules(source, rules);
  const originals = new Map([source, ...source.querySelectorAll('[id]')].filter(n => n.id).map(n => [n.id, n]));
  const occupied = new Set(originals.keys());
  let serial = 0;
  const unique = () => { let id; do { id = `_svgInstance${++serial}`; } while (occupied.has(id)); occupied.add(id); return id; };
  freezeRules(root, rules);
  function expand(use) {
    const ref = nativeSvgUseHref(use), target = ref && originals.get(ref.slice(1));
    const group = root.ownerDocument.createElementNS(SVG, 'g');
    for (const attr of use.attributes) if (!['href', 'x', 'y', 'width', 'height'].includes(attr.localName)) group.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    const transform = getComputedStyle(use).transform;
    const matrix = new DOMMatrix(transform === 'none' ? undefined : transform).translate(use.x.baseVal.value, use.y.baseVal.value);
    // CSSOM setters reserialize other numeric properties with lost precision.
    group.setAttribute('style',(group.getAttribute('style')||'')+';transform:'+matrix.toString());
    use.replaceWith(group);
    if (!target) return;
    const instance = target.cloneNode(true);
    group.append(instance);
    if (instance.localName === 'use') expand(instance);
    else for (const nested of [...instance.querySelectorAll('use')]) if (nested.isConnected && !nested.closest('clipPath')) expand(nested);
    // IDs remain unique, and resources inside the instance resolve within it.
    const remap = new Map();
    for (const node of group.querySelectorAll('*')) if (node.id && originals.has(node.id)) {
      if (!remap.has(node.id)) remap.set(node.id, unique());
      node.id = remap.get(node.id);
    }
    for (const node of group.querySelectorAll('*')) for (const attr of [...node.attributes]) {
      let value = attr.value.replace(/url\(\s*#([\w.:-]+)\s*\)/gi, (all, id) => remap.has(id) ? `url(#${remap.get(id)})` : all);
      if (attr.localName === 'href' && value.startsWith('#') && remap.has(value.slice(1))) value = '#' + remap.get(value.slice(1));
      if (value !== attr.value) node.setAttributeNS(attr.namespaceURI, attr.name, value);
    }
  }
  for (const use of drawableUses) if (use.isConnected) expand(use);
}
