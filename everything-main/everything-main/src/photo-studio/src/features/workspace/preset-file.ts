// Preset files: a small JSON envelope for exchanging presets of one kind
// between Photo Studio installations, plus list helpers used by the Preset
// Manager. Pure functions so they can be tested without the DOM.

export const presetFormat = 'photo-studio-presets';
export type PresetFile = { format: typeof presetFormat; version: 1; kind: string; items: unknown[] };

export function presetFile(kind: string, items: unknown[]): PresetFile {
  return { format: presetFormat, version: 1, kind, items };
}
/** Parse an exported file, keeping only valid items of the expected kind. */
export function parsePresetFile(text: string, kind: string, valid: (item: unknown) => boolean, limit = 1000): { items: unknown[]; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a preset file.');
  }
  const file = data as Partial<PresetFile>;
  if (!file || typeof file !== 'object' || file.format !== presetFormat || !Array.isArray(file.items)) throw new Error('This file is not a preset file.');
  if (file.version !== 1) throw new Error('This preset file was made by a newer version.');
  if (file.kind !== kind) throw new Error(`This file holds ${String(file.kind)} presets, not ${kind}.`);
  const items = file.items.filter(valid).slice(0, limit);
  return { items, skipped: file.items.length - items.length };
}
/** Move the item at `from` so it ends up at index `to` (returns a new list). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item);
  return out;
}
/** A name not already in `taken`, adding a number when needed. */
export function uniqueName(name: string, taken: Iterable<string>) {
  const set = new Set([...taken].map((n) => n.toLowerCase()));
  const base = name.trim() || 'Preset';
  if (!set.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!set.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}
