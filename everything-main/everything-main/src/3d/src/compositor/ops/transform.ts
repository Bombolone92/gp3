// Transform nodes. Translate / Rotate / Scale / Transform only change the image's domain
// transform and sampling (pixels are resampled when realized); Flip, Crop, Displace, Map UV,
// Corner Pin and Lens Distortion resample in their own pass.
import { registerExec, type NodeCtx } from '../eval/evaluator';
import { Result, xfMul, xfRotate, xfScale, xfTranslate, type Domain, type Sampling, IDENTITY, type Xform } from '../eval/result';
import { menuValue } from '../nodes/defs';
import { renderSize } from '../../render/final/units';

const INTERP: Record<string, number> = {
  Nearest: 0,
  Bilinear: 1,
  Bicubic: 2,
  Anisotropic: 3,
};
const EXTENSION: Record<string, number> = { Clip: 0, Extend: 1, Repeat: 2 };

function sampling(x: NodeCtx): Sampling {
  return {
    interp: INTERP[menuValue(x.node, 'Interpolation')] ?? 1,
    extX: EXTENSION[menuValue(x.node, 'Extension X')] ?? 0,
    extY: EXTENSION[menuValue(x.node, 'Extension Y')] ?? 0,
  };
}

/** Apply a transform to the Image input (no pixel work). */
function transformed(x: NodeCtx, make: (xf: Xform, d: Domain) => Xform) {
  const r = x.input('Image');
  if (!r.domain) return x.out('Image', r);
  const d: Domain = {
    w: r.domain.w,
    h: r.domain.h,
    xf: make(r.domain.xf, r.domain),
  };
  x.out('Image', r.withDomain(d, sampling(x)));
}

registerExec('CompositorNodeTranslate', (x) => {
  const tx = x.num('X'),
    ty = x.num('Y');
  transformed(x, (xf) => xfMul(xfTranslate(tx, ty), xf));
});

registerExec('CompositorNodeRotate', (x) => {
  const a = x.num('Angle');
  transformed(x, (xf) => xfMul(xf, xfRotate(a)));
});

registerExec('CompositorNodeTransform', (x) => {
  const tx = x.num('X'),
    ty = x.num('Y'),
    a = x.num('Angle'),
    s = x.num('Scale', 1);
  transformed(x, (xf) => xfMul(xfTranslate(tx, ty), xfMul(xf, xfMul(xfRotate(a), xfScale(s, s)))));
});

registerExec('CompositorNodeScale', (x) => {
  const type = menuValue(x.node, 'Type');
  const r = x.input('Image');
  if (!r.domain) return x.out('Image', r);
  const { w, h } = r.domain;
  let sx = 1,
    sy = 1;
  if (type === 'Relative') {
    sx = x.num('X', 1);
    sy = x.num('Y', 1);
  } else if (type === 'Absolute') {
    sx = x.num('X', w) / w;
    sy = x.num('Y', h) / h;
  } else if (type === 'Scene Size') {
    const pct = x.env.doc.scene.render.resolution_percentage / 100;
    sx = sy = pct;
  } else {
    const [W, H] = renderSize(x.env.doc.scene.render);
    const fx = W / w,
      fy = H / h;
    const frame = menuValue(x.node, 'Frame Type');
    if (frame === 'Fit') sx = sy = Math.min(fx, fy);
    else if (frame === 'Crop') sx = sy = Math.max(fx, fy);
    else {
      sx = fx;
      sy = fy;
    }
  }
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return x.out('Image', r);
  transformed(x, (xf) => xfMul(xf, xfScale(sx, sy)));
});

// ---------------------------------------------------------------------------

const FLIP = `
uniform sampler2D u_src;
uniform int u_fx;
uniform int u_fy;
layout(location = 0) out vec4 o0;
void main() {
  ivec2 s = textureSize(u_src, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (u_fx == 1) p.x = s.x - 1 - p.x;
  if (u_fy == 1) p.y = s.y - 1 - p.y;
  o0 = texelFetch(u_src, p, 0);
}`;

registerExec('CompositorNodeFlip', (x) => {
  const r = x.input('Image');
  const fx = x.bool('Flip X'),
    fy = x.bool('Flip Y');
  if (!r.domain || (!fx && !fy)) return x.out('Image', r);
  const t = x.alloc(r.domain);
  x.pass('flip', FLIP, t, {
    u_src: r.tex!,
    u_fx: fx ? 1 : 0,
    u_fy: fy ? 1 : 0,
  });
  x.out('Image', Result.image('RGBA', t, r.domain, r.sampling));
});

