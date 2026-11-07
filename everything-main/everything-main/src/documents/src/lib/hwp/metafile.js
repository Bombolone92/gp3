import { check } from './binary.js';

/** Validate record framing before invoking the SVG renderer. */
export function checkMetafile(bytes, ext) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = bytes.length;
  check(n <= 8 * 1024 * 1024, 'The metafile picture exceeds the 8 MB rendering limit.');
  let p, end, count = 0, totalPoints = 0;
  const pointsBudget = (n) => { totalPoints += n; check(totalPoints <= 250000, 'The metafile picture contains too many geometry points.'); };
  if (ext === 'emf') {
    check(n >= 88 && v.getUint32(0, true) === 1 && v.getUint32(40, true) === 0x464d4520);
    end = v.getUint32(48, true); p = 0; check(end >= 88 && end <= n);
  } else {
    check(n >= 18); const header = v.getUint32(0, true) === 0x9ac6cdd7 ? 22 : 0;
    check(n >= header + 18 && [1, 2].includes(v.getUint16(header, true)) && v.getUint16(header + 2, true) === 9);
    p = header + 18; end = header + v.getUint32(header + 6, true) * 2; check(end >= p && end <= n);
  }
  while (p < end) {
    check(++count <= 10000 && p + (ext === 'emf' ? 8 : 6) <= end, 'The metafile picture has too many or truncated records.');
    const length = ext === 'emf' ? v.getUint32(p + 4, true) : v.getUint32(p, true) * 2;
    check(length >= (ext === 'emf' ? 8 : 6) && length % (ext === 'emf' ? 4 : 2) === 0 && p + length <= end, 'The metafile picture contains an invalid record length.');
    if (ext === 'emf') {
      const type = v.getUint32(p, true);
      if ([2, 3, 4, 5, 6, 85, 86, 87, 88, 89].includes(type)) {
        check(length >= 28); const points = v.getUint32(p + 24, true);
        check(points <= 100000 && 28 + points * (type >= 85 ? 4 : 8) <= length, 'The metafile picture has invalid point data.');
        pointsBudget(points);
      }
      if ([7, 8, 90, 91].includes(type)) {
        check(length >= 32); const polygons = v.getUint32(p + 24, true), points = v.getUint32(p + 28, true);
        check(polygons <= 10000 && points <= 100000 && 32 + polygons * 4 + points * (type >= 90 ? 4 : 8) <= length);
        let total = 0; for (let i = 0; i < polygons; i++) total += v.getUint32(p + 32 + i * 4, true); check(total === points);
        pointsBudget(points);
      }
    } else {
      const type = v.getUint16(p + 4, true);
      if (type === 0x0324 || type === 0x0325) {
        check(length >= 8); const points = v.getUint16(p + 6, true);
        check(8 + points * 4 <= length, 'The metafile picture has invalid point data.'); pointsBudget(points);
      }
      if (type === 0x0538) {
        check(length >= 8); const polygons = v.getUint16(p + 6, true); check(8 + polygons * 2 <= length);
        let points = 0; for (let i = 0; i < polygons; i++) points += v.getUint16(p + 8 + i * 2, true);
        check(8 + polygons * 2 + points * 4 <= length, 'The metafile picture has invalid polygon data.'); pointsBudget(points);
      }
    }
    const eof = ext === 'emf' ? v.getUint32(p, true) === 14 : v.getUint16(p + 4, true) === 0;
    p += length;
    // Some placeable WMFs include a zero alignment word after META_EOF.
    if (eof) { check(p === end || ext === 'wmf' && end - p <= 3 && bytes.subarray(p, end).every((b) => b === 0)); return; }
  }
  check(false, 'The metafile picture is missing its end record.');
}

// EMFJS 3.0.9 misreads EMR_POLYBEZIER16's count as a point. Expand that
// record to its equivalent 32-bit form instead of losing common curve art.
function normalizeEmf(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks = []; let total = 0;
  for (let p = 0; p < bytes.length;) {
    const type = view.getUint32(p, true), length = view.getUint32(p + 4, true); let chunk = bytes.subarray(p, p + length);
    if (type === 85) {
      const count = view.getUint32(p + 24, true); chunk = new Uint8Array(28 + count * 8); chunk.set(bytes.subarray(p, p + 28));
      const out = new DataView(chunk.buffer); out.setUint32(0, 2, true); out.setUint32(4, chunk.length, true);
      for (let i = 0; i < count * 2; i++) out.setInt32(28 + i * 4, view.getInt16(p + 28 + i * 2, true), true);
    }
    chunks.push(chunk); total += chunk.length; p += length; if (type === 14) break;
  }
  const result = new Uint8Array(total); let p = 0; for (const chunk of chunks) { result.set(chunk, p); p += chunk.length; }
  new DataView(result.buffer).setUint32(48, total, true); return result;
}

export async function metafileSvg(resource, width, height) {
  checkMetafile(resource.bytes, resource.ext);
  // Import only the two standalone renderers; the RTF parser and code pages
  // are not part of the Hanword import bundle.
  const module = resource.ext === 'emf' ? await import('rtf.js/dist/EMFJS.bundle.js') : await import('rtf.js/dist/WMFJS.bundle.js');
  const renderer = module.default || module; renderer.loggingEnabled(false);
  const bytes = resource.ext === 'emf' ? normalizeEmf(resource.bytes) : resource.bytes, buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const svg = new renderer.Renderer(buffer).render({ width: `${width}px`, height: `${height}px`, xExt: width, yExt: height, wExt: resource.dimensions?.width || width, hExt: resource.dimensions?.height || height, mapMode: 8 });
  check(svg.querySelectorAll('*').length <= 100000, 'The metafile picture is too complex to render.');
  check([...svg.querySelectorAll('path,rect,polygon,polyline,text,image,circle,ellipse,line')].some((node) => !node.closest('defs')), 'The metafile contains no supported visible drawing commands.');
  // Renderer output stays detached and is decoded as an image. Reject any
  // external resources even if a future renderer adds new record support.
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    check(!['script', 'foreignObject', 'style'].includes(node.localName));
    for (const attr of node.attributes) {
      check(!/^on/i.test(attr.name));
      if (attr.localName === 'href') check(/^#|^data:image\/(?:png|jpeg|bmp);base64,/i.test(attr.value));
      if (/url\(/i.test(attr.value)) check(/^url\(#[\w.-]+\)$/.test(attr.value));
    }
  }
  const text = new XMLSerializer().serializeToString(svg); check(text.length <= 16 * 1024 * 1024, 'The rendered metafile picture is too large.');
  return new Blob([text], { type: 'image/svg+xml' });
}
