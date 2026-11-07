// Color readouts for the Info panel and color samplers: a sampled color
// described in one of several color models, optionally as before/after
// pairs while a change is previewed. Profile conversions load lazily.
import type { Editor } from '../../editor';
import { rgbToHsb } from '../../color/hsb';

export type ReadoutModel = 'actual' | 'proof' | 'rgb' | 'hex' | 'hsb' | 'cmyk' | 'lab' | 'gray' | 'ink' | 'opacity';
export const READOUT_MODELS: [ReadoutModel, string][] = [
  ['actual', 'Document'],
  ['proof', 'Proof'],
  ['rgb', 'RGB'],
  ['hex', 'Web Hex'],
  ['hsb', 'HSB'],
  ['cmyk', 'CMYK'],
  ['lab', 'Lab'],
  ['gray', 'Gray'],
  ['ink', 'Total Ink'],
  ['opacity', 'Opacity'],
];
export const isModel = (v: unknown): v is ReadoutModel => READOUT_MODELS.some(([id]) => id === v);
export type Channel = [label: string, value: string];
export type Color = [number, number, number, number];

type Engine = typeof import('./color-engine');
let engine: Engine | undefined;
let loading: Promise<unknown> | undefined;
let waiting: Promise<unknown> | undefined;
const readyListeners: (() => void)[] = [];
export const onEngineReady = (f: () => void) => readyListeners.push(f);
function needEngine(e: Editor): Engine | undefined {
  if (!engine) {
    loading ??= import('./color-engine').then((m) => {
      engine = m;
      readyListeners.forEach((f) => f());
    });
    return;
  }
  const p = engine.pending(e.doc, e.session);
  if (p) {
    if (!waiting)
      waiting = p.finally(() => {
        waiting = undefined;
        readyListeners.forEach((f) => f());
      });
    return;
  }
  return engine;
}

const int = (v: number) => String(Math.round(v));
const pct = (v: number) => `${Math.round(v)}%`;
const hex2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
const placeholder = (labels: string[]): Channel[] => labels.map((l) => [l, '…']);

/** The model a "Document Color" readout uses for the document's mode. */
export function actualModel(e: Editor): ReadoutModel {
  const m = e.doc.mode ?? 'rgb';
  return m === 'cmyk' ? 'cmyk' : m === 'lab' ? 'lab' : m === 'grayscale' || m === 'bitmap' || m === 'duotone' ? 'gray' : 'rgb';
}
/** Channels of a color (straight RGBA, 0-255) in `model`. */
export function channels(e: Editor, c: Color | null, model: ReadoutModel): Channel[] {
  const m = model === 'actual' ? actualModel(e) : model;
  const labels: Record<ReadoutModel, string[]> = {
    actual: [], proof: ['C', 'M', 'Y', 'K'], rgb: ['R', 'G', 'B'], hex: ['#'], hsb: ['H', 'S', 'B'], cmyk: ['C', 'M', 'Y', 'K'],
    lab: ['L', 'a', 'b'], gray: ['K'], ink: ['Ink'], opacity: ['Op'],
  };
  if (!c) return labels[m].map((l) => [l, '–']);
  const [r, g, b, a] = c;
  switch (m) {
    case 'rgb':
      return [['R', int(r)], ['G', int(g)], ['B', int(b)]];
    case 'hex':
      return [['#', `${hex2(r)}${hex2(g)}${hex2(b)}`]];
    case 'hsb': {
      const h = rgbToHsb(r, g, b);
      return [['H', `${Math.round(h.h) % 360}°`], ['S', pct(h.s)], ['B', pct(h.b)]];
    }
    case 'opacity':
      return [['Op', pct((a / 255) * 100)]];
  }
  const en = needEngine(e);
  if (m === 'proof') {
    if (!en) return placeholder(labels.proof);
    const p = en.proof(e.doc, e.session, [r, g, b]);
    if (p.space === 'CMYK') return p.values.map((v, i) => ['CMYK'[i], pct(v)]);
    if (p.space === 'GRAY') return [['K', pct(p.values[0])]];
    return p.values.map((v, i) => ['RGB'[i], int(v)]);
  }
  if (!en) return placeholder(labels[m]);
  switch (m) {
    case 'cmyk':
      return en.cmyk(e.doc, [r, g, b]).map((v, i) => ['CMYK'[i], pct(v)]);
    case 'ink':
      return [['Ink', pct(en.cmyk(e.doc, [r, g, b]).reduce((s, v) => s + Math.round(v), 0))]];
    case 'lab':
      return en.lab(e.doc, [r, g, b]).map((v, i) => [['L', 'a', 'b'][i], int(v)]);
    case 'gray':
      return [['K', pct(en.gray(e.doc, [r, g, b]))]];
  }
  return [];
}

/** Channels for before and after colors: "before/after" values while a
 * change is previewed. */
export function compareChannels(e: Editor, before: Color | null, after: Color | null | undefined, model: ReadoutModel): Channel[] {
  const a = channels(e, before, model);
  if (after === undefined) return a;
  const b = channels(e, after, model);
  return a.map(([label, v], i) => [label, `${v}/${b[i]?.[1] ?? '–'}`]);
}

/** Document profile name (loads the color engine). */
export function profileText(e: Editor): string {
  const en = needEngine(e);
  return en ? en.profileName(e.doc) : '…';
}