const CROP = `
uniform sampler2D u_src;
uniform ivec4 u_rect; // x, y, w, h in source pixels
uniform int u_alpha;
layout(location = 0) out vec4 o0;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (u_alpha == 1) {
    bool inside = p.x >= u_rect.x && p.y >= u_rect.y && p.x < u_rect.x + u_rect.z && p.y < u_rect.y + u_rect.w;
    o0 = inside ? texelFetch(u_src, p, 0) : vec4(0.0);
  } else o0 = texelFetch(u_src, p + u_rect.xy, 0);
}`;

registerExec('CompositorNodeCrop', (x) => {
  const r = x.input('Image');
  if (!r.domain) return x.out('Image', r);
  const { w, h } = r.domain;
  const cx = Math.max(0, Math.min(w, Math.round(x.num('X')))),
    cy = Math.max(0, Math.min(h, Math.round(x.num('Y'))));
  const cw = Math.max(0, Math.min(w - cx, Math.round(x.num('Width')))),
    ch = Math.max(0, Math.min(h - cy, Math.round(x.num('Height'))));
  const alpha = x.bool('Alpha Crop');
  if (!cw || !ch) return x.out('Image', Result.single('RGBA', [0, 0, 0, 0]));
  const d: Domain = alpha ? r.domain : { w: cw, h: ch, xf: r.domain.xf };
  const t = x.alloc(d);
  x.pass('crop', CROP, t, {
    u_src: r.tex!,
    u_rect: [cx, cy, cw, ch],
    u_alpha: alpha ? 1 : 0,
  });
  x.out('Image', Result.image('RGBA', t, d, r.sampling));
});

// Displace: sample the image at the pixel position offset by the displacement (pixels)
const DISPLACE = `
uniform sampler2D u_src;
uniform sampler2D u_disp;
uniform int u_interp;
uniform int u_extX;
uniform int u_extY;
layout(location = 0) out vec4 o0;
void main() {
  vec2 d = cmpPx(u_disp).xy;
  o0 = cmpSample(u_src, gl_FragCoord.xy - d, u_interp, u_extX, u_extY);
}`;

registerExec('CompositorNodeDisplace', (x) => {
  const r = x.input('Image');
  if (!r.domain) return x.out('Image', r);
  const s = sampling(x);
  const t = x.alloc(r.domain);
  x.pass('displace', DISPLACE, t, {
    u_src: x.realized('Image', r.domain),
    u_disp: x.ev.realize(x.input('Displacement'), r.domain),
    u_interp: s.interp,
    u_extX: s.extX,
    u_extY: s.extY,
  });
  x.out('Image', Result.image('RGBA', t, r.domain));
});

// Map UV: sample the image at normalized UV coordinates; z (alpha) masks the result
const MAPUV = `
uniform sampler2D u_src;
uniform sampler2D u_uv;
uniform int u_interp;
uniform int u_extX;
uniform int u_extY;
layout(location = 0) out vec4 o0;
void main() {
  vec3 uv = cmpPx(u_uv).xyz;
  vec4 c = cmpSample(u_src, uv.xy * vec2(textureSize(u_src, 0)), u_interp, u_extX, u_extY);
  o0 = c * clamp(uv.z, 0.0, 1.0);
}`;

registerExec('CompositorNodeMapUV', (x) => {
  const r = x.input('Image');
  const uv = x.input('UV');
  const d = uv.domain ?? r.domain;
  if (!d) return x.out('Image', r);
  const s = sampling(x);
  const t = x.alloc(d);
  x.pass('mapuv', MAPUV, t, {
    u_src: r.domain ? r.tex! : x.ev.tex(r),
    u_uv: x.ev.realize(uv, d),
    u_interp: s.interp,
    u_extX: s.extX,
    u_extY: s.extY,
  });
  x.out('Image', Result.image('RGBA', t, d));
});

// Corner Pin: projective warp of the image into the quad given by four normalized corners
const CORNER = `
uniform sampler2D u_src;
uniform mat3 u_inv; // output normalized position → source unit square (homogeneous)
uniform int u_interp;
uniform int u_extX;
uniform int u_extY;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  vec2 size = vec2(textureSize(u_src, 0));
  vec3 q = u_inv * vec3(gl_FragCoord.xy / size, 1.0);
  vec2 uv = q.xy / q.z;
  bool inside = q.z > 0.0 && all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
  o0 = inside ? cmpSample(u_src, uv * size, u_interp, u_extX, u_extY) : vec4(0.0);
  float m = inside ? 1.0 : 0.0;
  o1 = vec4(vec3(m), 1.0);
}`;

