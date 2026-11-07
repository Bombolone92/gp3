/**
 * Pixel effects: the Effect Gallery and its filters (Artistic, Blur, Brush
 * Strokes, Distort, Pixelate, Sketch, Stylize, Texture) and Effect > SVG
 * Filters. Both are live raster effects in node.effects, rendered in
 * document space at the document's raster effects resolution, listed and
 * edited in the Appearance panel, repeated by Apply Last Effect, written to
 * PNG/JPEG/PDF by the renderer and to SVG as an embedded image (gallery
 * filters) or a real <filter> (SVG filters).
 */
import './styles.css';
import './effect-types.js';
import { EFFECTS } from '../paint/effects-model.js';
import { FILTERS } from './catalog.js';
import { onRefine } from './core.js';
import { openGallery } from './gallery.js';
import { openSvgFilterDialog, importSvgFilterCommand } from './svg-filter-ui.js';
import { installSvgExport } from './svg-export.js';

const hasSel = (a) => Boolean(a.editor && a.editor.selection.size);

export function install(app) {
  installSvgExport();
  EFFECTS.gallery.openDialog = (a, { params, edit } = {}) => openGallery(a, { params, edit });
  EFFECTS.svgFilter.openDialog = (a, { params, edit } = {}) => openSvgFilterDialog(a, { params, edit });

  app.commands.register([
    { id: 'effect.gallery', label: 'Effect Gallery...', enabled: hasSel, run: (a) => openGallery(a) },
    ...FILTERS.map((f) => ({ id: `effect.px.${f.id}`, label: `${f.label}...`, enabled: hasSel, run: (a) => openGallery(a, { focus: f.id }) })),
    { id: 'effect.svgFilter.apply', label: 'Apply SVG Filter...', enabled: hasSel, run: (a) => openSvgFilterDialog(a) },
    { id: 'effect.svgFilter.import', label: 'Import SVG Filter...', enabled: (a) => Boolean(a.editor), run: (a) => importSvgFilterCommand(a) },
  ]);

  // Effects drafted at low resolution while something changed get redrawn sharp once it settles.
  onRefine(() => {
    for (const v of app.views?.values?.() || []) v.invalidate?.();
  });
}
