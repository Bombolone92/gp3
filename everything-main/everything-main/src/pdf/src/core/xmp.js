import { DOMParser, XMLSerializer, normalizeLineEndings as normalizeXml11 } from '@xmldom/xmldom';
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import { retainCryptFilter, withoutCryptFilter } from './stream-filters.js';

const NS = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  dc: 'http://purl.org/dc/elements/1.1/',
  pdf: 'http://ns.adobe.com/pdf/1.3/',
  pdfx: 'http://ns.adobe.com/pdfx/1.3/',
  xmp: 'http://ns.adobe.com/xap/1.0/',
  xml: 'http://www.w3.org/XML/1998/namespace',
};
// Adobe XMP Part 3, Table 20. dc:subject is distinct from pdf:Keywords.
const FIELDS = {
  title: ['dc', 'title', 'Alt'],
  author: ['dc', 'creator', 'Seq'],
  subject: ['dc', 'description', 'Alt'],
  keywords: ['pdf', 'Keywords'],
  creator: ['xmp', 'CreatorTool'],
  producer: ['pdf', 'Producer'],
  created: ['xmp', 'CreateDate', 'date'],
  modified: ['xmp', 'ModifyDate', 'date'],
  metadataDate: ['xmp', 'MetadataDate', 'date'],
};
const MAX_BYTES = 8 * 1024 * 1024;
const n = PDFName.of;
const unsafe = () => new Error('This PDF’s metadata could not be updated safely.');
const children = (node) =>
  Array.from(node.childNodes || []).filter((child) => child.nodeType === 1);
const is = (node, prefix, local) => node?.namespaceURI === NS[prefix] && node.localName === local;
const child = (node, prefix, local) => children(node).find((entry) => is(entry, prefix, local));
// Qualified RDF values can carry additional properties that must survive an edit.
const valueNode = (node) =>
  child(node, 'rdf', 'value') ||
  child(child(node, 'rdf', 'Description') || {}, 'rdf', 'value') ||
  node;
const text = (node) => {
  const value = valueNode(node);
  return value.getAttributeNS?.(NS.rdf, 'resource') ?? value.textContent;
};
const date = (value) => {
  if (!value || !/^\d{4}(?:-\d{2})?(?:-\d{2})?(?:T.*)?$/.test(value)) return undefined;
  const result = new Date(value);
  return Number.isFinite(result.getTime()) ? result : undefined;
};

