// Opaque document-level PSD data. Channel/layer records and merged transparency
// belong to the editable model and must always be regenerated, never restored.
// Section structure and PSD/PSB length differences:
// Layout: the published PSD file format specification.
export const psdMetadataMimeType = 'application/x-photo-editor-psd-metadata';
const magic = new TextEncoder().encode('PSMD0001');
const memoryLimit = 512 * 1024 * 1024;
// Bound indexing overhead independently of payload bytes: millions of empty
// blocks must not allocate millions of JavaScript objects from a small file.
const maxTags = 65536;
const layerKeys = new Set(['Layr', 'Lr16', 'Lr32', 'Mtrn', 'Mt16', 'Mt32']);
const largeKeys = new Set([
  'LMsk',
  'Lr16',
  'Lr32',
  'Layr',
  'Mt16',
  'Mt32',
  'Mtrn',
  'Alph',
  'FMsk',
  'lnk2',
  'FEid',
  'FXid',
  'PxSD',
  // Modern compositor info uses wide lengths in PSB (also recognized by ag-psd).
  'cinf',
]);
export type PsdTag = { key: string; data: Uint8Array; wideLength?: boolean };
export type PsdMetadata = { globalMask: Uint8Array; tags: PsdTag[] };

class Reader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  check(offset: number, length: number, end = this.bytes.length) {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > end ||
      end > this.bytes.length
    )
      throw new Error('Truncated or invalid PSD metadata.');
  }
  uint32(offset: number, end = this.bytes.length) {
    this.check(offset, 4, end);
    return this.view.getUint32(offset);
  }
  length(offset: number, large: boolean, end = this.bytes.length) {
    this.check(offset, large ? 8 : 4, end);
    const value = large
      ? this.view.getUint32(offset) * 0x100000000 +
        this.view.getUint32(offset + 4)
      : this.view.getUint32(offset);
    if (!Number.isSafeInteger(value) || value > memoryLimit)
      throw new Error('PSD metadata exceeds the 512 MB budget.');
    return value;
  }
  signature(offset: number, end = this.bytes.length) {
    this.check(offset, 4, end);
    return String.fromCharCode(...this.bytes.subarray(offset, offset + 4));
  }
}
export type PsdLayerMaskRecord = {
  recordStart: number;
  start: number;
  end: number;
  hasRealMask: boolean;
  hasLayerPixels: boolean;
  sectionDivider: number;
};

