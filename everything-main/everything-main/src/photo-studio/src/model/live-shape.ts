// Parameters of a live shape, in the same (reference) space as the layer's
// knots, so a rectangle stays editable as a rectangle until its anchors are
// edited directly. Knots remain the source of truth for rendering and export.
export type LiveShape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; radii: [number, number, number, number] }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
  | { kind: 'triangle'; x: number; y: number; width: number; height: number; radius: number }
  | { kind: 'polygon'; x: number; y: number; width: number; height: number; sides: number; star: number; radius: number; smoothIndents: boolean }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; weight: number; arrowStart: boolean; arrowEnd: boolean; arrowWidth: number; arrowLength: number; concavity: number };

const finite = (...values: unknown[]) => values.every((v) => typeof v === 'number' && Number.isFinite(v));

export function validateLiveShape(live: LiveShape) {
  const ok = (() => {
    if (!live || typeof live !== 'object') return false;
    switch (live.kind) {
      case 'rect':
        return finite(live.x, live.y, live.width, live.height) && live.width >= 0 && live.height >= 0 &&
          Array.isArray(live.radii) && live.radii.length === 4 && live.radii.every((r) => finite(r) && r >= 0);
      case 'ellipse':
        return finite(live.x, live.y, live.width, live.height) && live.width >= 0 && live.height >= 0;
      case 'triangle':
        return finite(live.x, live.y, live.width, live.height, live.radius) && live.width >= 0 && live.height >= 0 && live.radius >= 0;
      case 'polygon':
        return finite(live.x, live.y, live.width, live.height, live.sides, live.star, live.radius) &&
          Number.isInteger(live.sides) && live.sides >= 3 && live.sides <= 100 && live.star >= 0 && live.star < 1 &&
          live.radius >= 0 && typeof live.smoothIndents === 'boolean';
      case 'line':
        return finite(live.x1, live.y1, live.x2, live.y2, live.weight, live.arrowWidth, live.arrowLength, live.concavity) &&
          live.weight > 0 && live.arrowWidth > 0 && live.arrowLength > 0 && Math.abs(live.concavity) <= 0.5 &&
          typeof live.arrowStart === 'boolean' && typeof live.arrowEnd === 'boolean';
      default:
        return false;
    }
  })();
  if (!ok) throw new Error('Invalid live shape parameters.');
}
