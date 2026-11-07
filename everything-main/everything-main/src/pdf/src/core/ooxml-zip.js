/**
 * ZIP packages for Office Open XML files (DOCX, XLSX, PPTX), with deflate compression from the
 * platform's CompressionStream ('deflate-raw', in browsers and Node 22). When compression is
 * unavailable, or does not make an entry smaller, the entry is stored instead. `zlibDeflate`
 * gives PNG its zlib-wrapped stream the same way, falling back to stored deflate blocks.
 *
 * Office opens a package only when every entry is a plain local-header + data record with
 * matching central directory sizes and CRCs, so no data descriptors or ZIP64 records are used.
 */
import { crc32 } from '../lib/crc32.js';

const MAX_ZIP_BYTES = 0xffffffff;
const encoder = new TextEncoder();

/** UTF-8 bytes of a string; other values pass through as bytes. */
export const utf8 = (value) => (typeof value === 'string' ? encoder.encode(value) : value);

async function streamBytes(bytes, format) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** Raw deflate of `bytes`, or null when the platform cannot compress. */
export const deflateRaw = (bytes) => streamBytes(bytes, 'deflate-raw');

function adler32(bytes) {
  let a = 1,
    b = 0;
  for (let i = 0; i < bytes.length;) {
    const end = Math.min(bytes.length, i + 5552);
    for (; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream (RFC 1950) of `bytes`: compressed when possible, stored blocks otherwise. */
export async function zlibDeflate(bytes) {
  const compressed = await streamBytes(bytes, 'deflate');
  if (compressed) return compressed;
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
  const out = new Uint8Array(2 + bytes.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const chunk = bytes.subarray(i * 65535, Math.min(bytes.length, (i + 1) * 65535));
    out[at++] = i === blocks - 1 ? 1 : 0;
    out[at++] = chunk.length & 0xff;
    out[at++] = chunk.length >> 8;
    out[at++] = ~chunk.length & 0xff;
    out[at++] = (~chunk.length >> 8) & 0xff;
    out.set(chunk, at);
    at += chunk.length;
  }
  new DataView(out.buffer).setUint32(at, adler32(bytes));
  return out;
}

/**
 * A ZIP archive of `files` ({ name, data: string | Uint8Array, store?: boolean }) as one
 * Uint8Array. Text and XML compress; entries marked `store` (already-compressed JPEG/PNG) or
 * that do not shrink are stored.
 */
export async function zipPackage(files, { date = new Date(), signal } = {}) {
  const dosTime =
    ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate =
    (((Math.max(1980, date.getFullYear()) - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate()) &
    0xffff;
  const local = [],
    central = [];
  let offset = 0;
  const seen = new Set();
  for (const file of files) {
    signal?.throwIfAborted();
    if (seen.has(file.name)) throw new Error(`Duplicate package part ${file.name}.`);
    seen.add(file.name);
    const name = encoder.encode(file.name);
    const raw = utf8(file.data);
    const crc = crc32(raw);
    let data = raw,
      method = 0;
    if (!file.store && raw.length > 64) {
      const packed = await deflateRaw(raw);
      if (packed && packed.length < raw.length) {
        data = packed;
        method = 8;
      }
    }
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true);
    header.setUint16(8, method, true);
    header.setUint16(10, dosTime, true);
    header.setUint16(12, dosDate, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, raw.length, true);
    header.setUint16(26, name.length, true);
    local.push(new Uint8Array(header.buffer), name, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, method, true);
    entry.setUint16(12, dosTime, true);
    entry.setUint16(14, dosDate, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, raw.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
    if (offset > MAX_ZIP_BYTES) throw new Error('This export is too large to save.');
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  if (offset + centralSize > MAX_ZIP_BYTES || files.length > 0xffff)
    throw new Error('This export is too large to save.');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Escape text for XML element content and attribute values, dropping characters XML 1.0 forbids. */
export function xml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** [Content_Types].xml covering every part: defaults by extension, overrides by part name. */
export function contentTypes(parts, overrides) {
  const defaults = {
    rels: 'application/vnd.openxmlformats-package.relationships+xml',
    xml: 'application/xml',
    png: 'image/png',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
  };
  const used = new Set(parts.map((p) => p.name.split('.').pop().toLowerCase()));
  return (
    XML_HEADER +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    Object.entries(defaults)
      .filter(([ext]) => used.has(ext) || ext === 'rels' || ext === 'xml')
      .map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`)
      .join('') +
    Object.entries(overrides)
      .map(([name, type]) => `<Override PartName="/${xml(name)}" ContentType="${type}"/>`)
      .join('') +
    '</Types>'
  );
}

/** A relationships part from [{ id, type (short name or URI), target, external? }]. */
export function relationships(list) {
  const base = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const known = {
    'core-properties':
      'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  };
  return (
    XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    list
      .map(
        (r) =>
          `<Relationship Id="${r.id}" Type="${known[r.type] || (r.type.includes(':') ? r.type : base + r.type)}" Target="${xml(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`,
      )
      .join('') +
    '</Relationships>'
  );
}

const iso = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** docProps/core.xml and docProps/app.xml. */
export function documentProperties({
  title = '',
  author = '',
  application = 'PDF Editor',
  date = new Date(),
  extra = '',
} = {}) {
  return {
    core:
      XML_HEADER +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      (title ? `<dc:title>${xml(title)}</dc:title>` : '') +
      (author ? `<dc:creator>${xml(author)}</dc:creator>` : '') +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${iso(date)}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${iso(date)}</dcterms:modified>` +
      '</cp:coreProperties>',
    app:
      XML_HEADER +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      `<Application>${xml(application)}</Application>${extra}</Properties>`,
  };
}

export const CORE_TYPES = {
  'docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml',
  'docProps/app.xml': 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
};
