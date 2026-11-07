// Stack modes run here so large stacks never block the interface.
import { stackLayers } from '../../imaging/stack';
import type { StackMode } from '../../model/embedded';

export type StackJob = { id: number; layers: Uint8ClampedArray[]; pixels: number; mode: StackMode };
export type StackReply = { id: number; data?: Uint8ClampedArray; error?: string };

self.onmessage = (ev: MessageEvent<StackJob>) => {
  const { id, layers, pixels, mode } = ev.data;
  try {
    const data = stackLayers(layers, pixels, mode);
    (self as unknown as Worker).postMessage({ id, data } satisfies StackReply, [data.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: String(error) } satisfies StackReply);
  }
};
