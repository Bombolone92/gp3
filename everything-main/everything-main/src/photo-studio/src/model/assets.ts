import {
  decodeRaster,
  encodeRaster,
  rasterHeader,
  rasterMimeType,
  type RasterPixels,
} from './raster';
import { decodePsdMetadata, psdMetadataMimeType } from './psd-metadata';
import type { PatternSpan } from './pattern-assets';
import { decodePsdImageResources, psdResourcesMimeType } from './psd-resources';
import { coverageHeader, coverageMimeType, decodeCoverage, encodeCoverage, type CoverageSamples } from './coverage';
import { psdOriginalMimeType, validateOriginalPsd } from './psd-original';
import { projectMimeType, sourceMimeType } from './embedded';

import { TileStore } from './tiles';
export class Assets {
  readonly tiles = new TileStore();
  private urls = new Map<string, string>();
  private blobs = new Map<string, Blob>();
  private bitmaps = new Map<string, ImageBitmap>();
  private rasters = new Map<string, RasterPixels>();
  private coverages = new Map<string, CoverageSamples>();
  private patternIndices = new Map<string, Promise<Map<string, PatternSpan>>>();
  // Keep only record offsets between requests. Native planes and the complete
  // metadata buffer are temporary, rather than another permanent pixel cache.
  async patternResource(asset: string, id: string, byteBudget = 512 * 1024 * 1024) {
    if (!Number.isFinite(byteBudget) || byteBudget <= 0)
      throw new Error('Invalid PSD pattern byte budget.');
    const blob = this.blob(asset);
    if (blob.type !== psdMetadataMimeType)
      throw new Error('Invalid pattern metadata asset.');
    let pending = this.patternIndices.get(asset);
    if (!pending) {
      pending = (async () => {
        // Pattern codecs stay out of the ordinary image editor's entry bundle.
        const { indexPatternAssets } = await import('./pattern-assets');
        return indexPatternAssets(new Uint8Array(await blob.arrayBuffer()));
      })();
      this.patternIndices.set(asset, pending);
    }
    const span = (await pending).get(id);
    if (this.blobs.get(asset) !== blob) throw new Error('Pattern metadata asset was cleared.');
    if (!span) throw new Error('Missing embedded pattern definition.');
    if (span.ambiguous) throw new Error('Ambiguous embedded pattern identifier.');
    if (span.end - span.start > Math.min(byteBudget, 512 * 1024 * 1024))
      throw new Error('PSD pattern record exceeds the byte budget.');
    const { indexPsdPatterns } = await import('./psd-patterns');
    const bytes = new Uint8Array(await blob.slice(span.start, span.end).arrayBuffer());
    if (this.blobs.get(asset) !== blob) throw new Error('Pattern metadata asset was cleared.');
    const [record] = indexPsdPatterns(bytes);
    return record;
  }
  async pattern(asset: string, id: string, byteBudget = 512 * 1024 * 1024) {
    const record = await this.patternResource(asset, id, byteBudget);
    const { decodePsdPattern } = await import('./psd-patterns');
    return decodePsdPattern(record, Math.min(byteBudget, 512 * 1024 * 1024) - record.raw.length);
  }
  async add(blob: Blob, id: string = crypto.randomUUID()): Promise<string> {
    if (this.blobs.has(id)) throw new Error('Duplicate image asset identifier.');
    if (blob.type === psdOriginalMimeType) {
      await validateOriginalPsd(blob);
      this.blobs.set(id, blob);
      return id;
    }
    if (blob.type === projectMimeType) {
      // Nested .photo project of an embedded object: opaque until edited.
      const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
      if (blob.size > 512 * 1024 * 1024 || new TextDecoder().decode(head) !== 'PHOTO001')
        throw new Error('Invalid embedded project.');
      this.blobs.set(id, blob);
      return id;
    }
    if (blob.type === sourceMimeType) {
      if (blob.size > 512 * 1024 * 1024) throw new Error('Embedded file exceeds 512 MB.');
      this.blobs.set(id, blob);
      return id;
    }
    if (blob.type === coverageMimeType) {
      const header = coverageHeader(new Uint8Array(await blob.slice(0,16).arrayBuffer()));
      if (blob.size !== header.byteLength) throw new Error('Invalid mask coverage length.');
      this.coverages.set(id, decodeCoverage(await blob.arrayBuffer()));
      this.blobs.set(id, blob);
      return id;
    }
    if (blob.type === psdResourcesMimeType) {
      if (blob.size > 512 * 1024 * 1024) throw new Error('PSD image resources exceed 512 MB.');
      decodePsdImageResources(new Uint8Array(await blob.arrayBuffer()));
      this.blobs.set(id, blob);
      return id;
    }
    if (blob.type === psdMetadataMimeType) {
      // Opaque PSD data is immutable binary, never an image or executable input.
      if (blob.size > 512 * 1024 * 1024) throw new Error('PSD metadata exceeds 512 MB.');
      decodePsdMetadata(new Uint8Array(await blob.arrayBuffer()));
      this.blobs.set(id, blob);
      return id;
    }
    if (blob.type === rasterMimeType) {
      // Reject invalid dimensions and lengths before allocating sample storage.
      const header = rasterHeader(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
      if (blob.size !== header.byteLength) throw new Error('Invalid high-depth raster length.');
      const raster = decodeRaster(await blob.arrayBuffer());
      this.rasters.set(id, raster);
      this.blobs.set(id, blob);
      return id;
    }
    const bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'default',
    });
    if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 24_000_000) {
      bitmap.close();
      throw new Error('This image exceeds the 24 megapixel or 8192 pixel limit.');
    }
    this.blobs.set(id, blob);
    this.bitmaps.set(id, bitmap);
    return id;
  }
  async addRaster(pixels: RasterPixels, id: string = crypto.randomUUID()) {
    // Encoding copies the caller's samples so subsequent edits to its buffer
    // cannot change an asset referenced by history or a saved project.
    if (this.blobs.has(id)) throw new Error('Duplicate image asset identifier.');
    const buffer = encodeRaster(pixels);
    const raster = decodeRaster(buffer);
    this.rasters.set(id, raster);
    this.blobs.set(id, new Blob([buffer], { type: rasterMimeType }));
    return id;
  }
  has(id: string) {
    return this.blobs.has(id);
  }
  raster(id: string) {
    return this.rasters.get(id);
  }
  /** Store an 8-bit raster created by an edit under a stable identifier
   * right away (as 16-bit samples, which every image path reads), then
   * re-encode it as `encoded` (an image file with identical pixels) once that
   * decodes, which is far smaller in memory and in saved projects. */
  addPixels(width: number, height: number, rgba: Uint8ClampedArray, encoded: () => Blob | Promise<Blob>, id: string = crypto.randomUUID()) {
    if (this.blobs.has(id)) throw new Error('Duplicate image asset identifier.');
    const data = new Uint16Array(rgba.length);
    for (let i = 0; i < rgba.length; i++) data[i] = rgba[i] * 257;
    const buffer = encodeRaster({ width, height, data });
    const raster = decodeRaster(buffer);
    this.rasters.set(id, raster);
    this.blobs.set(id, new Blob([buffer], { type: rasterMimeType }));
    const pending = this.compacting.then(async () => {
      if (this.rasters.get(id) !== raster) return;
      const blob = await encoded();
      if (this.rasters.get(id) !== raster) return;
      const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
      // Cleared or replaced meanwhile: keep what is there.
      if (this.rasters.get(id) !== raster || bitmap.width !== width || bitmap.height !== height) {
        bitmap.close();
        return;
      }
      this.rasters.delete(id);
      this.bitmaps.set(id, bitmap);
      this.blobs.set(id, blob);
      const url = this.urls.get(id);
      if (url) URL.revokeObjectURL(url);
      this.urls.delete(id);
    });
    this.compacting = pending.catch(() => {});
    return id;
  }
  // Re-encodes started by addPixels run one at a time.
  private compacting: Promise<void> = Promise.resolve();
  async addCoverage(samples: CoverageSamples, id: string = crypto.randomUUID()) {
    if (this.blobs.has(id)) throw new Error('Duplicate image asset identifier.');
    const buffer = encodeCoverage(samples);
    this.coverages.set(id, decodeCoverage(buffer));
    this.blobs.set(id, new Blob([buffer], { type: coverageMimeType }));
    return id;
  }
  coverage(id: string) {
    const samples = this.coverages.get(id);
    if (!samples) throw new Error('Missing mask coverage asset.');
    return samples;
  }
  dimensions(id: string) {
    const source = this.rasters.get(id) ?? this.get(id);
    return { width: source.width, height: source.height };
  }
  get(id: string) {
    const b = this.bitmaps.get(id);
    if (!b)
      throw new Error(
        this.rasters.has(id)
          ? 'High-depth assets require typed raster access.'
          : 'Missing image asset',
      );
    return b;
  }
  blob(id: string) {
    const b = this.blobs.get(id);
    if (!b) throw new Error('Missing image asset');
    return b;
  }
  url(id: string) {
    let url = this.urls.get(id);
    if (!url) {
      url = URL.createObjectURL(this.blob(id));
      this.urls.set(id, url);
    }
    return url;
  }
  clear() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    for (const b of this.bitmaps.values()) b.close();
    this.bitmaps.clear();
    this.blobs.clear();
    this.rasters.clear();
    this.coverages.clear();
    this.patternIndices.clear();
    this.tiles.clear();
  }
}
export const escapeXML = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
