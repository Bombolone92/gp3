// Format detection by signature, plus a registry describing every format the
// app can open or save and which component handles it.
import { asciiAt } from './bytes';

export type ImageFormat =
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'avif'
  | 'heic'
  | 'bmp'
  | 'tiff'
  | 'bigtiff'
  | 'ico'
  | 'cur'
  | 'tga'
  | 'psd'
  | 'psb'
  | 'pnm'
  | 'svg'
  | 'unknown';

export function sniffImageFormat(bytes: Uint8Array): ImageFormat {
  const b = bytes;
  const n = b.length;
  if (n >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (n >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (n >= 6 && (asciiAt(b, 0, 6) === 'GIF89a' || asciiAt(b, 0, 6) === 'GIF87a')) return 'gif';
  if (n >= 12 && asciiAt(b, 0, 4) === 'RIFF' && asciiAt(b, 8, 4) === 'WEBP') return 'webp';
  if (n >= 12 && asciiAt(b, 4, 4) === 'ftyp') {
    const boxSize = Math.min(n, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0 || n);
    const brands: string[] = [asciiAt(b, 8, 4)];
    for (let p = 16; p + 4 <= boxSize; p += 4) brands.push(asciiAt(b, p, 4));
    if (brands[0] === 'avif' || brands[0] === 'avis') return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brands[0])) return 'heic';
    // Generic image brands: look at the compatible list.
    if (brands.includes('avif') || brands.includes('avis')) return 'avif';
    if (brands.some((x) => ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(x))) return 'heic';
  }
  if (n >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0))) {
    const v = b[0] === 0x49 ? b[2] : b[3];
    if (v === 42) return 'tiff';
    if (v === 43) return 'bigtiff';
  }
  if (n >= 6 && asciiAt(b, 0, 4) === '8BPS') {
    const version = (b[4] << 8) | b[5];
    if (version === 1) return 'psd';
    if (version === 2) return 'psb';
  }
  if (n >= 18 && b[0] === 0x42 && b[1] === 0x4d) {
    const hs = b[14] | (b[15] << 8) | (b[16] << 16) | (b[17] << 24);
    if ([12, 16, 40, 52, 56, 64, 108, 124].includes(hs)) return 'bmp';
  }
  if (n >= 22 && b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0) {
    const count = b[4] | (b[5] << 8);
    // Validate the first directory entry: reserved byte 0 and a sane offset.
    const off = (b[18] | (b[19] << 8) | (b[20] << 16) | (b[21] << 24)) >>> 0;
    if (count > 0 && b[9] === 0 && off >= 6 + count * 16) return b[2] === 1 ? 'ico' : 'cur';
  }
  if (n >= 3 && b[0] === 0x50 && b[1] >= 0x31 && b[1] <= 0x37 && (b[2] === 0x0a || b[2] === 0x0d || b[2] === 0x20 || b[2] === 0x09)) return 'pnm';
  if (looksLikeSvg(b)) return 'svg';
  if (looksLikeTga(b)) return 'tga';
  return 'unknown';
}

function looksLikeSvg(b: Uint8Array): boolean {
  let head = asciiAt(b, 0, Math.min(b.length, 4096));
  if (head.startsWith('\xef\xbb\xbf')) head = head.slice(3);
  head = head.trimStart();
  if (!head.startsWith('<')) return false;
  return /<svg[\s>]/i.test(head) && (head.startsWith('<?xml') || head.startsWith('<!--') || head.startsWith('<!DOCTYPE') || head.startsWith('<svg'));
}

// TGA has no magic number: accept a TGA 2.0 footer, or a header whose fields
// are all plausible.
function looksLikeTga(b: Uint8Array): boolean {
  if (b.length >= 26 && asciiAt(b, b.length - 18, 16) === 'TRUEVISION-XFILE') return true;
  if (b.length < 19) return false;
  const cmapType = b[1];
  const type = b[2];
  const depth = b[16];
  const w = b[12] | (b[13] << 8);
  const h = b[14] | (b[15] << 8);
  const cmapDepth = b[7];
  if (cmapType > 1 || ![1, 2, 3, 9, 10, 11].includes(type) || !w || !h || b[17] & 0xc0) return false;
  if ((type & 7) === 1 ? cmapType !== 1 || ![15, 16, 24, 32].includes(cmapDepth) || ![8, 16].includes(depth) : ![8, 15, 16, 24, 32].includes(depth)) return false;
  if (cmapType === 0 && (b[3] | b[4] | b[5] | b[6] | b[7])) return false;
  // Uncompressed images must be at least as large as their pixel data.
  if (type < 9 && b.length < 18 + b[0] + w * h * Math.ceil(depth / 8)) return false;
  return true;
}

export type CodecInfo = {
  format: ImageFormat;
  name: string;
  extensions: string[];
  mimeTypes: string[];
  // Which component reads/writes it: 'browser' (createImageBitmap/canvas),
  // 'codecs' (this folder), 'psd' (the PSD module), or false.
  read: 'browser' | 'codecs' | 'psd' | false;
  write: 'browser' | 'codecs' | 'psd' | 'wasm' | false;
  // Whether the format can carry these on export.
  alpha: boolean;
  highBitDepth: boolean;
  layers: boolean;
  animation: boolean;
  icc: boolean;
  notes?: string;
};