function decodedBytes(stream) {
  if (!(stream instanceof PDFRawStream)) {
    const bytes = stream.getUnencodedContents();
    if (bytes.length > MAX_BYTES) throw unsafe();
    return bytes;
  }
  // Unlocking has already handled Crypt. Decode other stages without changing the
  // original selector, which is still needed when exporting with the old protection.
  const dict = withoutCryptFilter(stream.dict);
  const decoder = decodePDFRawStream(
      dict === stream.dict ? stream : PDFRawStream.of(dict, stream.getContents()),
    ),
    chunks = [];
  let length = 0;
  while (true) {
    const chunk = decoder.getBytes(65536);
    length += chunk.length;
    if (length > MAX_BYTES) throw unsafe();
    chunks.push(chunk);
    if (chunk.length < 65536) break;
  }
  if (chunks.length === 1) return chunks[0];
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function decodeXml(bytes) {
  const [a, b, c, d] = bytes;
  const big32 = a === 0 && b === 0 && ((c === 0xfe && d === 0xff) || (c === 0 && d === 60));
  const little32 = c === 0 && d === 0 && ((a === 0xff && b === 0xfe) || (a === 60 && b === 0));
  if (big32 || little32) {
    if (bytes.length % 4) throw unsafe();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      parts = [];
    for (let offset = 0; offset < bytes.length; offset += 4) {
      const code = view.getUint32(offset, little32);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw unsafe();
      parts.push(String.fromCodePoint(code));
    }
    return parts.join('').replace(/^\uFEFF/, '');
  }
  const encoding =
    (a === 0xfe && b === 0xff) || (a === 0 && b === 60)
      ? 'utf-16be'
      : (a === 0xff && b === 0xfe) || (a === 60 && b === 0)
        ? 'utf-16le'
        : 'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

function checkMarkupSize(source) {
  let offset = 0,
    count = 0;
  while ((offset = source.indexOf('<', offset)) !== -1) {
    const closing = source.startsWith('<!--', offset)
      ? '-->'
      : source.startsWith('<![CDATA[', offset)
        ? ']]>'
        : source.startsWith('<?', offset)
          ? '?>'
          : null;
    if (closing) {
      offset = source.indexOf(closing, offset + 2);
      if (offset < 0) throw unsafe();
      offset += closing.length;
    } else {
      // Bound DOM amplification before parsing; '<' inside comments/CDATA is text.
      if (++count > 100000) throw unsafe();
      offset++;
    }
  }
}

const propertyKey = (namespace, local) => `${namespace}\0${local}`;
function indexProperties(descriptions) {
  const index = new Map();
  for (const description of descriptions)
    for (const node of [...Array.from(description.attributes), ...children(description)]) {
      const key = propertyKey(node.namespaceURI, node.localName);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(node);
    }
  return index;
}
function readValue(node, kind) {
  if (kind === 'Alt' || kind === 'Seq') {
    const array = child(valueNode(node), 'rdf', kind);
    if (array) {
      const items = children(array).filter((item) => is(item, 'rdf', 'li'));
      const first =
        kind === 'Alt'
          ? items.find((item) => item.getAttributeNS(NS.xml, 'lang') === 'x-default') || items[0]
          : items[0];
      return first ? text(first) : '';
    }
  }
  const value = text(node);
  return kind === 'date' ? date(value) : value;
}

/** Preserve precedence for overlapping custom Info entries and the standard Trapped flag. */
export function extraInfo(doc, packet, newerInfo) {
  if (!packet || packet.error) return [];
  const info = doc.getInfoDict(),
    entries = new Map();
  for (const description of packet.descriptions)
    for (const node of [...Array.from(description.attributes), ...children(description)]) {
      const trapped = is(node, 'pdf', 'Trapped');
      if (!trapped && node.namespaceURI !== NS.pdfx) continue;
      // XMP Part 3 2.2.1 encodes non-XML name characters as U+2182 and four hex digits.
      const name = trapped
        ? 'Trapped'
        : node.localName.replace(/\u2182([\da-f]{4})/gi, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
      if (
        !trapped &&
        [
          'Title',
          'Author',
          'Subject',
          'Keywords',
          'Creator',
          'Producer',
          'CreationDate',
          'ModDate',
          'Trapped',
        ].includes(name)
      )
        continue;
      const key = n(name),
        native = info.lookup(key);
      if (
        !(trapped
          ? native instanceof PDFName
          : native instanceof PDFString || native instanceof PDFHexString)
      )
        continue;
      const before = native.decodeText(),
        xmp = text(node);
      const normalize = (value) =>
        /^(?:true|1)$/i.test(value) ? 'True' : /^(?:false|0)$/i.test(value) ? 'False' : null;
      const value = newerInfo ? before : trapped ? normalize(xmp) : xmp;
      if (value == null || (trapped && !['True', 'False', 'Unknown'].includes(value))) continue;
      if (!entries.has(name))
        entries.set(name, {
          key,
          prefix: trapped ? 'pdf' : 'pdfx',
          local: node.localName,
          value: value === 'Unknown' && trapped ? null : value,
          native: trapped ? n(value) : PDFHexString.fromText(value),
        });
    }
  return [...entries.values()];
}

/** Read only the document's RDF subject; nested and unrelated subjects are left intact. */
export function readXmp(doc) {
  if (!doc.catalog.has(n('Metadata'))) return null;
  try {
    const stream = doc.catalog.lookup(n('Metadata'));
    if (!(stream instanceof PDFStream)) throw unsafe();
    const source = decodeXml(decodedBytes(stream));
    checkMarkupSize(source);
    const xml = new DOMParser({
      locator: false,
      // XML 1.0 §2.11 preserves NEL and U+2028. xmldom defaults to XML 1.1's
      // broader normalization, which is appropriate only with that declaration.
      normalizeLineEndings: (text) =>
        /^<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(['"])1\.1\1(?:[ \t\r\n]|\?>)/.test(text)
          ? normalizeXml11(text)
          : text.replace(/\r\n?/g, '\n'),
      onError: () => {
        throw unsafe();
      },
    }).parseFromString(source, 'application/xml');
    if (xml.doctype) throw unsafe();
    const root = xml.documentElement;
    const rdf = is(root, 'rdf', 'RDF') ? root : child(root, 'rdf', 'RDF');
    if (!rdf) throw unsafe();
    const all = children(rdf).filter((entry) => is(entry, 'rdf', 'Description'));
    if (!all.length) {
      const description = xml.createElementNS(NS.rdf, 'rdf:Description');
      description.setAttributeNS(NS.rdf, 'rdf:about', '');
      rdf.appendChild(description);
      all.push(description);
    }
    const about = all.find((entry) => entry.getAttributeNS(NS.rdf, 'about') === '') || all[0];
    if (!about) throw unsafe();
    const descriptions = all.filter(
      (entry) => entry.getAttributeNS(NS.rdf, 'about') === about.getAttributeNS(NS.rdf, 'about'),
    );
    const properties = indexProperties(descriptions);
    const values = {};
    for (const [key, [prefix, local, kind]] of Object.entries(FIELDS)) {
      const property = properties.get(propertyKey(NS[prefix], local))?.[0];
      if (property) values[key] = readValue(property, kind);
    }
    return { xml, descriptions, properties, values, stream };
  } catch {
    // Reading a damaged packet must not stop the rest of the details dialog from opening.
    return { error: true, values: {} };
  }
}

const replaceText = (node, value) => {
  node = valueNode(node);
  if (node.nodeType === 2) node.value = value;
  else {
    node.removeAttributeNS(NS.rdf, 'resource');
    node.textContent = value;
  }
};
function writeValue(xml, node, kind, value) {
  if (kind !== 'Alt' && kind !== 'Seq') {
    replaceText(node, value);
    return;
  }
  let array = child(valueNode(node), 'rdf', kind);
  if (!array) {
    replaceText(node, '');
    array = xml.createElementNS(NS.rdf, `rdf:${kind}`);
    valueNode(node).appendChild(array);
  }
  const items = children(array).filter((item) => is(item, 'rdf', 'li'));
  let first =
    kind === 'Alt'
      ? items.find((item) => item.getAttributeNS(NS.xml, 'lang') === 'x-default')
      : items[0];
  if (!first) {
    first = xml.createElementNS(NS.rdf, 'rdf:li');
    if (kind === 'Alt') first.setAttributeNS(NS.xml, 'xml:lang', 'x-default');
    array.insertBefore(first, array.firstChild);
  } else if (kind === 'Alt') {
    const previous = text(first);
    // Preserve translations, updating only alternatives that tracked the default verbatim.
    for (const item of items) if (text(item) === previous) replaceText(item, value);
  }
  replaceText(first, value);
}

/** Prepare the complete replacement before changing any PDF objects. */
export function updatedXmp(packet, values, extras = []) {
  if (!packet) return null;
  if (packet.error) throw unsafe();
  try {
    const { xml, descriptions, properties } = packet;
    const updates = Object.entries(values)
      .filter(([key, value]) => FIELDS[key] && value !== undefined)
      .map(([key, value]) => ({ field: FIELDS[key], value }));
    for (const { prefix, local, value } of extras) updates.push({ field: [prefix, local], value });
    for (const {
      field: [prefix, local, kind],
      value,
    } of updates) {
      const rendered = value instanceof Date ? value.toISOString() : value;
      const key = propertyKey(NS[prefix], local);
      let nodes = properties.get(key) || [];
      if (value === null) {
        for (const node of nodes)
          if (node.nodeType === 2) node.ownerElement.removeAttributeNode(node);
          else node.parentNode.removeChild(node);
        properties.delete(key);
        continue;
      }
      if (
        nodes.length &&
        nodes.every((node) => {
          const before = readValue(node, kind);
          return (
            value === before ||
            (value instanceof Date && before instanceof Date && +value === +before)
          );
        })
      )
        continue;
      if (!nodes.length) {
        const node = xml.createElementNS(NS[prefix], `${prefix}:${local}`);
        descriptions[0].appendChild(node);
        nodes = [node];
        properties.set(key, nodes);
      }
      for (let i = 0; i < nodes.length; i++) {
        let node = nodes[i];
        // Arrays cannot use RDF's shorthand attribute syntax.
        if (node.nodeType === 2 && (kind === 'Alt' || kind === 'Seq')) {
          const owner = node.ownerElement;
          owner.removeAttributeNode(node);
          node = xml.createElementNS(NS[prefix], `${prefix}:${local}`);
          owner.appendChild(node);
          nodes[i] = node;
        }
        writeValue(xml, node, kind, rendered);
      }
    }
    for (const node of Array.from(xml.childNodes))
      if (node.nodeType === 7 && node.target === 'xml') xml.removeChild(node);
    // UTF-8 is XML's default encoding. Drop an old UTF-16/32 declaration, which is
    // represented as a processing instruction by the DOM parser, before serializing.
    const serializer = new XMLSerializer();
    return new TextEncoder().encode(
      serializer.serializeToString(xml, {
        requireWellFormed: true,
        // A literal CR becomes LF when XML is read again. Preserve text-node CRs
        // as references, retaining the serializer's validation and markup escaping.
        nodeFilter: (node) =>
          node.nodeType === 3 && node.data.includes('\r')
            ? serializer
                .serializeToString(node, { requireWellFormed: true })
                .replaceAll('\r', '&#13;')
            : node,
      }),
    );
  } catch {
    throw unsafe();
  }
}

/** Isolate a shared metadata stream, retiring the old stream only if it is now unreachable. */
export function installXmp(doc, packet, bytes) {
  if (!bytes) return;
  const old = doc.catalog.get(n('Metadata'));
  const next = packet.stream.dict.has(n('Filter'))
    ? doc.context.flateStream(bytes)
    : doc.context.stream(bytes);
  for (const [key, value] of packet.stream.dict.entries())
    if (
      !['Length', 'Filter', 'DecodeParms', 'F', 'FFilter', 'FDecodeParms', 'DL'].includes(
        key.decodeText(),
      )
    )
      next.dict.set(key, value);
  next.dict.set(n('Type'), n('Metadata'));
  next.dict.set(n('Subtype'), n('XML'));
  // Preserve the metadata's explicit cipher (including Identity exemptions) when
  // replacing its contents; only the compression stage and its parameters change.
  retainCryptFilter(next.dict, [packet.stream.dict]);
  doc.catalog.set(n('Metadata'), doc.context.register(next));
  if (!(old instanceof PDFRef)) return;
  const pending = Object.values(doc.context.trailerInfo),
    seen = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (value === old) return;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof PDFRef) pending.push(doc.context.lookup(value));
    else if (value instanceof PDFStream) pending.push(value.dict);
    else if (value instanceof PDFDict) for (const [, entry] of value.entries()) pending.push(entry);
    else if (value instanceof PDFArray) for (const entry of value.asArray()) pending.push(entry);
  }
  doc.context.delete(old);
}
