import { fileFontFamily, fileFontImageSources } from './file-fonts.js';
import { parseXml } from './docx-xml.js';
import { readFontMetadata } from './font-metadata.js';
import { normalizeFontBuffer } from './font-container.js';

const encoded = new WeakMap();
const quote = name => '"' + name.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const metrics = new WeakMap();
function faceMetrics(buffer) {
  if (metrics.has(buffer)) return metrics.get(buffer);
  let result = null;
  try {
    const normalized = normalizeFontBuffer(buffer);
    const metadata = readFontMetadata(normalized), view = new DataView(normalized);
    if (metadata && !metadata.variable) for (let i = 0; i < view.getUint16(4); i++) {
      const at = 12 + i * 16;
      if (view.getUint32(at) !== 0x4f532f32 || view.getUint32(at + 12) < 78) continue;
      const offset = view.getUint32(at + 8);
      result = { ...metadata, ascent: view.getUint16(offset + 74), descent: view.getUint16(offset + 76) };
    }
  } catch { /* Unknown metrics retain the existing SVG baseline. */ }
  metrics.set(buffer, result); return result;
}
function fontUrl(buffer) {
  let result = encoded.get(buffer);
  if (!result) {
    const bytes = new Uint8Array(buffer), chunks = [];
    for (let at = 0; at < bytes.length; at += 32768) chunks.push(String.fromCharCode(...bytes.subarray(at, at + 32768)));
    const woff = bytes.length >= 4 && new DataView(buffer).getUint32(0) === 0x774f4646;
    result = `data:font/${woff ? 'woff' : 'ttf'};base64,` + btoa(chunks.join(''));
    encoded.set(buffer, result);
  }
  return result;
}

// Called only on our generated/validated EMF SVG, never on untrusted SVG CSS.
// Image documents cannot inherit surrounding FontFaces or blob-font sources.
export function metafileFileFonts(svg, groups, additional = new Map()) {
  const replacements = new Map(), aliases = new Map();
  for (const names of groups) {
    const mapped = names.map(name => {
      const file = fileFontFamily(name), supplied = additional.get(name);
      const alias = file || supplied?.alias;
      if (alias) aliases.set(alias, file ? fileFontImageSources(alias) : supplied.faces);
      return alias || name;
    });
    if (mapped.some((name, i) => name !== names[i])) replacements.set(names.map(quote).join(', '), mapped.map(quote).join(', '));
  }
  if (!aliases.size) return svg;
  const doc = parseXml(svg), root = doc.documentElement;
  for (const text of [...root.getElementsByTagName('text')]) {
    const replacement = replacements.get(text.getAttribute('font-family'));
    if (replacement) text.setAttribute('font-family', replacement);
    const selected = [...aliases].find(([alias]) => text.getAttribute('font-family').split(', ').includes(quote(alias)));
    if (!selected) continue;
    const faces = selected[1], italic = text.getAttribute('font-style') === 'italic';
    const italicFaces = faces.filter(face => /^(italic|oblique)/.test(face.descriptors?.style || 'normal'));
    // Native GDI synthetic italic has shear 1/3; CSS's default oblique angle
    // is smaller. A real italic face remains authoritative.
    const normalFaces = faces.filter(face => !/^(italic|oblique)/.test(face.descriptors?.style || 'normal'));
    const styled = italic && italicFaces.length ? italicFaces : normalFaces.length ? normalFaces : faces;
    const candidates = styled.map(face => faceMetrics(face.buffer)).filter(Boolean);
    const weight = Number(text.getAttribute('font-weight')) || 400;
    const face = candidates.sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
    const baseline = text.getAttribute('dominant-baseline'), size = Number(text.getAttribute('font-size'));
    if (face && size > 0 && ['text-before-edge', 'text-after-edge'].includes(baseline)) {
      const shift = size * (baseline === 'text-before-edge' ? face.ascent : -face.descent) / face.unitsPerEm;
      text.setAttribute('dominant-baseline', 'alphabetic');
      for (const span of text.getElementsByTagName('tspan')) span.setAttribute('y', String(Number(span.getAttribute('y')) + shift));
    }
    if (italic && !italicFaces.length && text.getAttribute('dominant-baseline') === 'alphabetic') {
      // Apply the native shear around each explicit glyph origin. Skewing a
      // whole string would also displace the saved advance positions.
      const group = doc.createElementNS(root.namespaceURI, 'g');
      for (const span of text.getElementsByTagName('tspan')) {
        const glyph = text.cloneNode(false), x = span.getAttribute('x'), y = span.getAttribute('y');
        glyph.setAttribute('font-style', 'normal'); glyph.setAttribute('x', x); glyph.setAttribute('y', y);
        glyph.setAttribute('transform', `${text.getAttribute('transform') || ''} translate(${x} ${y}) matrix(1 0 ${-1 / 3} 1 0 0) translate(${-Number(x)} ${-Number(y)})`);
        glyph.textContent = span.textContent; group.appendChild(glyph);
      }
      text.parentNode.replaceChild(group, text);
    }
  }
  const css = [];
  for (const [alias, faces] of aliases) for (const { buffer, descriptors: d = {} } of faces) {
    css.push(`@font-face{font-family:${quote(alias)};src:url("${fontUrl(buffer)}");font-weight:${d.weight || 'normal'};font-style:${d.style || 'normal'};font-stretch:${d.stretch || 'normal'}}`);
  }
  const style = doc.createElementNS(root.namespaceURI, 'style');
  style.textContent = css.join(''); root.insertBefore(style, root.firstChild);
  return new XMLSerializer().serializeToString(root);
}
