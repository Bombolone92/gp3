import { FontFormatError } from "./binary.ts";
import { MtxReader } from "./mtx-reader.ts";

/** Hop history is local to this glyph, although the encoded stream is shared. */
export function readMtxPushes(input: MtxReader, count: number): Int16Array {
  const values = new Int16Array(count);
  for (let at = 0; at < count;) {
    const code = input.u8();
    if (code === 251 || code === 252) {
      const size = code === 251 ? 3 : 5;
      if (at < 2 || size > count - at)
        throw new FontFormatError(
          "MTX hop exceeds this glyph's push history/count",
        );
      const repeat = values[at - 2]!;
      values[at++] = repeat;
      values[at++] = input.short();
      values[at++] = repeat;
      if (size === 5) {
        values[at++] = input.short();
        values[at++] = repeat;
      }
    } else values[at++] = input.short(code);
  }
  return values;
}

/** Minimum-byte equivalent initial PUSH burst, in linear time.
 * A word PUSH can include byte-sized values: splitting every mixed run can
 * exceed the 16-bit glyph program length even when a valid encoding fits.
 * Fixed PUSHes cover 1..8 values; NPUSHes cover 9..255. Sliding minima cover
 * the long alternatives, while the eight short alternatives are explicit.
 */
export function writeMtxPushes(values: Int16Array): Uint8Array {
  const n = values.length,
    costs = new Uint32Array(n + 1),
    previous = new Uint32Array(n + 1),
    words = new Uint8Array(n + 1),
    wordQueue = new Uint32Array(n + 1),
    byteQueue = new Uint32Array(n + 1);
  let wordHead = 0,
    wordTail = 0,
    byteHead = 0,
    byteTail = 0,
    lastWord = -1;
  for (let end = 1; end <= n; end++) {
    if (values[end - 1]! < 0 || values[end - 1]! > 255) lastWord = end - 1;
    const add = end - 9;
    if (add >= 0) {
      while (
        wordTail > wordHead &&
        costs[wordQueue[wordTail - 1]!]! - 2 * wordQueue[wordTail - 1]! >=
          costs[add]! - 2 * add
      )
        wordTail--;
      wordQueue[wordTail++] = add;
      while (
        byteTail > byteHead &&
        costs[byteQueue[byteTail - 1]!]! - byteQueue[byteTail - 1]! >=
          costs[add]! - add
      )
        byteTail--;
      byteQueue[byteTail++] = add;
    }
    while (wordHead < wordTail && wordQueue[wordHead]! < end - 255) wordHead++;
    while (
      byteHead < byteTail &&
      byteQueue[byteHead]! < Math.max(end - 255, lastWord + 1)
    )
      byteHead++;
    let best = Infinity,
      start = 0,
      word = 0;
    const consider = (from: number, width: number, overhead: number) => {
      const cost = costs[from]! + (end - from) * width + overhead;
      if (cost < best) {
        best = cost;
        start = from;
        word = width - 1;
      }
    };
    for (let count = 1; count <= Math.min(8, end); count++) {
      consider(end - count, 2, 1);
      if (end - count > lastWord) consider(end - count, 1, 1);
    }
    if (wordHead < wordTail) consider(wordQueue[wordHead]!, 2, 2);
    if (byteHead < byteTail) consider(byteQueue[byteHead]!, 1, 2);
    costs[end] = best;
    previous[end] = start;
    words[end] = word;
  }
  const bytes = new Uint8Array(costs[n]!),
    chunks: number[] = [];
  for (let at = n; at > 0; at = previous[at]!) chunks.push(at);
  let pos = 0;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const end = chunks[i]!,
      start = previous[end]!,
      count = end - start,
      word = words[end]!;
    if (count <= 8) bytes[pos++] = (word ? 0xb8 : 0xb0) + count - 1;
    else {
      bytes[pos++] = word ? 0x41 : 0x40;
      bytes[pos++] = count;
    }
    for (let at = start; at < end; at++) {
      const value = values[at]!;
      if (word) bytes[pos++] = value >>> 8;
      bytes[pos++] = value;
    }
  }
  return bytes;
}
