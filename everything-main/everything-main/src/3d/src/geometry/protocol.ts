import type { Primitive } from '../core/scene';
export interface GeometryRequest {
  id: number;
  kind: Primitive;
}
export type GeometryResponse =
  { id: number; vertices: ArrayBuffer } | { id: number; error: string };
export interface Mesh {
  vertices: Float32Array;
  count: number;
  uvs?: Float32Array;
}
