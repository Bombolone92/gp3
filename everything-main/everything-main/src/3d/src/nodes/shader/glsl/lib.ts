// GLSL function library registry: named chunks with dependencies, emitted in dependency order.
export interface GlslChunk {
  code: string;
  deps?: string[];
}
export type GlslLib = Record<string, GlslChunk>;

import { COMMON } from './common';
import { NOISE } from './noise';
import { VORONOI } from './voronoi';
import { TEXTURES } from './textures';

export const GLSL_LIB: GlslLib = {
  ...COMMON,
  ...NOISE,
  ...VORONOI,
  ...TEXTURES,
};

/** Concatenate the requested chunks and their dependencies (each once, dependencies first). */
export function collectLib(names: Iterable<string>, lib: GlslLib = GLSL_LIB): string {
  const out: string[] = [];
  const done = new Set<string>();
  const visit = (n: string, stack: string[]) => {
    if (done.has(n)) return;
    if (stack.includes(n)) throw new Error(`GLSL library cycle: ${[...stack, n].join(' → ')}`);
    const c = lib[n];
    if (!c) throw new Error(`Unknown GLSL chunk ${n}`);
    for (const d of c.deps ?? []) visit(d, [...stack, n]);
    done.add(n);
    out.push(c.code.trim());
  };
  for (const n of names) visit(n, []);
  return out.join('\n');
}
