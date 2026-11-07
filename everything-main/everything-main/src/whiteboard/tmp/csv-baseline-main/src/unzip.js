// A small ZIP reader for Office Open XML imports. Entries are listed from the
// central directory and decompressed lazily with the browser's
// DecompressionStream("deflate-raw"). Archives are untrusted: entry count,
// per-entry size, and total inflated size are bounded, and inflation stops as
// soon as output exceeds the size the archive declared.
export const ZIP_LIMITS = {
  entries: 2000,
  entry: 50 * 1024 * 1024,
  total: 200 * 1024 * 1024,
};
export class ZipError extends Error {}

const decoder = new TextDecoder("utf-8", { fatal: false });
const EOCD = 0x06054b50,
  CENTRAL = 0x02014b50,
  LOCAL = 0x04034b50;

export const canInflate = () =>
  typeof DecompressionStream === "function" &&
  (() => {
    try {
      new DecompressionStream("deflate-raw");
      return true;
    } catch {
      return false;
    }
  })();

// With `partial`, output stops at the limit instead of failing, giving the
// start of the part. `progress` returns how much output still fits the
// shared archive budget, including chunks other reads already produced.
async function inflate(bytes, limit, partial = false, progress) {
  if (!canInflate())
    throw new ZipError(
      "This browser cannot open compressed Office files. Update your browser and try again.",
    );
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const next = Math.min(size + value.length, limit),
        allowed = progress ? progress(next) : next;
      if (size + value.length > allowed) {
        await reader.cancel().catch(() => {});
        if (!partial)
          throw new ZipError("This file expands beyond the import size limit.");
        chunks.push(value.subarray(0, allowed - size));
        size = allowed;
        break;
      }
      size += value.length;
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ZipError) throw error;
    throw new ZipError("This file is damaged or is not a supported document.");
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// Returns { names, has(name), size(name), bytes(name), text(name),
// start(name, max) }.
export function readZip(input, limits = {}) {
  const {
    entries: maxEntries,
    entry: maxEntry,
    total: maxTotal,
    // A part over this size is only ever read from its start, such as the
    // first rows of a large sheet, however large it says it is.
    start: maxStart = Infinity,
  } = {
    ...ZIP_LIMITS,
    ...limits,
  };
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () =>
    new ZipError("This file is damaged or is not a supported document.");
  // Office saves password-protected files in an OLE container holding an
  // EncryptionInfo stream instead of a ZIP archive.
  if (
    bytes.length > 8 &&
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
      (b, n) => bytes[n] === b,
    ) &&
    new TextDecoder("utf-16le").decode(bytes).includes("EncryptionInfo")
  )
    throw new ZipError("Password-protected documents are not supported.");
  // The end-of-central-directory record is within the last 64 KB + 22 bytes.
  let end = -1;
  for (
    let n = bytes.length - 22;
    n >= Math.max(0, bytes.length - 22 - 0xffff);
    n--
  )
    if (view.getUint32(n, true) === EOCD) {
      end = n;
      break;
    }
  if (end < 0) throw invalid();
  const count = view.getUint16(end + 10, true),
    directorySize = view.getUint32(end + 12, true),
    directory = view.getUint32(end + 16, true);
  if (count === 0xffff || directory === 0xffffffff)
    throw new ZipError("Large ZIP64 archives are not supported.");
  if (count > maxEntries)
    throw new ZipError("This file contains too many parts to import.");
  if (directory + directorySize > end) throw invalid();
  const entries = new Map();
  let at = directory,
    declared = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL) throw invalid();
    const flags = view.getUint16(at + 8, true),
      method = view.getUint16(at + 10, true),
      compressed = view.getUint32(at + 20, true),
      size = view.getUint32(at + 24, true),
      nameLength = view.getUint16(at + 28, true),
      extraLength = view.getUint16(at + 30, true),
      commentLength = view.getUint16(at + 32, true),
      offset = view.getUint32(at + 42, true);
    if (at + 46 + nameLength > end) throw invalid();
    const name = decoder
      .decode(bytes.subarray(at + 46, at + 46 + nameLength))
      .replaceAll("\\", "/")
      .replace(/^\/+/, "");
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (flags & 1)
      throw new ZipError("Password-protected documents are not supported.");
    if (![0, 8].includes(method))
      throw new ZipError("This document uses an unsupported compression.");
    // A part too large to read whole can still be read in part, such as
    // the first rows of a large sheet, so only what can be read counts. A
    // part only read from its start counts as it is read, below, so a
    // workbook of several large sheets still opens.
    if (size <= maxStart) declared += Math.min(size, maxEntry);
    if (declared > maxTotal)
      throw new ZipError("This file expands beyond the import size limit.");
    if (offset + 30 > bytes.length) throw invalid();
    if (!entries.has(name))
      entries.set(name, { method, compressed, size, offset });
  }
  // Each part counts once toward the budget, however often it is read.
  let inflated = 0;
  const charged = new Map();
  function account(name, size) {
    const before = charged.get(name) || 0,
      allowed = Math.min(size, maxTotal - inflated + before);
    if (allowed > before) {
      inflated += allowed - before;
      charged.set(name, allowed);
    }
    return allowed;
  }
  function data(e) {
    if (view.getUint32(e.offset, true) !== LOCAL) throw invalid();
    const start =
      e.offset +
      30 +
      view.getUint16(e.offset + 26, true) +
      view.getUint16(e.offset + 28, true);
    if (start + e.compressed > bytes.length) throw invalid();
    return bytes.subarray(start, start + e.compressed);
  }
  async function read(name) {
    const e = entries.get(name);
    if (!e) return null;
    if (e.size > maxEntry)
      throw new ZipError("A part of this file is too large to import.");
    const packed = data(e);
    // Declared sizes can lie; the total budget is enforced on real output.
    const budget = Math.min(
      e.size,
      maxTotal - inflated + (charged.get(name) || 0),
    );
    let out;
    if (e.method === 0) {
      if (e.compressed !== e.size || e.size > budget) throw invalid();
      out = packed.slice();
    } else {
      out = await inflate(packed, budget, false, (size) => account(name, size));
      if (out.length !== e.size) throw invalid();
    }
    account(name, out.length);
    return out;
  }
  // The first `max` bytes of a part, or all of it when it is smaller. A
  // longer start read again counts only what it adds.
  async function start(name, max) {
    const e = entries.get(name);
    if (!e) return null;
    if (e.size <= max) return read(name);
    const packed = data(e),
      before = charged.get(name) || 0;
    const limit = Math.max(0, Math.min(max, maxTotal - inflated + before));
    let out;
    if (e.method === 0) {
      if (e.compressed !== e.size) throw invalid();
      out = packed.slice(0, limit);
    } else
      out = await inflate(packed, limit, true, (size) => account(name, size));
    account(name, out.length);
    return out;
  }
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    size: (name) => entries.get(name)?.size ?? 0,
    bytes: read,
    async text(name) {
      const data = await read(name);
      return data && decoder.decode(data);
    },
    start,
  };
}

// Resolves a relationship target against the part that references it.
export function resolvePart(base, target) {
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const parts = target.startsWith("/")
    ? []
    : base.split("/").slice(0, -1).filter(Boolean);
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}
