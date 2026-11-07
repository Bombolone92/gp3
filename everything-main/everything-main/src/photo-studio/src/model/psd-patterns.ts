import { Inflate } from "pako";
import type { Psd, ReadOptions } from "ag-psd";
import { infoHandlersMap } from "ag-psd/dist/additionalInfo";
import { readBytes } from "ag-psd/dist/psdReader";
import { assertSize } from "./document";
import { readPsdWithPixelMasks } from "./psd-mask-codec";
import { withPsdFillReaders } from "./psd-fill-codec";

const memoryLimit = 512 * 1024 * 1024;
const indexLimit = 262144;
export type PatternBounds = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};
export type PsdPatternChannel = {
  written: number;
  depth?: number;
  pixelDepth?: number;
  bounds?: PatternBounds;
  compression?: number;
  data?: Uint8Array;
};
export type PsdPatternResource = {
  name: string;
  id: string;
  colorMode: number;
  // The format stores a vertical/horizontal size point, not a tile origin.
  size: [number, number];
  bounds: PatternBounds;
  colorChannels: number;
  channels: PsdPatternChannel[];
  palette?: Uint8Array;
  // Complete original record, including its length and alignment. Native/PSD
  // metadata round trips retain this rather than regenerating an 8-bit tile.
  raw: Uint8Array;
};
export type PatternPixels = {
  width: number;
  height: number;
  data:
    | Uint8Array<ArrayBuffer>
    | Uint16Array<ArrayBuffer>
    | Float32Array<ArrayBuffer>;
};
export type PsdWithPatternResources = Psd & {
  patternResources?: PsdPatternResource[];
};