/** Homography (row-major 3×3) mapping the unit square corners to the quad p0..p3 (LL, LR, UR, UL). */
export function squareToQuad(p: [number, number][]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2,
    dy2 = y3 - y2,
    dy3 = y0 - y1 + y2 - y3;
  let g = 0,
    hh = 0;
  if (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12) {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    hh = (dx1 * dy3 - dx3 * dy1) / det;
  }
  return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh, 1];
}

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

registerExec('CompositorNodeCornerPin', (x) => {
  const r = x.input('Image');
  if (!r.domain) return x.out('Image', r);
  const quad: [number, number][] = [x.vec('Lower Left', 2), x.vec('Lower Right', 2), x.vec('Upper Right', 2), x.vec('Upper Left', 2)] as [number, number][];
  const inv = invert3(squareToQuad(quad));
  // row-major → column-major mat3
  const m = new Float32Array([inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]);
  const s = sampling(x);
  const img = x.alloc(r.domain),
    plane = x.alloc(r.domain);
  x.pass('cornerpin', CORNER, [img, plane], {
    u_src: r.tex!,
    u_inv: m,
    u_interp: s.interp,
    u_extX: s.extX,
    u_extY: s.extY,
  });
  x.out('Image', Result.image('RGBA', img, r.domain));
  x.out('Plane', Result.image('FLOAT', plane, r.domain));
});

// Lens Distortion: radial (barrel/pincushion with per-channel dispersion) or horizontal dispersion
const LENS = `
uniform sampler2D u_src;
uniform int u_type; // 0 radial, 1 horizontal
uniform float u_dist;
uniform float u_disp;
uniform int u_jitter;
uniform int u_fit;
layout(location = 0) out vec4 o0;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 size = vec2(textureSize(u_src, 0));
  vec2 p = gl_FragCoord.xy;
  vec2 c = size * 0.5;
  vec4 acc = vec4(0.0);
  if (u_type == 1) {
    // horizontal: red/blue shifted in opposite directions across the image width
    float s = u_disp * size.x * 0.25 * ((p.x - c.x) / c.x);
    float r = cmpBilinear(u_src, p + vec2(s, 0.0), 1, 1).r;
    vec4 g = cmpBilinear(u_src, p, 1, 1);
    float b = cmpBilinear(u_src, p - vec2(s, 0.0), 1, 1).b;
    o0 = vec4(r, g.g, b, g.a);
    return;
  }
  // per channel distortion: dispersion spreads red and blue around green
  vec3 k = clamp(vec3(u_dist + u_disp, u_dist, u_dist - u_disp), -0.999, 1.0);
  float kmax = max(k.x, max(k.y, k.z));
  float sc = (u_fit == 1 && kmax > 0.0) ? 1.0 / (1.0 + 2.0 * kmax) : 1.0 / (1.0 + kmax);
  vec2 uv = sc * (p - c) / c;
  float r2 = dot(uv, uv);
  float j = u_jitter == 1 ? hash(p) - 0.5 : 0.0;
  for (int i = 0; i < 3; i++) {
    float kk = k[i] + j * u_disp * 0.5;
    float t = 1.0 - 4.0 * kk * r2;
    if (t < 0.0) continue;
    float s = 2.0 / (1.0 + sqrt(t));
    vec4 smp = cmpBilinear(u_src, c + uv * s * c, 0, 0);
    acc[i] = smp[i];
    acc.a += smp.a / 3.0;
  }
  o0 = acc;
}`;

registerExec('CompositorNodeLensdist', (x) => {
  const r = x.input('Image');
  if (!r.domain) return x.out('Image', r);
  const type = menuValue(x.node, 'Type') === 'Horizontal' ? 1 : 0;
  const t = x.alloc(r.domain);
  x.pass('lens', LENS, t, {
    u_src: r.tex!,
    u_type: type,
    u_dist: Math.max(-0.999, Math.min(1, x.num('Distortion'))),
    u_disp: Math.max(0, Math.min(1, x.num('Dispersion'))),
    u_jitter: x.bool('Jitter') ? 1 : 0,
    u_fit: x.bool('Fit') ? 1 : 0,
  });
  x.out('Image', Result.image('RGBA', t, r.domain));
});

export const IDENT: Xform = [...IDENTITY] as Xform;
