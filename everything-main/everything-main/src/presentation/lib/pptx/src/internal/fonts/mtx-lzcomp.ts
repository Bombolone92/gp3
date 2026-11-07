import { FontFormatError, requireBytes } from "./binary.ts";

// MTX 1.0, sections 2/3 and Appendix C. This is the lossless LZCOMP layer;
// its three outputs are CTF data, pushes and instructions, not an SFNT font.
// https://www.w3.org/submissions/MTX/
// The published sample/format has a royalty-free, sublicensable grant:
// https://www.w3.org/standards/licensing/
const PRELOAD_SIZE = 2 * 32 * 96 + 4 * 256;
const MIN_COPY_LIMIT = PRELOAD_SIZE + 64;
const DEFAULT_DECODED_LIMIT = 64 * 1024 * 1024;

class Bits {
  private at = 0;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  read(count: number): number {
    if (count > this.bytes.length * 8 - this.at)
      throw new FontFormatError("truncated MTX compressed stream");
    let value = 0;
    for (let i = 0; i < count; i++, this.at++)
      value =
        value * 2 + ((this.bytes[this.at >>> 3]! >>> (7 - (this.at & 7))) & 1);
    return value;
  }

  finish(): void {
    // The final partial byte is padding. Its unused bits have no meaning;
    // the reference reader does not inspect them. Whole trailing bytes are
    // not part of a block, whose enclosing offsets give its exact length.
    if (Math.ceil(this.at / 8) !== this.bytes.length)
      throw new FontFormatError("unexpected trailing MTX compressed data");
  }
}

/** Sibling-property adaptive tree, including the format's initial biases. */
class Huffman {
  private readonly parent: Int16Array;
  private readonly left: Int16Array;
  private readonly right: Int16Array;
  private readonly code: Int16Array;
  private readonly weight: Int32Array;
  private readonly symbol: Int16Array;
  private readonly fields: readonly (Int16Array | Int32Array)[];

  constructor(range: number) {
    this.parent = new Int16Array(range * 2);
    this.left = new Int16Array(range * 2);
    this.right = new Int16Array(range * 2);
    this.code = new Int16Array(range * 2).fill(-1);
    this.weight = new Int32Array(range * 2);
    this.symbol = new Int16Array(range);
    this.fields = [this.left, this.right, this.code, this.weight];
    for (let i = 2; i < range * 2; i++) this.parent[i] = i >>> 1;
    for (let i = 1; i < range; i++) {
      this.left[i] = i * 2;
      this.right[i] = i * 2 + 1;
    }
    for (let i = 0; i < range; i++) {
      this.code[range + i] = i;
      this.symbol[i] = range + i;
      this.weight[range + i] = 1;
    }
    for (let i = range - 1; i >= 1; i--)
      this.weight[i] =
        this.weight[this.left[i]!]! + this.weight[this.right[i]!]!;
    if (range > 256 && range < 512) {
      this.update(this.symbol[256]!);
      this.update(this.symbol[257]!);
      for (let i = 0; i < 12; i++) this.update(this.symbol[range - 3]!);
      for (let i = 0; i < 6; i++) this.update(this.symbol[range - 2]!);
    } else {
      for (let pass = 0; pass < 2; pass++)
        for (let i = 0; i < range; i++) this.update(this.symbol[i]!);
    }
  }

  private swap(a: number, b: number): void {
    // Swap node contents, retaining each slot's own parent. Repair the
    // moved children's parents and leaf lookup; parent edges stay put.
    for (const field of this.fields) {
      const value = field[a]!;
      field[a] = field[b]!;
      field[b] = value;
    }
    this.repair(a);
    this.repair(b);
  }

  private repair(at: number): void {
    const code = this.code[at]!;
    if (code < 0) {
      this.parent[this.left[at]!] = at;
      this.parent[this.right[at]!] = at;
    } else this.symbol[code] = at;
  }

  private update(at: number): void {
    while (at !== 1) {
      const weight = this.weight[at]!;
      let before = at - 1;
      if (this.weight[before] === weight) {
        while (before > 0 && this.weight[before] === weight) before--;
        before++;
        if (before > 1) {
          this.swap(at, before);
          at = before;
        }
      }
      this.weight[at] = weight + 1;
      at = this.parent[at]!;
    }
    this.weight[1] = this.weight[1]! + 1;
  }

  read(bits: Bits): number {
    let at = 1;
    while (this.code[at]! < 0)
      at = bits.read(1) ? this.right[at]! : this.left[at]!;
    const code = this.code[at]!;
    this.update(at);
    return code;
  }
}

function preload(history: Uint8Array): void {
  let at = 0;
  for (let k = 0; k < 32; k++)
    for (let j = 0; j < 96; j++) {
      history[at++] = k;
      history[at++] = j;
    }
  for (let j = 0; j < 256; j++)
    for (let repeat = 0; repeat < 4; repeat++) history[at++] = j;
}

