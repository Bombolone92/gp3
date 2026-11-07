/**
 * Render geometry shared by the SVG and PDF writers: shapes as they render
 * (with live geometry effects such as Round Corners applied) and radial
 * gradient frames (elliptical gradients with an aspect ratio).
 */
import { effectiveSubpaths, hasGeomEffects } from '../../model/geom-effects.js';
import { gradientGeometry } from '../../model/geometry.js';

/** Subpaths of a path or compound as rendered (geometry effects applied). */
export function renderSubpaths(doc, node) {
  if (node.type !== 'path' && node.type !== 'compound') return [];
  return effectiveSubpaths(doc, node);
}

/** Whether a shape's rendered outline differs from its anchors (so it cannot export as a primitive). */
export function hasRoundCorners(node) {
  return hasGeomEffects(node);
}

export function isElliptical(paint) {
  return Boolean(paint && paint.type === 'radial' && paint.aspect != null && paint.aspect > 0 && Math.abs(paint.aspect - 1) > 1e-3);
}

/**
 * Radial gradient frame like the canvas renderer: center, radius along the
 * gradient direction, rotation (radians) and aspect (perpendicular radius / radius).
 */
export function radialFrame(paint, bounds) {
  const g = gradientGeometry(paint, bounds);
  const angle = paint.x1 !== undefined ? Math.atan2(g.y2 - g.y1, g.x2 - g.x1) : (-(paint.angle || 0) * Math.PI) / 180;
  return { cx: g.x1, cy: g.y1, r: Math.max(g.r, 1e-4), angle, aspect: isElliptical(paint) ? paint.aspect : 1 };
}
