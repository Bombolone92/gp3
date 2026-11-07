/**
 * Perspective grid presets: a few built-in starting points and the user's
 * own, saved in preferences. A preset holds Define Grid settings (see
 * gridFromSettings), not positions, so applying one keeps the grid where it
 * is on the page.
 */
import { DEFAULT_COLORS } from './grid-math.js';

const base = { cell: 30, units: 'pt', scale: 1, every: 30, opacity: 0.5, colors: { ...DEFAULT_COLORS } };

export const BUILTIN_PRESETS = Object.freeze([
  { name: 'One Point, Eye Level', builtin: true, settings: { ...base, type: 'one', distance: 480, horizonHeight: 250 } },
  { name: 'One Point, Deep Room', builtin: true, settings: { ...base, type: 'one', distance: 260, horizonHeight: 220 } },
  { name: 'Two Point, Eye Level', builtin: true, settings: { ...base, type: 'two', angle: 45, distance: 480, horizonHeight: 250 } },
  { name: 'Two Point, Low Horizon', builtin: true, settings: { ...base, type: 'two', angle: 40, distance: 520, horizonHeight: 90 } },
  { name: 'Two Point, Wide View', builtin: true, settings: { ...base, type: 'two', angle: 30, distance: 300, horizonHeight: 250 } },
  { name: "Three Point, Bird's Eye", builtin: true, settings: { ...base, type: 'three', angle: 45, distance: 480, horizonHeight: 420, third: { x: 0, y: 900 } } },
  { name: "Three Point, Worm's Eye", builtin: true, settings: { ...base, type: 'three', angle: 45, distance: 480, horizonHeight: 40, third: { x: 0, y: -1500 } } },
]);

const KEY = 'perspectivePresets';

/** The user's presets. */
export function userPresets(prefs) {
  const v = prefs?.get?.(KEY);
  return Array.isArray(v) ? v.filter((p) => p && typeof p.name === 'string' && p.settings) : [];
}

export function setUserPresets(prefs, list) {
  prefs?.set?.(KEY, list.map((p) => ({ name: p.name, settings: p.settings })));
}

/** Built-in and user presets. */
export function allPresets(prefs) {
  return [...BUILTIN_PRESETS, ...userPresets(prefs)];
}

/** The first preset of a grid type. */
export function defaultPresetOf(type) {
  return BUILTIN_PRESETS.find((p) => p.settings.type === type);
}

/** A preset name not used yet: "Base", "Base 2", ... */
export function uniqueName(prefs, base) {
  const used = new Set(allPresets(prefs).map((p) => p.name));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Add or replace a user preset (by name). Built-in names cannot be replaced. */
export function savePreset(prefs, name, settings) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Enter a name for the preset.');
  if (BUILTIN_PRESETS.some((p) => p.name === n)) throw new Error(`"${n}" is a built-in preset. Choose another name.`);
  const list = userPresets(prefs).filter((p) => p.name !== n);
  list.push({ name: n, settings: JSON.parse(JSON.stringify(settings)) });
  setUserPresets(prefs, list);
  return n;
}

export function deletePreset(prefs, name) {
  setUserPresets(
    prefs,
    userPresets(prefs).filter((p) => p.name !== name),
  );
}