function expandRuns(bytes: Uint8Array, limit: number): Uint8Array {
  if (!bytes.length)
    throw new FontFormatError("MTX run-length stream has no escape byte");
  const escape = bytes[0]!;
  // Count and validate before allocating: RLE can expand much more than the
  // 24-bit intermediate length. No speculative allocation or partial result.
  let length = 0;
  for (let at = 1; at < bytes.length; at++) {
    const value = bytes[at]!;
    let count = 1;
    if (value === escape) {
      requireBytes(bytes, ++at, 1, "MTX run-length count");
      count = bytes[at]!;
      if (count) requireBytes(bytes, ++at, 1, "MTX run-length value");
      else count = 1;
    }
    if (count > limit - length)
      throw new FontFormatError("MTX decoded data exceeds the output limit");
    length += count;
  }
  const output = new Uint8Array(length);
  let pos = 0;
  for (let at = 1; at < bytes.length; at++) {
    let value = bytes[at]!,
      count = 1;
    if (value === escape) {
      count = bytes[++at]!;
      if (count) value = bytes[++at]!;
      else count = 1;
    }
    output.fill(value, pos, pos + count);
    pos += count;
  }
  return output;
}

function decodeBlock(
  bytes: Uint8Array,
  copyLimit: number,
  limit: number,
): Uint8Array {
  const bits = new Bits(bytes),
    runLength = bits.read(1),
    length = bits.read(24);
  // Bound both the intermediate history/output and the expanded data. An
  // RLE stream may shrink (escape,0), so its length isn't the final length.
  // Each expanded byte can consume at most three intermediate bytes, plus
  // the initial escape byte. This bounds allocation even for a tiny budget.
  if (runLength ? length > limit * 3 + 1 : length > limit)
    throw new FontFormatError("MTX decoded data exceeds the output limit");
  let ranges = 1;
  while (8 ** ranges < length) ranges++;
  const dup2 = 256 + 8 * ranges,
    symbols = new Huffman(dup2 + 3),
    lengths = new Huffman(8),
    distances = new Huffman(8),
    effectiveLimit = Math.max(MIN_COPY_LIMIT, copyLimit),
    history = new Uint8Array(Math.min(effectiveLimit, PRELOAD_SIZE + length)),
    output = new Uint8Array(length);
  preload(history);
  let pos = 0;
  const save = (value: number) => {
    history[(PRELOAD_SIZE + pos) % history.length] = value;
    output[pos++] = value;
  };
  const previous = (distance: number): number => {
    if (distance > Math.min(effectiveLimit, PRELOAD_SIZE + pos))
      throw new FontFormatError("MTX copy exceeds available history");
    return history[(PRELOAD_SIZE + pos - distance) % history.length]!;
  };
  while (pos < length) {
    const symbol = symbols.read(bits);
    if (symbol < 256) save(symbol);
    else if (symbol >= dup2) save(previous(2 + (symbol - dup2) * 2));
    else {
      const distanceRanges = Math.floor((symbol - 256) / 8) + 1;
      let digit = (symbol - 256) & 7,
        size = 0;
      for (;;) {
        size = size * 4 + (digit & 3);
        if (size > length - pos - 2)
          throw new FontFormatError("MTX copy exceeds declared output length");
        // Appendix C EncodeLength/DecodeLength use SET for continuation.
        // The explanatory prose reverses that bit; match the actual codec.
        if (!(digit & 4)) break;
        digit = lengths.read(bits);
      }
      size += 2;
      let distance = 0;
      for (let i = 0; i < distanceRanges; i++)
        distance = distance * 8 + distances.read(bits);
      distance++;
      // The published encoder and decoder both use >= 512, not > 512.
      if (distance >= 512) size++;
      if (size > length - pos)
        throw new FontFormatError("MTX copy exceeds declared output length");
      // Distance points to the TAIL of the source, unlike ordinary LZ77.
      // The source is non-overlapping; holding the head distance constant
      // while advancing pos also handles history-ring wrap correctly.
      const headDistance = distance + size - 1;
      previous(headDistance);
      for (let i = 0; i < size; i++) save(previous(headDistance));
    }
  }
  bits.finish();
  return runLength ? expandRuns(output, limit) : output;
}

export interface MtxDecompressionOptions {
  /** Combined size of the three decoded streams. Default: 64 MiB. */
  readonly maxDecodedBytes?: number;
}

/** Decode MTX 1.0's three independent streams; CTF reconstruction is separate. */
export function decompressMtxStreams(
  bytes: Uint8Array,
  { maxDecodedBytes = DEFAULT_DECODED_LIMIT }: MtxDecompressionOptions = {},
): readonly [Uint8Array, Uint8Array, Uint8Array] {
  if (
    !Number.isSafeInteger(maxDecodedBytes) ||
    maxDecodedBytes < 0 ||
    maxDecodedBytes > 0x7fffffff
  )
    throw new FontFormatError("invalid MTX decoded output limit");
  requireBytes(bytes, 0, 10, "MTX header");
  if (bytes[0] !== 3) throw new FontFormatError("unsupported MTX version");
  const u24 = (at: number) =>
      bytes[at]! * 65536 + bytes[at + 1]! * 256 + bytes[at + 2]!,
    copyLimit = u24(1),
    second = u24(4),
    third = u24(7);
  if (second <= 10 || third <= second || third >= bytes.length)
    throw new FontFormatError("invalid MTX stream offsets");
  const first = decodeBlock(
      bytes.subarray(10, second),
      copyLimit,
      maxDecodedBytes,
    ),
    pushes = decodeBlock(
      bytes.subarray(second, third),
      copyLimit,
      maxDecodedBytes - first.length,
    ),
    instructions = decodeBlock(
      bytes.subarray(third),
      copyLimit,
      maxDecodedBytes - first.length - pushes.length,
    );
  return [first, pushes, instructions];
}
