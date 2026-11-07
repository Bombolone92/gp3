// Variables and data sets for data-driven graphics.
//
// A layer can carry up to three variables: visibility (shown or hidden), text
// replacement (text layers) and pixel replacement (pixel layers and embedded
// objects, filled from an image file). A data set gives every variable a
// value; applying a set rewrites the layers it names. Definitions and sets are
// saved in .photo projects (`doc.variables`); the images named by pixel
// values are matched against a folder chosen when the sets are applied.

import { allLayers, type Layer, type PhotoDocument, type Rect } from './document';
import { parseDelimited } from './delimited';

export type PixelMethod = 'fit' | 'fill' | 'as-is' | 'conform';
export type PixelVariable = {
  name: string;
  method: PixelMethod;
  // Alignment inside the replacement bounds: 0 left/top, 0.5 center, 1 right/bottom.
  alignX: 0 | 0.5 | 1;
  alignY: 0 | 0.5 | 1;
  // Keep the image inside the bounds (pixel layers).
  clip: boolean;
  // Document rectangle the image is placed in: the layer's bounds when the
  // variable was defined.
  bounds: Rect;
};
export type LayerVariables = { visibility?: string; text?: string; pixel?: PixelVariable };
export type VariableValue = string | boolean;
export type DataSet = { name: string; values: Record<string, VariableValue> };
export type DocumentVariables = {
  layers: Record<string, LayerVariables>;
  sets: DataSet[];
  // Index of the data set shown last (Apply Data Set, Data Sets dialog).
  current?: number;
};
export type VariableKind = 'visibility' | 'text' | 'pixel';
export type VariableInfo = { name: string; kind: VariableKind; layerId: string };

// Names start with a letter or underscore and continue with letters, digits,
// underscores, periods and hyphens (they also serve as column headings).
export const validVariableName = (name: string) => /^[\p{L}_][\p{L}\p{N}_.-]{0,63}$/u.test(name);

/** Every defined variable, in layer order. */
export function variablesOf(doc: PhotoDocument): VariableInfo[] {
  const v = doc.variables;
  if (!v) return [];
  const out: VariableInfo[] = [];
  for (const l of allLayers(doc.layers)) {
    const lv = v.layers[l.id];
    if (!lv) continue;
    if (lv.visibility) out.push({ name: lv.visibility, kind: 'visibility', layerId: l.id });
    if (lv.text) out.push({ name: lv.text, kind: 'text', layerId: l.id });
    if (lv.pixel) out.push({ name: lv.pixel.name, kind: 'pixel', layerId: l.id });
  }
  return out;
}

/** What a layer kind can be bound to. */
export function variableKindsFor(l: Layer): VariableKind[] {
  const kinds: VariableKind[] = ['visibility'];
  if (l.kind === 'text') kinds.push('text');
  if (l.kind === 'pixel' || l.kind === 'image') kinds.push('pixel');
  return kinds;
}

/** The value a variable takes in a set, or the layer's current state. */
export function currentValue(doc: PhotoDocument, info: VariableInfo): VariableValue {
  const l = allLayers(doc.layers).find((x) => x.id === info.layerId);
  if (info.kind === 'visibility') return l?.visible ?? true;
  if (info.kind === 'text') return l?.text ?? '';
  return '';
}

/** A data set capturing the document's current values. */
export function captureDataSet(doc: PhotoDocument, name: string, previous?: DataSet): DataSet {
  const values: Record<string, VariableValue> = {};
  for (const info of variablesOf(doc)) values[info.name] = info.kind === 'pixel' ? (previous?.values[info.name] ?? '') : currentValue(doc, info);
  return { name, values };
}

export function nextSetName(sets: DataSet[]): string {
  const used = new Set(sets.map((s) => s.name));
  let i = sets.length + 1;
  while (used.has(`Data Set ${i}`)) i++;
  return `Data Set ${i}`;
}

// Visibility values accept the usual spellings of true and false.
export function parseVisibility(v: string): boolean | undefined {
  const s = v.trim().toLowerCase();
  if (['true', 'visible', 'yes', 'on', '1', 'show', 'shown'].includes(s)) return true;
  if (['false', 'invisible', 'hidden', 'no', 'off', '0', 'hide'].includes(s)) return false;
  return undefined;
}

/** Data sets from a table whose first row names the variables. */
export function dataSetsFromTable(rows: string[][], vars: VariableInfo[], startIndex = 0): { sets: DataSet[]; errors: string[] } {
  const errors: string[] = [];
  if (rows.length < 2) return { sets: [], errors: ['The file needs a header row naming the variables and at least one row of values.'] };
  const header = rows[0].map((h) => h.trim());
  const byName = new Map(vars.map((v) => [v.name, v]));
  const unknown = header.filter((h) => h && !byName.has(h));
  if (unknown.length) errors.push(`Not defined in this document: ${unknown.join(', ')}.`);
  const dup = header.filter((h, i) => h && header.indexOf(h) !== i);
  if (dup.length) errors.push(`Repeated columns: ${[...new Set(dup)].join(', ')}.`);
  if (errors.length) return { sets: [], errors };
  const sets: DataSet[] = [];
  rows.slice(1).forEach((row, r) => {
    const values: Record<string, VariableValue> = {};
    header.forEach((h, c) => {
      if (!h) return;
      const info = byName.get(h)!;
      const raw = row[c] ?? '';
      if (info.kind === 'visibility') {
        const b = parseVisibility(raw);
        if (b === undefined) errors.push(`Row ${r + 2}: "${raw}" is not a visibility value for ${h} (use true or false).`);
        values[h] = b ?? true;
      } else values[h] = raw;
    });
    sets.push({ name: `Data Set ${startIndex + sets.length + 1}`, values });
  });
  return { sets, errors };
}
export function dataSetsFromText(text: string, vars: VariableInfo[], startIndex = 0) {
  return dataSetsFromTable(parseDelimited(text), vars, startIndex);
}

