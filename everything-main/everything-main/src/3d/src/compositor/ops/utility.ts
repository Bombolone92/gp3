// Utility nodes: Levels, Normalize, Split, Switch, Relative To Pixel, Tonemap.
import { registerExec } from '../eval/evaluator';
import { Result, IDENTITY, type Domain, type Xform } from '../eval/result';
import { reduce } from '../eval/reduce';
import { menuValue } from '../nodes/defs';
import { renderSize } from '../../render/final/units';

// ---------------------------------------------------------------------------
// Levels: statistics of a channel

const LEVEL_CHANNEL: Record<string, string> = {
  Combined: 'cmpLuma(c.rgb)',
  Red: 'c.r',
  Green: 'c.g',
  Blue: 'c.b',
  Luminance: 'cmpLuma(c.rgb)',
};

registerExec('CompositorNodeLevels', (x) => {
  const r = x.input('Image');
  const ch = LEVEL_CHANNEL[menuValue(x.node, 'Channel')] ?? LEVEL_CHANNEL.Combined;
  if (!r.domain) {
    const c = Array.isArray(r.value) ? r.value : [0, 0, 0, 1];
    const v = ch === 'c.r' ? c[0] : ch === 'c.g' ? c[1] : ch === 'c.b' ? c[2] : ch.startsWith('cmp') ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : (c[0] + c[1] + c[2]) / 3;
    x.out('Mean', Result.single('FLOAT', v));
    x.out('Standard Deviation', Result.single('FLOAT', 0));
    x.out('Minimum', Result.single('FLOAT', v));
    x.out('Maximum', Result.single('FLOAT', v));
    return;
  }
  const n = r.domain.w * r.domain.h;
  const sum = reduce(x.ev, r.tex!, `float l = ${ch}; v = vec4(l, l * l, 0.0, 0.0);`, 'sum');
  const mn = reduce(x.ev, r.tex!, `float l = ${ch}; v = vec4(l);`, 'min')[0];
  const mx = reduce(x.ev, r.tex!, `float l = ${ch}; v = vec4(l);`, 'max')[0];
  const mean = sum[0] / n;
  const variance = Math.max(0, sum[1] / n - mean * mean);
  x.out('Mean', Result.single('FLOAT', mean));
  x.out('Standard Deviation', Result.single('FLOAT', Math.sqrt(variance)));
  x.out('Minimum', Result.single('FLOAT', mn));
  x.out('Maximum', Result.single('FLOAT', mx));
});

// ---------------------------------------------------------------------------
// Normalize: map the value range of an image to [0, 1] (very large values, e.g. the background
// depth, are ignored)

const NORMALIZE = `
uniform sampler2D u_src;
uniform float u_min;
uniform float u_range;
layout(location = 0) out vec4 o0;
void main() {
  float v = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0).r;
  float r = v >= 10000.0 ? 1.0 : (v - u_min) / u_range;
  o0 = vec4(vec3(r), 1.0);
}`;

registerExec('CompositorNodeNormalize', (x) => {
  const r = x.input('Value');
  if (!r.domain) return x.out('Value', Result.single('FLOAT', 0));
  const mn = reduce(x.ev, r.tex!, 'v = vec4(c.r < 10000.0 ? c.r : 3.4e38);', 'min')[0];
  const mx = reduce(x.ev, r.tex!, 'v = vec4(c.r < 10000.0 ? c.r : -3.4e38);', 'max')[0];
  const range = mx - mn;
  const t = x.alloc(r.domain);
  x.pass('normalize', NORMALIZE, t, {
    u_src: r.tex!,
    u_min: mn > 1e37 ? 0 : mn,
    u_range: range > 1e-12 && range < 1e37 ? range : 1,
  });
  x.out('Value', Result.image('FLOAT', t, r.domain));
});

// ---------------------------------------------------------------------------
// Split: two images separated by a line through Position at Rotation

const SPLIT = `
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform vec2 u_pos;
uniform vec2 u_dir;
layout(location = 0) out vec4 o0;
void main() {
  vec2 size = vec2(textureSize(u_a, 0));
  vec2 p = floor(gl_FragCoord.xy) - u_pos * (size - 1.0);
  float side = u_dir.x * p.y - u_dir.y * p.x;
  o0 = side > 0.0 ? cmpPx(u_a) : cmpPx(u_b);
}`;

registerExec('CompositorNodeSplit', (x) => {
  const d = x.domain(['Image', 'Image_001']);
  if (!d) return x.out('Image', x.input('Image'));
  const [px, py] = x.vec('Position', 2);
  const a = x.num('Rotation');
  const t = x.alloc(d);
  x.pass('split', SPLIT, t, {
    u_a: x.realized('Image', d),
    u_b: x.realized('Image_001', d),
    u_pos: [px, py],
    u_dir: [Math.cos(a), Math.sin(a)],
  });
  x.out('Image', Result.image('RGBA', t, d));
});

// ---------------------------------------------------------------------------
// Switch (no blending: passes one input through)

registerExec('GeometryNodeSwitch', (x) => {
  const on = x.bool('Switch');
  x.out('Output', x.input(on ? 'True' : 'False'));
});

