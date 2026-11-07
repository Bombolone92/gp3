/// <reference lib="webworker" />
// Heavy multi-image jobs (alignment, warping, blending, HDR, sky layers,
// scanned-photo detection, trapping and channel math) run here. Buffers
// arrive and leave as transferables; cancelling terminates the worker.
import type { Mask8, Progress, RGBA8 } from '../../imaging/types';
import { alignImages, warpPlacement, type AlignOptions, type Placement } from '../../imaging/stitch/align';
import { blendPanorama, blendStack, type Placed } from '../../imaging/stitch/blend';
import { estimateExposures, mergeHdr, solveResponse } from '../../imaging/stitch/hdr';
import { toneMap, type HdrToningParams } from '../../imaging/adjust/hdr-toning';
import { SKY_PRESETS, adjustSky, placeSky, renderSky, skyMaskEdge, type SkyPlacement } from '../../imaging/sky/sky';
import { extractPhoto, findPhotos, type FoundPhoto } from '../../imaging/photos/split';
import { trap } from '../../imaging/print/trap';
import { applyImage, calculate, type ChannelOptions, type TargetChannel } from '../../imaging/channels/apply';
import type { IRect, RGBAF } from '../../imaging/types';

const scope = self as unknown as DedicatedWorkerGlobalScope;
type Args = Record<string, unknown>;

const jobs: Record<string, (a: Args, p: Progress) => unknown> = {
  align: (a, p) => alignImages(a.images as RGBA8[], { ...(a.opts as AlignOptions), progress: p }),
  warp: (a, p) => {
    const items = a.items as { image: RGBA8; placement: Placement; rect: IRect; offset?: { x: number; y: number } }[];
    return items.map((it, k) =>
      warpPlacement(it.image, it.placement, it.rect, 'bicubic', p && { cancelled: p.cancelled, report: (f) => p.report?.((k + f) / items.length) }, it.offset),
    );
  },
  'blend-panorama': (a, p) => blendPanorama(a.items as Placed[], a.canvas as IRect, { seamless: a.seamless as boolean, progress: p }),
  'blend-stack': (a, p) => blendStack(a.images as RGBA8[], { seamless: a.seamless as boolean, progress: p }),
  'hdr-exposures': (a) => estimateExposures(a.images as RGBA8[]),
  'hdr-merge': (a, p) => {
    const images = a.images as RGBA8[],
      ev = a.ev as number[];
    const response = solveResponse(images, ev);
    p.report?.(0.2);
    const hdr = mergeHdr(images, ev, response, { removeGhosts: a.removeGhosts as boolean, progress: p && { cancelled: p.cancelled, report: (f) => p.report?.(0.2 + 0.6 * f) } });
    const tone = a.tone as HdrToningParams | undefined;
    return tone ? { toned: toneMap(hdr, tone, (a.scale as number) ?? 1) } : { hdr };
  },
  'tone-map': (a, p) => toneMap(a.hdr as RGBAF, a.params as HdrToningParams, (a.scale as number) ?? 1, p),
  'sky-render': (a) => renderSky(SKY_PRESETS.find((s) => s.id === a.preset) ?? SKY_PRESETS[0], a.width as number, a.height as number, (a.seed as number) ?? 1),
  'sky-layer': (a) => {
    const placed = placeSky(a.sky as RGBA8, a.width as number, a.height as number, a.placement as SkyPlacement, a.horizon as number);
    return adjustSky(placed, a.brightness as number, a.temperature as number);
  },
  'sky-mask': (a) => skyMaskEdge(a.mask as Mask8, a.shift as number, a.fade as number),
  'find-photos': (a, p) => findPhotos(a.image as RGBA8, { progress: p }),
  'extract-photos': (a) => (a.photos as FoundPhoto[]).map((ph) => extractPhoto(a.image as RGBA8, ph)),
  trap: (a, p) => trap(a.image as RGBA8, a.width as number, p),
  'apply-image': (a) => applyImage(a.target as RGBA8, a.source as RGBA8 | Uint8Array, a.channel as TargetChannel, a.opts as ChannelOptions),
  calculate: (a) => calculate(a.a as Uint8Array, a.b as Uint8Array, a.opts as ChannelOptions & { invertB?: boolean }),
};

function transferables(v: unknown, out: Transferable[] = []): Transferable[] {
  if (!v || typeof v !== 'object') return out;
  if (ArrayBuffer.isView(v)) {
    if (!out.includes(v.buffer as ArrayBuffer)) out.push(v.buffer as ArrayBuffer);
    return out;
  }
  for (const x of Object.values(v)) transferables(x, out);
  return out;
}

scope.onmessage = (ev: MessageEvent<{ id: number; op: string; args: Args }>) => {
  const { id, op, args } = ev.data;
  let last = 0;
  const progress: Progress = {
    report: (f) => {
      const now = performance.now();
      if (now - last < 60 && f < 1) return;
      last = now;
      scope.postMessage({ id, progress: f });
    },
  };
  try {
    const job = jobs[op];
    if (!job) throw new Error(`Unknown job: ${op}`);
    const result = job(args, progress);
    scope.postMessage({ id, result }, transferables(result));
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
