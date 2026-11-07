/**
 * Image helpers: data URL <-> bytes, format sniffing and pixel sizes read
 * from file headers (PNG, JPEG, GIF, WebP), so the SVG importer can size
 * embedded images synchronously and the PDF writer can pass JPEGs through.
 */

export function dataUrlToBytes(url) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(String(url || ''));
  if (!m) return null;
  const mime = (m[1] || 'text/plain').toLowerCase();
  let bytes;
  try {
    if (m[3]) {
      const bin = atob(m[4].replace(/\s+/g, ''));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(m[4]));
    }
  } catch {
    return null;
  }
  return { mime, bytes };
}

export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function bytesToDataUrl(bytes, mime) {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Sniff an image format from its first bytes. */
export function sniffMime(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

/** JPEG frame info: { width, height, components } from the first SOF marker, or null. */
export function jpegInfo(b) {
  if (!b || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xff) {
      i++;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], components: b[i + 9], progressive: marker === 0xc2 };
    }
    i += 2 + len;
  }
  return null;
}

/** Pixel size from image bytes: { width, height } or null. */
export function imageSize(bytes) {
  const mime = sniffMime(bytes);
  const b = bytes;
  const u32be = (o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  switch (mime) {
    case 'image/png':
      return { width: u32be(16), height: u32be(20) };
    case 'image/gif':
      return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
    case 'image/jpeg': {
      const j = jpegInfo(b);
      return j ? { width: j.width, height: j.height } : null;
    }
    case 'image/webp': {
      const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fourcc === 'VP8 ') return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
      if (fourcc === 'VP8L') {
        const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
      }
      if (fourcc === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      return null;
    }
    default:
      return null;
  }
}

/** Size of an SVG image from its root width/height or viewBox (user units). */
export function svgImageSize(text) {
  const m = /<svg\b[^>]*>/i.exec(text || '');
  if (!m) return null;
  const tag = m[0];
  const attr = (n) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const vb = attr('viewBox')?.split(/[\s,]+/).map(Number);
  const w = parseFloat(attr('width'));
  const h = parseFloat(attr('height'));
  if (Number.isFinite(w) && Number.isFinite(h) && !/%/.test(attr('width'))) return { width: w, height: h };
  if (vb && vb.length === 4 && vb.every(Number.isFinite)) return { width: vb[2], height: vb[3] };
  return null;
}
