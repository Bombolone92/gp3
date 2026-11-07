import { drawingSvg } from './drawingml-svg.js';

const SVG = 'http://www.w3.org/2000/svg';
const encode = text => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:image/svg+xml;base64,${btoa(binary)}`;
};
const fontCache = new Map();
// Keep the notices with the redistributable families declared in fonts.css.
// Downloaded SVGs contain the original font bytes, unlike PNG clipboard output.
const fontNotices = new Map([
  ['carlito', ['/fonts/carlito/OFL.txt']],
  ['caladea', ['/fonts/caladea/README.txt', '/fonts/caladea/LICENSE.txt']],
  ['open sans', ['/fonts/opensans/README.txt', '/fonts/opensans/LICENSE.txt']],
]);
async function fontResource(url, text = false) {
  if (!fontCache.has(url)) {
    const pending = (async () => {
      // Reuse the font already loaded by CSS, including while offline.
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error('Cannot load drawing font');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > (text ? 65536 : 4 * 1024 * 1024)) throw new Error('Drawing font resource exceeds size limit');
      if (text) return new TextDecoder().decode(bytes);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return `data:font/ttf;base64,${btoa(binary)}`;
    })();
    fontCache.set(url, pending);
    pending.catch(() => fontCache.delete(url));
    if (fontCache.size > 32) fontCache.delete(fontCache.keys().next().value);
  }
  return fontCache.get(url);
}

/** Embed only matching fonts declared by the app's own, same-origin CSS. */
async function embeddedFonts(root) {
  const used = [...root.querySelectorAll('span')].map(n => getComputedStyle(n));
  const css = [];
  const notices = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (rule.type !== 5) continue; // CSSFontFaceRule
      const s = rule.style, family = s.getPropertyValue('font-family').replace(/^['"]|['"]$/g, '');
      const weight = s.getPropertyValue('font-weight') || '400', style = s.getPropertyValue('font-style') || 'normal';
      const [lo, hi = lo] = weight.split(/\s+/).map(Number);
      if (!used.some(u => u.fontFamily.toLowerCase().includes(family.toLowerCase()) && u.fontStyle === style && +u.fontWeight >= lo && +u.fontWeight <= hi)) continue;
      const location = s.getPropertyValue('src').match(/url\(['"]?([^)'"\s]+)['"]?\)/)?.[1];
      if (!location) continue;
      const url = new URL(location, sheet.href || document.baseURI);
      if (url.origin !== window.location.origin) continue;
      const licenses = fontNotices.get(family.toLowerCase());
      if (!licenses) throw new Error(`No embedding notice registered for font ${family}`);
      licenses.forEach(path => notices.add(new URL(path, document.baseURI).href));
      const data = await fontResource(url.href);
      css.push(`@font-face{font-family:${s.getPropertyValue('font-family')};font-style:${style};font-weight:${weight};src:url("${data}")}`);
    }
  }
  if (css.length) {
    const style = document.createElementNS(SVG, 'style');
    style.textContent = css.join('\n');
    root.prepend(style);
    const metadata = document.createElementNS(SVG, 'metadata');
    metadata.textContent = (await Promise.all([...notices].map(url => fontResource(url, true)))).join('\n\n');
    root.prepend(metadata);
  }
}

/**
 * Measure the browser's actual rich-text layout before rasterizing. Symmetric
 * expansion includes permitted text overflow without moving the rotation center.
 * The workbook object and native DrawingML anchor are never resized or changed.
 */
export async function drawingRasterSource(src, obj) {
  if (!obj.drawingShape || obj.srcRect || obj.fillRect || !(obj.w > 0 && obj.h > 0)) return null;
  const root = drawingSvg(src);
  if (!root || !document.body) return null;
  const view = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (view?.length !== 4 || !view.every(Number.isFinite) || !(view[2] > 0 && view[3] > 0)) return null;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none', contain: 'layout style' });
  Object.assign(root.style, { width: `${obj.w}px`, height: `${obj.h}px` });
  root.setAttribute('width', obj.w); root.setAttribute('height', obj.h);
  host.append(root); document.body.append(host);
  try {
    // Force layout so the font set includes faces actually used by these runs.
    root.getBoundingClientRect();
    await document.fonts?.ready;
    const frame = root.getBoundingClientRect();
    if (!(frame.width > 0 && frame.height > 0)) return null;
    let left = frame.left, top = frame.top, right = frame.right, bottom = frame.bottom;
    for (const fo of root.querySelectorAll('foreignObject')) {
      const body = fo.firstElementChild, clip = body.getBoundingClientRect();
      const xClip = body.style.overflowX === 'clip', yClip = body.style.overflowY === 'clip';
      const matrix = fo.getScreenCTM();
      const straight = matrix && Math.abs(matrix.b) < 1e-8 && Math.abs(matrix.c) < 1e-8;
      for (const span of body.querySelectorAll('span')) {
        const r = span.getBoundingClientRect();
        // For a rotated single-axis clip, retaining the entire text AABB is a
        // conservative bound. Clipping still happens inside the serialized SVG.
        const l = xClip && (straight || yClip) ? Math.max(r.left, clip.left) : r.left;
        const t = yClip && (straight || xClip) ? Math.max(r.top, clip.top) : r.top;
        const rr = xClip && (straight || yClip) ? Math.min(r.right, clip.right) : r.right;
        const bb = yClip && (straight || xClip) ? Math.min(r.bottom, clip.bottom) : r.bottom;
        if (rr > l && bb > t) { left = Math.min(left, l); top = Math.min(top, t); right = Math.max(right, rr); bottom = Math.max(bottom, bb); }
      }
      // Preserve the app's box sizing in the standalone SVG image document.
      for (const div of body.querySelectorAll('div')) div.style.boxSizing = getComputedStyle(div).boxSizing;
    }
    const px = Math.max(frame.left - left, right - frame.right), py = Math.max(frame.top - top, bottom - frame.bottom);
    const dx = px * view[2] / frame.width, dy = py * view[3] / frame.height;
    const w = obj.w * (1 + 2 * px / frame.width), h = obj.h * (1 + 2 * py / frame.height);
    if (![w, h, dx, dy].every(Number.isFinite)) return null;
    root.setAttribute('viewBox', `${view[0] - dx} ${view[1] - dy} ${view[2] + 2 * dx} ${view[3] + 2 * dy}`);
    root.setAttribute('width', w); root.setAttribute('height', h);
    root.style.width = `${w}px`; root.style.height = `${h}px`;
    await embeddedFonts(root);
    return { src: encode(new XMLSerializer().serializeToString(root)), w, h };
  } finally { host.remove(); }
}
