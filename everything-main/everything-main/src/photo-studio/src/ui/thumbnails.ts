import type { Assets } from '../model/assets';
import { findLayer, type Layer, type PhotoDocument } from '../model/document';
import { decodeIccProfile } from '../model/psd-resources';
import {
  colorTransform,
  convertRgb,
  linearSrgbProfile,
  readRgbProfile,
  srgbProfile,
  type ColorTransform,
} from '../color/profile';

type ProfileState = { profile: string; depth: number; transform?: ColorTransform };
type Preview = ProfileState & { colorSpace: Layer['assetColorSpace']; url: string };
const caches = new WeakMap<
  Assets,
  { state?: ProfileState; previews: Map<string, Preview> }
>();

export function cachedSourceThumbnail(l: Layer, assets: Assets, doc?: PhotoDocument) {
  if (!l.asset) return undefined;
  const profile = doc?.iccUntaggedProfile ? '' : (doc?.iccProfile ?? '');
  const depth = doc?.bitsPerChannel ?? 8;
  const old = caches
    .get(assets)
    ?.previews.get(`${l.asset}:${l.assetColorSpace ?? 'document'}`);
  if (
    old &&
    old.profile === profile &&
    old.depth === depth &&
    old.colorSpace === l.assetColorSpace
  )
    return old.url;
  if (
    !assets.raster(l.asset) &&
    (l.assetColorSpace === 'srgb' || (!profile && depth !== 32))
  )
    return assets.url(l.asset);
  return undefined;
}

const pending = new WeakMap<HTMLElement, () => void>();
// Color conversion is source work, not part of synchronous DOM construction.
// Only visible previews are generated, at most one per frame. Replacing the
// document or rebuilding rows cancels stale jobs before they touch new assets.
export function hydrateSourceThumbnails(
  root: HTMLElement,
  doc: PhotoDocument,
  assets: Assets,
) {
  pending.get(root)?.();
  let frame = 0,
    cancelled = false;
  const queue: HTMLImageElement[] = [];
  const tick = () => {
    frame = 0;
    if (cancelled) return;
    const image = queue.shift();
    if (image?.isConnected) {
      const layer = findLayer(doc.layers, image.dataset.sourceThumbnail ?? '');
      if (layer) image.src = sourceThumbnail(layer, assets, doc);
      delete image.dataset.sourceThumbnail;
      observer.unobserve(image);
    }
    if (queue.length) frame = requestAnimationFrame(tick);
  };
  const observer = new IntersectionObserver(
    (entries) => {
      if (cancelled) return;
      for (const entry of entries)
        if (entry.isIntersecting) {
          const image = entry.target as HTMLImageElement;
          if (!queue.includes(image)) queue.push(image);
        }
      if (!frame && queue.length) frame = requestAnimationFrame(tick);
    },
    { root: root.querySelector('#layers') },
  );
  root
    .querySelectorAll<HTMLImageElement>('img[data-source-thumbnail]')
    .forEach((image) => observer.observe(image));
  pending.set(root, () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
  });
}

// Previews are bounded sRGB display images. Original source samples and profile
// bytes remain untouched, and the cache is scoped to the immutable asset store.
export function sourceThumbnail(l: Layer, assets: Assets, doc?: PhotoDocument): string {
  if (!l.asset) return '';
  const profile = doc?.iccUntaggedProfile ? '' : (doc?.iccProfile ?? '');
  const depth = doc?.bitsPerChannel ?? 8;
  let cache = caches.get(assets);
  if (!cache) caches.set(assets, (cache = { previews: new Map() }));
  let state = cache.state;
  if (!state || state.profile !== profile || state.depth !== depth) {
    state = { profile, depth };
    try {
      const source = profile
        ? readRgbProfile(decodeIccProfile(profile))
        : depth === 32
          ? linearSrgbProfile
          : undefined;
      if (source) state.transform = colorTransform(source, srgbProfile);
    } catch {
      // The renderer reports unsupported profiles; the thumbnail follows the
      // same explicit unmanaged-display policy while retaining the original.
    }
    cache.state = state;
  }
  const key = `${l.asset}:${l.assetColorSpace ?? 'document'}`;
  const old = cache.previews.get(key);
  if (
    old &&
    old.profile === profile &&
    old.depth === depth &&
    old.colorSpace === l.assetColorSpace
  )
    return old.url;
  const transform = l.assetColorSpace === 'srgb' ? undefined : state.transform;
  const raster = assets.raster(l.asset);
  if (!raster && !transform) {
    const url = assets.url(l.asset);
    cache.previews.set(key, { ...state, colorSpace: l.assetColorSpace, url });
    return url;
  }
  const dimensions = assets.dimensions(l.asset);
  const scale = Math.min(1, 64 / Math.max(dimensions.width, dimensions.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(dimensions.width * scale));
  canvas.height = Math.max(1, Math.round(dimensions.height * scale));
  const c = canvas.getContext('2d')!;
  let image: ImageData;
  if (raster) {
    image = c.createImageData(canvas.width, canvas.height);
    const divisor = raster.data instanceof Uint16Array ? 65535 : 1;
    const at = (x: number, y: number, component: number) =>
      raster.data[
        (Math.max(0, Math.min(raster.height - 1, y)) * raster.width +
          Math.max(0, Math.min(raster.width - 1, x))) *
          4 +
          component
      ] / divisor;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const px = ((x + 0.5) * raster.width) / canvas.width - 0.5;
        const py = ((y + 0.5) * raster.height) / canvas.height - 0.5;
        const ix = Math.floor(px),
          iy = Math.floor(py),
          fx = px - ix,
          fy = py - iy;
        const taps = [
          [ix, iy, (1 - fx) * (1 - fy)],
          [ix + 1, iy, fx * (1 - fy)],
          [ix, iy + 1, (1 - fx) * fy],
          [ix + 1, iy + 1, fx * fy],
        ];
        let alpha = 0;
        const rgb = [0, 0, 0];
        for (const [tx, ty, weight] of taps) {
          const coverage = at(tx, ty, 3) * weight;
          alpha += coverage;
          for (let k = 0; k < 3; k++) rgb[k] += at(tx, ty, k) * coverage;
        }
        for (let k = 0; k < 3; k++) rgb[k] = alpha > 0 ? rgb[k] / alpha : 0;
        const converted = transform ? convertRgb(transform, rgb) : rgb;
        image.data.set(
          [...converted.map((n) => n * 255), alpha * 255],
          (y * canvas.width + x) * 4,
        );
      }
  } else {
    c.drawImage(assets.get(l.asset), 0, 0, canvas.width, canvas.height);
    image = c.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < image.data.length; i += 4) {
      const rgb = convertRgb(transform!, [
        image.data[i] / 255,
        image.data[i + 1] / 255,
        image.data[i + 2] / 255,
      ]);
      for (let k = 0; k < 3; k++) image.data[i + k] = rgb[k] * 255;
    }
  }
  c.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  cache.previews.set(key, { ...state, colorSpace: l.assetColorSpace, url });
  return url;
}
