/** Strip optional marker fill and parameterless TEM markers that pdf-lib cannot skip.
 * Segment payloads and everything from the first scan onward remain byte-for-byte intact.
 */
export function normalizeJpegPadding(bytes) {
  if (bytes?.[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  let result,
    copied = 0,
    written = 0;
  for (let at = 2; at + 1 < bytes.length && bytes[at] === 0xff;) {
    const fillStart = at;
    while (bytes[at + 1] === 0xff) at++;
    const marker = bytes[at + 1];
    if (marker === undefined || marker === 0) break;
    const keepFrom = marker === 1 ? at + 2 : at;
    if (keepFrom > fillStart) {
      result ??= new Uint8Array(bytes.length);
      result.set(bytes.subarray(copied, fillStart), written);
      written += fillStart - copied;
      copied = keepFrom;
    }
    if (marker === 0xda || marker === 0xd9) break;
    // Standalone markers have no length field.
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    if (at + 4 > bytes.length) break;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2 || at + 2 + length > bytes.length) break;
    at += 2 + length;
  }
  if (!result) return bytes;
  result.set(bytes.subarray(copied), written);
  return result.subarray(0, written + bytes.length - copied);
}