// ---------------------------------------------------------------------------
// Relative To Pixel

registerExec('CompositorNodeRelativeToPixel', (x) => {
  const img = x.input('Image');
  let w: number, h: number;
  if (img.domain) [w, h] = [img.domain.w, img.domain.h];
  else [w, h] = renderSize(x.env.doc.scene.render);
  const ref = String(x.prop('reference_dimension') ?? 'X');
  const dim = ref === 'Y' ? h : ref === 'Greater' ? Math.max(w, h) : ref === 'Smaller' ? Math.min(w, h) : ref === 'Diagonal' ? Math.hypot(w, h) : w;
  if (String(x.prop('data_type')) === 'VECTOR') {
    const [vx, vy] = x.vec('Vector Value', 2);
    const out = ref === 'PER_DIMENSION' ? [vx * w, vy * h, 0] : [vx * dim, vy * dim, 0];
    x.out('Vector Value', Result.single('VECTOR', out));
  } else x.out('Float Value', Result.single('FLOAT', x.num('Float Value') * (ref === 'PER_DIMENSION' ? w : dim)));
});

// ---------------------------------------------------------------------------
// Tonemap

const TONEMAP_RH = `
uniform sampler2D u_src;
uniform float u_al;
uniform float u_balance;
uniform float u_igamma;
layout(location = 0) out vec4 o0;
void main() {
  vec4 c = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0);
  vec3 s = max(c.rgb * u_al, vec3(0.0));
  s = s / (s + u_balance);
  s = mix(s, pow(max(s, vec3(0.0)), vec3(u_igamma)), step(vec3(0.0), s));
  o0 = vec4(s, c.a);
}`;

const TONEMAP_RD = `
uniform sampler2D u_src;
uniform float u_f;
uniform float u_m;
uniform float u_ia;
uniform float u_ic;
uniform float u_lav;
uniform vec3 u_cav;
layout(location = 0) out vec4 o0;
void main() {
  vec4 c = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0);
  float L = cmpLuma(c.rgb);
  vec3 Il = mix(vec3(L), c.rgb, u_ic);
  vec3 Ig = mix(vec3(u_lav), u_cav, u_ic);
  vec3 Ia = mix(Ig, Il, u_ia);
  vec3 r = c.rgb / max(c.rgb + pow(max(u_f * Ia, vec3(0.0)), vec3(u_m)), vec3(1e-12));
  o0 = vec4(r, c.a);
}`;

registerExec('CompositorNodeTonemap', (x) => {
  const r = x.input('Image');
  if (!r.domain) return x.out('Image', r);
  const n = r.domain.w * r.domain.h;
  const t = x.alloc(r.domain);
  if (menuValue(x.node, 'Type') === 'Rh Simple') {
    const s = reduce(x.ev, r.tex!, 'v = vec4(log(max(cmpLuma(c.rgb), 0.0) + 1e-5), 0.0, 0.0, 0.0);', 'sum');
    const lav = Math.exp(s[0] / n);
    const key = x.num('Key', 0.18);
    const al = lav > 0 ? key / lav : 1;
    const gamma = x.num('Gamma', 1);
    x.pass('tonemap-rh', TONEMAP_RH, t, {
      u_src: r.tex!,
      u_al: al,
      u_balance: Math.max(1e-6, x.num('Balance', 1)),
      u_igamma: gamma > 0 ? 1 / gamma : 1,
    });
  } else {
    const sum = reduce(x.ev, r.tex!, 'float L = max(cmpLuma(c.rgb), 0.0); v = vec4(c.rgb, L);', 'sum');
    const lg = reduce(x.ev, r.tex!, 'float L = max(cmpLuma(c.rgb), 0.0); v = vec4(log(L + 1e-5), 0.0, 0.0, 0.0);', 'sum');
    const lmax = reduce(x.ev, r.tex!, 'v = vec4(max(cmpLuma(c.rgb), 0.0));', 'max')[0];
    const lmin = reduce(x.ev, r.tex!, 'v = vec4(max(cmpLuma(c.rgb), 0.0));', 'min')[0];
    const cav = [sum[0] / n, sum[1] / n, sum[2] / n];
    const lav = sum[3] / n;
    const logAv = lg[0] / n;
    const contrast = x.num('Contrast');
    const lmx = Math.log(lmax + 1e-5),
      lmn = Math.log(lmin + 1e-5);
    const m = contrast > 0 ? contrast : 0.3 + 0.7 * Math.pow(lmx - lmn > 1e-9 ? (lmx - logAv) / (lmx - lmn) : 0.5, 1.4);
    x.pass('tonemap-rd', TONEMAP_RD, t, {
      u_src: r.tex!,
      u_f: Math.exp(-x.num('Intensity')),
      u_m: m,
      u_ia: Math.min(1, Math.max(0, x.num('Light Adaptation'))),
      u_ic: Math.min(1, Math.max(0, x.num('Chromatic Adaptation'))),
      u_lav: lav,
      u_cav: cav,
    });
  }
  x.out('Image', Result.image('RGBA', t, r.domain));
});

export const ID: Xform = [...IDENTITY] as Xform;
export type { Domain };
