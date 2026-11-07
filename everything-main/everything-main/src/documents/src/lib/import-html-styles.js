import { htmlToFragmentWithWhitespace } from './import-whitespace.js';
import { prepareFontResets } from './import-font-resets.js';
import { prepareFontFamilies, restoreFontFamilies } from './import-font-families.js';

/** Preserve whitespace and explicit formatting resets during HTML conversion. */
export async function htmlToFragmentWithStyles(api, html) {
  html = prepareFontResets(html);
  const families = prepareFontFamilies(html);
  const converted = await convertColors(api, families?.html || html);
  return families ? restoreFontFamilies(converted, families.marker) : converted;
}

async function convertColors(api, html) {
  const converted = await htmlToFragmentWithWhitespace(api, html);
  if (typeof DOMParser === 'undefined' || !/\bcolor\s*:\s*initial(?![\w-])/i.test(html)
    || !Array.isArray(converted?.fragment) || converted.diagnostics?.some(item => item.severity === 'error')) return converted;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const resets = [...document.body.querySelectorAll('[style]')].filter(el => el.style?.color?.toLowerCase() === 'initial');
  if (!resets.length) return converted;
  // Choose a color absent from the actual native result, including normalized
  // named/rgb() colors. A second conversion then preserves native text spacing,
  // inheritance, and child overrides without inserting text markers.
  const colors = new Set(), pending = [converted.fragment];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (value.model === 'rgb' && typeof value.value === 'string') colors.add(value.value.toUpperCase());
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
  let marker;
  for (let index = 0; index <= 0xffffff; index++) {
    const candidate = index.toString(16).padStart(6, '0').toUpperCase();
    if (!colors.has(candidate)) { marker = candidate; break; }
  }
  if (!marker) throw new Error('Could not resolve imported text color');
  const resetElements = new Set(resets), nodes = [{ node: document.body, reset: false }];
  while (nodes.length) {
    let { node, reset } = nodes.pop();
    if (node.nodeType === 3) {
      if (reset && node.data) {
        const span = document.createElement('span');
        span.style.color = `#${marker}`;
        node.replaceWith(span);
        span.append(node);
      }
      continue;
    }
    if (node.nodeType !== 1) continue;
    const declared = node.style?.color?.toLowerCase() || '';
    if (resetElements.has(node)) {
      reset = true;
      // CSSOM has already selected the effective inline declaration. The
      // converter does not parse !important, so carry only its resolved value.
      node.style.setProperty('color', `#${marker}`);
    } else if (declared && !['inherit', 'unset', 'revert', 'revert-layer'].includes(declared)) reset = false;
    // Native list-item conversion skips the item's inherited run styles.
    // Inline spans retain the reset there without changing the actual text.
    for (let i = node.childNodes.length - 1; i >= 0; i--) nodes.push({ node: node.childNodes[i], reset });
  }
  const result = await htmlToFragmentWithWhitespace(api, document.body.innerHTML);
  pending.push(result?.fragment);
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    const props = value.kind === 'run' ? value.run?.props : null;
    if (props?.color?.model === 'rgb' && props.color.value.toUpperCase() === marker) delete props.color;
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
  return result;
}
