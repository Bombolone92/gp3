/**
 * The 3D effect record: { type: 'threeD', kind, ...parameters } stored in
 * node.effects like every other effect (so the Appearance panel lists it,
 * graphic styles carry it and Apply Last Effect repeats it).
 *
 * Lengths are in points, angles in degrees, fractions as 0..1.
 */
import { MATERIALS, LIGHTS, materialPreset, lightPreset } from './shading.js';
import { BEVELS } from './mesh.js';

export const EFFECT_TYPE = 'threeD';

export const KINDS = [
  { id: 'rotate', label: 'Rotate', hint: 'Turn the flat artwork in space' },
  { id: 'extrude', label: 'Extrude', hint: 'Give the artwork depth' },
  { id: 'revolve', label: 'Revolve', hint: 'Spin the artwork around an axis' },
  { id: 'inflate', label: 'Inflate', hint: 'Puff the artwork up like a cushion' },
];

/** Orientation presets: X, Y, Z angles (see math.js for their meaning). */
export const VIEWS = [
  { id: 'front', label: 'Front', x: 0, y: 0, z: 0 },
  { id: 'back', label: 'Back', x: 0, y: 180, z: 0 },
  { id: 'left', label: 'Left Side', x: 0, y: 90, z: 0 },
  { id: 'right', label: 'Right Side', x: 0, y: -90, z: 0 },
  { id: 'top', label: 'Top Down', x: 90, y: 0, z: 0 },
  { id: 'bottom', label: 'Bottom Up', x: -90, y: 0, z: 0 },
  { id: 'tilt', label: 'Tilted Back', x: 32, y: 0, z: 0 },
  { id: 'quarterLeft', label: 'Quarter Turn Left', x: 18, y: 30, z: 0 },
  { id: 'quarterRight', label: 'Quarter Turn Right', x: 18, y: -30, z: 0 },
  { id: 'isoLeft', label: 'Isometric Left', x: 35.26, y: 45, z: 0 },
  { id: 'isoRight', label: 'Isometric Right', x: 35.26, y: -45, z: 0 },
  { id: 'cornerLow', label: 'Low Corner', x: -20, y: -40, z: 0 },
];

export const DETAIL = {
  low: { tolerance: 1.5, segments: 24, grid: 16 },
  medium: { tolerance: 0.6, segments: 48, grid: 28 },
  high: { tolerance: 0.25, segments: 96, grid: 44 },
};

export const SHADING = [
  { id: 'smooth', label: 'Smooth' },
  { id: 'faceted', label: 'Faceted' },
  { id: 'banded', label: 'Banded' },
];

const studio = lightPreset('studio');
const satin = materialPreset('satin');

export const DEFAULTS = Object.freeze({
  kind: 'extrude',
  depth: 50,
  twist: 0,
  taper: 1,
  cap: true,
  bevel: 'none',
  bevelWidth: 4,
  bevelHeight: 4,
  bevelOut: false,
  bevelBack: false,
  angle: 360,
  offset: 0,
  axis: 'left',
  volume: 0.5,
  bothSides: false,
  rotX: 18,
  rotY: -28,
  rotZ: 0,
  perspective: 0,
  detail: 'medium',
  material: 'satin',
  roughness: satin.roughness,
  specular: satin.specular,
  metallic: satin.metallic,
  reflection: satin.reflection,
  opacity: satin.opacity,
  color: '',
  light: 'studio',
  lightX: studio.light[0],
  lightY: studio.light[1],
  lightZ: studio.light[2],
  intensity: studio.intensity,
  ambient: studio.ambient,
  lightColor: '#ffffff',
  shading: 'smooth',
  steps: 8,
  shadow: false,
  shadowPlane: 'below',
  shadowDistance: 0,
  shadowOpacity: 0.35,
});

