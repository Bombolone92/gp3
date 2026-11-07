const WORD_NAMESPACES = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'];
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WORD_CONTENT_TYPE = /^application\/vnd\.(?:openxmlformats-officedocument\.wordprocessingml\.[\w.-]+|ms-word\.[\w.-]+)\+xml$/i;

function decodeXml(bytes) {
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be'
      : bytes[0] === 0x3c && bytes[1] === 0 ? 'utf-16le'
        : bytes[0] === 0 && bytes[1] === 0x3c ? 'utf-16be' : null;
  return new TextDecoder(utf16 || 'utf-8', { fatal: true }).decode(bytes);
}

function parseXml(text) {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('The exported document contains invalid XML');
  return document;
}

/** Correct a native serializer enum without changing text or unrelated XML. */
function fixJustification(text) {
  // Only a paragraph alignment of "justify" needs the part parsed and rewritten; the word in prose does not.
  if (!/<(?:[\w.-]+:)?jc\b[^>]*\bval="justify"/.test(text)) return null;
  const document = parseXml(text);
  let changed = false;
  for (const namespace of WORD_NAMESPACES) {
    for (const node of document.getElementsByTagNameNS(namespace, 'jc')) {
      if (node.parentNode?.namespaceURI !== namespace || node.parentNode.localName !== 'pPr') continue;
      const value = node.getAttributeNodeNS(namespace, 'val');
      if (value?.value !== 'justify') continue;
      value.value = 'both';
      changed = true;
    }
  }
  // Changed entries are written as UTF-8, including a source encoded as UTF-16.
  return changed ? new XMLSerializer().serializeToString(document)
    .replace(/^(<\?xml\b[^?]*\bencoding\s*=\s*)(["'])[^"']*\2/i, '$1"UTF-8"') : null;
}

/** Keep native exports valid DOCX without per-paragraph editor mutations. */
export async function normalizeDocx(blob) {
  // Preserve non-ZIP exporter results, including adapters returning another type.
  if (!blob?.slice || typeof blob.size !== 'number' || blob.size < 4) return blob;
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 3 || signature[3] !== 4) return blob;
  const { ZipReader, ZipWriter, BlobReader, BlobWriter, TextReader, Uint8ArrayWriter } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  try {
    const entries = await reader.getEntries();
    const types = entries.find(entry => entry.filename === '[Content_Types].xml');
    if (!types) return blob;
    const catalog = parseXml(decodeXml(await types.getData(new Uint8ArrayWriter(), { checkCrc32: true })));
    const parts = new Set();
    for (const node of catalog.getElementsByTagNameNS(CONTENT_TYPES, 'Override')) {
      if (WORD_CONTENT_TYPE.test(node.getAttribute('ContentType') || '')) {
        parts.add(decodeURI(node.getAttribute('PartName') || '').replace(/^\//, ''));
      }
    }
    const replacements = new Map();
    for (const entry of entries) {
      if (entry.directory || !parts.has(entry.filename)) continue;
      const original = decodeXml(await entry.getData(new Uint8ArrayWriter(), { checkCrc32: true }));
      const corrected = fixJustification(original);
      if (corrected !== null) replacements.set(entry.filename, corrected);
    }
    if (!replacements.size) return blob;
    const writer = new ZipWriter(new BlobWriter(blob.type), { useWebWorkers: false });
    for (const entry of entries) {
      if (replacements.has(entry.filename)) {
        await writer.add(entry.filename, new TextReader(replacements.get(entry.filename)), { entry });
      } else if (entry.directory) {
        await writer.add(entry.filename, null, { entry });
      } else {
        const compressed = await entry.getData(new BlobWriter(), { passThrough: true });
        await writer.add(entry.filename, new BlobReader(compressed), { entry, passThrough: true });
      }
    }
    return await writer.close(reader.comment);
  } finally { await reader.close(); }
}

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function blobFromBase64(base64, type) {
  if (typeof Uint8Array.fromBase64 === 'function') return new Blob([Uint8Array.fromBase64(base64)], { type });
  if (typeof fetch === 'function') {
    try { return new Blob([await (await fetch(`data:application/octet-stream;base64,${base64}`)).arrayBuffer()], { type }); } catch { /* decoded below */ }
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * The document's bytes. The previous engine's own save (`engine.export`) turned
 * editing off while serializing and blurred the text input, so keystrokes
 * typed during an autosave of a long document were lost and an IME
 * composition in progress was cut short. The Document API writes the same
 * bytes without touching the editing surface, so it is preferred.
 */
async function exportBytes(engine, options) {
  const api = engine?.activeEditor?.doc;
  if (typeof api?.export?.toDocx === 'function') {
    const exported = await api.export.toDocx({});
    if (typeof exported?.contentBase64 === 'string') return blobFromBase64(exported.contentBase64, DOCX_TYPE);
  }
  return engine.export(options);
}

export async function exportDocx(engine, options) {
  return normalizeDocx(await exportBytes(engine, options));
}