class Reader {
  at = 0;
  readonly view: DataView;
  constructor(
    readonly bytes: Uint8Array,
    public end = bytes.length,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  take(n: number) {
    if (!Number.isSafeInteger(n) || n < 0 || this.at + n > this.end)
      throw new Error("Truncated PSD pattern resource.");
    const at = this.at;
    this.at += n;
    return at;
  }
  u32() {
    return this.view.getUint32(this.take(4));
  }
  u16() {
    return this.view.getUint16(this.take(2));
  }
  i16() {
    return this.view.getInt16(this.take(2));
  }
  u8() {
    return this.bytes[this.take(1)];
  }
  rectangle(): PatternBounds {
    const top = this.u32(),
      left = this.u32(),
      bottom = this.u32(),
      right = this.u32();
    if (bottom < top || right < left)
      throw new Error("Invalid PSD pattern bounds.");
    return { top, left, bottom, right };
  }
  padding(end: number) {
    if (
      end < this.at ||
      end - this.at > 3 ||
      this.bytes.subarray(this.at, end).some((v) => v !== 0)
    )
      throw new Error("Invalid PSD pattern padding.");
    this.at = end;
  }
}

// Layout: the published PSD file format specification.
// Indexed patterns include four bytes after the interleaved RGB palette, as
// implemented by the independent MIT psd-tools codec and the pinned ag-psd.
export function indexPsdPatterns(bytes: Uint8Array): PsdPatternResource[] {
  if (bytes.length > memoryLimit)
    throw new Error("PSD patterns exceed 512 MB.");
  const r = new Reader(bytes),
    patterns: PsdPatternResource[] = [];
  let entries = 0;
  while (r.at < bytes.length) {
    if (++entries > indexLimit)
      throw new Error("PSD pattern index budget exceeded.");
    const start = r.at,
      length = r.u32(),
      end = r.at + length,
      paddedEnd = r.at + Math.ceil(length / 4) * 4;
    if (paddedEnd > bytes.length)
      throw new Error("Truncated PSD pattern record.");
    r.end = end;
    if (r.u32() !== 1) throw new Error("Unsupported PSD pattern version.");
    const colorMode = r.u32(),
      size: [number, number] = [r.i16(), r.i16()],
      nameLength = r.u32(),
      nameAt = r.take(nameLength * 2),
      name = new TextDecoder("utf-16be", { ignoreBOM: true })
        .decode(bytes.subarray(nameAt, r.at))
        .replace(/\0$/, ""),
      idLength = r.u8(),
      idAt = r.take(idLength),
      id = String.fromCharCode(...bytes.subarray(idAt, r.at));
    let palette: Uint8Array | undefined;
    if (colorMode === 2) {
      palette = bytes.subarray(r.take(768), r.at);
      r.take(4);
    }
    if (r.u32() !== 3) throw new Error("Unsupported PSD pattern VMAL version.");
    const vmalLength = r.u32(),
      vmalEnd = r.at + vmalLength;
    if (vmalEnd > end) throw new Error("Truncated PSD pattern VMAL.");
    r.end = vmalEnd;
    const bounds = r.rectangle(),
      colorChannels = r.u32();
    // Bound object allocation independently of compressed byte counts.
    if (colorChannels > 64 || (entries += colorChannels + 2) > indexLimit)
      throw new Error("PSD pattern channel index budget exceeded.");
    const channels: PsdPatternChannel[] = [];
    for (let i = 0; i < colorChannels + 2; i++) {
      const written = r.u32(),
        channel: PsdPatternChannel = { written };
      if (written) {
        const channelLength = r.u32(),
          channelEnd = r.at + channelLength;
        if (channelEnd > vmalEnd)
          throw new Error("Truncated PSD pattern channel.");
        if (channelLength) {
          if (channelLength < 23)
            throw new Error("Invalid PSD pattern channel length.");
          channel.depth = r.u32();
          channel.bounds = r.rectangle();
          channel.pixelDepth = r.u16();
          channel.compression = r.u8();
          channel.data = bytes.subarray(r.take(channelLength - 23), r.at);
        }
      }
      channels.push(channel);
    }
    r.padding(vmalEnd);
    r.end = end;
    r.padding(end);
    r.end = bytes.length;
    r.padding(paddedEnd);
    patterns.push({
      name,
      id,
      colorMode,
      size,
      bounds,
      colorChannels,
      channels,
      palette,
      raw: bytes.subarray(start, paddedEnd),
    });
  }
  return patterns;
}

function inflatePlane(compressed: Uint8Array, expected: number) {
  const output = new Uint8Array(expected);
  let at = 0;
  const decoder = new Inflate({
    windowBits: 15,
    chunkSize: Math.min(65536, expected + 1),
  });
  decoder.onData = (chunk) => {
    if (!(chunk instanceof Uint8Array) || at + chunk.length > expected)
      throw new Error("PSD pattern ZIP output exceeds channel dimensions.");
    output.set(chunk, at);
    at += chunk.length;
  };
  const state = decoder as unknown as {
    ended: boolean;
    strm: { avail_in: number; total_in: number };
  };
  if (
    !decoder.push(compressed, true) ||
    decoder.err ||
    !state.ended ||
    at !== expected ||
    state.strm.avail_in !== 0 ||
    state.strm.total_in !== compressed.length
  )
    throw new Error("Invalid PSD pattern ZIP stream.");
  return output;
}

function unpackRows(compressed: Uint8Array, rowBytes: number, height: number) {
  const reader = new Reader(compressed),
    lengths: number[] = [];
  // Pattern VMAs always use 16-bit row lengths, even inside a PSB document.
  for (let y = 0; y < height; y++) lengths.push(reader.u16());
  const output = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const end = reader.at + lengths[y];
    if (end > compressed.length)
      throw new Error("Truncated PSD pattern RLE row.");
    reader.end = end;
    let x = 0;
    while (reader.at < end) {
      const code = reader.u8();
      if (code === 128) continue; // PackBits no-op.
      const count = code < 128 ? code + 1 : 257 - code;
      if (x + count > rowBytes)
        throw new Error("PSD pattern RLE row exceeds dimensions.");
      const at = y * rowBytes + x;
      if (code < 128)
        output.set(compressed.subarray(reader.take(count), reader.at), at);
      else output.fill(reader.u8(), at, at + count);
      x += count;
    }
    if (x !== rowBytes) throw new Error("Truncated PSD pattern RLE pixels.");
    reader.end = compressed.length;
  }
  if (reader.at !== compressed.length)
    throw new Error("Trailing PSD pattern RLE data.");
  return output;
}

