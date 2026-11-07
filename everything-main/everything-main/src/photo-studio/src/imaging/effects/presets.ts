import { findContour, type Contour } from './contour';
import type { LayerStyle } from './types';

// Original layer style presets designed for this project.
const contour = (name: string) => findContour(name) as Contour;
export type StylePreset = { id: string; name: string; style: LayerStyle };

export const stylePresets: StylePreset[] = [
  {
    id: 'soft-shadow', name: 'Soft Shadow',
    style: {
      enabled: true, globalAngle: 120,
      dropShadow: [{ enabled: true, blendMode: 'multiply', opacity: 0.4, color: [0, 0, 0], angle: 120, useGlobalLight: true, distance: 8, spread: 0, size: 18, knockout: true }],
    },
  },
  {
    id: 'lifted-card', name: 'Lifted Card',
    style: {
      enabled: true, globalAngle: 90,
      dropShadow: [
        { enabled: true, blendMode: 'multiply', opacity: 0.22, color: [20, 24, 40], angle: 90, useGlobalLight: true, distance: 2, spread: 0, size: 4, knockout: true },
        { enabled: true, blendMode: 'multiply', opacity: 0.2, color: [20, 24, 40], angle: 90, useGlobalLight: true, distance: 14, spread: 0, size: 30, knockout: true },
      ],
    },
  },
  {
    id: 'neon-glow', name: 'Neon Glow',
    style: {
      enabled: true,
      outerGlow: { enabled: true, blendMode: 'screen', opacity: 0.85, fill: { type: 'color', color: [40, 255, 220] }, technique: 'softer', spread: 0.1, size: 26, range: 0.5, jitter: 0 },
      innerGlow: { enabled: true, blendMode: 'screen', opacity: 0.7, fill: { type: 'color', color: [220, 255, 250] }, technique: 'softer', spread: 0, size: 6, range: 0.5, jitter: 0, source: 'edge' },
      colorOverlay: [{ enabled: true, blendMode: 'normal', opacity: 1, color: [20, 210, 190] }],
      stroke: [{ enabled: true, blendMode: 'screen', opacity: 0.9, size: 2, position: 'center', fill: { type: 'color', color: [190, 255, 245] } }],
    },
  },
  {
    id: 'embossed', name: 'Embossed',
    style: {
      enabled: true, globalAngle: 135, globalAltitude: 35,
      bevel: {
        enabled: true, style: 'emboss', technique: 'smooth', depth: 1.4, direction: 'up', size: 7, soften: 1,
        angle: 135, altitude: 35, useGlobalLight: true, highlightMode: 'screen', highlightColor: [255, 255, 255],
        highlightOpacity: 0.8, shadowMode: 'multiply', shadowColor: [30, 25, 20], shadowOpacity: 0.7,
      },
    },
  },
  {
    id: 'outline', name: 'Outline',
    style: { enabled: true, stroke: [{ enabled: true, blendMode: 'normal', opacity: 1, size: 3, position: 'outside', fill: { type: 'color', color: [17, 17, 17] } }] },
  },
  {
    id: 'glass-button', name: 'Glass Button',
    style: {
      enabled: true, globalAngle: 90, globalAltitude: 60,
      dropShadow: [{ enabled: true, blendMode: 'multiply', opacity: 0.35, color: [0, 30, 70], angle: 90, useGlobalLight: true, distance: 4, spread: 0, size: 10, knockout: true }],
      gradientOverlay: [{
        enabled: true, blendMode: 'screen', opacity: 0.55, style: 'linear', angle: 90, scale: 1, alignWithLayer: true,
        gradient: {
          kind: 'solid', smoothness: 100,
          colorStops: [{ location: 0, color: [255, 255, 255] }, { location: 1, color: [255, 255, 255] }],
          opacityStops: [{ location: 0, opacity: 0 }, { location: 0.48, opacity: 0.1 }, { location: 0.52, opacity: 0.75 }, { location: 1, opacity: 0.35 }],
        },
      }],
      innerGlow: { enabled: true, blendMode: 'screen', opacity: 0.4, fill: { type: 'color', color: [200, 235, 255] }, technique: 'softer', spread: 0, size: 12, range: 0.5, jitter: 0, source: 'edge' },
      bevel: {
        enabled: true, style: 'inner-bevel', technique: 'smooth', depth: 1, direction: 'up', size: 10, soften: 2,
        angle: 90, altitude: 60, useGlobalLight: true, glossContour: contour('Half Round'), highlightMode: 'screen',
        highlightColor: [255, 255, 255], highlightOpacity: 0.6, shadowMode: 'multiply', shadowColor: [0, 40, 90], shadowOpacity: 0.35,
      },
      stroke: [{ enabled: true, blendMode: 'normal', opacity: 0.5, size: 1, position: 'inside', fill: { type: 'color', color: [0, 50, 110] } }],
    },
  },
  {
    id: 'letterpress', name: 'Letterpress',
    style: {
      enabled: true, globalAngle: 90,
      dropShadow: [{ enabled: true, blendMode: 'screen', opacity: 0.6, color: [255, 255, 255], angle: 90, useGlobalLight: true, distance: 1, spread: 0, size: 1, knockout: true }],
      innerShadow: [{ enabled: true, blendMode: 'multiply', opacity: 0.55, color: [0, 0, 0], angle: 90, useGlobalLight: true, distance: 2, spread: 0, size: 3 }],
    },
  },
  {
    id: 'gold-foil', name: 'Gold Foil',
    style: {
      enabled: true, globalAngle: 120, globalAltitude: 40,
      gradientOverlay: [{
        enabled: true, blendMode: 'normal', opacity: 1, style: 'linear', angle: 70, scale: 1, alignWithLayer: true,
        gradient: {
          kind: 'solid', smoothness: 100,
          colorStops: [
            { location: 0, color: [122, 82, 24] }, { location: 0.3, color: [230, 190, 92] }, { location: 0.5, color: [255, 238, 170] },
            { location: 0.7, color: [205, 150, 58] }, { location: 1, color: [140, 96, 30] },
          ],
          opacityStops: [{ location: 0, opacity: 1 }, { location: 1, opacity: 1 }],
        },
      }],
      satin: { enabled: true, blendMode: 'overlay', opacity: 0.3, color: [255, 240, 200], angle: 30, distance: 9, size: 12, invert: false, contour: contour('Soft Bell') },
      bevel: {
        enabled: true, style: 'inner-bevel', technique: 'chisel-hard', depth: 1.2, direction: 'up', size: 4, soften: 0,
        angle: 120, altitude: 40, useGlobalLight: true, glossContour: contour('Ring'), glossAntiAliased: true,
        highlightMode: 'screen', highlightColor: [255, 248, 220], highlightOpacity: 0.85, shadowMode: 'multiply', shadowColor: [90, 50, 10], shadowOpacity: 0.6,
      },
      dropShadow: [{ enabled: true, blendMode: 'multiply', opacity: 0.35, color: [40, 25, 0], angle: 120, useGlobalLight: true, distance: 3, spread: 0, size: 6, knockout: true }],
    },
  },
  {
    id: 'sticker', name: 'Sticker',
    style: {
      enabled: true, globalAngle: 110,
      dropShadow: [{ enabled: true, blendMode: 'multiply', opacity: 0.3, color: [0, 0, 0], angle: 110, useGlobalLight: true, distance: 4, spread: 0, size: 8, knockout: true }],
      stroke: [{ enabled: true, blendMode: 'normal', opacity: 1, size: 10, position: 'outside', fill: { type: 'color', color: [255, 255, 255] } }],
    },
  },
  {
    id: 'chrome', name: 'Chrome',
    style: {
      enabled: true, globalAngle: 100, globalAltitude: 45,
      gradientOverlay: [{
        enabled: true, blendMode: 'normal', opacity: 1, style: 'linear', angle: 90, scale: 1, alignWithLayer: true, method: 'classic',
        gradient: {
          kind: 'solid', smoothness: 60,
          colorStops: [
            { location: 0, color: [40, 44, 52] }, { location: 0.45, color: [235, 240, 245] }, { location: 0.5, color: [90, 96, 108] },
            { location: 0.75, color: [180, 188, 198] }, { location: 1, color: [250, 252, 255] },
          ],
          opacityStops: [{ location: 0, opacity: 1 }, { location: 1, opacity: 1 }],
        },
      }],
      bevel: {
        enabled: true, style: 'inner-bevel', technique: 'smooth', depth: 2, direction: 'up', size: 6, soften: 0,
        angle: 100, altitude: 45, useGlobalLight: true, glossContour: contour('Rolling Slope'), highlightMode: 'screen',
        highlightColor: [255, 255, 255], highlightOpacity: 0.9, shadowMode: 'multiply', shadowColor: [0, 0, 0], shadowOpacity: 0.6,
      },
      stroke: [{
        enabled: true, blendMode: 'normal', opacity: 1, size: 2, position: 'outside',
        fill: {
          type: 'gradient', style: 'linear', angle: 90, scale: 1, alignWithLayer: true,
          gradient: { kind: 'solid', colorStops: [{ location: 0, color: [70, 74, 82] }, { location: 1, color: [210, 216, 224] }], opacityStops: [{ location: 0, opacity: 1 }, { location: 1, opacity: 1 }] },
        },
      }],
    },
  },
  {
    id: 'retro-offset', name: 'Retro Offset',
    style: {
      enabled: true,
      dropShadow: [{ enabled: true, blendMode: 'normal', opacity: 1, color: [255, 90, 120], angle: 135, useGlobalLight: false, distance: 7, spread: 0, size: 0, knockout: true }],
      stroke: [{ enabled: true, blendMode: 'normal', opacity: 1, size: 2, position: 'outside', fill: { type: 'color', color: [30, 20, 60] } }],
    },
  },
  {
    id: 'stamped-paper', name: 'Stamped Paper',
    style: {
      enabled: true, globalAngle: 120, globalAltitude: 30,
      patternOverlay: { enabled: true, blendMode: 'multiply', opacity: 0.6, patternId: 'paper', scale: 1, linkWithLayer: true },
      bevel: {
        enabled: true, style: 'pillow-emboss', technique: 'smooth', depth: 1, direction: 'up', size: 5, soften: 0,
        angle: 120, altitude: 30, useGlobalLight: true, highlightMode: 'screen', highlightColor: [255, 255, 255],
        highlightOpacity: 0.6, shadowMode: 'multiply', shadowColor: [40, 30, 20], shadowOpacity: 0.5,
        texture: { patternId: 'canvas', scale: 1, depth: 0.6, linkWithLayer: true },
      },
    },
  },
];
// A deep copy safe to edit.
export function stylePreset(id: string): LayerStyle | undefined {
  const p = stylePresets.find((s) => s.id === id);
  return p ? structuredClone(p.style) : undefined;
}
