/**
 * Smooth slow motion for video clips played slower than 1x. Slowed footage
 * repeats each source frame several times; with this on, the frames in
 * between are made up from the two source frames around the wanted time:
 *   clip.smoothSlow = 'blend'  cross-fade the two frames by the position
 *                     'flow'   estimate the motion between them and move
 *                              both toward the in-between time (see
 *                              engine/slow-motion.js)
 * Absent means off. It only acts where the clip is slower than 1x (its
 * constant speed, or the parts of a speed curve below 1x); elsewhere the
 * clip shows its source frames as usual.
 *
 * Pure functions; no DOM.
 */
import { hasCurve, curveTable, speedAt } from './speed-curve.js';

export const SMOOTH_SLOW_MODES = [
  { id: 'off', label: 'Off' },
  { id: 'blend', label: 'Frame blending' },
  { id: 'flow', label: 'Optical flow' },
];

/** Speeds this close to 1x count as normal speed (float noise in curves). */
const NORMAL = 1 - 1e-6;
/** Positions this close to a source frame show that frame as it is. */
export const FRAME_SNAP = 1e-3;

/** Stored value for a saved one: 'blend', 'flow' or null (off). */
export function normalizeSmoothSlow(v) {
  return v === 'blend' || v === 'flow' ? v : null;
}

/** Whether a clip plays slower than 1x anywhere (the option is offered then). */
export function slowsDown(clip) {
  if (!clip || clip.type !== 'video' || clip.freeze) return false;
  if (hasCurve(clip)) return curveTable(clip.speedCurve).vmin < NORMAL;
  return (clip.speed || 1) < NORMAL;
}

/**
 * Interpolation mode at clip-local time (us), or null where the clip shows
 * plain source frames: option off, not a slowed video clip, or this moment
 * of a speed curve at 1x or faster.
 */
export function smoothSlowAt(clip, local) {
  const mode = normalizeSmoothSlow(clip?.smoothSlow);
  if (!mode || !slowsDown(clip)) return null;
  return speedAt(clip, local) < NORMAL ? mode : null;
}

/**
 * Position of source time sec between the frames shown at a and b (their
 * timestamps, a < b), 0 at a and 1 at b. Clamped; 0 when the span is empty.
 */
export function framePosition(sec, a, b) {
  if (!(b > a)) return 0;
  return Math.min(1, Math.max(0, (sec - a) / (b - a)));
}

/** Whether a position needs an in-between frame (not on a source frame). */
export const needsBetween = (frac) => frac > FRAME_SNAP && frac < 1 - FRAME_SNAP;
