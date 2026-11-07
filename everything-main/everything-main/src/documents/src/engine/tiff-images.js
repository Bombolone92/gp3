import { tiffDirectory } from '../lib/hwp/tiff.js';
import { tiffWorker } from '../lib/hwp/tiff-worker.js';

export const TIFF_MIME = 'image/tiff';
export function isTiff(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return false;
  const signature = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  return signature === 0x49492a00 || signature === 0x4d4d002a;
}

export function tiffInfo(bytes) {
  if (!isTiff(bytes) || bytes.length > 10 * 1024 * 1024) throw new Error('Invalid TIFF image or image larger than 10 MB.');
  const { ifd } = tiffDirectory(bytes);
  const width = ifd.t256[0], height = ifd.t257[0], orientation = ifd.t274?.[0] ?? 1;
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) throw new Error('Invalid TIFF orientation.');
  if (width > 8192 || height > 8192 || width * height > 16000000) throw new Error('Images must be at most 8,192 pixels per side and 16 megapixels.');
  // The DrawingML picture path uses encoded pixel order for all eight TIFF
  // orientation values. Keep this distinct from HWP's orientation-aware path.
  return { mime: TIFF_MIME, width, height };
}

export async function decodeTiffImage(bytes) {
  tiffInfo(bytes);
  const { pixels, width, height } = await tiffWorker(bytes);
  const target = new OffscreenCanvas(width, height);
  target.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height), 0, 0);
  return target.transferToImageBitmap();
}
