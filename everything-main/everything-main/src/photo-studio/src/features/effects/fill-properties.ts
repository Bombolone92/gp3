import type { Layer, PhotoDocument } from '../../model/document';
import type { LayerFill } from '../../model/fill-layer';
import { escapeXML } from '../../model/assets';
import { layerLock } from '../../model/locks';
import type { PropertiesEditor } from '../panels/properties';
import { mountFields, type Field } from './controls';
import { fillLayerFor } from './commands';
import { resolveGradient } from './state';

// Properties editor for gradient and pattern fill layers. Slider drags
// preview; committed edits are one history step each.
export const fillPropertiesEditor: PropertiesEditor = {
  mount: (e, el, l) => {
    const fill: LayerFill = structuredClone(l.fill!);
    const id = l.id;
    const locked = !!layerLock(e.doc.layers, id, 'all');
    el.innerHTML = `<div class="property-body fill-properties"><span class="eyebrow">${fill.type === 'gradient' ? 'GRADIENT' : 'PATTERN'} FILL LAYER</span><h3>${escapeXML(l.name)}</h3><div class="fill-fields"></div></div>`;
    const host = el.querySelector<HTMLElement>('.fill-fields')!;
    const previewDoc = (): PhotoDocument => {
      const replace = (layers: Layer[]): Layer[] =>
        layers.map((x) => (x.id === id ? { ...x, fill: structuredClone(fill) } : x.children.length ? { ...x, children: replace(x.children) } : x));
      return { ...e.doc, layers: replace(e.doc.layers) };
    };
    let type: 'gradient' | 'pattern' | 'solid' = fill.type;
    const fields = (): Field[] => {
      const head: Field = {
        kind: 'select', label: 'Fill', structural: true, options: [['gradient', 'Gradient'], ['pattern', 'Pattern'], ['solid', 'Solid Color']], get: () => type,
        set: (v) => (type = v as typeof type),
      };
      if (fill.type === 'gradient') {
        const g = fill;
        return [
          head,
          { kind: 'gradient', label: 'Gradient', get: () => g.gradient, set: (x) => (g.gradient = resolveGradient(e, x)) },
          { kind: 'select', label: 'Style', options: [['linear', 'Linear'], ['radial', 'Radial'], ['angle', 'Angle'], ['reflected', 'Reflected'], ['diamond', 'Diamond']], get: () => g.style, set: (v) => (g.style = v as typeof g.style) },
          { kind: 'angle', label: 'Angle', get: () => g.angle, set: (v) => (g.angle = v) },
          { kind: 'slider', label: 'Scale', min: 10, max: 1000, unit: '%', display: 100, get: () => g.scale, set: (v) => (g.scale = Math.max(0.1, v)) },
          { kind: 'slider', label: 'Offset X', min: -100, max: 100, unit: '%', display: 100, get: () => g.offset?.x ?? 0, set: (v) => (g.offset = { x: v, y: g.offset?.y ?? 0 }) },
          { kind: 'slider', label: 'Offset Y', min: -100, max: 100, unit: '%', display: 100, get: () => g.offset?.y ?? 0, set: (v) => (g.offset = { x: g.offset?.x ?? 0, y: v }) },
          { kind: 'check', label: 'Reverse', get: () => !!g.reverse, set: (v) => (g.reverse = v) },
          { kind: 'check', label: 'Dither', get: () => !!g.dither, set: (v) => (g.dither = v) },
          { kind: 'select', label: 'Method', options: [['perceptual', 'Perceptual'], ['linear', 'Linear'], ['classic', 'Classic']], get: () => g.method ?? 'perceptual', set: (v) => (g.method = v as typeof g.method) },
        ];
      }
      const p = fill;
      return [
        head,
        { kind: 'pattern', label: 'Pattern', get: () => p.patternId, set: (v) => (p.patternId = v) },
        { kind: 'slider', label: 'Scale', min: 1, max: 1000, unit: '%', display: 100, get: () => p.scale, set: (v) => (p.scale = Math.max(0.01, v)) },
        { kind: 'angle', label: 'Angle', get: () => p.angle ?? 0, set: (v) => (p.angle = v) },
        { kind: 'slider', label: 'Offset X', min: -2000, max: 2000, unit: 'px', get: () => p.offset?.x ?? 0, set: (v) => (p.offset = { x: v, y: p.offset?.y ?? 0 }) },
        { kind: 'slider', label: 'Offset Y', min: -2000, max: 2000, unit: 'px', get: () => p.offset?.y ?? 0, set: (v) => (p.offset = { x: p.offset?.x ?? 0, y: v }) },
      ];
    };
    if (locked) {
      host.innerHTML = '<p class="muted">Unlock this layer to edit its fill.</p>';
      return;
    }
    mountFields(e, host, fields, (_structural, final) => {
      if (!final) {
        e.preview(previewDoc());
        return;
      }
      if (type !== fill.type) {
        const next = type === 'solid' ? undefined : fillLayerFor(e, type);
        e.editLayer('Change Fill Type', (x) => {
          if (next) x.fill = next;
          else delete x.fill;
        });
        return;
      }
      const value = structuredClone(fill);
      e.editLayer('Change Fill', (x) => (x.fill = value));
    });
  },
};
