// GPU reductions (sum / min / max of a per-pixel vec4 expression over an image) used by the
// statistics nodes (Levels, Normalize, Tonemap). Each pass folds 4×4 texels.
import type { Texture } from '../gpu/gpu';
import type { Evaluator } from './evaluator';

export type ReduceMode = 'sum' | 'min' | 'max';

const INIT: Record<ReduceMode, string> = {
  sum: 'vec4(0.0)',
  min: 'vec4(3.4e38)',
  max: 'vec4(-3.4e38)',
};
const OP: Record<ReduceMode, string> = {
  sum: 'a + b',
  min: 'min(a, b)',
  max: 'max(a, b)',
};

const FOLD = (mode: ReduceMode) => `
uniform sampler2D u_src;
layout(location = 0) out vec4 o0;
vec4 op(vec4 a, vec4 b) { return ${OP[mode]}; }
void main() {
  ivec2 s = textureSize(u_src, 0);
  ivec2 base = ivec2(gl_FragCoord.xy) * 4;
  vec4 acc = ${INIT[mode]};
  for (int j = 0; j < 4; j++)
    for (int i = 0; i < 4; i++) {
      ivec2 p = base + ivec2(i, j);
      if (p.x < s.x && p.y < s.y) acc = op(acc, texelFetch(u_src, p, 0));
    }
  o0 = acc;
}`;

/**
 * Reduce `map` (GLSL body computing `vec4 v` from `vec4 c = texel`) over `src`.
 * The map must return the neutral element of `mode` for pixels to ignore.
 */
export function reduce(ev: Evaluator, src: Texture, map: string, mode: ReduceMode): number[] {
  let cur = ev.alloc(src.w, src.h, 'reduce');
  ev.pass(
    `reduce-map:${map}`,
    `
uniform sampler2D u_src;
layout(location = 0) out vec4 o0;
void main() {
  vec4 c = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0);
  vec4 v;
  ${map}
  o0 = v;
}`,
    cur,
    { u_src: src },
  );
  while (cur.w > 1 || cur.h > 1) {
    const next = ev.alloc(Math.ceil(cur.w / 4), Math.ceil(cur.h / 4), 'reduce');
    ev.pass(`reduce-${mode}`, FOLD(mode), next, { u_src: cur });
    ev.release(cur);
    cur = next;
  }
  const out = Array.from(ev.gpu.read(cur, 0, 0, 1, 1));
  ev.release(cur);
  return out;
}
