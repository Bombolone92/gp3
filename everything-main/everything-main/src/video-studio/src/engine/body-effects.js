/**
 * GLSL bodies of the body effects (model/body-effects.js). All original.
 * They run like any effect (FX_HEAD + FX_LIB before them) and also get the
 * clip's person matte: fx-render.js binds it as u_person with the crop
 * rectangle and flips that map the effect buffer back to the source frame.
 * Distances are in fractions of the clip's height.
 */

const BODY_LIB = `
uniform sampler2D u_person;
uniform vec4 u_personRect;   // source uv rectangle shown in the buffer (crop)
uniform vec2 u_personFlip;   // 1 where the clip is mirrored
uniform vec2 u_personTexel;  // one matte pixel, in buffer uv
float personAt(vec2 uv) {
  vec2 q = vec2(u_personFlip.x > 0.5 ? 1.0 - uv.x : uv.x, u_personFlip.y > 0.5 ? 1.0 - uv.y : uv.y);
  q = u_personRect.xy + q * u_personRect.zw;
  if (!inside(q)) return 0.0;
  return smoothstep(0.3, 0.7, texture(u_person, q).a);
}
// Offset of length r (fraction of the height) in direction a, in uv.
vec2 hOff(float a, float r) { return vec2(cos(a) / aspect(), sin(a)) * r; }
// The person grown outward by r: most of the matte found within r.
float personGrow(vec2 uv, float r) {
  float m = personAt(uv);
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 0.39269908;
    m = max(m, personAt(uv + hOff(a, r)));
    m = max(m, personAt(uv + hOff(a + 0.19634954, r * 0.55)));
  }
  return m;
}
// Soft average of the matte over a disc of radius r (rotated per pixel so
// few taps leave grain rather than streaks).
float personSoft(vec2 uv, float r) {
  float s = 0.0;
  float j = hash12(uv * u_res) * TAU;
  for (int i = 0; i < 24; i++) {
    float a = float(i) * 2.39996323 + j;
    float d = sqrt((float(i) + 0.5) / 24.0);
    s += personAt(uv + hOff(a, r * d));
  }
  return s / 24.0;
}
// The matte with its edge moved onto the picture's own edges: nearby matte
// samples count more where the picture looks like this pixel.
float personEdgeIn(vec2 uv, float lo, float hi) {
  vec3 c0 = unpre(src(uv));
  float acc = 0.0;
  float wsum = 0.0;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
    vec2 o = vec2(float(i), float(j));
    vec2 q = uv + o * u_personTexel;
    vec3 d = unpre(src(q)) - c0;
    float w = exp(-dot(o, o) * 0.22 - dot(d, d) * 28.0);
    acc += personAt(q) * w;
    wsum += w;
  }
  return smoothstep(lo, hi, acc / max(wsum, 1e-5));
}
float personEdge(vec2 uv) { return personEdgeIn(uv, 0.35, 0.65); }
// Smooth glow of the person out to about r: soft discs of three sizes. A
// lower reach makes it brighter further out.
float personGlow(vec2 uv, float r, float reach) {
  float s = personSoft(uv, r * 0.3) + personSoft(uv, r * 0.6) + personSoft(uv, r);
  return smoothstep(0.0, reach, s / 3.0);
}
`;

const body = (src) => BODY_LIB + src;

