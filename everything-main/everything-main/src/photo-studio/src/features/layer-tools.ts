import type { Editor } from '../editor';
import { registerTool } from '../app/registry';
import type { CanvasPointer } from '../app/pointer';
import { findLayer } from '../model/document';
import { compositeRGBA, layerRGBA, rgbHex } from './pixels';
import { readRGBA } from '../model/tiles';
import type { RGBA8 } from '../imaging/types';
import { svg } from '../app/icons';
import { sampleAverage, SAMPLE_SIZES } from '../imaging/measure/geometry';


export function installLayerTools(e: Editor) {
  registerTool({
    id: 'move',
    label: 'Move Tool',
    key: 'V',
    icon: 'move',
    group: 'move',
    // Pointer handling lives in FreeTransform (selection, drag, handles).
    options: (e) =>
      `<label class="transform-setting"><input id="auto-select" type="checkbox" ${e.autoSelect ? 'checked' : ''}>Auto-Select</label><label class="transform-setting"><input id="transform-snap" type="checkbox" ${e.transform.snapping ? 'checked' : ''}>Snap</label><button data-command="edit.free-transform" ${!e.selectedIds.size ? 'disabled' : ''}>Free Transform</button><span class="divider"></span>${['align-left', 'align-hcenter', 'align-right', 'align-top', 'align-vcenter', 'align-bottom']
        .map((a) => `<button class="icon-button" data-command="layer.${a}" title="${a.replace('align-', 'Align ').replace('hcenter', 'horizontal centers').replace('vcenter', 'vertical centers')}" aria-label="${a.replace('align-', 'Align ')}">${svg(alignIcon(a), 16)}</button>`)
        .join('')}`,
    bindOptions: ({ e, el }) => {
      el.querySelector<HTMLInputElement>('#auto-select')?.addEventListener('change', (ev) => (e.autoSelect = (ev.target as HTMLInputElement).checked));
    },
  });
  // The Crop and Perspective Crop tools live in features/transform/crop.ts.
  registerTool({
    id: 'eyedropper',
    label: 'Eyedropper Tool',
    key: 'I',
    icon: 'pipette',
    group: 'eyedropper',
    cursor: () => 'crosshair',
    options: (e) =>
      `<label>Sample Size <select id="sample-size">${SAMPLE_SIZES.map((n) => `<option value="${n}" ${Number(e.settings.sampleSize ?? 1) === n ? 'selected' : ''}>${n === 1 ? 'Point Sample' : `${n} by ${n} Average`}</option>`).join('')}</select></label><label>Sample <select id="sample-layers"><option value="current" ${e.settings.sampleAll ? '' : 'selected'}>Current Layer</option><option value="all" ${e.settings.sampleAll ? 'selected' : ''}>All Layers</option></select></label>`,
    bindOptions: ({ e, el }) => {
      el.querySelector<HTMLSelectElement>('#sample-size')?.addEventListener('change', (ev) => (e.settings.sampleSize = Number((ev.target as HTMLSelectElement).value)));
      el.querySelector<HTMLSelectElement>('#sample-layers')?.addEventListener('change', (ev) => (e.settings.sampleAll = (ev.target as HTMLSelectElement).value === 'all'));
    },
    pointerDown: (e, p) => sample(e, p),
    pointerMove: (e, p) => sample(e, p),
  });
  void e;
}
function alignIcon(a: string) {
  return (
    {
      'align-left': 'align-start-vertical',
      'align-hcenter': 'align-horizontal-justify-center',
      'align-right': 'align-end-vertical',
      'align-top': 'align-start-horizontal',
      'align-vcenter': 'align-vertical-justify-center',
      'align-bottom': 'align-end-horizontal',
    } as Record<string, string>
  )[a];
}
let sampleCache: { doc: unknown; layer?: string; all: boolean; image: Promise<RGBA8> } | undefined;
async function sample(e: Editor, p: CanvasPointer) {
  const all = !!e.settings.sampleAll;
  const l = e.layer;
  if (!sampleCache || sampleCache.doc !== e.doc || sampleCache.all !== all || sampleCache.layer !== l?.id)
    sampleCache = {
      doc: e.doc,
      layer: l?.id,
      all,
      image: all || !l ? compositeRGBA(e) : l.kind === 'pixel' && l.pixels ? Promise.resolve(readRGBA(e.assets.tiles, l.pixels, { x: 0, y: 0, width: e.doc.width, height: e.doc.height })) : layerRGBA(e, findLayer(e.doc.layers, l.id)!),
    };
  const img = await sampleCache.image;
  const c = sampleAverage(img, p.x, p.y, Number(e.settings.sampleSize ?? 1));
  if (!c) return;
  const hex = rgbHex(c[0], c[1], c[2]);
  if (p.alt) e.setBackground(hex);
  else e.setForeground(hex);
}
