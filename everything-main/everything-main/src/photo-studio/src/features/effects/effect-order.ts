// Effects in Layer Style dialog order, with their names (menus, Layers
// panel rows and the dialog share them).
export type Single = 'outerGlow' | 'innerGlow' | 'bevel' | 'satin' | 'patternOverlay';
export type Multi = 'dropShadow' | 'innerShadow' | 'colorOverlay' | 'gradientOverlay' | 'stroke';
export const effectOrder: { key: Single | Multi | 'blending'; label: string; multi?: boolean }[] = [
  { key: 'blending', label: 'Blending Options' },
  { key: 'bevel', label: 'Bevel & Emboss' },
  { key: 'stroke', label: 'Stroke', multi: true },
  { key: 'innerShadow', label: 'Inner Shadow', multi: true },
  { key: 'innerGlow', label: 'Inner Glow' },
  { key: 'satin', label: 'Satin' },
  { key: 'colorOverlay', label: 'Color Overlay', multi: true },
  { key: 'gradientOverlay', label: 'Gradient Overlay', multi: true },
  { key: 'patternOverlay', label: 'Pattern Overlay' },
  { key: 'outerGlow', label: 'Outer Glow' },
  { key: 'dropShadow', label: 'Drop Shadow', multi: true },
];
export const effectLabels: Record<string, string> = Object.fromEntries(effectOrder.map((o) => [o.key, o.label]));