function dimensions(bounds: PatternBounds) {
  const width = bounds.right - bounds.left,
    height = bounds.bottom - bounds.top;
  assertSize(width, height);
  return { width, height };
}

export function decodePsdPatternChannel(
  channel: PsdPatternChannel,
  byteBudget = memoryLimit,
) {
  const { depth, pixelDepth, bounds, compression, data } = channel;
  if (!channel.written || !bounds || !data || depth === undefined)
    throw new Error("PSD pattern channel has no pixel data.");
  if (depth !== pixelDepth || ![8, 16, 32].includes(depth))
    throw new Error("Unsupported PSD pattern channel depth.");
  const { width, height } = dimensions(bounds),
    rowBytes = width * (depth / 8),
    expected = rowBytes * height;
  if (
    !Number.isFinite(byteBudget) ||
    Math.min(byteBudget, memoryLimit) < expected * 2
  )
    throw new Error("PSD pattern channel exceeds the decoded pixel budget.");
  let bytes: Uint8Array;
  if (compression === 0) {
    if (data.length !== expected)
      throw new Error("Invalid PSD pattern RAW channel length.");
    bytes = data;
  } else if (compression === 1) bytes = unpackRows(data, rowBytes, height);
  else if (compression === 2 || compression === 3)
    bytes = inflatePlane(data, expected);
  else throw new Error("Unsupported PSD pattern channel compression.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Prediction is per scanline: byte deltas at 8 bits, big-endian uint16
  // deltas at 16 bits, and byte-plane deltas at 32 bits. See the independent
  // psd-tools compression implementation; the pattern table's compression
  // labels in the format specification omit RLE and ZIP prediction.
  if (compression === 3) {
    for (let y = 0; y < height; y++) {
      const row = y * rowBytes;
      if (depth === 16) {
        for (let x = 1; x < width; x++)
          view.setUint16(
            row + x * 2,
            view.getUint16(row + (x - 1) * 2) + view.getUint16(row + x * 2),
          );
      } else {
        for (let x = 1; x < rowBytes; x++) bytes[row + x] += bytes[row + x - 1];
      }
    }
  }
  const output =
    depth === 8
      ? new Uint8Array(width * height)
      : depth === 16
        ? new Uint16Array(width * height)
        : new Float32Array(width * height);
  const bits =
    output instanceof Float32Array ? new Uint32Array(output.buffer) : undefined;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (depth === 8) output[i] = bytes[i];
      else if (depth === 16) output[i] = view.getUint16(i * 2);
      else if (compression === 3) {
        const at = y * rowBytes + x;
        bits![i] =
          ((bytes[at] << 24) |
            (bytes[at + width] << 16) |
            (bytes[at + 2 * width] << 8) |
            bytes[at + 3 * width]) >>>
          0;
      } else bits![i] = view.getUint32(i * 4);
      if (!Number.isFinite(output[i]))
        throw new Error("Invalid floating-point PSD pattern sample.");
    }
  return { width, height, data: output };
}