/** Starting parameters per kind (Rotate keeps the artwork's own colors, flat on). */
export const KIND_DEFAULTS = {
  rotate: { rotX: 0, rotY: -35, rotZ: 0, perspective: 40, material: 'unlit', depth: 0 },
  extrude: {},
  revolve: { rotX: 15, rotY: 0, rotZ: 0, cap: true },
  inflate: { rotX: 22, rotY: -24, rotZ: 0, depth: 0, volume: 0.6, material: 'gloss' },
};

export const RANGES = {
  depth: [0, 2000],
  twist: [-3600, 3600],
  taper: [0.01, 4],
  bevelWidth: [0, 500],
  bevelHeight: [0, 500],
  angle: [1, 360],
  offset: [0, 2000],
  volume: [0, 1],
  perspective: [0, 160],
  roughness: [0, 1],
  specular: [0, 1],
  metallic: [0, 1],
  reflection: [0, 1],
  opacity: [0.05, 1],
  lightX: [-1, 1],
  lightY: [-1, 1],
  lightZ: [-1, 1],
  intensity: [0, 2],
  ambient: [0, 1],
  steps: [2, 64],
  shadowDistance: [0, 1000],
  shadowOpacity: [0, 1],
};

export const ENUMS = {
  kind: KINDS.map((k) => k.id),
  bevel: ['none', ...BEVELS.map((b) => b.id)],
  axis: ['left', 'right'],
  detail: Object.keys(DETAIL),
  material: [...MATERIALS.map((m) => m.id), 'custom'],
  light: [...LIGHTS.map((l) => l.id), 'custom'],
  shading: SHADING.map((s) => s.id),
  shadowPlane: ['below', 'behind'],
};

const wrapAngle = (v) => {
  const w = ((((v + 180) % 360) + 360) % 360) - 180;
  return v === 180 ? 180 : w;
};

/** Final cleanup of a record (after the generic per-key normalizing). */
export function normalizeRecord(out) {
  for (const k of ['rotX', 'rotY', 'rotZ']) out[k] = Number.isFinite(out[k]) ? wrapAngle(out[k]) : 0;
  out.steps = Math.round(out.steps);
  out.color = /^#[0-9a-f]{6}$/i.test(String(out.color || '')) ? String(out.color).toLowerCase() : '';
  out.lightColor = /^#[0-9a-f]{6}$/i.test(String(out.lightColor || '')) ? String(out.lightColor).toLowerCase() : '#ffffff';
  // A light needs a direction.
  if (Math.hypot(out.lightX, out.lightY, out.lightZ) < 1e-3) out.lightZ = 1;
  return out;
}

/** Parameters for a new effect of a kind. */
export function newParams(kind, extra = {}) {
  const base = { ...DEFAULTS, ...(KIND_DEFAULTS[kind] || {}), kind };
  if (base.material !== DEFAULTS.material) Object.assign(base, materialParams(base.material));
  return { ...base, ...extra };
}

/** The shading parameters a material preset sets. */
export function materialParams(id) {
  const m = materialPreset(id);
  if (!m) return {};
  return { material: id, roughness: m.roughness, specular: m.specular, metallic: m.metallic, reflection: m.reflection, opacity: m.opacity };
}

/** The lighting parameters a light preset sets. */
export function lightParams(id) {
  const l = lightPreset(id);
  if (!l) return {};
  return { light: id, lightX: l.light[0], lightY: l.light[1], lightZ: l.light[2], intensity: l.intensity, ambient: l.ambient };
}

/** Label for the Appearance panel ("3D: Extrude"). */
export function describe(e) {
  return `3D: ${KINDS.find((k) => k.id === e.kind)?.label || 'Extrude'}`;
}

/** The visible 3D effect of a node: { fx, index } or null. */
export function threeDOf(node) {
  const list = node?.effects;
  if (!list) return null;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e && e.type === EFFECT_TYPE && !e.hidden) return { fx: e, index: i };
  }
  return null;
}

/** The 3D effect record of a node even when hidden: { fx, index } or null. */
export function threeDRecord(node) {
  const list = node?.effects;
  if (!list) return null;
  const i = list.findIndex((e) => e?.type === EFFECT_TYPE);
  return i < 0 ? null : { fx: list[i], index: i };
}
