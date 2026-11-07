import { assertSize } from "./document";

// A mask is one scalar channel, independent of image RGB and browser alpha.
export type CoverageSamples = {
  width: number;
  height: number;
  data:
    | Uint8Array<ArrayBuffer>
    | Uint16Array<ArrayBuffer>
    | Float32Array<ArrayBuffer>;
};
export const coverageMimeType = "application/x-photo-editor-coverage";
const signature = [0x50, 0x48, 0x4d, 0x53]; // PHMS
const headerSize = 16;
export function validateCoverage(samples: CoverageSamples) {
  assertSize(samples.width, samples.height);
  if (
    !(
      samples.data instanceof Uint8Array ||
      samples.data instanceof Uint16Array ||
      samples.data instanceof Float32Array
    ) ||
    samples.data.length !== samples.width * samples.height
  )
    throw new Error("Invalid mask coverage source.");
  if (samples.data instanceof Float32Array)
    for (const value of samples.data)
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new Error("Invalid floating-point mask coverage.");
}
export function coverageHeader(bytes: Uint8Array) {
  if (bytes.length < headerSize || !signature.every((v, i) => bytes[i] === v))
    throw new Error("Invalid mask coverage header.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    depth = v.getUint16(6, true);
  if (v.getUint16(4, true) !== 1 || ![8, 16, 32].includes(depth))
    throw new Error("Unsupported mask coverage format.");
  const width = v.getUint32(8, true),
    height = v.getUint32(12, true);
  assertSize(width, height);
  return {
    width,
    height,
    depth,
    byteLength: headerSize + (width * height * depth) / 8,
  };
}
export function encodeCoverage(samples: CoverageSamples): ArrayBuffer {
  validateCoverage(samples);
  const depth =
    samples.data instanceof Float32Array
      ? 32
      : samples.data instanceof Uint16Array
        ? 16
        : 8;
  const buffer = new ArrayBuffer(headerSize + samples.data.byteLength),
    v = new DataView(buffer);
  new Uint8Array(buffer).set(signature);
  v.setUint16(4, 1, true);
  v.setUint16(6, depth, true);
  v.setUint32(8, samples.width, true);
  v.setUint32(12, samples.height, true);
  for (let i = 0; i < samples.data.length; i++) {
    const at = headerSize + (i * depth) / 8;
    if (depth === 8) v.setUint8(at, samples.data[i]);
    else if (depth === 16) v.setUint16(at, samples.data[i], true);
    else v.setFloat32(at, samples.data[i], true);
  }
  return buffer;
}
export function decodeCoverage(buffer: ArrayBuffer): CoverageSamples {
  const { width, height, depth, byteLength } = coverageHeader(
    new Uint8Array(buffer),
  );
  if (buffer.byteLength !== byteLength)
    throw new Error("Invalid mask coverage length.");
  const v = new DataView(buffer),
    count = width * height;
  const data =
    depth === 8
      ? new Uint8Array(count)
      : depth === 16
        ? new Uint16Array(count)
        : new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const at = headerSize + (i * depth) / 8;
    data[i] =
      depth === 8
        ? v.getUint8(at)
        : depth === 16
          ? v.getUint16(at, true)
          : v.getFloat32(at, true);
  }
  const samples = { width, height, data };
  validateCoverage(samples);
  return samples;
}
export function floatCoverage(
  samples: CoverageSamples,
): Float32Array<ArrayBuffer> {
  if (samples.data instanceof Float32Array) return samples.data;
  const max = samples.data instanceof Uint16Array ? 65535 : 255;
  return Float32Array.from(samples.data, (v) => v / max);
}