export const BODY_EFFECT_SHADERS = {
  'body-outline': body(`uniform float u_size; uniform vec3 u_color;
  void main() {
    vec4 c = src(v_uv);
    float m = personEdge(v_uv);
    float ring = clamp(personGrow(v_uv, 0.003 + u_size * 0.03) - m, 0.0, 1.0);
    outColor = over(c, u_color, ring * u_strength);
  }`),
  'body-aura': body(`uniform float u_size; uniform vec3 u_color;
  void main() {
    vec4 c = src(v_uv);
    float m = personEdge(v_uv);
    float r = 0.02 + u_size * 0.14;
    float g = personGlow(v_uv, r, 0.3);
    float pulse = 0.75 + 0.25 * sin(u_time * (0.5 + u_speed * 6.0));
    float a = g * (1.0 - m) * u_strength * pulse;
    // Light added over the picture, and a colored halo where it is see-through.
    outColor = vec4(c.rgb + u_color * a * (1.0 - 0.4 * c.a), max(c.a, a));
  }`),
  'body-neon': body(`uniform float u_size; uniform float u_dim;
  void main() {
    vec4 c = src(v_uv);
    float r = 0.002 + u_size * 0.012;
    float edge = clamp(personGrow(v_uv, r) - personAt(v_uv) + (personAt(v_uv) - personSoft(v_uv, r)) * 2.0, 0.0, 1.0);
    float halo = clamp(personGrow(v_uv, r * 4.0) - personAt(v_uv), 0.0, 1.0) * 0.35;
    vec3 col = hue2rgb(fract(v_uv.y * 0.6 + u_time * u_speed * 0.4));
    vec3 base = c.rgb * (1.0 - u_dim * 0.85);
    float a = (edge + halo) * u_strength;
    outColor = vec4(base + col * a, max(c.a, a));
  }`),
  'body-bg-blur': body(`void main() {
    vec4 c = src(v_uv);
    float m = personEdge(v_uv);
    vec4 b = discBlur(v_uv, vec2(1.0 / aspect(), 1.0) * u_strength * 0.09);
    outColor = mix(b, c, m);
  }`),
  'body-color-spot': body(`void main() {
    vec4 c = src(v_uv);
    float m = personEdge(v_uv);
    vec4 g = vec4(vec3(luma(c.rgb)), c.a);
    outColor = mix(c, g, (1.0 - m) * u_strength);
  }`),
  'body-spotlight': body(`uniform float u_size;
  void main() {
    vec4 c = src(v_uv);
    float light = max(personGlow(v_uv, 0.05 + u_size * 0.35, 0.55), personEdge(v_uv));
    float k = 1.0 - u_strength * 0.9 * (1.0 - light);
    outColor = vec4(c.rgb * k, c.a);
  }`),
  'body-shadow': body(`uniform float u_angle; uniform float u_size; uniform float u_soft; uniform vec3 u_color;
  void main() {
    vec4 c = src(v_uv);
    // Direction the shadow falls on screen: 0 right, 90 down.
    float a = radians(-u_angle);
    vec2 off = hOff(a, u_size * 0.12);
    float sh = personSoft(v_uv - off, 0.004 + u_soft * 0.05);
    float m = personEdge(v_uv);
    float k = sh * (1.0 - m) * u_strength;
    // Darkens what is under it; shows as a shadow where the clip is see-through.
    outColor = vec4(mix(c.rgb, u_color * c.a, k), max(c.a, k));
  }`),
  'body-clones': body(`uniform float u_size;
  void main() {
    vec4 c = src(v_uv);
    vec4 outc = c;
    float sway = sin(u_time * (0.5 + u_speed * 4.0)) * u_speed * 0.15;
    for (int k = 3; k >= 1; k--) {
      float d = float(k) * (0.08 + u_size * 0.22) * (1.0 + sway);
      float fade = u_strength * (1.0 - float(k) * 0.24);
      for (int side = -1; side <= 1; side += 2) {
        vec2 q = v_uv + vec2(float(side) * d / aspect(), 0.0);
        float pm = personAt(q) * fade;
        outc = outc * (1.0 - pm) + src(q) * pm;
      }
    }
    outColor = mix(outc, c, personEdge(v_uv));
  }`),
  'body-silhouette': body(`uniform vec3 u_color;
  void main() {
    vec4 c = src(v_uv);
    // A solid fill reads best a little generous at the edge.
    float m = personEdgeIn(v_uv, 0.12, 0.4) * u_strength;
    outColor = mix(c, vec4(u_color, 1.0) * max(c.a, m), m);
  }`),
  'body-mosaic': body(`uniform float u_size;
  void main() {
    vec4 c = src(v_uv);
    float m = personGrow(v_uv, 0.01);
    float cells = mix(60.0, 8.0, u_size);
    vec2 n = vec2(cells * aspect(), cells);
    vec4 p = src((floor(v_uv * n) + 0.5) / n);
    outColor = mix(c, p, m * u_strength);
  }`),
};
