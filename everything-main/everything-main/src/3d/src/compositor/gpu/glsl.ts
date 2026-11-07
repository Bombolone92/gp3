// GLSL helpers shared by every compositor pass (prepended after the version/precision header).
//
// Pixel space: pixel (i, j) covers [i, i+1) × [j, j+1); its centre is (i + 0.5, j + 0.5).
// Extension modes: 0 clip (transparent outside), 1 extend (clamp to edge), 2 repeat.
// Interpolation: 0 nearest, 1 bilinear, 2 bicubic (cubic B-spline), 3 anisotropic (≈ bicubic).

export const EXT = { CLIP: 0, EXTEND: 1, REPEAT: 2 } as const;
export const INTERP = {
  NEAREST: 0,
  BILINEAR: 1,
  BICUBIC: 2,
  ANISOTROPIC: 3,
} as const;

export const GLSL_COMMON = /* glsl */ `
ivec2 cmpPX() { return ivec2(gl_FragCoord.xy); }

/** Texel at the current output pixel; 1×1 textures (single values) broadcast. */
vec4 cmpPx(sampler2D t) {
  ivec2 s = textureSize(t, 0);
  return texelFetch(t, min(ivec2(gl_FragCoord.xy), s - 1), 0);
}

int cmpWrap(int i, int n, int mode, out bool outside) {
  outside = false;
  if (i >= 0 && i < n) return i;
  if (mode == 1) return clamp(i, 0, n - 1);
  if (mode == 2) { int m = i % n; return m < 0 ? m + n : m; }
  outside = true;
  return clamp(i, 0, n - 1);
}

/** Texel with per-axis extension (clip returns transparent black). */
vec4 cmpFetch(sampler2D t, ivec2 p, int ex, int ey) {
  ivec2 s = textureSize(t, 0);
  bool ox, oy;
  int x = cmpWrap(p.x, s.x, ex, ox);
  int y = cmpWrap(p.y, s.y, ey, oy);
  if (ox || oy) return vec4(0.0);
  return texelFetch(t, ivec2(x, y), 0);
}

vec4 cmpNearest(sampler2D t, vec2 p, int ex, int ey) {
  return cmpFetch(t, ivec2(floor(p)), ex, ey);
}

vec4 cmpBilinear(sampler2D t, vec2 p, int ex, int ey) {
  vec2 q = p - 0.5;
  vec2 f = floor(q);
  vec2 w = q - f;
  ivec2 i = ivec2(f);
  vec4 a = cmpFetch(t, i, ex, ey);
  vec4 b = cmpFetch(t, i + ivec2(1, 0), ex, ey);
  vec4 c = cmpFetch(t, i + ivec2(0, 1), ex, ey);
  vec4 d = cmpFetch(t, i + ivec2(1, 1), ex, ey);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

vec4 cmpBsplineW(float x) {
  float x2 = x * x, x3 = x2 * x;
  return vec4((1.0 - x) * (1.0 - x) * (1.0 - x), 3.0 * x3 - 6.0 * x2 + 4.0, -3.0 * x3 + 3.0 * x2 + 3.0 * x + 1.0, x3) / 6.0;
}

vec4 cmpBicubic(sampler2D t, vec2 p, int ex, int ey) {
  vec2 q = p - 0.5;
  vec2 f = floor(q);
  vec2 w = q - f;
  ivec2 i = ivec2(f);
  vec4 wx = cmpBsplineW(w.x), wy = cmpBsplineW(w.y);
  vec4 r = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    vec4 row = vec4(0.0);
    for (int x = 0; x < 4; x++) row += wx[x] * cmpFetch(t, i + ivec2(x - 1, y - 1), ex, ey);
    r += wy[y] * row;
  }
  return r;
}

vec4 cmpSample(sampler2D t, vec2 p, int interp, int ex, int ey) {
  if (interp == 0) return cmpNearest(t, p, ex, ey);
  if (interp == 1) return cmpBilinear(t, p, ex, ey);
  return cmpBicubic(t, p, ex, ey);
}

/** Bilinear sample with normalized coordinates (0..1 over the texture), extend at the edges. */
vec4 cmpSampleUV(sampler2D t, vec2 uv) {
  return cmpBilinear(t, uv * vec2(textureSize(t, 0)), 1, 1);
}

float cmpLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;
