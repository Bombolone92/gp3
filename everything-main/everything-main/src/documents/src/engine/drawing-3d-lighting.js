// Original Phong lighting for DrawingML's threePt/twoPt rigs and matte materials.
// Numerical presets: MS-OI29500 2.1.1274(c), 2.1.1334(b). Its light vectors
// describe incoming light. Apply the documented (-y,-x,z) scene transform,
// then negate to obtain vectors from a surface toward each light source.
const presets = { threePt: { ambient: 0, lights: [
  { color: 1.141, incoming: [-.6515, -.2693, -.7093] },
  { color: .5, incoming: [.8482, .2469, -.4686] },
  { color: 1, incoming: [.5634, -.2812, .7769] },
] }, twoPt: { ambient: .25, lights: [
  { color: .84, incoming: [.5266, -.4089, -.7454] },
  { color: .3, incoming: [-.8983, .2365, -.3704] },
] } };
for (const preset of Object.values(presets)) preset.lights = preset.lights.map(({ color, incoming: [x, y, z] }) => ({ color, direction: unit([y, x, -z]) }));

function unit(vector) {
  if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite) || Math.hypot(...vector) === 0) throw new Error('Invalid 3D lighting vector.');
  const length = Math.hypot(...vector);
  return vector.map(value => value / length);
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// normal and view (surface-to-viewer) are in the unrotated object's scene.
// The rig turns with that scene; turning the camera changes view, not the
// normal/light dot product. Colors use the picture's encoded RGB channels.
// Unimplemented rigs/materials remain explicit errors, never approximations.
export function create3dShader({ rig = 'threePt', material = 'warmMatte', direction = 't', revolution } = {}) {
  if (!Object.hasOwn(presets, rig) || !['warmMatte', 'matte'].includes(material) || !['t', 'tr', 'r', 'br', 'b', 'bl', 'l', 'tl'].includes(direction) || revolution === undefined && direction !== 't') throw new Error('Unsupported 3D lighting preset.');
  if (revolution !== undefined && (!Number.isFinite(revolution) || revolution < 0 || revolution >= 360)) throw new Error('Invalid 3D light revolution.');
  const preset = presets[rig], angle = (revolution ?? 0) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  // Explicit rotation overrides dir (MS-OI29500 2.1.1274(b)). Prepare the
  // rotated lights once for the picture, outside its per-pixel shading loop.
  const lights = angle ? preset.lights.map(({ color, direction: [x, y, z] }) => ({ color, direction: [cos * x - sin * y, sin * x + cos * y, z] })) : preset.lights;
  // MS-OI29500 2.1.1334(b): matte has a black specular component;
  // warmMatte has RGB .3. Both retain the shape's diffuse/ambient color.
  const specularColor = material === 'matte' ? 0 : .3;
  const shader = (color, normal, view) => shade(color, normal, view, lights, preset.ambient, specularColor);
  shader.gradient = (color, start, end, view) => {
    const a = illumination(start, view, lights, preset.ambient, specularColor);
    const b = illumination(end, view, lights, preset.ambient, specularColor);
    // Validate once and retain unclipped endpoint colors. Per-pixel painting
    // interpolates these coefficients without reevaluating lights or vectors.
    surfaceColor(color, a.diffuse, a.specular);
    const first = color.map(value => value * a.diffuse + 255 * a.specular);
    const delta = color.map((value, i) => value * b.diffuse + 255 * b.specular - first[i]);
    return { first, delta };
  };
  shader.interpolate = (color, samples) => {
    if (!Array.isArray(samples) || !samples.length || samples.some(s => !Number.isFinite(s.weight) || s.weight < 0 || s.weight > 1) || Math.abs(samples.reduce((n, s) => n + s.weight, 0) - 1) > 1e-8) throw new Error('Invalid 3D lighting interpolation.');
    let diffuse = 0, specular = 0;
    for (const { normal, view, weight } of samples) {
      const light = illumination(normal, view, lights, preset.ambient, specularColor);
      diffuse += weight * light.diffuse; specular += weight * light.specular;
    }
    return surfaceColor(color, diffuse, specular);
  };
  return shader;
}
const defaultShader = create3dShader();
export function shade3d(color, normal, view, options) {
  return (options ? create3dShader(options) : defaultShader)(color, normal, view);
}
function shade(color, normal, view, lights, ambient, specularColor) {
  const { diffuse, specular } = illumination(normal, view, lights, ambient, specularColor);
  return surfaceColor(color, diffuse, specular);
}
function illumination(normal, view, lights, ambient, specularColor) {
  const n = unit(normal), v = unit(view);
  let diffuse = ambient, specular = 0;
  for (const light of lights) {
    const incidence = dot(n, light.direction);
    diffuse += light.color * Math.max(0, incidence);
    const reflection = n.map((value, i) => 2 * incidence * value - light.direction[i]);
    // warmMatte: specular RGB .3, power 8, Phong (not Blinn), no Fresnel.
    // This lobe is evaluated even when the diffuse incidence is negative;
    // the independently captured left-extrusion side samples distinguish it.
    specular += specularColor * light.color * Math.max(0, dot(reflection, v)) ** 8;
  }
  return { diffuse, specular };
}
function surfaceColor(color, diffuse, specular) {
  if (!Array.isArray(color) || color.length !== 3 || !color.every(value => Number.isFinite(value) && value >= 0 && value <= 255)) throw new Error('Invalid 3D surface color.');
  // Clip only after interpolation and applying the texture, otherwise bright
  // bevel vertices lose energy before their contribution reaches the pixel.
  return color.map(value => Math.min(255, Math.max(0, Math.round(value * diffuse + 255 * specular))));
}