function patternLayout(pattern: PsdPatternResource) {
  if (![1, 2, 3].includes(pattern.colorMode))
    throw new Error("Unsupported PSD pattern color mode.");
  const colors = pattern.channels
      .slice(0, pattern.colorChannels)
      .filter((c) => c.data),
    count = pattern.colorMode === 3 ? 3 : 1;
  if (colors.length !== count)
    throw new Error("Unsupported PSD pattern color channel layout.");
  // Keep auxiliary user masks opaque until their pattern-specific semantics
  // are established. The last VMA is sheet/transparency alpha, independently
  // of how many color slots are unwritten; it is never a fourth color plane.
  if (pattern.channels[pattern.colorChannels]?.data)
    throw new Error("PSD pattern user masks are not yet supported.");
  const alpha = pattern.channels[pattern.colorChannels + 1],
    planes = alpha?.data ? [...colors, alpha] : colors,
    depth = colors[0].depth;
  if (
    ![8, 16, 32].includes(depth ?? 0) ||
    planes.some((c) => c.depth !== depth) ||
    (pattern.colorMode === 2 &&
      (depth !== 8 || pattern.palette?.length !== 768))
  )
    throw new Error("Unsupported PSD pattern color depth.");
  return { colors, planes, alpha, depth: depth! };
}
export function supportedPsdPattern(pattern: PsdPatternResource) {
  try {
    patternLayout(pattern);
    return true;
  } catch {
    return false;
  }
}
/** Decode a requested tile only, retaining native RGB, straight alpha and HDR. */
export function decodePsdPattern(
  pattern: PsdPatternResource,
  byteBudget = memoryLimit,
): PatternPixels {
  const { colors, planes, alpha, depth } = patternLayout(pattern);
  const { width, height } = dimensions(pattern.bounds),
    bytesPerSample = depth! / 8,
    outputBytes = width * height * 4 * bytesPerSample;
  let peakPlaneBytes = 0;
  for (const c of planes) {
    const d = dimensions(c.bounds!);
    peakPlaneBytes = Math.max(
      peakPlaneBytes,
      d.width * d.height * bytesPerSample * 2,
    );
  }
  if (
    !Number.isFinite(byteBudget) ||
    outputBytes + peakPlaneBytes > Math.min(byteBudget, memoryLimit)
  )
    throw new Error("PSD pattern exceeds the decoded pixel budget.");
  const data =
      depth === 8
        ? new Uint8Array(width * height * 4)
        : depth === 16
          ? new Uint16Array(width * height * 4)
          : new Float32Array(width * height * 4),
    maximum = depth === 32 ? 1 : depth === 16 ? 65535 : 255;
  for (let i = 3; i < data.length; i += 4) data[i] = alpha?.data ? 0 : maximum;
  for (let ch = 0; ch < planes.length; ch++) {
    const channel = planes[ch],
      pixels = decodePsdPatternChannel(channel, byteBudget - outputBytes),
      isAlpha = ch === colors.length,
      b = channel.bounds!,
      p = pattern.bounds;
    if (isAlpha && pixels.data.some((value) => value < 0 || value > maximum))
      throw new Error("Invalid PSD pattern alpha.");
    // Respect each VMA rectangle. Intersect in document coordinates, rather
    // than treating differently sized channels as contiguous tile rows.
    for (
      let y = Math.max(b.top, p.top);
      y < Math.min(b.bottom, p.bottom);
      y++
    ) {
      for (
        let x = Math.max(b.left, p.left);
        x < Math.min(b.right, p.right);
        x++
      ) {
        const source = (y - b.top) * pixels.width + x - b.left,
          destination = ((y - p.top) * width + x - p.left) * 4,
          value = pixels.data[source];
        if (isAlpha) {
          data[destination + 3] = value;
        } else if (pattern.colorMode === 3) data[destination + ch] = value;
        else if (pattern.colorMode === 1)
          for (let c = 0; c < 3; c++) data[destination + c] = value;
        else
          for (let c = 0; c < 3; c++)
            data[destination + c] = pattern.palette![value * 3 + c];
      }
    }
  }
  return { width, height, data };
}

/** Replace the dependency's eager byte-only pattern cache with native records. */
export function readPsdWithPatternResources(
  bytes: Uint8Array,
  options?: ReadOptions,
): PsdWithPatternResources {
  const handler = infoHandlersMap.Patt,
    previous = handler.read;
  let failure: unknown,
    entries = 0;
  // All three format keys share the pinned dispatch entry. Synchronous scoped
  // replacement mirrors the mask/stroke adapters; no asynchronous global state.
  handler.read = (reader, target, left) => {
    try {
      const records = indexPsdPatterns(readBytes(reader, left()));
      entries += records.reduce((n, p) => n + 1 + p.channels.length, 0);
      if (entries > indexLimit)
        throw new Error("PSD pattern index budget exceeded.");
      const native = target as PsdWithPatternResources;
      const resources = (native.patternResources ??= []);
      for (const record of records) resources.push(record);
    } catch (error) {
      // ag-psd normally suppresses tagged-block errors. A malformed pattern
      // must be reported, rather than silently discarding its definition.
      failure ??= error;
    }
  };
  try {
    const psd = withPsdFillReaders(() =>
      readPsdWithPixelMasks(bytes, options),
    );
    if (failure) throw failure;
    return psd;
  } finally {
    handler.read = previous;
  }
}
