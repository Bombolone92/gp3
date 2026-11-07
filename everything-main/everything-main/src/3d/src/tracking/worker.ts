// Tracking worker: runs the KLT tracker and the feature detector off the main thread.
import { buildPyramid, trackMarker, type GrayRegion, type TrackParams, type TrackResult } from './tracker';
import { detectFeatures, type DetectOptions, type Feature } from './detect';

export interface TrackItem {
  ref: GrayRegion;
  cur: GrayRegion;
  levels: number;
  params: TrackParams;
}

export type WorkerRequest = { id: number; type: 'track'; items: TrackItem[] } | { id: number; type: 'detect'; frame: { w: number; h: number; data: Uint8Array }; opts: DetectOptions };
export type WorkerResponse = { id: number; results?: TrackResult[]; features?: Feature[]; error?: string };

export function runTrackItems(items: TrackItem[]): TrackResult[] {
  return items.map((it) => trackMarker(buildPyramid(it.ref, it.levels), buildPyramid(it.cur, it.levels), it.params));
}

export function handle(req: WorkerRequest): WorkerResponse {
  try {
    if (req.type === 'track') return { id: req.id, results: runTrackItems(req.items) };
    return { id: req.id, features: detectFeatures(req.frame, req.opts) };
  } catch (e) {
    return { id: req.id, error: e instanceof Error ? e.message : String(e) };
  }
}

// worker entry (no-op when imported on the main thread)
const scope = globalThis as unknown as { document?: unknown; onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null; postMessage: (m: WorkerResponse) => void };
const WGS = (globalThis as { WorkerGlobalScope?: new () => unknown }).WorkerGlobalScope;
if (typeof scope.document === 'undefined' && WGS && globalThis instanceof WGS) {
  scope.onmessage = (e) => scope.postMessage(handle(e.data));
}
