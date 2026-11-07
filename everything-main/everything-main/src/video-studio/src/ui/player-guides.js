/**
 * Pure helpers for the player's snapping, rulers and safe-zone overlays.
 */

/**
 * Snap one axis: given the moving box's positions (edges and center) and
 * the target positions, the smallest offset that lines one of them up
 * within tolerance, as { delta, at } (at = the target position), or null.
 */
export function snapAxis(moving, targets, tolerance) {
  let best = null;
  for (const m of moving) {
    for (const t of targets) {
      const d = t - m;
      if (Math.abs(d) <= tolerance && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t };
    }
  }
  return best;
}

/** Ruler label step in project pixels so labels sit at least ~60 css px apart. */
export function rulerStep(cssPerPx, minCss = 60) {
  for (const s of [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000]) if (s * cssPerPx >= minCss) return s;
  return 10000;
}

/**
 * Overlays that show where text stays readable. Regions are fractions of the
 * frame: 'safe' frames mark the area to keep content inside, 'ui' regions
 * shade where a phone app's interface usually covers the video.
 */
export const SAFE_ZONES = [
  { id: 'none', label: 'None', regions: [] },
  {
    id: 'broadcast',
    label: 'Action and title safe',
    regions: [
      { kind: 'safe', x: 0.05, y: 0.05, w: 0.9, h: 0.9, label: 'Action safe' },
      { kind: 'safe inner', x: 0.1, y: 0.1, w: 0.8, h: 0.8, label: 'Title safe' },
    ],
  },
  {
    id: 'vertical',
    label: 'Vertical short video',
    regions: [
      { kind: 'ui', x: 0, y: 0, w: 1, h: 0.1, label: 'Top bar' },
      { kind: 'ui', x: 0, y: 0.74, w: 0.8, h: 0.26, label: 'Caption and account' },
      { kind: 'ui', x: 0.84, y: 0.42, w: 0.16, h: 0.58, label: 'Buttons' },
      { kind: 'safe', x: 0.06, y: 0.12, w: 0.76, h: 0.6 },
    ],
  },
  {
    id: 'story',
    label: 'Vertical story',
    regions: [
      { kind: 'ui', x: 0, y: 0, w: 1, h: 0.14, label: 'Profile and progress' },
      { kind: 'ui', x: 0, y: 0.86, w: 1, h: 0.14, label: 'Reply bar' },
      { kind: 'safe', x: 0.06, y: 0.16, w: 0.88, h: 0.68 },
    ],
  },
  {
    id: 'feed',
    label: 'Square and feed posts',
    regions: [
      { kind: 'safe', x: 0.08, y: 0.08, w: 0.84, h: 0.84, label: 'Keep text inside' },
    ],
  },
];