// Mask headers live inside each layer's extra-data section. Enumerate their
// exact spans without decoding image planes or guessing from layer IDs/names.
export function readPsdLayerMaskRecords(bytes: Uint8Array): PsdLayerMaskRecord[][] {
  const s = sections(bytes), r = s.r;
  const blocks: [number, number][] = [];
  if (s.layerEnd > s.start + s.lengthSize)
    blocks.push([s.start + s.lengthSize, s.layerEnd]);
  for (const t of s.tags)
    if (t.key === 'Lr16' || t.key === 'Lr32')
      blocks.push([t.data.byteOffset - bytes.byteOffset, t.data.byteOffset - bytes.byteOffset + t.data.length]);
  return blocks.map(([start, end]) => {
    r.check(start, 2, end);
    const count = Math.abs(r.view.getInt16(start));
    let at = start + 2;
    const records: PsdLayerMaskRecord[] = [];
    for (let i = 0; i < count; i++) {
      r.check(at, 18, end);
      const channelCount = r.view.getUint16(at + 16),
        stride = s.psb ? 10 : 6,
        channels = at + 18;
      r.check(channels, channelCount * stride + 16, end);
      let hasRealMask = false, hasLayerPixels = false;
      for (let j = 0; j < channelCount; j++) {
        const channel = channels + j * stride, id = r.view.getInt16(channel);
        if (id === -3) hasRealMask = true;
        if (id !== -2 && id !== -3 && r.length(channel + 2, s.psb, end) > 2)
          hasLayerPixels = true;
      }
      const extraLength = channels + channelCount * stride + 12;
      if (r.signature(extraLength - 12, end) !== '8BIM')
        throw new Error('Invalid PSD layer record signature.');
      const extra = extraLength + 4, extraEnd = extra + r.uint32(extraLength, end);
      r.check(extra, extraEnd - extra, end);
      const maskStart = extra + 4, maskEnd = maskStart + r.uint32(extra, extraEnd);
      r.check(maskStart, maskEnd - maskStart, extraEnd);
      let info = maskEnd + 4 + r.uint32(maskEnd, extraEnd);
      r.check(info, 1, extraEnd);
      const nameLength = bytes[info];
      info += 1 + nameLength;
      r.check(info, 0, extraEnd);
      // Accept an unpadded Pascal name as the pinned reader does. Canonical
      // names have at most three padding bytes; never scan through tag data.
      for (let padding = 0; padding < 3 && info + 12 <= extraEnd &&
        !['8BIM', '8B64'].includes(r.signature(info, extraEnd)); padding++) info++;
      r.check(info, 0, extraEnd);
      let sectionDivider = 0;
      while (info < extraEnd && bytes[info] === 0) info++;
      while (info + 12 <= extraEnd) {
        const signature = r.signature(info, extraEnd), key = r.signature(info + 4, extraEnd);
        if (signature !== '8BIM' && signature !== '8B64')
          throw new Error('Invalid PSD layer tag signature.');
        const large = signature === '8B64' || (s.psb && largeKeys.has(key));
        const data = info + (large ? 16 : 12), size = r.length(info + 8, large, extraEnd);
        r.check(data, size, extraEnd);
        if (key === 'lsct' || key === 'lsdk') {
          r.check(data, 4, data + size);
          sectionDivider = r.uint32(data, data + size);
        }
        // Layer tags use even padding (some handlers include wider alignment
        // in their length); document-level tags use four-byte padding above.
        info = data + Math.ceil(size / 2) * 2;
        r.check(info, 0, extraEnd);
      }
      records.push({ recordStart: at, start: maskStart, end: maskEnd, hasRealMask, hasLayerPixels, sectionDivider });
      at = extraEnd;
    }
    return records;
  });
}
const padded = (size: number) => Math.ceil(size / 4) * 4;
function tags(
  reader: Reader,
  start: number,
  end: number,
  psb: boolean,
  native = false,
) {
  const result: PsdTag[] = [];
  for (let at = start; at < end;) {
    // Some compatible writers leave zero padding before/between global blocks.
    while (at < end && reader.bytes[at] === 0) at++;
    if (at === end) break;
    if (result.length === maxTags)
      throw new Error('PSD metadata exceeds the block index budget.');
    const signature = reader.signature(at, end);
    if (signature !== '8BIM' && signature !== '8B64')
      throw new Error('Invalid PSD metadata signature.');
    const key = reader.signature(at + 4, end);
    const large =
      signature === '8B64' || (!native && psb && largeKeys.has(key));
    const size = reader.length(at + 8, large, end),
      dataStart = at + (large ? 16 : 12);
    reader.check(dataStart, size, end);
    let next = dataStart + padded(size);
    const even = dataStart + Math.ceil(size / 2) * 2;
    const hasHeader = (at: number) =>
      at + 12 <= end && ['8BIM', '8B64'].includes(reader.signature(at, end));
    // Some writers apply layer-level two-byte padding to document globals.
    // Recover only at the payload's even boundary, never by scanning its data.
    // Native assets and our output always use canonical four-byte padding.
    if (!native && (next > end || (even !== next && hasHeader(even))))
      next = even;
    reader.check(dataStart, next - dataStart, end);
    result.push({
      key,
      data: reader.bytes.subarray(dataStart, dataStart + size),
      // Preserve an explicit wide header for unknown future block types. Known
      // version-dependent keys are regenerated for the destination file version.
      wideLength:
        signature === '8B64' && !largeKeys.has(key) ? true : undefined,
    });
    at = next;
  }
  return result;
}
function sections(bytes: Uint8Array) {
  const r = new Reader(bytes);
  r.check(0, 26);
  if (r.signature(0) !== '8BPS') throw new Error('Invalid PSD metadata file.');
  const version = r.view.getUint16(4);
  if (version !== 1 && version !== 2)
    throw new Error('Invalid PSD metadata version.');
  const psb = version === 2,
    lengthSize = psb ? 8 : 4;
  let section = 26;
  for (let i = 0; i < 2; i++) {
    const length = r.uint32(section);
    r.check(section + 4, length);
    section += 4 + length;
  }
  const start = section + lengthSize,
    size = r.length(section, psb),
    end = start + size;
  r.check(start, size);
  if (!size)
    return {
      r,
      section,
      start,
      end,
      layerEnd: start,
      mask: new Uint8Array(),
      tags: [],
      psb,
      lengthSize,
    };
  const layerEnd = start + lengthSize + r.length(start, psb, end);
  r.check(start, layerEnd - start, end);
  // Older SAI files can end immediately after their layer-info section.
  if (layerEnd === end)
    return {
      r,
      section,
      start,
      end,
      layerEnd,
      mask: new Uint8Array(),
      tags: [],
      psb,
      lengthSize,
    };
  const maskSize = r.uint32(layerEnd, end),
    maskStart = layerEnd + 4;
  r.check(maskStart, maskSize, end);
  return {
    r,
    section,
    start,
    end,
    layerEnd,
    mask: bytes.subarray(maskStart, maskStart + maskSize),
    tags: tags(r, maskStart + maskSize, end, psb),
    psb,
    lengthSize,
  };
}

