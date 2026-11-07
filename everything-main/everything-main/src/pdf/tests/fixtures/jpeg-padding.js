/** Add legal FF fill before selected header markers without touching segment payloads/scans. */
export function padJpegHeaders(bytes, count = 2, selected = () => true) {
  const chunks = [bytes.subarray(0, 2)];
  for (let at = 2; at < bytes.length;) {
    const marker = bytes[at + 1];
    if (selected(marker)) chunks.push(Buffer.alloc(count, 0xff));
    if (marker === 0xda || marker === 0xd9) {
      chunks.push(bytes.subarray(at));
      break;
    }
    const end = at + 2 + (bytes[at + 2] << 8) + bytes[at + 3];
    chunks.push(bytes.subarray(at, end));
    at = end;
  }
  return Buffer.concat(chunks);
}

export function jpegExif(bytes, orientation, little = true) {
  const exif = Buffer.from(
    little
      ? 'ffe1002245786966000049492a0008000000010012010300010000000600000000000000'
      : 'ffe100224578696600004d4d002a00000008000101120003000000010006000000000000',
    'hex',
  );
  if (little) exif.writeUInt16LE(orientation, 28);
  else exif.writeUInt16BE(orientation, 28);
  return Buffer.concat([bytes.subarray(0, 2), exif, bytes.subarray(2)]);
}

/** A parameterless TEM marker, optionally preceded by marker fill, before the first segment. */
export function jpegTem(bytes, fill = 0) {
  return Buffer.concat([
    bytes.subarray(0, 2),
    Buffer.alloc(fill, 0xff),
    Buffer.from([0xff, 0x01]),
    bytes.subarray(2),
  ]);
}
