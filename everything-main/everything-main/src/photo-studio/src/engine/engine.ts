import type { Layer } from "../model/document";
import type { Rect } from "../model/document";
import type { VectorStroke } from "../model/vector-stroke";
import type { StrokeRaster } from "./vector";
import type {
  VectorMask,
  VectorMatrix,
  VectorRaster,
  FloatVectorRaster,
} from '../model/vector';
export class ImageEngine {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  });
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  constructor() {
    this.worker.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result);
    };
    this.worker.onerror = () => {
      for (const p of this.pending.values())
        p.reject(
          new Error('Image processing worker failed. Reload to continue.'),
        );
      this.pending.clear();
    };
  }
  private run<T>(
    operation: string,
    args: Record<string, unknown> = {},
    transfer: Transferable[] = [],
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
      this.worker.postMessage({ id, operation, ...args }, transfer);
    });
  }
  ready() {
    return this.run<boolean>('ready');
  }
  raster(layer: Layer, width: number, height: number) {
    return this.run<ImageBitmap>('raster', { layer, width, height });
  }
  mask(
    layer: Layer,
    width: number,
    height: number,
    bitmap?: ImageBitmap,
    viewport?: Rect,
  ) {
    return this.run<ImageBitmap>('mask', {
      layer,
      width,
      height,
      bitmap,
      viewport,
    });
  }
  maskBasis(layer: Layer, width: number, height: number, viewport?: Rect) {
    return this.run<{width:number;height:number;data:Uint8Array}>('mask-basis', { layer, width, height, viewport });
  }
  vectorMask(mask: VectorMask, viewport: Rect, matrix?: VectorMatrix) {
    return this.run<VectorRaster>('vector-mask', {
      vector: mask,
      viewport,
      matrix,
    });
  }
  vectorCoverage(mask: VectorMask, viewport: Rect, matrix?: VectorMatrix) {
    return this.run<FloatVectorRaster>('vector-mask', {
      vector: mask,
      viewport,
      matrix,
      floating: true,
    });
  }
  vectorStroke(
    mask: VectorMask,
    viewport: Rect,
    matrix: VectorMatrix,
    stroke: VectorStroke,
  ) {
    return this.run<StrokeRaster>("vector-mask", {
      vector: mask,
      viewport,
      matrix,
      stroke,
      floating: true,
    });
  }
  histogram(data: Uint8Array) {
    return this.run<Uint32Array>('histogram', { data }, [
      data.buffer as ArrayBuffer,
    ]);
  }
  fill(
    data: Uint8Array | Float32Array,
    width: number,
    height: number,
    x: number,
    y: number,
    tolerance: number,
  ) {
    return this.run<Uint8Array>(
      'fill',
      { data, width, height, x, y, tolerance },
      [data.buffer as ArrayBuffer],
    );
  }
  async png(data: Uint8Array, width: number, height: number) {
    const result = await this.run<Uint8Array>('png', { data, width, height }, [
      data.buffer as ArrayBuffer,
    ]);
    return new Blob([result as Uint8Array<ArrayBuffer>], { type: 'image/png' });
  }
  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Editor closed'));
    this.pending.clear();
  }
}
