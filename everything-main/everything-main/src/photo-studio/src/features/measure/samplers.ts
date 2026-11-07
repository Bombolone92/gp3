// Color Sampler tool: up to ten numbered fixed sample points whose colors
// the Info panel reads live (before/after while a change is previewed).
// Click to place, drag to move, Alt-click or drag off the canvas to delete.
import type { Editor } from '../../editor';
import { registerOverlay, registerTool } from '../../app/registry';
import { MAX_SAMPLERS, type ColorSampler } from '../../model/annotations';
import { sampleAverage, SAMPLE_SIZES } from '../../imaging/measure/geometry';
import { annotationsOf, baseImage, editAnnotations, previewImage, px, shown } from './state';
import type { Color } from './readout';

type Drag = { index: number; x: number; y: number; added: boolean; moved: boolean };
let drag: Drag | undefined;

export const sampleSize = (e: Editor) => {
  const n = Number(e.settings.sampleSize ?? 1);
  return SAMPLE_SIZES.includes(n) ? n : 1;
};
/** Samplers as shown on screen (with an in-progress drag). */
export function samplers(e: Editor): ColorSampler[] {
  const list = [...(annotationsOf(e.doc).samplers ?? [])];
  if (drag) {
    if (drag.added) list.push({ x: drag.x, y: drag.y });
    else list[drag.index] = { x: drag.x, y: drag.y };
  }
  return list;
}
const inside = (e: Editor, s: ColorSampler) => s.x >= 0 && s.y >= 0 && s.x < e.doc.width && s.y < e.doc.height;
/** Color at a sampler in the current document and, while previewing, in
 * the previewed document (undefined when nothing is previewed). */
export function samplerColors(e: Editor, s: ColorSampler): { before: Color | null; after?: Color | null } {
  if (!inside(e, s)) return { before: null };
  const base = baseImage(e);
  const pre = previewImage(e);
  const n = sampleSize(e);
  return {
    before: base ? sampleAverage(base, s.x, s.y, n) : null,
    ...(pre && pre.width === e.doc.width && pre.height === e.doc.height ? { after: sampleAverage(pre, s.x, s.y, n) } : {}),
  };
}

function hit(e: Editor, x: number, y: number) {
  const list = annotationsOf(e.doc).samplers ?? [];
  const r = px(e, 8);
  let best = -1,
    bestD = Infinity;
  list.forEach((s, i) => {
    const d = Math.hypot(s.x + 0.5 - x, s.y + 0.5 - y);
    if (d <= r && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}
export function deleteSampler(e: Editor, index: number) {
  editAnnotations(e, 'Delete Color Sampler', (a) => {
    a.samplers = (a.samplers ?? []).filter((_, i) => i !== index);
  });
}
export function clearSamplers(e: Editor) {
  editAnnotations(e, 'Delete All Color Samplers', (a) => {
    a.samplers = [];
  });
}

function samplerMarkup(e: Editor, s: ColorSampler, n: number, active: boolean) {
  const cx = s.x + 0.5,
    cy = s.y + 0.5;
  const r = px(e, 5),
    arm = px(e, 9),
    w = px(e, 1);
  const cross = `M${cx - arm} ${cy}H${cx - r * 0.4}M${cx + r * 0.4} ${cy}H${cx + arm}M${cx} ${cy - arm}V${cy - r * 0.4}M${cx} ${cy + r * 0.4}V${cy + arm}`;
  return `<g class="color-sampler ${active ? 'active' : ''}"><circle cx="${cx}" cy="${cy}" r="${r}" stroke-width="${w * 3}" class="halo"/><path d="${cross}" stroke-width="${w * 3}" class="halo"/><circle cx="${cx}" cy="${cy}" r="${r}" stroke-width="${w}"/><path d="${cross}" stroke-width="${w}"/><text x="${cx + px(e, 7)}" y="${cy + px(e, 15)}" font-size="${px(e, 11)}" stroke-width="${w * 3}" class="halo">${n}</text><text x="${cx + px(e, 7)}" y="${cy + px(e, 15)}" font-size="${px(e, 11)}">${n}</text></g>`;
}

export function installSamplers(_e: Editor) {
  registerOverlay('color-samplers', (e) => {
    if (!e.hasDocument || !shown(e, 'hideSamplers')) return '';
    return samplers(e)
      .map((s, i) => samplerMarkup(e, s, i + 1, !!drag && (drag.added ? i === samplers(e).length - 1 : i === drag.index)))
      .join('');
  });
  registerTool({
    id: 'color-sampler',
    label: 'Color Sampler Tool',
    key: 'I',
    icon: 'color-sampler',
    group: 'eyedropper',
    cursor: () => 'crosshair',
    options: (e) => {
      const n = annotationsOf(e.doc).samplers?.length ?? 0;
      return `<label>Sample Size <select id="sampler-size">${SAMPLE_SIZES.map((s) => `<option value="${s}" ${sampleSize(e) === s ? 'selected' : ''}>${s === 1 ? 'Point Sample' : `${s} by ${s} Average`}</option>`).join('')}</select></label><span class="divider"></span><span class="muted" id="sampler-count">${n} of ${MAX_SAMPLERS} samplers</span><button data-command="samplers.clear" ${n ? '' : 'disabled'}>Clear All</button><button data-command="window.panel.info" title="Show the readouts in the Info panel">Show Info</button>`;
    },
    bindOptions: ({ e, el }) => {
      el.querySelector<HTMLSelectElement>('#sampler-size')?.addEventListener('change', (ev) => {
        e.settings.sampleSize = Number((ev.target as HTMLSelectElement).value);
        e.dock.update();
      });
    },
    pointerDown: (e, p) => {
      const i = hit(e, p.x, p.y);
      if (i >= 0 && p.alt) {
        deleteSampler(e, i);
        return;
      }
      if (i >= 0) {
        const s = annotationsOf(e.doc).samplers![i];
        drag = { index: i, x: s.x, y: s.y, added: false, moved: false };
        return;
      }
      if (p.alt) return;
      const count = annotationsOf(e.doc).samplers?.length ?? 0;
      if (count >= MAX_SAMPLERS) {
        e.message(`Up to ${MAX_SAMPLERS} color samplers fit in a document; drag one to move it or Alt-click to delete it.`);
        return;
      }
      if (p.x < 0 || p.y < 0 || p.x >= e.doc.width || p.y >= e.doc.height) return;
      drag = { index: count, x: Math.floor(p.x), y: Math.floor(p.y), added: true, moved: false };
      e.overlay();
      e.dock.update();
    },
    pointerMove: (e, p) => {
      if (!drag) return;
      drag.x = Math.floor(p.x);
      drag.y = Math.floor(p.y);
      drag.moved = true;
      e.overlay();
      e.dock.update();
    },
    pointerUp: (e) => {
      const d = drag;
      drag = undefined;
      if (!d) return;
      const off = d.x < 0 || d.y < 0 || d.x >= e.doc.width || d.y >= e.doc.height;
      if (d.added) {
        if (off) e.update();
        else editAnnotations(e, 'Color Sampler', (a) => (a.samplers = [...(a.samplers ?? []), { x: d.x, y: d.y }]));
      } else if (off) deleteSampler(e, d.index);
      else if (d.moved)
        editAnnotations(e, 'Move Color Sampler', (a) => {
          a.samplers = (a.samplers ?? []).map((s, i) => (i === d.index ? { x: d.x, y: d.y } : s));
        });
      else e.update();
    },
  });
}
