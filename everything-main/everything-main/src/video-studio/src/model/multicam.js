/**
 * Multi-camera clips: several recordings of the same moment, lined up and
 * nested into one compound clip whose angle tracks (track.angle) are the
 * cameras. Only one angle shows at a time; the clip keeps the switches as
 *
 *   clip.multicam = { cuts: [{ t, angle }], audio: angleIndex | 'follow' }
 *
 * with t in the clip's inner time (the nested timeline, as clip.in) and
 * angle an index into angleTracks(clip). The first cut is always at 0, so
 * every inner time has exactly one active angle. Sound comes from one
 * chosen angle, or from whichever angle is showing ('follow').
 *
 * The cut functions are pure: they take a multicam object and return a
 * new, normalized one. Creating and flattening the clip are in
 * multicam-edit.js.
 */

// One frame at 60 fps, as MIN_CLIP in timeline.js (not imported: project.js uses this module).
const MIN_GAP = 16_667;

export const MAX_ANGLES = 9;
export const MIN_ANGLES = 2;

export const isMulticam = (c) => c?.type === 'compound' && Boolean(c.multicam);

/** Nested tracks that are camera angles, in angle order. */
export function angleTracks(clip) {
  return clip?.sequence?.tracks.filter((t) => t.angle) || [];
}

/** Display name of angle i. */
export function angleName(clip, i) {
  return angleTracks(clip)[i]?.name || `Angle ${i + 1}`;
}

/**
 * Validate untrusted multicam data for a clip with `count` angles and an
 * inner timeline `length` long: cuts sorted, one per time, inside the
 * timeline, naming real angles, the first at 0, and no cut that keeps the
 * angle already showing.
 */
export function normalizeMulticam(raw, count, length = Infinity) {
  const n = Math.max(1, Math.floor(count) || 1);
  const last = Number.isFinite(length) ? Math.max(0, Math.round(length) - 1) : Infinity;
  const list = (Array.isArray(raw?.cuts) ? raw.cuts : [])
    .filter((c) => c && Number.isFinite(Number(c.t)) && Number.isInteger(Number(c.angle)) && Number(c.angle) >= 0 && Number(c.angle) < n)
    .map((c) => ({ t: Math.min(last, Math.max(0, Math.round(Number(c.t)))), angle: Number(c.angle) }))
    .sort((a, b) => a.t - b.t)
    .slice(0, 10_000);
  const cuts = [];
  for (const c of list) {
    // A later cut at the same time wins.
    if (cuts.length && cuts.at(-1).t === c.t) cuts.pop();
    if (cuts.length && cuts.at(-1).angle === c.angle) continue;
    cuts.push(c);
  }
  if (!cuts.length) cuts.push({ t: 0, angle: 0 });
  // Before the first cut, its angle shows.
  cuts[0] = { ...cuts[0], t: 0 };
  // Moving the first cut to 0 can leave two in a row on one angle.
  const merged = cuts.filter((c, i) => i === 0 || c.angle !== cuts[i - 1].angle);
  const a = raw?.audio;
  const audio = a === 'follow' ? 'follow' : Number.isInteger(a) && a >= 0 && a < n ? a : 0;
  return { cuts: merged, audio };
}

/** Angle showing at inner time t. */
export function angleAt(mc, t) {
  let angle = mc.cuts[0]?.angle ?? 0;
  for (const c of mc.cuts) {
    if (c.t > t) break;
    angle = c.angle;
  }
  return angle;
}

/** Runs of one angle covering inner [lo, hi): [{ a, b, angle }]. */
export function segments(mc, lo, hi) {
  const out = [];
  mc.cuts.forEach((c, i) => {
    const a = Math.max(lo, c.t);
    const b = Math.min(hi, mc.cuts[i + 1]?.t ?? Infinity);
    if (b > a) out.push({ a, b, angle: c.angle });
  });
  return out;
}

/** Inner [a, b) ranges where an angle shows, within [lo, hi). */
export function activeRanges(mc, angle, lo, hi) {
  return segments(mc, lo, hi).filter((s) => s.angle === angle).map((s) => [s.a, s.b]);
}

const keep = (mc, cuts, audio = mc.audio) => ({ cuts, audio });

/**
 * Show `angle` from inner time t until the next cut (live switching):
 * replaces a cut at t or adds one. count is the number of angles.
 */
export function switchAngle(mc, t, angle, count, length) {
  const at = Math.max(0, Math.round(t));
  const cuts = mc.cuts.filter((c) => c.t !== at);
  cuts.push({ t: at, angle });
  return normalizeMulticam(keep(mc, cuts), count, length);
}

/** Remove the cut at t: the angle before it carries on. The cut at 0 goes only when another follows. */
export function removeCut(mc, t, count, length) {
  if (mc.cuts.length < 2) return mc;
  return normalizeMulticam(keep(mc, mc.cuts.filter((c) => c.t !== t)), count, length);
}

/** Move the cut at `from` to `to`, kept at least a frame away from its neighbours. The first cut stays at 0. */
export function moveCut(mc, from, to, count, length) {
  const i = mc.cuts.findIndex((c) => c.t === from);
  if (i <= 0) return mc;
  const lo = mc.cuts[i - 1].t + MIN_GAP;
  const hi = (mc.cuts[i + 1]?.t ?? (Number.isFinite(length) ? length : Infinity)) - MIN_GAP;
  if (hi < lo) return mc;
  const cuts = mc.cuts.map((c, j) => (j === i ? { ...c, t: Math.round(Math.min(hi, Math.max(lo, to))) } : c));
  return normalizeMulticam(keep(mc, cuts), count, length);
}

/** Sound from one angle (index) or from the angle showing ('follow'). */
export function setAudioSource(mc, audio, count) {
  return normalizeMulticam(keep(mc, mc.cuts, audio), count);
}

/** Cuts that fall inside the part of the clip on the timeline (the first one excluded). */
export function visibleCuts(clip) {
  const lo = clip.in;
  const hi = clip.in + clip.duration;
  return (clip.multicam?.cuts || []).filter((c) => c.t > lo && c.t < hi);
}

/** Bring a clip's multicam data in line with its angle tracks, or drop it when none are left. */
export function fitMulticam(clip) {
  if (!clip.multicam) return clip;
  const n = angleTracks(clip).length;
  if (!n) delete clip.multicam;
  else {
    let len = 0;
    for (const t of clip.sequence.tracks) for (const c of t.clips) len = Math.max(len, c.start + c.duration);
    clip.multicam = normalizeMulticam(clip.multicam, n, len);
  }
  return clip;
}
