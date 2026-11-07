const SVG = 'http://www.w3.org/2000/svg';
const HTML = 'http://www.w3.org/1999/xhtml';
const tags = new Set(['svg', 'g', 'path', 'foreignObject', 'image']);
const htmlTags = new Set(['div', 'span', 'br']);
const attributes = new Set(['viewBox', 'preserveAspectRatio', 'x', 'y', 'width', 'height', 'transform', 'd', 'fill', 'stroke', 'stroke-width', 'overflow']);
const styles = new Set(('width height box-sizing display flex flex-direction justify-content overflow overflow-x overflow-y padding white-space overflow-wrap writing-mode font-family font-size letter-spacing color font-weight font-style text-decoration text-transform font-variant margin text-indent text-align line-height direction').split(' '));
for (const side of ['top', 'right', 'bottom', 'left']) for (const box of ['padding', 'margin']) styles.add(`${box}-${side}`);
for (const part of ['grow', 'shrink', 'basis']) styles.add(`flex-${part}`);

/**
 * Put generated DrawingML text in the document's font/layout context. An IMG
 * always clips to its image viewport and cannot use the document's webfonts.
 * Workbook metadata is untrusted: reconstruct a small, inert SVG/XHTML subset,
 * never insert arbitrary source markup or copy event/URL-bearing attributes.
 * Unsupported SVG retains the existing, isolated image rendering path.
 */
export function drawingSvg(src) {
  if (typeof src !== 'string' || src.length > 32 * 1024 * 1024 || !/^data:image\/svg\+xml;base64,[a-z\d+/=]+$/i.test(src)) return null;
  try {
    const text = new TextDecoder().decode(Uint8Array.from(atob(src.split(',')[1]), c => c.charCodeAt(0)));
    if (!text.includes('foreignObject') || /<!DOCTYPE|<!ENTITY/i.test(text)) return null;
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') return null;
    let count = 0;
    const copy = (source, inHtml = false, depth = 0) => {
      if (++count > 20000 || depth > 64) throw 0;
      if (source.nodeType === 3) return document.createTextNode(source.data);
      const ns = inHtml ? HTML : SVG;
      if (source.nodeType !== 1 || source.namespaceURI !== ns || !(inHtml ? htmlTags : tags).has(source.localName)) throw 0;
      const target = document.createElementNS(ns, source.localName);
      for (const attr of source.attributes) {
        if (attr.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
        const { name, value } = attr;
        if (name === 'style' && inHtml) {
          // CSSOM parses quoted font names and values. Only text/layout
          // properties are admitted; no URL, custom property or positioned UI.
          const style = document.createElement('span').style;
          style.cssText = value;
          for (const key of Array.from(style)) {
            const v = style.getPropertyValue(key);
            if ((!styles.has(key) && !/^(?:font-variant|text-decoration|white-space|text-wrap)-[a-z-]+$/.test(key))
              || /url\s*\(|var\s*\(|expression\s*\(/i.test(v)) throw 0;
            target.style.setProperty(key, v);
          }
        } else if (!inHtml && attributes.has(name)) {
          if (['fill', 'stroke'].includes(name) && !/^(?:none|transparent|#[a-f\d]{3,8})$/i.test(value)) throw 0;
          if (name === 'overflow' && !['visible', 'hidden', 'clip'].includes(value)) throw 0;
          target.setAttribute(name, value);
        } else if (!inHtml && source.localName === 'image' && name === 'href'
          && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[a-z\d+/=]+$/i.test(value)) {
          // An SVG image's own image context disables scripts/external loads.
          target.setAttribute(name, value);
        } else throw 0;
      }
      // Global chart CSS must not replace nested picture viewport dimensions.
      if (source.localName === 'svg' && depth) {
        for (const key of ['width', 'height']) if (source.hasAttribute(key)) target.style[key] = `${source.getAttribute(key)}px`;
      }
      for (const n of source.childNodes) target.append(copy(n, inHtml || source.localName === 'foreignObject', depth + 1));
      return target;
    };
    const root = copy(parsed.documentElement);
    root.style.overflow = 'visible';
    root.style.userSelect = 'none';
    return root;
  } catch { return null; }
}
