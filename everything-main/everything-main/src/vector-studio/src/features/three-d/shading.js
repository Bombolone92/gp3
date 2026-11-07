/**
 * Materials, lights and the shading model of the 3D effects.
 *
 * Colors are [r, g, b] in 0..1. Shading mixes ambient light, diffuse light
 * from one directional light, a highlight (Blinn-Phong) whose size follows
 * the material's roughness, and a reflection of a simple studio
 * surrounding (bright above the horizon, dark below) for metals.
 */
import { dot, normalize, add, scale } from './math.js';
import { hexToRgb, rgbToHex } from '../../lib/color.js';
import { sampleStops, isGradient } from '../../model/gradients.js';

/**
 * Material presets. `special` materials skip the lighting model: 'unlit'
 * keeps the object's colors, 'wire' draws the mesh edges.
 */
export const MATERIALS = [
  { id: 'satin', label: 'Satin', roughness: 0.4, specular: 0.45, metallic: 0, reflection: 0, opacity: 1 },
  { id: 'matte', label: 'Chalk', roughness: 0.95, specular: 0.04, metallic: 0, reflection: 0, opacity: 1 },
  { id: 'gloss', label: 'Lacquer', roughness: 0.12, specular: 0.85, metallic: 0, reflection: 0.08, opacity: 1 },
  { id: 'rubber', label: 'Rubber', roughness: 0.7, specular: 0.18, metallic: 0, reflection: 0, opacity: 1 },
  { id: 'brushed', label: 'Brushed Metal', roughness: 0.45, specular: 0.7, metallic: 1, reflection: 0.3, opacity: 1 },
  { id: 'chrome', label: 'Mirror Metal', roughness: 0.06, specular: 1, metallic: 1, reflection: 0.85, opacity: 1 },
  { id: 'glass', label: 'Tinted Glass', roughness: 0.08, specular: 0.9, metallic: 0, reflection: 0.15, opacity: 0.45 },
  { id: 'unlit', label: 'Flat Color', special: true, roughness: 1, specular: 0, metallic: 0, reflection: 0, opacity: 1 },
  { id: 'wire', label: 'Wire Frame', special: true, roughness: 1, specular: 0, metallic: 0, reflection: 0, opacity: 1 },
];

export const MATERIAL_KEYS = ['roughness', 'specular', 'metallic', 'reflection', 'opacity'];

export function materialPreset(id) {
  return MATERIALS.find((m) => m.id === id) || null;
}

/**
 * Light presets: direction [x, y, z] toward the light in view space
 * (x right, y down, z toward the viewer) plus intensity and ambient.
 */
export const LIGHTS = [
  { id: 'studio', label: 'Key Light', light: [-0.45, -0.6, 0.66], intensity: 0.85, ambient: 0.35 },
  { id: 'soft', label: 'Soft Front', light: [-0.1, -0.2, 0.97], intensity: 0.6, ambient: 0.55 },
  { id: 'overhead', label: 'Overhead', light: [0, -0.95, 0.3], intensity: 0.9, ambient: 0.3 },
  { id: 'side', label: 'Low Side', light: [0.9, -0.25, 0.35], intensity: 0.95, ambient: 0.25 },
  { id: 'dramatic', label: 'Spotlight', light: [-0.6, -0.75, 0.25], intensity: 1.1, ambient: 0.12 },
];

