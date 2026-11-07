// Canvas color schemes for each theme. Interface chrome colors live in CSS;
// these are the drawing colors used by the WebGL scenes and exporters.

import { LAYERS } from '../model/layers.js';
import { toVec4 } from './color.js';

export const SCH_PALETTES = {
  light: {
    background: '#d9d9d6', paper: '#fdfcf7', border: '#5b5b5b', zoneText: '#5b5b5b', titleText: '#2a2a2a', titleValue: '#1f3fa6',
    gridMinor: '#00000012', gridMajor: '#0000001f',
    wire: '#1f4fd1', bus: '#163a9c', junction: '#1f4fd1',
    body: '#8c2f1c', bodyFill: '#fff6c7', pin: '#2e2e2e', pinName: '#2e2e2e', pinNum: '#555555',
    designator: '#1b3a8a', value: '#3a3a3a', label: '#1a1a1a', power: '#8c2f1c',
    portFill: '#fff0a6', portStroke: '#8c2f1c', portText: '#1a1a1a', noerc: '#d32f2f', text: '#1a1a1a', graphic: '#3a3a3a',
    selection: '#0a84ff', highlight: '#ff8a00', preview: '#0a84ff', crosshair: '#0a84ff', ercError: '#e5484d', ercWarning: '#d79b00',
  },
  dark: {
    background: '#141518', paper: '#1d1f24', border: '#8a8f99', zoneText: '#8a8f99', titleText: '#c9ccd3', titleValue: '#8ab4ff',
    gridMinor: '#ffffff0d', gridMajor: '#ffffff1a',
    wire: '#5ea2ff', bus: '#86b8ff', junction: '#5ea2ff',
    body: '#e39a6c', bodyFill: '#2e2a22', pin: '#c4c7ce', pinName: '#c4c7ce', pinNum: '#8d929c',
    designator: '#8ab4ff', value: '#b9bdc6', label: '#e8e9ec', power: '#ff9a7a',
    portFill: '#3a3420', portStroke: '#e39a6c', portText: '#e8e9ec', noerc: '#ff6b6b', text: '#e1e3e8', graphic: '#aeb3bd',
    selection: '#4aa8ff', highlight: '#ffad4a', preview: '#4aa8ff', crosshair: '#4aa8ff', ercError: '#ff6b6b', ercWarning: '#f5c04a',
  },
};

export const PCB_PALETTES = {
  light: {
    background: '#cfd0cc', boardFill: '#0d0d0d', boardEdge: '#e8d000', cutout: '#cfd0cc',
    gridMinor: '#ffffff16', gridMajor: '#ffffff2a',
    hole: '#2b2b2b', holeEdge: '#7a7a7a', via: '#a8a8a8', multi: '#b4b4b4', ratsnest: '#e6e6e6',
    selection: '#ffffff', highlight: '#ffffff', drcError: '#00ff4c', preview: '#ffffff', crosshair: '#ffffff', padText: '#ffffff',
  },
  dark: {
    background: '#232323', boardFill: '#000000', boardEdge: '#e8d000', cutout: '#232323',
    gridMinor: '#ffffff14', gridMajor: '#ffffff26',
    hole: '#2b2b2b', holeEdge: '#7a7a7a', via: '#a8a8a8', multi: '#b4b4b4', ratsnest: '#e6e6e6',
    selection: '#ffffff', highlight: '#ffffff', drcError: '#00ff4c', preview: '#ffffff', crosshair: '#ffffff', padText: '#ffffff',
  },
};

/** Layer colors with user overrides. */
export function layerColor(layer, overrides) {
  return overrides?.[layer] || LAYERS[layer]?.color || '#888888';
}

export const vec4 = toVec4;
