/** Plain XPRESS (MS-XCA §2.4.4), used by the embedded Spreadsheet Data Model.
 * https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-xca/34cb9ab9-5ce6-42d7-a518-107c1c7c65e7
 * All lengths are checked before allocation, reads and back-reference copies.
 */
const MAX_BLOCK_BYTES = 65536;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
function invalid(message) { throw new Error(`Invalid XPRESS data: ${message}`); }
function size(value, limit) {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) invalid('output size');
}

export function decompressXpress(input, outputSize) {
  if (!(input instanceof Uint8Array)) throw new TypeError('XPRESS input must be bytes');
  size(outputSize, MAX_BLOCK_BYTES);
  const output = new Uint8Array(outputSize);
  let pos = 0, written = 0, flags = 0, bits = 0, halfByte = -1;
  const read = count => {
    if (pos + count > input.length) invalid('truncated input');
    let value = 0;
    for (let i = 0; i < count; i++) value += input[pos++] * 2 ** (i * 8);
    return value;
  };
  for (;;) {
    if (!bits) { flags = read(4); bits = 32; }
    if (!(flags & (1 << --bits))) {
      if (written >= outputSize) invalid('literal exceeds output');
      output[written++] = read(1);
      continue;
    }
    // A match flag at the end of the input terminates the stream.
    if (pos === input.length) {
      if (written !== outputSize) invalid('output size mismatch');
      return output;
    }
    const token = read(2), distance = (token >>> 3) + 1;
    let length = token & 7;
    if (length === 7) {
      if (halfByte < 0) { halfByte = pos; length = read(1) & 15; }
      else { length = input[halfByte] >>> 4; halfByte = -1; }
      if (length === 15) {
        length = read(1);
        if (length === 255) {
          length = read(2);
          if (!length) length = read(4);
          if (length < 22) invalid('extended match length');
          length -= 22;
        }
        length += 15;
      }
      length += 7;
    }
    length += 3;
    if (distance > written) invalid('match precedes output');
    if (length > outputSize - written) invalid('match exceeds output');
    // Overlapping matches intentionally read bytes written by the same match.
    for (let i = 0; i < length; i++, written++) output[written] = output[written - distance];
  }
}

/** Data Model file payloads consist of independent blocks with little-endian
 * uint16 (original size, stored size) headers. Equal sizes indicate raw bytes.
 * Validate the complete framing and cumulative size before allocating output.
 */
export function decompressXpressChunks(input, outputSize, maxBytes = MAX_FILE_BYTES) {
  if (!(input instanceof Uint8Array)) throw new TypeError('XPRESS input must be bytes');
  size(maxBytes, MAX_FILE_BYTES);
  size(outputSize, maxBytes);
  let total = 0;
  for (let pos = 0; pos < input.length;) {
    if (input.length - pos < 4) invalid('truncated chunk header');
    const original = input[pos] | input[pos + 1] << 8, stored = input[pos + 2] | input[pos + 3] << 8;
    pos += 4;
    if (!original || !stored || stored > original || stored > input.length - pos) invalid('chunk size');
    total += original;
    if (total > outputSize) invalid('chunk output exceeds size');
    pos += stored;
  }
  if (total !== outputSize) invalid('chunk output size mismatch');
  const output = new Uint8Array(total);
  for (let pos = 0, dest = 0; pos < input.length;) {
    const original = input[pos] | input[pos + 1] << 8, stored = input[pos + 2] | input[pos + 3] << 8;
    pos += 4;
    const chunk = input.subarray(pos, pos + stored);
    output.set(stored === original ? chunk : decompressXpress(chunk, original), dest);
    pos += stored; dest += original;
  }
  return output;
}