export function lightPreset(id) {
  return LIGHTS.find((l) => l.id === id) || null;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function rgbOf(hex) {
  const c = hexToRgb(hex || '#000000');
  return [c.r / 255, c.g / 255, c.b / 255];
}

export function hexOf(rgb) {
  return rgbToHex({ r: Math.round(clamp01(rgb[0]) * 255), g: Math.round(clamp01(rgb[1]) * 255), b: Math.round(clamp01(rgb[2]) * 255) });
}

/** The color a paint shows most (solid color, a gradient's middle), or null. */
export function paintColor(paint) {
  if (!paint) return null;
  if (paint.type === 'solid' && paint.color) return paint.color;
  if (isGradient(paint) && paint.stops?.length) return sampleStops(paint.stops, 0.5).color;
  if (typeof paint.color === 'string') return paint.color;
  return null;
}

/** An object's 3D base color: its fill, else its stroke, else a neutral gray. */
export function baseColorOf(style, override) {
  if (override && /^#[0-9a-f]{6}$/i.test(override)) return override;
  return paintColor(style?.fill) || paintColor(style?.stroke) || '#b4b4b4';
}

/** Brightness of the surroundings seen along direction r (y down: negative y looks up). */
export function environment(r) {
  const up = -r[1];
  const t = clamp01((up + 0.05) / 0.1);
  const sky = 0.62 + 0.38 * clamp01(up);
  const ground = 0.08 + 0.14 * clamp01(1 + up);
  // A soft bright band along the horizon gives metals their signature streak.
  const band = Math.exp(-((up - 0.12) ** 2) / 0.004) * 0.25;
  return ground + (sky - ground) * t + band;
}

/** Snap a 0..1 value to one of `steps` levels (0 and 1 included); steps < 2 leaves it alone. */
export const quantize = (v, steps) => (steps > 1 ? Math.round(v * (steps - 1)) / (steps - 1) : v);

/**
 * The lighting terms at a surface point, each 0..1: diffuse light (diff),
 * highlight (spec) and the brightness of the reflected surroundings (env).
 *   n      unit normal facing the viewer side being drawn
 *   view   unit vector from the point toward the viewer
 *   mat    { roughness, specular, metallic, reflection }
 *   light  { dir (unit, toward the light), color [r, g, b], intensity, ambient }
 */
export function lightTerms(n, view, mat, light) {
  const diff = Math.max(0, dot(n, light.dir));
  const h = normalize(add(light.dir, view));
  const rough = clamp01(mat.roughness ?? 0.5);
  const shininess = 2 + (1 - rough) ** 2 * 220;
  let spec = diff > 0 ? Math.pow(Math.max(0, dot(n, h)), shininess) * (mat.specular ?? 0) : 0;
  // Rougher surfaces spread the highlight but dim it.
  spec *= 0.35 + 0.65 * (1 - rough);
  const r = add(scale(n, 2 * dot(n, view)), scale(view, -1));
  return { diff, spec: clamp01(spec), env: clamp01(environment(r)) };
}

/** The color for lighting terms (see lightTerms). */
export function combine(base, t, mat, light) {
  const metal = clamp01(mat.metallic ?? 0);
  const refl = clamp01(mat.reflection ?? 0);
  const lc = light.color || [1, 1, 1];
  const amb = clamp01(light.ambient ?? 0.3);
  const kd = (1 - metal * 0.75) * (1 - refl * 0.6);
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const tint = metal * base[i] + (1 - metal);
    const diffuse = base[i] * (amb + light.intensity * t.diff * lc[i]) * kd;
    const metalBody = base[i] * metal * 0.25 * (amb + light.intensity * t.diff);
    const highlight = t.spec * light.intensity * lc[i] * tint;
    const mirror = refl * t.env * tint;
    out[i] = clamp01(diffuse + metalBody + highlight + mirror);
  }
  return out;
}

/**
 * Shaded color of a surface point (see lightTerms for the arguments).
 * `steps` quantizes the lighting to that many levels (banded shading); 0
 * keeps it smooth. Flat Color and Wire Frame keep the base color.
 */
export function shade(base, n, view, mat, light, steps = 0) {
  if (mat.id === 'unlit' || mat.id === 'wire') return base;
  const t = lightTerms(n, view, mat, light);
  return combine(base, { diff: quantize(t.diff, steps), spec: quantize(t.spec, steps), env: quantize(t.env, steps) }, mat, light);
}

/** Relative luminance-like brightness of a color (for gradient directions). */
export function brightness(c) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
