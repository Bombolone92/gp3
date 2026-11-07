import { FontFormatError, viewOf } from "./binary.ts";
import { MtxReader, checkMtxSize, mtxInteger } from "./mtx-reader.ts";

class Magnitudes {
  readonly input: MtxReader;
  private bit = 0;
  private byte = 0;
  constructor(input: MtxReader) {
    this.input = input;
  }
  private next(): number {
    if (!this.bit) this.byte = this.input.u8();
    const value = (this.byte >>> this.bit) & 1;
    this.bit = (this.bit + 1) & 7;
    return value;
  }
  read(): number {
    let magnitude = 0;
    while (this.next()) {
      if (++magnitude > 32768)
        throw new FontFormatError("MTX metric error exceeds int16");
    }
    const value = magnitude && this.next() ? -magnitude : magnitude;
    return mtxInteger(value, -32768, 32767, "metric error");
  }
}

export function reconstructMtxCvt(
  bytes: Uint8Array,
  limit: number,
): Uint8Array {
  const input = new MtxReader(bytes, "MTX cvt table"),
    count = input.u16();
  checkMtxSize(count * 2, limit);
  const result = new Uint8Array(count * 2),
    view = viewOf(result);
  let value = 0;
  for (let i = 0; i < count; i++) {
    const code = input.u8(),
      delta =
        code < 238
          ? code
          : code === 238
            ? input.s16()
            : code >= 248
              ? 238 * (code - 247) + input.u8()
              : -(238 * (code - 239) + input.u8());
    value = (value + delta) & 65535;
    view.setUint16(i * 2, value);
  }
  input.finish();
  return result;
}

export function reconstructMtxHdmx(
  bytes: Uint8Array,
  advances: Uint16Array,
  unitsPerEm: number,
  limit: number,
): Uint8Array {
  const input = new MtxReader(bytes, "MTX hdmx table"),
    version = input.u16();
  if (version === 65535) {
    checkMtxSize(bytes.length, limit);
    const result = Uint8Array.from(bytes);
    viewOf(result).setUint16(0, 0);
    return result;
  }
  if (version !== 0) throw new FontFormatError("unsupported MTX hdmx version");
  mtxInteger(unitsPerEm, 16, 16384, "units per em");
  const count = input.u16(),
    size = input.u32();
  if (size % 4 || size < advances.length + 2)
    throw new FontFormatError("invalid MTX hdmx record size");
  checkMtxSize(8 + count * size, limit);
  const recordHeaders = input.take(count * 2),
    bits = new Magnitudes(input),
    result = new Uint8Array(8 + count * size);
  result.set(bytes.subarray(0, 8));
  for (let record = 0; record < count; record++) {
    const at = 8 + record * size,
      ppem = recordHeaders[record * 2]!;
    result[at] = ppem;
    result[at + 1] = recordHeaders[record * 2 + 1]!;
    for (let glyph = 0; glyph < advances.length; glyph++) {
      // Keep both integer rounding steps from the published C encoder.
      const scaled = Math.trunc(
          (64 * ppem * advances[glyph]! + Math.trunc(unitsPerEm / 2)) /
            unitsPerEm,
        ),
        predicted = Math.trunc((scaled + 32) / 64),
        width = predicted + bits.read();
      result[at + 2 + glyph] = mtxInteger(
        width,
        0,
        255,
        "device advance width",
      );
    }
  }
  input.finish();
  return result;
}

export function reconstructMtxVdmx(
  bytes: Uint8Array,
  limit: number,
): Uint8Array {
  const input = new MtxReader(bytes, "MTX VDMX table"),
    version = input.u16();
  if (version >= 65534) {
    checkMtxSize(bytes.length, limit);
    const result = Uint8Array.from(bytes);
    viewOf(result).setUint16(0, 65535 - version);
    return result;
  }
  if (version > 1) throw new FontFormatError("unsupported MTX VDMX version");
  const count = input.u16(),
    ratios = input.u16();
  if (!count || !ratios)
    throw new FontFormatError("MTX VDMX has no groups/ratios");
  const ratioData = input.take(ratios * 4),
    offsets = new Uint16Array(ratios);
  for (let i = 0; i < ratios; i++) offsets[i] = input.u16();
  const headerSize = input.at,
    first = offsets[0]!;
  if (first < headerSize)
    throw new FontFormatError("MTX VDMX group overlaps its header");
  input.take(first - input.at);
  const groups: Uint8Array[] = [],
    compressedOffsets = new Map<number, number>(),
    logicalOffsets = new Map<number, number>();
  let total = headerSize,
    logical = first;
  for (let i = 0; i < count; i++) {
    compressedOffsets.set(input.at, i);
    logicalOffsets.set(logical, i);
    const records = input.u16(),
      maxMultiplier = input.s16(),
      minMultiplier = input.s16();
    if (!records) throw new FontFormatError("MTX VDMX group has no records");
    const length = 4 + records * 6;
    checkMtxSize(total + length, limit);
    const group = new Uint8Array(length),
      view = viewOf(group),
      bits = new Magnitudes(input);
    view.setUint16(0, records);
    let predictedPpem = 8,
      previous = -1;
    for (let j = 0; j < records; j++) {
      const ppem = (predictedPpem + bits.read()) & 65535,
        maxError = bits.read(),
        minError = bits.read(),
        ymax = Math.trunc((ppem * maxMultiplier + 1024) / 2048) + maxError,
        ymin = -Math.trunc((ppem * minMultiplier + 1024) / 2048) + minError;
      if (ppem <= previous)
        throw new FontFormatError("MTX VDMX sizes are not increasing");
      // Signed native fields retain the encoder's modulo-16-bit deltas.
      view.setUint16(4 + j * 6, ppem);
      view.setInt16(6 + j * 6, ymax);
      view.setInt16(8 + j * 6, ymin);
      if (!j) group[2] = ppem;
      group[3] = ppem;
      predictedPpem = ppem + 1;
      previous = ppem;
    }
    // Magnitude errors share bits within a group; each next group is byte aligned.
    groups.push(group);
    total += length;
    logical += length;
  }
  input.finish();
  // The published layout permits compressed offsets; its encoder sample
  // retains original TTF offsets while its reader walks groups sequentially.
  // Accept either complete, consistent mapping, preserving shared groups.
  // Reject conflicting interpretations instead of assigning ratios by index.
  const compressed = [...offsets].map((offset) =>
      compressedOffsets.get(offset),
    ),
    original = [...offsets].map((offset) => logicalOffsets.get(offset)),
    complete = (mapping: readonly (number | undefined)[]) =>
      mapping.every((index) => index !== undefined);
  if (!complete(compressed) && !complete(original))
    throw new FontFormatError("invalid MTX VDMX ratio offsets");
  if (
    complete(compressed) &&
    complete(original) &&
    compressed.some((index, i) => index !== original[i])
  )
    throw new FontFormatError("ambiguous MTX VDMX ratio offsets");
  const mapping = complete(compressed) ? compressed : original,
    result = new Uint8Array(total),
    view = viewOf(result),
    outputOffsets: number[] = [];
  result.set(bytes.subarray(0, 6));
  result.set(ratioData, 6);
  let at = headerSize;
  for (const group of groups) {
    outputOffsets.push(at);
    result.set(group, at);
    at += group.length;
  }
  for (let i = 0; i < ratios; i++)
    view.setUint16(
      6 + ratios * 4 + i * 2,
      mtxInteger(outputOffsets[mapping[i]!]!, 0, 65535, "VDMX group offset"),
    );
  return result;
}