/** Visibility and text values of a set, as plain layer changes. Pixel values
 * need decoding and are applied separately. */
export function setChanges(doc: PhotoDocument, set: DataSet): { visible: Map<string, boolean>; text: Map<string, string>; pixel: Map<string, { file: string; variable: PixelVariable }> } {
  const visible = new Map<string, boolean>(),
    text = new Map<string, string>(),
    pixel = new Map<string, { file: string; variable: PixelVariable }>();
  const lv = doc.variables?.layers ?? {};
  for (const info of variablesOf(doc)) {
    if (!(info.name in set.values)) continue;
    const v = set.values[info.name];
    if (info.kind === 'visibility') visible.set(info.layerId, typeof v === 'boolean' ? v : parseVisibility(String(v)) ?? true);
    else if (info.kind === 'text') text.set(info.layerId, String(v));
    else if (String(v).trim()) pixel.set(info.layerId, { file: String(v).trim(), variable: lv[info.layerId].pixel! });
  }
  return { visible, text, pixel };
}

/** File name for a set's output: its number, its name, or a variable's value. */
export function outputName(set: DataSet, index: number, naming: string, prefix = ''): string {
  let base: string;
  if (naming === 'number') base = String(index + 1).padStart(3, '0');
  else if (naming === 'name') base = set.name;
  else {
    const v = set.values[naming];
    base = v === undefined ? '' : typeof v === 'boolean' ? String(v) : v.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
    if (!base.trim()) base = String(index + 1).padStart(3, '0');
  }
  return `${prefix}${base}`.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 120) || `set-${index + 1}`;
}

/** Placement of an image of size w x h in the bounds by a fitting method. */
export function pixelPlacement(v: Pick<PixelVariable, 'method' | 'alignX' | 'alignY' | 'bounds'>, w: number, h: number): Rect {
  const b = v.bounds;
  let width = w,
    height = h;
  if (v.method === 'conform') return { ...b };
  if (v.method === 'fit' || v.method === 'fill') {
    const s = v.method === 'fit' ? Math.min(b.width / w, b.height / h) : Math.max(b.width / w, b.height / h);
    width = w * s;
    height = h * s;
  }
  return { x: b.x + (b.width - width) * v.alignX, y: b.y + (b.height - height) * v.alignY, width, height };
}

// ------------------------------------------------------------ validation

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
export function validateVariables(v: unknown) {
  if (v === undefined) return;
  const fail = (what: string) => {
    throw new Error(`Invalid variables (${what}).`);
  };
  const d = v as DocumentVariables;
  if (!d || typeof d !== 'object' || !d.layers || typeof d.layers !== 'object' || !Array.isArray(d.sets)) fail('structure');
  if (d.sets.length > 100_000 || Object.keys(d.layers).length > 10_000) fail('size');
  const names = new Set<string>();
  const name = (n: unknown) => {
    if (typeof n !== 'string' || !validVariableName(n) || names.has(n)) fail('name');
    names.add(n as string);
  };
  for (const lv of Object.values(d.layers)) {
    if (!lv || typeof lv !== 'object') fail('layer');
    if (lv.visibility !== undefined) name(lv.visibility);
    if (lv.text !== undefined) name(lv.text);
    if (lv.pixel !== undefined) {
      const p = lv.pixel;
      name(p?.name);
      if (!['fit', 'fill', 'as-is', 'conform'].includes(p.method) || ![0, 0.5, 1].includes(p.alignX) || ![0, 0.5, 1].includes(p.alignY) || typeof p.clip !== 'boolean') fail('pixel');
      const b = p.bounds;
      if (!b || !finite(b.x) || !finite(b.y) || !finite(b.width) || !finite(b.height) || b.width <= 0 || b.height <= 0) fail('pixel bounds');
    }
  }
  for (const s of d.sets) {
    if (!s || typeof s.name !== 'string' || s.name.length > 200 || !s.values || typeof s.values !== 'object') fail('data set');
    for (const [k, val] of Object.entries(s.values)) if (k.length > 64 || !(typeof val === 'boolean' || (typeof val === 'string' && val.length <= 100_000))) fail('value');
  }
  if (d.current !== undefined && !(Number.isInteger(d.current) && d.current >= 0 && d.current < Math.max(1, d.sets.length))) fail('current');
}
