import { assertSize } from './document';

// Native project sources use interleaved, straight RGBA. PSD channel decoding
// supplies full-range unsigned 16-bit samples or IEEE-754 32-bit samples.
export type RasterPixels = {
  width: number;
  height: number;
  data: Uint16Array<ArrayBuffer> | Float32Array<ArrayBuffer>;
};
export const rasterMimeType = 'application/x-photo-editor-raster';
const headerSize = 16;
const signature = new Uint8Array([0x50, 0x48, 0x52, 0x41]); // PHRA
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function validateRaster(pixels: RasterPixels) {
  assertSize(pixels.width, pixels.height);
  if (
    !(pixels.data instanceof Uint16Array || pixels.data instanceof Float32Array) ||
    pixels.data.length !== pixels.width * pixels.height * 4
  )
    throw new Error('Invalid high-depth raster source.');
  if (pixels.data instanceof Float32Array) {
    for (let i = 0; i < pixels.data.length; i++) {
      const value = pixels.data[i];
      // HDR RGB is intentionally unbounded. Alpha remains coverage in [0,1].
      if (!Number.isFinite(value) || (i % 4 === 3 && (value < 0 || value > 1)))
        throw new Error('Invalid floating-point raster sample.');
    }
  }
}

// Version 1: PHRA, uint16 version/depth, uint32 width/height, then RGBA samples.
// All numbers are little-endian, independent of the host typed-array byte order.
export function encodeRaster(pixels: RasterPixels): ArrayBuffer {
  validateRaster(pixels);
  const depth = pixels.data instanceof Uint16Array ? 16 : 32;
  const buffer = new ArrayBuffer(headerSize + pixels.data.byteLength);
  const view = new DataView(buffer);
  new Uint8Array(buffer).set(signature);
  view.setUint16(4, 1, true);
  view.setUint16(6, depth, true);
  view.setUint32(8, pixels.width, true);
  view.setUint32(12, pixels.height, true);
  if (littleEndian) {
    new Uint8Array(buffer, headerSize).set(
      new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength),
    );
  } else {
    for (let i = 0; i < pixels.data.length; i++) {
      if (depth === 16) view.setUint16(headerSize + i * 2, pixels.data[i], true);
      else view.setFloat32(headerSize + i * 4, pixels.data[i], true);
    }
  }
  return buffer;
}

export function decodeRaster(buffer: ArrayBuffer): RasterPixels {
  const bytes = new Uint8Array(buffer);
  const { width, height, depth, byteLength } = rasterHeader(bytes);
  if (buffer.byteLength !== byteLength) throw new Error('Invalid high-depth raster length.');
  const count = width * height * 4;
  const data =
    depth === 16
      ? new Uint16Array(buffer, headerSize, count)
      : new Float32Array(buffer, headerSize, count);
  if (!littleEndian) {
    // Read into the host-endian view after taking a copy of the encoded bytes.
    const encoded = new DataView(buffer.slice(headerSize));
    for (let i = 0; i < count; i++)
      data[i] = depth === 16 ? encoded.getUint16(i * 2, true) : encoded.getFloat32(i * 4, true);
  }
  const pixels = { width, height, data };
  validateRaster(pixels);
  return pixels;
}

export function rasterHeader(bytes: Uint8Array) {
  if (bytes.length < headerSize || !signature.every((value, i) => bytes[i] === value))
    throw new Error('Invalid high-depth raster header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const depth = view.getUint16(6, true);
  if (view.getUint16(4, true) !== 1 || (depth !== 16 && depth !== 32))
    throw new Error('Unsupported high-depth raster format.');
  const width = view.getUint32(8, true),
    height = view.getUint32(12, true);
  assertSize(width, height);
  return { width, height, depth, byteLength: headerSize + width * height * 4 * (depth / 8) };
}

export function floatRaster(pixels: RasterPixels): Float32Array<ArrayBuffer> {
  if (pixels.data instanceof Float32Array) return pixels.data;
  const floats = new Float32Array(pixels.data.length);
  for (let i = 0; i < floats.length; i++) floats[i] = pixels.data[i] / 65535;
  return floats;
}
