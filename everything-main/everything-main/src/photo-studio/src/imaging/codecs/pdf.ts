// Minimal PDF 1.4 writer for image pages (ISO 32000-1 sections 7.3-7.5 and
// 8.9): each page has an optional background color, placed images (JPEG passed
// through with DCTDecode, or 8-bit RGB/gray samples stored with FlateDecode and
// an optional grayscale soft mask for transparency) and single-line captions in
// a standard font. Coordinates are PDF points with the origin at the top-left
// of the page (converted to PDF's bottom-left origin when written).

export type PdfImage =
  | { kind: 'jpeg'; bytes: Uint8Array; width: number; height: number; gray?: boolean }
  // Interleaved samples (3 channels, or 1 when gray), raw or zlib-compressed;
  // `alpha` is one sample per pixel, compressed the same way.
  | { kind: 'samples'; bytes: Uint8Array; width: number; height: number; gray?: boolean; deflated?: boolean; alpha?: Uint8Array };
export type PdfText = { x: number; y: number; size: number; text: string; color?: [number, number, number]; align?: 'left' | 'center' };
export type PdfPage = {
  width: number;
  height: number;
  background?: [number, number, number];
  images: { x: number; y: number; width: number; height: number; image: PdfImage }[];
  texts?: PdfText[];
};
export type PdfInfo = {
  title?: string;
  author?: string;
  creator?: string;
  date?: Date;
  // zlib (RFC 1950) compressor applied to samples that are not yet deflated.
  deflate?: (data: Uint8Array) => Uint8Array;
};

const enc = new TextEncoder();

/** PDF text string for metadata: literal for printable ASCII, else UTF-16BE hex with a BOM. */
export function pdfString(s: string) {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}
/** Literal string for page text shown in a WinAnsi font: printable Latin-1, escaping delimiters. */
export function pdfTextString(s: string) {
  let out = '(';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c >= 32 && c < 127) out += ch;
    else if (c >= 160 && c < 256) out += '\\' + c.toString(8).padStart(3, '0');
    else out += '?';
  }
  return out + ')';
}
function pdfDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

// Approximate Helvetica advance widths (per 1000 em) for centering captions.
function textWidth(text: string, size: number) {
  let w = 0;
  for (const ch of text) w += /[il.,:;'|!]/.test(ch) ? 278 : /[mwMW]/.test(ch) ? 833 : /[A-Z]/.test(ch) ? 667 : ch === ' ' ? 278 : 556;
  return (w * size) / 1000;
}

/** Split interleaved RGBA into RGB and alpha planes; alpha is omitted when opaque. */
export function splitRgba(data: ArrayLike<number>, width: number, height: number): { rgb: Uint8Array; alpha?: Uint8Array } {
  const n = width * height;
  const rgb = new Uint8Array(n * 3),
    alpha = new Uint8Array(n);
  let opaque = true;
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
    alpha[i] = data[i * 4 + 3];
    if (alpha[i] !== 255) opaque = false;
  }
  return opaque ? { rgb } : { rgb, alpha };
}

