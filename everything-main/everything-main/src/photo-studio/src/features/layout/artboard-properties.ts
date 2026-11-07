// Properties panel section for artboards: name, size and position, presets,
// orientation, background and clipping.
import type { Editor } from '../../editor';
import { svg } from '../../app/icons';
import { escapeXML } from '../../model/assets';
import { findLayer } from '../../model/document';
import { artboardPresets, isArtboard, matchingPreset, presetById, type ArtboardBackground } from '../../model/artboard';
import { layerLock } from '../../model/locks';
import { propertiesEditors } from '../panels/properties';
import { backgroundOptions, fitRectOnScreen, resizeArtboard, setArtboard, shiftArtboard, layoutCommand } from './artboards';

const num = (key: string, label: string, value: number, min?: number) =>
  `<label class="number-field"><span>${label}</span><input type="number" data-artboard="${key}" step="1" ${min !== undefined ? `min="${min}" max="8192"` : ''} value="${Math.round(value)}" aria-label="Artboard ${label}"></label>`;

export function installArtboardProperties(_e: Editor) {
  propertiesEditors.set('artboard', {
    mount: (e, el, l) => {
      if (!isArtboard(l)) return;
      const a = l.artboard;
      const r = a.rect;
      const locked = !!layerLock(e.doc.layers, l.id, 'all');
      const preset = matchingPreset(r.width, r.height, a.preset);
      const categories = [...new Set(artboardPresets.map((p) => p.category))];
      const portrait = r.height >= r.width;
      el.innerHTML = `<div class="property-body artboard-properties"><span class="eyebrow">ARTBOARD</span>
<input class="layer-name-input" data-artboard="name" aria-label="Artboard name" value="${escapeXML(l.name)}" ${locked ? 'disabled' : ''}>
<fieldset ${locked ? 'disabled' : ''}>
<h3>Size</h3>
<label class="number-field artboard-preset"><span>Preset</span><select data-artboard="preset" aria-label="Artboard size preset"><option value="">Custom</option>${categories
        .map((c) => `<optgroup label="${escapeXML(c)}">${artboardPresets.filter((p) => p.category === c).map((p) => `<option value="${p.id}" ${preset?.id === p.id ? 'selected' : ''}>${escapeXML(p.name)}</option>`).join('')}</optgroup>`)
        .join('')}</select></label>
<div class="transform-grid">${num('width', 'W', r.width, 1)}${num('height', 'H', r.height, 1)}${num('x', 'X', r.x)}${num('y', 'Y', r.y)}</div>
<div class="artboard-orientation" role="group" aria-label="Orientation"><span>Orientation</span><button data-artboard-orient="portrait" aria-pressed="${portrait}" title="Portrait">${svg('artboard-layer', 14)}<span>Portrait</span></button><button data-artboard-orient="landscape" aria-pressed="${!portrait}" title="Landscape">${svg('artboard-layer', 14)}<span>Landscape</span></button></div>
<h3>Background</h3>
<label class="number-field"><span>Fill</span><select data-artboard="background" aria-label="Artboard background">${backgroundOptions.map(([v, label]) => `<option value="${v}" ${a.background === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
${a.background === 'custom' ? `<label class="color-row">Color <input type="color" data-artboard="color" value="${a.color ?? '#ffffff'}"></label>` : ''}
<label class="lock-label"><input type="checkbox" data-artboard="clip" ${a.clip !== false ? 'checked' : ''}> Clip contents to the artboard</label>
</fieldset>
<button class="wide" data-artboard-action="fit">${svg('scan', 13)} Fit artboard on screen</button>
<button class="wide" data-command="file.export-artboards-files">${svg('download', 13)} Export artboards…</button></div>`;
      const id = l.id;
      el.addEventListener('change', (ev) => {
        const t = ev.target as HTMLInputElement;
        const key = t.dataset.artboard;
        const cur = findLayer(e.doc.layers, id);
        if (!key || !isArtboard(cur)) return;
        const rect = cur.artboard.rect;
        if (key === 'name') {
          if (t.value.trim()) e.command('Rename Artboard', (d) => (findLayer(d.layers, id)!.name = t.value.trim()));
        } else if (key === 'preset') {
          const p = presetById(t.value);
          // Keep the current orientation when picking a preset.
          if (p) {
            const flip = rect.width > rect.height !== p.width > p.height && p.width !== p.height;
            resizeArtboard(e, id, { ...rect, width: flip ? p.height : p.width, height: flip ? p.width : p.height }, p.id);
          }
        } else if (key === 'width' || key === 'height') {
          const v = Math.max(1, Math.min(8192, Math.round(Number(t.value) || 1)));
          resizeArtboard(e, id, { ...rect, [key]: v });
        } else if (key === 'x' || key === 'y') {
          const v = Math.round(Number(t.value) || 0);
          layoutCommand(e, 'Move Artboard', (d) => shiftArtboard(d, id, key === 'x' ? v - rect.x : 0, key === 'y' ? v - rect.y : 0));
        } else if (key === 'background')
          setArtboard(e, id, 'Artboard Background', (x) => {
            x.artboard.background = t.value as ArtboardBackground;
            if (t.value === 'custom') x.artboard.color ??= e.color;
          });
        else if (key === 'color') setArtboard(e, id, 'Artboard Color', (x) => (x.artboard.color = t.value));
        else if (key === 'clip') setArtboard(e, id, t.checked ? 'Clip Artboard' : 'Unclip Artboard', (x) => (x.artboard.clip = t.checked));
      });
      el.addEventListener('click', (ev) => {
        const t = ev.target as HTMLElement;
        const cur = findLayer(e.doc.layers, id);
        if (!isArtboard(cur)) return;
        const rect = cur.artboard.rect;
        const orient = t.closest<HTMLElement>('[data-artboard-orient]')?.dataset.artboardOrient;
        if (orient && (orient === 'portrait') !== (rect.height >= rect.width))
          resizeArtboard(e, id, { ...rect, width: rect.height, height: rect.width }, cur.artboard.preset);
        if (t.closest('[data-artboard-action="fit"]')) fitRectOnScreen(e, rect);
      });
    },
  });
}
