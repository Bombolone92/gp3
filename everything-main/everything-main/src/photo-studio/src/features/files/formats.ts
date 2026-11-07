// Export formats and what each can store (shared by menus and the encoder).
export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'tiff' | 'bmp' | 'tga' | 'ico' | 'svg';
export const formatInfo: Record<ExportFormat, { label: string; ext: string; mime: string; alpha: boolean; lossy: boolean; deep: boolean; icc: boolean; text: boolean }> = {
  png: { label: 'PNG', ext: 'png', mime: 'image/png', alpha: true, lossy: false, deep: true, icc: true, text: true },
  jpeg: { label: 'JPEG', ext: 'jpg', mime: 'image/jpeg', alpha: false, lossy: true, deep: false, icc: true, text: true },
  webp: { label: 'WebP', ext: 'webp', mime: 'image/webp', alpha: true, lossy: true, deep: false, icc: false, text: false },
  avif: { label: 'AVIF', ext: 'avif', mime: 'image/avif', alpha: true, lossy: true, deep: false, icc: false, text: false },
  gif: { label: 'GIF', ext: 'gif', mime: 'image/gif', alpha: true, lossy: false, deep: false, icc: false, text: false },
  tiff: { label: 'TIFF', ext: 'tif', mime: 'image/tiff', alpha: true, lossy: false, deep: true, icc: true, text: false },
  bmp: { label: 'BMP', ext: 'bmp', mime: 'image/bmp', alpha: true, lossy: false, deep: false, icc: false, text: false },
  tga: { label: 'TGA', ext: 'tga', mime: 'image/x-tga', alpha: true, lossy: false, deep: false, icc: false, text: false },
  ico: { label: 'ICO', ext: 'ico', mime: 'image/vnd.microsoft.icon', alpha: true, lossy: false, deep: false, icc: false, text: false },
  svg: { label: 'SVG', ext: 'svg', mime: 'image/svg+xml', alpha: true, lossy: false, deep: false, icc: false, text: false },
};
