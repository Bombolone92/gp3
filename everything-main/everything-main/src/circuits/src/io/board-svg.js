// Boards as SVG, drawn by the same scene code as the canvas: the chosen
// layers in stacking order over the board shape, with drill holes on top.

import { SvgBatch } from '../render/svg-batch.js';
import { emitPcbObject, layerDrawOrder } from '../render/pcb-scene.js';
import { PCB_PALETTES } from '../render/palette.js';
import { pack } from '../render/color.js';
import { bboxOfFlat, bboxUnion } from '../core/geom.js';
import { pcbBounds } from '../model/pcb.js';
import { mm } from '../core/units.js';

/**
 * @param {{board, rules, items: () => Iterable<object>}} doc  a board DocModel
 * @param {Record<string,object>} lib
 * @param {{ layers?: string[], pourFills?: Map, colors?: object, theme?: 'light'|'dark', active?: string }} opts
 */
export function boardToSvgView(doc, lib, { layers, pourFills, colors, theme = 'light', active = 'top' } = {}) {
  const pal = PCB_PALETTES[theme];
  const board = doc.board;
  const items = [...doc.items()];
  let box = board.outline?.length >= 6 ? bboxOfFlat(board.outline) : { minX: 0, minY: 0, maxX: mm(10), maxY: mm(10) };
  for (const o of items) box = bboxUnion(box, pcbBounds(o, lib));
  const margin = mm(3);
  const ox = box.minX - margin, oy = box.minY - margin;
  const W = box.maxX - box.minX + 2 * margin, H = box.maxY - box.minY + 2 * margin;
  // The batch flips y against H; a group transform below moves the box to the origin.
  const b = new SvgBatch({ height: H, minStroke: 0.05 });
  const count = board.copper || 2;
  const order = layerDrawOrder(count, active).filter((l) => l === 'holes' || !layers || layers.includes(l));
  const ctx = { lib, count, pal, colors, rules: doc.rules, pourFills };
  if (board.outline?.length >= 6) {
    b.poly([board.outline, ...(board.cutouts || [])], pack(pal.boardFill));
    b.polyline(board.outline, mm(0.1), pack(pal.boardEdge), true);
  }
  for (const l of order) {
    const sink = (layer) => (layer === l ? b : null);
    for (const o of items) emitPcbObject(o, sink, ctx);
  }
  b._flush();
  const content = b.out.join('');
  const svgW = W / 1e6, svgH = H / 1e6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}mm" height="${svgH}mm" viewBox="0 0 ${svgW} ${svgH}">`
    + `<rect width="${svgW}" height="${svgH}" fill="${pal.background}"/>`
    + `<g transform="translate(${-ox / 1e6} ${oy / 1e6})">${content}</g></svg>`;
}