export const codecs: CodecInfo[] = [
  { format: 'png', name: 'PNG', extensions: ['png', 'apng'], mimeTypes: ['image/png', 'image/apng'], read: 'browser', write: 'wasm', alpha: true, highBitDepth: true, layers: false, animation: false, icc: true, notes: 'ICC, DPI and text added with png-chunks.ts.' },
  { format: 'jpeg', name: 'JPEG', extensions: ['jpg', 'jpeg', 'jpe', 'jfif'], mimeTypes: ['image/jpeg'], read: 'browser', write: 'browser', alpha: false, highBitDepth: false, layers: false, animation: false, icc: true, notes: 'ICC and density added with jpeg-markers.ts; EXIF orientation read there.' },
  { format: 'gif', name: 'GIF', extensions: ['gif'], mimeTypes: ['image/gif'], read: 'codecs', write: 'codecs', alpha: true, highBitDepth: false, layers: false, animation: true, icc: false, notes: '1-bit transparency, 256 colors per frame.' },
  { format: 'webp', name: 'WebP', extensions: ['webp'], mimeTypes: ['image/webp'], read: 'browser', write: 'browser', alpha: true, highBitDepth: false, layers: false, animation: false, icc: false },
  { format: 'avif', name: 'AVIF', extensions: ['avif'], mimeTypes: ['image/avif'], read: 'browser', write: false, alpha: true, highBitDepth: true, layers: false, animation: false, icc: true, notes: 'Readable where the browser supports it.' },
  { format: 'heic', name: 'HEIC/HEIF', extensions: ['heic', 'heif'], mimeTypes: ['image/heic', 'image/heif'], read: 'browser', write: false, alpha: true, highBitDepth: true, layers: false, animation: false, icc: true, notes: 'Only Safari decodes HEIC natively.' },
  { format: 'bmp', name: 'BMP', extensions: ['bmp', 'dib'], mimeTypes: ['image/bmp', 'image/x-ms-bmp'], read: 'codecs', write: 'codecs', alpha: true, highBitDepth: false, layers: false, animation: false, icc: false },
  { format: 'tiff', name: 'TIFF', extensions: ['tif', 'tiff'], mimeTypes: ['image/tiff'], read: 'codecs', write: 'codecs', alpha: true, highBitDepth: true, layers: false, animation: false, icc: true, notes: 'Multi-page; layer data from other editors is not read.' },
  { format: 'bigtiff', name: 'BigTIFF', extensions: ['tif', 'tiff', 'btf', 'tf8'], mimeTypes: ['image/tiff'], read: 'codecs', write: false, alpha: true, highBitDepth: true, layers: false, animation: false, icc: true },
  { format: 'ico', name: 'Windows icon', extensions: ['ico'], mimeTypes: ['image/vnd.microsoft.icon', 'image/x-icon'], read: 'codecs', write: 'codecs', alpha: true, highBitDepth: false, layers: false, animation: false, icc: false },
  { format: 'cur', name: 'Windows cursor', extensions: ['cur'], mimeTypes: ['image/x-win-bitmap'], read: 'codecs', write: 'codecs', alpha: true, highBitDepth: false, layers: false, animation: false, icc: false },
  { format: 'tga', name: 'Targa', extensions: ['tga', 'icb', 'vda', 'vst'], mimeTypes: ['image/x-tga', 'image/x-targa'], read: 'codecs', write: 'codecs', alpha: true, highBitDepth: false, layers: false, animation: false, icc: false },
  { format: 'psd', name: 'PSD (layered)', extensions: ['psd'], mimeTypes: ['image/vnd.adobe.photoshop'], read: 'psd', write: 'psd', alpha: true, highBitDepth: true, layers: true, animation: false, icc: true },
  { format: 'psb', name: 'PSB (large layered)', extensions: ['psb'], mimeTypes: ['image/vnd.adobe.photoshop'], read: 'psd', write: 'psd', alpha: true, highBitDepth: true, layers: true, animation: false, icc: true },
  { format: 'pnm', name: 'Netpbm', extensions: ['pbm', 'pgm', 'ppm', 'pnm', 'pam'], mimeTypes: ['image/x-portable-anymap', 'image/x-portable-bitmap', 'image/x-portable-graymap', 'image/x-portable-pixmap'], read: 'codecs', write: 'codecs', alpha: true, highBitDepth: true, layers: false, animation: false, icc: false },
  { format: 'svg', name: 'SVG', extensions: ['svg', 'svgz'], mimeTypes: ['image/svg+xml'], read: 'browser', write: 'codecs', alpha: true, highBitDepth: false, layers: true, animation: false, icc: false, notes: 'Export writes one group per layer with embedded rasters.' },
];

export function codecForExtension(nameOrExt: string): CodecInfo | undefined {
  const ext = nameOrExt.toLowerCase().replace(/^.*\./, '');
  return codecs.find((c) => c.extensions.includes(ext));
}
export function codecForFormat(format: ImageFormat): CodecInfo | undefined {
  return codecs.find((c) => c.format === format);
}
export function codecForMime(mime: string): CodecInfo | undefined {
  const m = mime.toLowerCase().split(';')[0].trim();
  return codecs.find((c) => c.mimeTypes.includes(m));
}
