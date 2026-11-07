/// <reference lib="webworker" />
import { drawMask, drawWorldMask } from "../model/masks";
import { fillFloat } from "./fill";
import type { Layer } from "../model/document";
import type { Rect } from "../model/document";
import type { VectorMask, VectorMatrix } from "../model/vector";
import type { VectorStroke } from "../model/vector-stroke";
import type { StrokeRaster } from "./vector";
interface Wasm extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  alloc(n: number): number;
  free(p: number, n: number): void;
  histogram(p: number, n: number, o: number): void;
  flood_fill(
    p: number,
    w: number,
    h: number,
    x: number,
    y: number,
    t: number,
    o: number,
  ): void;
  encode_png(p: number, w: number, h: number, o: number): number;
}
const ready = WebAssembly.instantiateStreaming(
  fetch("/photo-engine.wasm"),
).then((r) => r.instance.exports as Wasm);
const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = async (
  event: MessageEvent<{
    id: number;
    operation: string;
    data: Uint8Array | Float32Array;
    width: number;
    height: number;
    x: number;
    y: number;
    tolerance: number;
    layer: Layer;
    bitmap?: ImageBitmap;
    vector: VectorMask;
    viewport?: Rect;
    matrix?: VectorMatrix;
    floating?: boolean;
    stroke?: VectorStroke;
  }>,
) => {
  const { id, operation, data, width, height, x, y, tolerance, layer } = event.data;
  try {
    if (operation === 'vector-mask') {
      // Load the geometry toolkit only for vector documents, outside the UI
      // thread. Ordinary raster, text and brush workflows retain their startup.
      const { rasterVectorMask } = await import("./vector");
      const result = await rasterVectorMask(
        event.data.vector,
        event.data.viewport!,
        event.data.matrix,
        event.data.floating,
        event.data.stroke,
      );
      const buffers = [result.coverage.buffer];
      if ("strokeCoverage" in result)
        buffers.push(
          (result as StrokeRaster).strokeCoverage.buffer,
          (result as StrokeRaster).overlapCoverage.buffer,
        );
      worker.postMessage({ id, result }, buffers);
      return;
    }
    if (operation === 'mask-basis') {
      const canvas = new OffscreenCanvas(width,height), c = canvas.getContext('2d')!;
      const plain = { ...layer, maskInverted: false };
      const render = (base: number) => {
        c.clearRect(0,0,width,height);
        if (event.data.viewport) drawWorldMask(c,plain,event.data.viewport,undefined,base);
        else drawMask(c,plain,width,height,undefined,base);
        return c.getImageData(0,0,width,height);
      };
      const black = render(0), white = render(1);
      for (let i = 0; i < black.data.length; i += 4) {
        black.data[i] = white.data[i+3]-black.data[i+3];
        black.data[i+1] = black.data[i+3]; black.data[i+2] = 0; black.data[i+3] = 255;
      }
      // Gain/bias are data channels. Upload bytes directly so browser bitmap
      // color/premultiplication rules cannot reinterpret them.
      const data = new Uint8Array(black.data.buffer);
      worker.postMessage({id,result:{width,height,data}},[data.buffer]);
      return;
    }
    if (operation === 'raster' || operation === 'mask') {
      const canvas = new OffscreenCanvas(width, height),
        c = canvas.getContext('2d');
      if (!c) throw new Error('Vector rasterization unavailable');
      if (operation === 'mask') {
        try {
          if (event.data.viewport) drawWorldMask(c,layer,event.data.viewport,event.data.bitmap);
          else drawMask(c, layer, width, height, event.data.bitmap);
        } finally {
          event.data.bitmap?.close();
        }
      } else if (layer.kind === 'text') {
        c.fillStyle = layer.color;
        c.font = `600 ${layer.fontSize}px sans-serif`;
        c.textBaseline = "top";
        layer.text
          .split("\n")
          .forEach((line, i) => c.fillText(line, 0, i * layer.fontSize * 1.2));
      } else {
        c.lineCap = "round";
        c.lineJoin = "round";
        for (const stroke of layer.strokes) {
          c.strokeStyle = stroke.color;
          c.fillStyle = stroke.color;
          c.lineWidth = stroke.size;
          c.beginPath();
          stroke.points.forEach((p, i) => {
            if (i === 0) c.moveTo(...p);
            else c.lineTo(...p);
          });
          if (stroke.points.length === 1) {
            c.arc(
              stroke.points[0][0],
              stroke.points[0][1],
              stroke.size / 2,
              0,
              Math.PI * 2,
            );
            c.fill();
          } else c.stroke();
        }
      }
      const raw = canvas.transferToImageBitmap();
      const bitmap = await createImageBitmap(raw, { premultiplyAlpha: "none" });
      raw.close();
      worker.postMessage({ id, result: bitmap }, [bitmap]);
      return;
    }
    const w = await ready;
    if (operation === "ready") {
      worker.postMessage({ id, result: true });
      return;
    }
    if (operation === "fill" && data instanceof Float32Array) {
      const result = fillFloat(data, width, height, x, y, tolerance);
      worker.postMessage({ id, result }, [result.buffer]);
      return;
    }
    if (!(data instanceof Uint8Array))
      throw new Error("This operation requires byte pixels.");
    const p = w.alloc(data.length);
    new Uint8Array(w.memory.buffer, p, data.length).set(data);
    try {
      let result: Uint8Array | Uint32Array;
      if (operation === "histogram") {
        const o = w.alloc(1024);
        try {
          w.histogram(p, data.length, o);
          result = new Uint32Array(w.memory.buffer, o, 256).slice();
        } finally {
          w.free(o, 1024);
        }
      } else if (operation === "fill") {
        const o = w.alloc(data.length);
        try {
          w.flood_fill(p, width, height, x, y, tolerance, o);
          result = new Uint8Array(w.memory.buffer, o, data.length).slice();
        } finally {
          w.free(o, data.length);
        }
      } else {
        const size = w.alloc(4);
        try {
          const o = w.encode_png(p, width, height, size),
            n = new DataView(w.memory.buffer).getUint32(size, true);
          result = new Uint8Array(w.memory.buffer, o, n).slice();
          w.free(o, n);
        } finally {
          w.free(size, 4);
        }
      }
      worker.postMessage({ id, result }, [result.buffer]);
    } finally {
      w.free(p, data.length);
    }
  } catch (error) {
    worker.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
