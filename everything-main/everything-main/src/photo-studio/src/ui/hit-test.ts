import { isVectorGradient } from "../model/vector-gradient";
import { drawMask, drawWorldMask, hasMask } from '../model/masks';
import { applyPixelMask, rawPixelMaskCoverage } from '../model/pixel-mask';
import { vectorContains } from './vector-hit';
import { isVectorPattern } from '../model/vector-pattern';
import { ownLock } from '../model/locks';
import type { Assets } from '../model/assets';
import { localPoint, type Layer, type PhotoDocument } from '../model/document';

// Sample one source pixel; no full document readback or per-layer pixel cache is needed.
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 1;
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
function sample(assets: Assets, id: string, u: number, v: number) {
  const raster = assets.raster(id);
  if (raster) {
    const x = Math.min(raster.width - 1, Math.floor(u * raster.width));
    const y = Math.min(raster.height - 1, Math.floor(v * raster.height));
    return (
      raster.data[(y * raster.width + x) * 4 + 3] / (raster.data instanceof Uint16Array ? 65535 : 1)
    );
  }
  const bitmap = assets.get(id);
  ctx.clearRect(0, 0, 1, 1);
  ctx.drawImage(
    bitmap,
    Math.min(bitmap.width - 1, Math.floor(u * bitmap.width)),
    Math.min(bitmap.height - 1, Math.floor(v * bitmap.height)),
    1,
    1,
    0,
    0,
    1,
    1,
  );
  const p = ctx.getImageData(0, 0, 1, 1).data;
  return p[3] / 255;
}
// Sources whose strokes preserve alpha can be sampled directly without a
// renderer. Generated paint/text coverage must come from the rendering engine.
function sourceAlpha(l: Layer, assets: Assets, u: number, v: number) {
  if (l.kind === "solid") return 1;
  if (
    l.strokes.some((stroke) => !stroke.preserveAlpha) ||
    l.kind === "text" ||
    l.filters.blur
  )
    throw new Error(
      "Picking generated or filtered sources requires rendered coverage.",
    );
  return l.asset ? sample(assets, l.asset, u, v) : 0;
}
export type CoverageReader = (
  layer: Layer,
  parents: Layer[],
  x: number,
  y: number,
) => number | Promise<number>;
function* candidates(
  layers: Layer[],
  x: number,
  y: number,
  parents: Layer[] = [],
  opacity = 1,
): Generator<{ layer: Layer; parents: Layer[] }> {
  for (const l of [...layers].reverse()) {
    if (!l.visible || ownLock(l, 'position') || l.opacity * opacity < 0.01) continue;
    if (l.kind === 'group')
      yield* candidates(l.children, x, y, [...parents, l], opacity * l.opacity);
    else if (l.kind === "vector") {
      // Stroke geometry is compiled in the worker; the coverage reader tests
      // its continuous path, including ink outside the fill's original bounds.
      if (l.vector!.stroke || vectorContains(l, x, y))
        yield { layer: l, parents };
    } else {
      const [u, v] = localPoint(
        l.transform,
        Math.floor(x) + 0.5,
        Math.floor(y) + 0.5,
      );
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) yield { layer: l, parents };
    }
  }
}
export function hitLayer(
  doc: PhotoDocument,
  assets: Assets,
  x: number,
  y: number,
): Layer | undefined;
export function hitLayer(
  doc: PhotoDocument,
  assets: Assets,
  x: number,
  y: number,
  read: CoverageReader,
): Layer | undefined | Promise<Layer | undefined>;
export function hitLayer(
  doc: PhotoDocument,
  assets: Assets,
  x: number,
  y: number,
  read?: CoverageReader,
): Layer | undefined | Promise<Layer | undefined> {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
  if (read) {
    const iterator = candidates(doc.layers, x, y);
    const scan = (): Layer | undefined | Promise<Layer | undefined> => {
      for (let candidate = iterator.next(); !candidate.done; candidate = iterator.next()) {
        const { layer, parents } = candidate.value;
        const alpha = read(layer, parents, x, y);
        if (typeof alpha !== 'number') return alpha.then((a) => (a >= 0.01 ? layer : scan()));
        if (alpha >= 0.01) return layer;
      }
    };
    return scan();
  }
  const visit = (layers: Layer[], opacity: number): Layer | undefined => {
    for (const l of [...layers].reverse()) {
      if (!l.visible || ownLock(l, 'position') || l.opacity * opacity < 0.01) continue;
      const [u, v] =
        l.kind === 'group' ? [x / doc.width, y / doc.height] : localPoint(l.transform, x, y);
      if (l.kind !== 'vector' && (u < 0 || u >= 1 || v < 0 || v >= 1)) continue;
      let maskAlpha = 1;
      if (hasMask(l) && !l.maskDisabled) {
        const w = l.kind === 'group' ? doc.width : l.sourceWidth;
        const h = l.kind === 'group' ? doc.height : l.sourceHeight;
        if (l.pixelMask) {
          const viewport={x:Math.floor(x),y:Math.floor(y),width:1,height:1};
          const raw=rawPixelMaskCoverage(l,l.pixelMask.asset ? assets.coverage(l.pixelMask.asset) : undefined,viewport.x+.5,viewport.y+.5);
          let value=raw;
          if (l.maskStrokes?.length) {
            const draw=(base:number) => {
              ctx.clearRect(0,0,1,1);
              drawWorldMask(ctx,{...l,maskInverted:false},viewport,undefined,base);
              return ctx.getImageData(0,0,1,1).data[3]/255;
            };
            const black=draw(0),white=draw(1);
            value=raw*(white-black)+black;
          }
          maskAlpha=applyPixelMask(l,value);
        } else {
        ctx.clearRect(0, 0, 1, 1);
        ctx.save();
        if (l.kind === 'vector')
          drawWorldMask(
            ctx,
            l,
            { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 },
            l.maskAsset ? assets.get(l.maskAsset) : undefined,
          );
        else {
          ctx.translate(-Math.floor(u * w), -Math.floor(v * h));
          drawMask(
            ctx,
            l.kind === 'group'
              ? {
                  ...l,
                  transform: { x: 0, y: 0, width: w, height: h, rotation: 0 },
                }
              : l,
            w,
            h,
            l.maskAsset ? assets.get(l.maskAsset) : undefined,
          );
        }
        ctx.restore();
        maskAlpha = ctx.getImageData(0, 0, 1, 1).data[3] / 255;
        }
      }
      const alpha = l.opacity * opacity * maskAlpha;
      if (alpha < 0.01) continue;
      if (l.kind === 'group') {
        const child = visit(l.children, alpha);
        if (child) return child;
      } else {
        if (l.kind === "vector" && l.vector!.stroke)
          throw new Error("Picking vector strokes requires rendered geometry.");
        if (isVectorGradient(l.vector?.fill)) throw new Error("Picking gradient fills requires rendered coverage.");
        if (isVectorPattern(l.vector?.fill))
          throw new Error("Picking pattern fills requires rendered coverage.");
        const coverage =
          l.kind === "vector"
            ? vectorContains(l, x, y)
              ? 1
              : 0
            : sourceAlpha(l, assets, u, v);
        if (coverage * alpha >= 0.01) return l;
      }
    }
  };
  return visit(doc.layers, 1);
}
