// Board layers. Copper layers are ordered top to bottom; the stack decides
// which inner layers exist. Each layer has a stable string id used in files,
// a short code for compact UI, and default display colors.

export const COPPER_ORDER = ['top', 'in1', 'in2', 'in3', 'in4', 'bottom'];

/** @type {Record<string, {id:string,name:string,short:string,kind:string,side?:string,color:string}>} */
export const LAYERS = {
  top: { id: 'top', name: 'Top Layer', short: 'T', kind: 'copper', side: 'top', color: '#ff2a2a' },
  in1: { id: 'in1', name: 'Inner Layer 1', short: 'I1', kind: 'copper', color: '#c8a000' },
  in2: { id: 'in2', name: 'Inner Layer 2', short: 'I2', kind: 'copper', color: '#30c8ff' },
  in3: { id: 'in3', name: 'Inner Layer 3', short: 'I3', kind: 'copper', color: '#20c060' },
  in4: { id: 'in4', name: 'Inner Layer 4', short: 'I4', kind: 'copper', color: '#c060ff' },
  bottom: { id: 'bottom', name: 'Bottom Layer', short: 'B', kind: 'copper', side: 'bottom', color: '#2f5bff' },
  topOverlay: { id: 'topOverlay', name: 'Top Overlay', short: 'TO', kind: 'overlay', side: 'top', color: '#ffe23a' },
  bottomOverlay: { id: 'bottomOverlay', name: 'Bottom Overlay', short: 'BO', kind: 'overlay', side: 'bottom', color: '#a08c2a' },
  topPaste: { id: 'topPaste', name: 'Top Paste', short: 'TP', kind: 'paste', side: 'top', color: '#8a8a8a' },
  bottomPaste: { id: 'bottomPaste', name: 'Bottom Paste', short: 'BP', kind: 'paste', side: 'bottom', color: '#7a5050' },
  topSolder: { id: 'topSolder', name: 'Top Solder Mask', short: 'TS', kind: 'mask', side: 'top', color: '#a040a0' },
  bottomSolder: { id: 'bottomSolder', name: 'Bottom Solder Mask', short: 'BS', kind: 'mask', side: 'bottom', color: '#c040c0' },
  mech1: { id: 'mech1', name: 'Mechanical 1', short: 'M1', kind: 'mech', color: '#e040e0' },
  mech2: { id: 'mech2', name: 'Mechanical 2', short: 'M2', kind: 'mech', color: '#40c040' },
  courtyard: { id: 'courtyard', name: 'Courtyard', short: 'CY', kind: 'mech', color: '#8c8cff' },
  keepout: { id: 'keepout', name: 'Keep-Out', short: 'KO', kind: 'keepout', color: '#ff40a0' },
  multi: { id: 'multi', name: 'Multi-Layer', short: 'ML', kind: 'multi', color: '#c0c0c0' },
  drill: { id: 'drill', name: 'Drill Drawing', short: 'DD', kind: 'drill', color: '#ff7a3a' },
};

/** Layers available on a board with the given copper count (2, 4 or 6). */
export function copperLayers(count = 2) {
  if (count <= 2) return ['top', 'bottom'];
  if (count <= 4) return ['top', 'in1', 'in2', 'bottom'];
  return ['top', 'in1', 'in2', 'in3', 'in4', 'bottom'];
}

export function boardLayers(count = 2) {
  return [
    ...copperLayers(count),
    'topOverlay', 'bottomOverlay', 'topPaste', 'bottomPaste', 'topSolder', 'bottomSolder',
    'mech1', 'mech2', 'courtyard', 'keepout', 'multi', 'drill',
  ];
}

export const isCopper = (layer) => LAYERS[layer]?.kind === 'copper';

/** The layer that a top-side layer maps to when a footprint is flipped. */
const FLIP = {
  top: 'bottom', bottom: 'top', topOverlay: 'bottomOverlay', bottomOverlay: 'topOverlay',
  topPaste: 'bottomPaste', bottomPaste: 'topPaste', topSolder: 'bottomSolder', bottomSolder: 'topSolder',
};
export const flipLayer = (layer) => FLIP[layer] ?? layer;

/**
 * Copper layers spanned by a via or through-hole pad on a board with the
 * given copper count.
 */
export function spanLayers(from, to, count = 2) {
  const list = copperLayers(count);
  const a = list.indexOf(from), b = list.indexOf(to);
  if (a < 0 || b < 0) return list;
  return list.slice(Math.min(a, b), Math.max(a, b) + 1);
}
