/**
 * QR codes for share links, built on qrcode-generator (MIT, Kazuhiko Arase).
 * The library only does the encoding; drawing (SVG and PNG) is ours, so the
 * output is a crisp vector or an exact pixel grid with a proper quiet zone.
 *
 * Codes are always dark modules on white with a 4-module quiet zone,
 * whatever the app theme: inverted or low-contrast codes scan badly.
 */
import qrcode from 'qrcode-generator';

/**
 * The library's byte mode keeps only the low 8 bits of each UTF-16 unit, so
 * text is encoded to UTF-8 first and handed over as one char per byte.
 */
function utf8Binary(text) {
  let out = '';
  for (const b of new TextEncoder().encode(String(text))) out += String.fromCharCode(b);
  return out;
}

/**
 * The module matrix for `text`: an array of rows of booleans (true = dark).
 * Version is picked automatically; level M tolerates ~15% damage, which is
 * plenty for screens and print while keeping links small.
 */
export function qrMatrix(text, { level = 'M' } = {}) {
  const qr = qrcode(0, level);
  qr.addData(utf8Binary(text), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r++) {
    const row = new Array(n);
    for (let c = 0; c < n; c++) row[c] = qr.isDark(r, c);
    rows.push(row);
  }
  return rows;
}

/**
 * SVG markup for `text`. One path for all dark modules (horizontal runs
 * merged), so the file stays small and renders without hairline seams.
 */
export function qrSvg(text, { margin = 4, size = null, title = '' } = {}) {
  const m = qrMatrix(text);
  const n = m.length;
  const dim = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!m[r][c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && m[r][c]) c++;
      d += `M${start + margin} ${r + margin}h${c - start}v1h${start - c}z`;
    }
  }
  const sizeAttr = size ? ` width="${size}" height="${size}"` : '';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const titleEl = title ? `<title>${esc(title)}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}"${sizeAttr} shape-rendering="crispEdges"` +
    `${title ? ' role="img"' : ''}>${titleEl}<rect width="${dim}" height="${dim}" fill="#ffffff"/>` +
    `<path fill="#000000" d="${d}"/></svg>`
  );
}

/** A PNG of `text` at about `size` pixels square (rounded to whole pixels
 *  per module, so every module is sharp). */
export function qrPngBlob(text, size = 512, { margin = 4 } = {}) {
  const m = qrMatrix(text);
  const dim = m.length + margin * 2;
  const scale = Math.max(1, Math.round(size / dim));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = dim * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  m.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
    }),
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the QR code'))), 'image/png'),
  );
}
