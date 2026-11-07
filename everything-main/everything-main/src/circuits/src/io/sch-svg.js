// Schematic sheets as SVG, drawn by the same scene code as the canvas.

import { SvgBatch } from '../render/svg-batch.js';
import { buildSchematic } from '../render/sch-scene.js';
import { SCH_PALETTES } from '../render/palette.js';
import { sheetExtents } from '../model/project.js';

/** Print palette: the light theme on white paper. */
const PRINT = { ...SCH_PALETTES.light, paper: '#ffffff', background: '#ffffff' };

/**
 * @param {{sheet:object, items:() => Iterable<object>}} doc  a DocModel (or {sheet, objects})
 * @param {Record<string,object>} lib
 * @param {{ theme?: 'print'|'light'|'dark', junctions?: number[][], info?: object }} opts
 */
export function sheetToSvg(doc, lib, { theme = 'print', junctions = [], info = {} } = {}) {
  const pal = theme === 'print' ? PRINT : SCH_PALETTES[theme];
  const ext = sheetExtents(doc.sheet);
  const b = new SvgBatch({ height: ext.maxY });
  const sheetBatch = new SvgBatch({ height: ext.maxY });
  const source = doc.items ? doc : { sheet: doc.sheet, items: () => doc.objects };
  buildSchematic(b, source, lib, pal, { sheetBatch, junctions, info });
  sheetBatch._flush();
  b._flush();
  sheetBatch.out.push(...b.out);
  return sheetBatch.toSvg(ext.maxX, ext.maxY, pal.paper);
}