/** Write a document. Returns the file bytes. */
export function writePdf(pages: PdfPage[], info: PdfInfo = {}): Uint8Array {
  if (!pages.length) throw new Error('A PDF needs at least one page.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(bytes);
    length += bytes.length;
  };
  const pack = (data: Uint8Array, deflated?: boolean) => {
    if (deflated) return { data, filter: '/Filter /FlateDecode ' };
    if (info.deflate) return { data: info.deflate(data), filter: '/Filter /FlateDecode ' };
    return { data, filter: '' };
  };
  // Object numbers: 1 catalog, 2 pages, 3 font, 4 info, then per page.
  let next = 5;
  const pageIds: number[] = [];
  type Obj = { id: number; dict: string; stream?: Uint8Array };
  const objects: Obj[] = [];
  for (const page of pages) {
    if (!(page.width > 0 && page.height > 0)) throw new Error('PDF pages need a positive size.');
    const pageId = next++,
      contentId = next++;
    pageIds.push(pageId);
    const xobjects: string[] = [];
    let content = '';
    const H = page.height;
    if (page.background) content += `${page.background.map((c) => num(c / 255)).join(' ')} rg 0 0 ${num(page.width)} ${num(H)} re f\n`;
    page.images.forEach((placed, k) => {
      const im = placed.image;
      if (!(im.width > 0 && im.height > 0)) throw new Error('PDF images need a positive size.');
      const id = next++;
      const name = `Im${k}`;
      xobjects.push(`/${name} ${id} 0 R`);
      const base = `/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /BitsPerComponent 8`;
      const cs = im.gray ? '/DeviceGray' : '/DeviceRGB';
      if (im.kind === 'jpeg') {
        objects.push({ id, dict: `<< ${base} /ColorSpace ${cs} /Filter /DCTDecode /Length ${im.bytes.length} >>`, stream: im.bytes });
      } else {
        if (!im.deflated && im.bytes.length !== im.width * im.height * (im.gray ? 1 : 3)) throw new Error('PDF image data does not match its size.');
        let smask = '';
        if (im.alpha) {
          if (!im.deflated && im.alpha.length !== im.width * im.height) throw new Error('PDF mask data does not match its size.');
          const maskId = next++;
          const m = pack(im.alpha, im.deflated);
          objects.push({ id: maskId, dict: `<< ${base} /ColorSpace /DeviceGray ${m.filter}/Length ${m.data.length} >>`, stream: m.data });
          smask = `/SMask ${maskId} 0 R `;
        }
        const d = pack(im.bytes, im.deflated);
        objects.push({ id, dict: `<< ${base} /ColorSpace ${cs} ${d.filter}${smask}/Length ${d.data.length} >>`, stream: d.data });
      }
      content += `q ${num(placed.width)} 0 0 ${num(placed.height)} ${num(placed.x)} ${num(H - placed.y - placed.height)} cm /${name} Do Q\n`;
    });
    for (const t of page.texts ?? []) {
      const x = t.align === 'center' ? t.x - textWidth(t.text, t.size) / 2 : t.x;
      const color = t.color ?? [0, 0, 0];
      content += `BT ${color.map((c) => num(c / 255)).join(' ')} rg /F1 ${num(t.size)} Tf ${num(x)} ${num(H - t.y)} Td ${pdfTextString(t.text)} Tj ET\n`;
    }
    const stream = enc.encode(content);
    objects.push({ id: contentId, dict: `<< /Length ${stream.length} >>`, stream });
    objects.push({
      id: pageId,
      dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(H)}] /Resources << /Font << /F1 3 0 R >> /XObject << ${xobjects.join(' ')} >> >> /Contents ${contentId} 0 R >>`,
    });
  }
  objects.push({ id: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' });
  objects.push({ id: 2, dict: `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>` });
  objects.push({ id: 3, dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' });
  const infoParts = [`/Producer ${pdfString(info.creator ?? 'Photo Studio')}`, `/CreationDate ${pdfString(pdfDate(info.date ?? new Date()))}`];
  if (info.title) infoParts.push(`/Title ${pdfString(info.title)}`);
  if (info.author) infoParts.push(`/Author ${pdfString(info.author)}`);
  objects.push({ id: 4, dict: `<< ${infoParts.join(' ')} >>` });
  objects.sort((a, b) => a.id - b.id);
  // Header with a binary comment so transfer tools treat the file as binary (7.5.2).
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  for (const o of objects) {
    offsets[o.id] = length;
    push(`${o.id} 0 obj\n${o.dict}\n`);
    if (o.stream) {
      push('stream\n');
      push(o.stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  }
  // Cross-reference table: fixed 20-byte entries (7.5.4).
  const xref = length;
  const count = objects.length + 1;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

// One full-page image per page (artboard and layer comp exports).
export type PdfImagePage = {
  // Page size in points (1/72 inch).
  width: number;
  height: number;
  image: { width: number; height: number; jpeg: Uint8Array; channels?: 1 | 3 } | { width: number; height: number; rgb: Uint8Array; alpha?: Uint8Array };
};
export function buildPdf(pages: PdfImagePage[], opts: { title?: string; author?: string; date?: Date; deflate: (data: Uint8Array) => Uint8Array }): Uint8Array {
  return writePdf(
    pages.map((p) => {
      const img = p.image;
      const image: PdfImage =
        'jpeg' in img
          ? { kind: 'jpeg', bytes: img.jpeg, width: img.width, height: img.height, gray: img.channels === 1 }
          : { kind: 'samples', bytes: img.rgb, alpha: img.alpha, width: img.width, height: img.height };
      return { width: p.width, height: p.height, images: [{ x: 0, y: 0, width: p.width, height: p.height, image }] };
    }),
    opts,
  );
}