/** Views into the input, excluding regenerated layer/transparency blocks. */
export function readPsdMetadata(bytes: Uint8Array): PsdMetadata {
  const s = sections(bytes);
  return {
    globalMask: s.mask,
    tags: s.tags.filter((t) => !layerKeys.has(t.key)),
  };
}
function tagSize(tag: PsdTag, psb: boolean) {
  return (
    (tag.wideLength || (psb && largeKeys.has(tag.key)) ? 16 : 12) +
    padded(tag.data.length)
  );
}
function checkSize(size: number) {
  if (!Number.isSafeInteger(size) || size > memoryLimit)
    throw new Error('PSD metadata exceeds the 512 MB budget.');
}
function writeTags(
  out: Uint8Array,
  offset: number,
  records: PsdTag[],
  psb: boolean,
) {
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (const tag of records) {
    if (
      typeof tag.key !== 'string' ||
      tag.key.length !== 4 ||
      [...tag.key].some((c) => c.charCodeAt(0) > 255)
    )
      throw new Error('Invalid PSD metadata key.');
    const large = tag.wideLength || (psb && largeKeys.has(tag.key));
    out.set(new TextEncoder().encode(large ? '8B64' : '8BIM'), offset);
    out.set(
      Uint8Array.from(tag.key, (c) => c.charCodeAt(0)),
      offset + 4,
    );
    // Upper 32 bits are zero within the bounded asset/export budget.
    v.setUint32(offset + (large ? 12 : 8), tag.data.length);
    out.set(tag.data, offset + (large ? 16 : 12));
    offset += tagSize(tag, psb);
  }
}
export function encodePsdMetadata(metadata: PsdMetadata): ArrayBuffer {
  if (metadata.tags.length > maxTags)
    throw new Error('PSD metadata exceeds the block index budget.');
  if (metadata.tags.some((t) => layerKeys.has(t.key)))
    throw new Error(
      'Native PSD metadata cannot replace editable layer records.',
    );
  const size =
    12 +
    metadata.globalMask.length +
    metadata.tags.reduce((n, t) => n + tagSize(t, false), 0);
  checkSize(size);
  const out = new Uint8Array(size);
  out.set(magic);
  new DataView(out.buffer).setUint32(8, metadata.globalMask.length);
  out.set(metadata.globalMask, 12);
  writeTags(out, 12 + metadata.globalMask.length, metadata.tags, false);
  return out.buffer;
}
export function decodePsdMetadata(bytes: Uint8Array): PsdMetadata {
  checkSize(bytes.length);
  const r = new Reader(bytes);
  r.check(0, 12);
  if (!magic.every((v, i) => bytes[i] === v))
    throw new Error('Invalid native PSD metadata.');
  const length = r.uint32(8),
    end = 12 + length;
  r.check(12, length);
  const records = tags(r, end, bytes.length, false, true);
  if (records.some((t) => layerKeys.has(t.key)))
    throw new Error(
      'Native PSD metadata cannot replace editable layer records.',
    );
  return { globalMask: bytes.subarray(12, end), tags: records };
}

/** Preserve opaque globals, while current model-owned records take precedence. */
export function restorePsdMetadata(
  bytes: Uint8Array,
  metadata: PsdMetadata,
): ArrayBuffer {
  const s = sections(bytes);
  if (metadata.tags.some((t) => layerKeys.has(t.key)))
    throw new Error(
      'Native PSD metadata cannot replace editable layer records.',
    );
  const keys = new Set(s.tags.map((t) => t.key));
  const records = [...s.tags, ...metadata.tags.filter((t) => !keys.has(t.key))];
  if (records.length > maxTags)
    throw new Error('PSD metadata exceeds the block index budget.');
  const mask = s.mask.length ? s.mask : metadata.globalMask;
  // An empty original section needs an empty layer-info length before globals.
  const layerSize = s.layerEnd - s.start || s.lengthSize;
  const sectionSize =
    layerSize +
    4 +
    mask.length +
    records.reduce((n, t) => n + tagSize(t, s.psb), 0);
  const size = bytes.length - (s.end - s.start) + sectionSize;
  checkSize(size);
  const out = new Uint8Array(size),
    v = new DataView(out.buffer);
  out.set(bytes.subarray(0, s.start));
  v.setUint32(s.section + (s.psb ? 4 : 0), sectionSize);
  out.set(bytes.subarray(s.start, s.layerEnd), s.start);
  let offset = s.start + layerSize;
  v.setUint32(offset, mask.length);
  offset += 4;
  out.set(mask, offset);
  offset += mask.length;
  writeTags(out, offset, records, s.psb);
  out.set(bytes.subarray(s.end), s.start + sectionSize);
  return out.buffer;
}
