// Shared state for the measurement and annotation tools: annotation edits as
// undoable commands, ruler units, the per-document ruler line, the composite
// snapshots the samplers read, and small overlay helpers.
import type { Editor } from '../../editor';
import type { DocumentSession } from '../../app/session';
import type { PhotoDocument } from '../../model/document';
import { tidyAnnotations, type Annotations } from '../../model/annotations';
import { documentPpi } from '../../model/text-layer';
import { formatUnit, RULER_UNITS, type RulerLine, type RulerUnit } from '../../imaging/measure/geometry';
import type { RGBA8 } from '../../imaging/types';
import { compositeRGBA } from '../pixels';

export const annotationsOf = (doc: PhotoDocument): Annotations => doc.annotations ?? {};

/** One undoable edit of the document's annotations. */
export function editAnnotations(e: Editor, label: string, edit: (a: Annotations, doc: PhotoDocument) => void) {
  e.command(label, (d) => {
    const a = d.annotations ?? {};
    edit(a, d);
    d.annotations = tidyAnnotations(a);
  });
}

// ----- Units -----
export function rulerUnit(e: Editor): RulerUnit {
  const u = e.preferences.rulerUnits;
  return RULER_UNITS.some(([id]) => id === u) ? (u as RulerUnit) : 'px';
}
export const unitSuffix = (u: RulerUnit) => RULER_UNITS.find(([id]) => id === u)![2];
/** A horizontal (`x`) or vertical (`y`) length in the chosen ruler units. */
export function lengthText(e: Editor, px: number, axis: 'x' | 'y' = 'x', withUnit = false) {
  const u = rulerUnit(e);
  const v = formatUnit(px, u, documentPpi(e.doc), axis === 'x' ? e.doc.width : e.doc.height);
  return withUnit ? `${v} ${unitSuffix(u)}` : v;
}

// ----- Ruler line (view state of each open document) -----
const rulers = new WeakMap<DocumentSession, RulerLine>();
export const rulerLine = (e: Editor) => rulers.get(e.session);
export function setRulerLine(e: Editor, r: RulerLine | undefined) {
  if (r) rulers.set(e.session, r);
  else rulers.delete(e.session);
}

// ----- Visibility of annotations (View > Show) -----
export const shown = (e: Editor, key: 'hideSamplers' | 'hideCounts' | 'hideNotes') => !e.settings.extrasHidden && !e.settings[key];

/** Stroke width and lengths in document units for a size in screen pixels. */
export const px = (e: Editor, n: number) => n / e.zoom;

// ----- Composite snapshots -----
// The Info panel and samplers read the flattened document from the GPU.
// Snapshots are taken after the document settles; while a dialog previews a
// change (`e.preview`), a second snapshot of the previewed document gives the
// "after" values.
type Snap = { doc: PhotoDocument; image?: RGBA8; pending?: boolean };
let base: Snap | undefined;
let preview: Snap | undefined;
let baseTimer = 0;
let previewTimer = 0;
const listeners: (() => void)[] = [];
export const onSnapshot = (f: () => void) => listeners.push(f);
const notify = () => listeners.forEach((f) => f());

function take(e: Editor, snap: Snap) {
  if (snap.pending || snap.image) return;
  snap.pending = true;
  compositeRGBA(e, snap.doc)
    .then((image) => {
      snap.image = image;
      notify();
    })
    .catch(() => {})
    .finally(() => (snap.pending = false));
}
/** Composite of the current document, or undefined while it is captured. */
export function baseImage(e: Editor): RGBA8 | undefined {
  if (!e.hasDocument || !e.renderer) return;
  if (base?.doc !== e.doc) {
    base = { doc: e.doc };
    clearTimeout(baseTimer);
    const snap = base;
    baseTimer = window.setTimeout(function wait() {
      if (snap !== base) return;
      if (e.toolBusy) baseTimer = window.setTimeout(wait, 200);
      else take(e, snap);
    }, 250);
  }
  return base.image;
}
/** Track `e.preview` so readouts can show before/after values while a
 * dialog or transform previews a change. */
export function watchPreviews(e: Editor, wanted: () => boolean) {
  const original = e.preview.bind(e);
  e.preview = (doc: PhotoDocument) => {
    original(doc);
    if (doc === e.doc || !wanted()) {
      if (preview) {
        preview = lastPreview = undefined;
        clearTimeout(previewTimer);
        notify();
      }
      return;
    }
    if (preview?.doc === doc) return;
    // Keep showing the previous values until the new preview is captured,
    // so readouts do not flicker while a slider moves.
    if (preview?.image) lastPreview = preview.image;
    const snap: Snap = { doc };
    preview = snap;
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(function wait() {
      if (preview !== snap) return;
      if (e.toolBusy) previewTimer = window.setTimeout(wait, 200);
      else take(e, snap);
    }, 120);
  };
}
let lastPreview: RGBA8 | undefined;
/** Composite of the previewed document, or undefined when nothing previews. */
export function previewImage(e: Editor): RGBA8 | undefined {
  if (!preview || preview.doc === e.doc) return;
  return preview.image ?? lastPreview;
}
export const previewing = (e: Editor) => !!preview && preview.doc !== e.doc;
