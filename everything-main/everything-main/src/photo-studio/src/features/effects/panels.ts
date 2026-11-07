import type { Panel } from '../../app/registry';
import { escapeXML } from '../../model/assets';
import { svg } from '../../app/icons';
import { gradientToCss } from '../../imaging/gradient/edit';
import { applyStylePreset } from './commands';
import { allGradientFolders, availablePatterns, colors, effectsState, loadUserGradients, patternThumb, saveUserGradients } from './state';
import { allStyles, deleteUserStyle, showStyleThumbnail } from './style-thumbs';

// Styles, Gradients and Patterns panels. Clicking a style applies it to the
// selected layers; clicking a gradient or pattern makes it current for the
// Gradient tool, fill layers and the Pattern Stamp.
export const stylesPanel: Panel = {
  id: 'styles',
  title: 'Styles',
  icon: 'sparkles',
  location: 'strip',
  mount: (e, el) => {
    el.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-style]');
      if (!b) return;
      const id = b.dataset.style!;
      if (ev.altKey && id.startsWith('user-')) {
        deleteUserStyle(id);
        stylesPanel.update!(e, el);
        return;
      }
      applyStylePreset(e, id);
    });
  },
  update: (e, el) => {
    const key = JSON.stringify(allStyles().map((s) => s.id));
    if (el.dataset.key === key) {
      el.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) => (b.disabled = !e.layer));
      return;
    }
    el.dataset.key = key;
    el.innerHTML = `<div class="style-grid" role="list" aria-label="Layer styles">${allStyles().map((s) => `<button role="listitem" data-style="${escapeXML(s.id)}" title="${escapeXML(s.name)}${s.id.startsWith('user-') ? ' — Alt-click to delete' : ''}" aria-label="Apply style ${escapeXML(s.name)}" ${e.layer ? '' : 'disabled'}><img alt="" width="48" height="48"><span>${escapeXML(s.name)}</span></button>`).join('')}</div><p class="muted panel-hint">Click a style to apply it to the selected layers. Save your own from the Layer Style dialog.</p>`;
    const styles = allStyles();
    el.querySelectorAll<HTMLImageElement>('[data-style] img').forEach((img, i) => showStyleThumbnail(img, styles[i].style, 48));
  },
  menu: () => ['layer.style-dialog', 'layer.style-copy', 'layer.style-paste', 'layer.style-clear'],
};

export const gradientsPanel: Panel = {
  id: 'gradients',
  title: 'Gradients',
  icon: 'gradient-swatches',
  location: 'dock-top',
  mount: (e, el) => {
    el.addEventListener('click', async (ev) => {
      const t = ev.target as HTMLElement;
      const b = t.closest<HTMLElement>('[data-gradient]');
      if (b) {
        const [fi, gi] = b.dataset.gradient!.split(':').map(Number);
        const folders = allGradientFolders();
        if (ev.altKey && folders[fi].name === 'Saved') {
          saveUserGradients(loadUserGradients().filter((_, i) => i !== gi));
          gradientsPanel.update!(e, el);
          return;
        }
        effectsState.gradient = structuredClone(folders[fi].gradients[gi]);
        if (e.tool !== 'gradient') e.setTool('gradient');
        else e.options();
        gradientsPanel.update!(e, el);
        return;
      }
      if (t.closest('[data-edit-gradient]')) {
        const { gradientEditor } = await import('./gradient-editor');
        const g = await gradientEditor(e, effectsState.gradient);
        if (g) {
          effectsState.gradient = g;
          e.options();
        }
        gradientsPanel.update!(e, el);
      }
    });
  },
  update: (e, el) => {
    const ctx = colors(e);
    const current = JSON.stringify(effectsState.gradient);
    el.innerHTML = `<div class="gradient-panel">${allGradientFolders().map((f, fi) => `<details open><summary>${svg('folder', 13)}${escapeXML(f.name)}</summary><div class="picker-grid">${f.gradients.map((g, gi) => `<button data-gradient="${fi}:${gi}" aria-pressed="${JSON.stringify(g) === current}" title="${escapeXML(g.name ?? 'Gradient')}${f.name === 'Saved' ? ' — Alt-click to delete' : ''}" aria-label="${escapeXML(g.name ?? 'Gradient')}" style="background:${gradientToCss(g, ctx)}, var(--fx-checker)"></button>`).join('')}</div></details>`).join('')}<button class="panel-wide-button" data-edit-gradient>${svg('sliders-horizontal', 13)}Edit current gradient…</button></div>`;
  },
};

export const patternsPanel: Panel = {
  id: 'patterns',
  title: 'Patterns',
  icon: 'grid-2x2',
  location: 'dock-top',
  mount: (e, el) => {
    el.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-pattern]');
      if (b) {
        const id = b.dataset.pattern!;
        if (ev.altKey && id.startsWith('user-')) {
          e.command('Delete Pattern', (d) => (d.patterns = (d.patterns ?? []).filter((p) => p.id !== id)));
          return;
        }
        effectsState.patternId = id;
        e.options();
        patternsPanel.update!(e, el);
        return;
      }
    });
  },
  update: (e, el) => {
    const list = availablePatterns(e);
    el.innerHTML = `<div class="pattern-panel"><div class="picker-grid">${list.map((p) => `<button data-pattern="${escapeXML(p.id)}" aria-pressed="${p.id === effectsState.patternId}" title="${escapeXML(p.name)}${p.id.startsWith('user-') ? ' — Alt-click to delete' : ''}" aria-label="${escapeXML(p.name)}"><img src="${patternThumb(p, 40)}" alt=""></button>`).join('')}</div><div class="panel-row"><button data-command="edit.define-pattern">${svg('plus', 13)}Define from selection</button><button data-command="layer.fill-pattern">Pattern fill layer</button></div></div>`;
  },
  menu: () => ['edit.define-pattern', 'layer.fill-pattern'],
};
