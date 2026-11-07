// Small builders shared by the model and engine tests. Times are written in
// seconds through s() so expectations read like the timeline.
import { US } from '../src/lib/time.js';
import { createProject, makeClip, normalizeAsset } from '../src/model/project.js';
import { mainTrack } from '../src/model/timeline.js';

export const s = (seconds) => Math.round(seconds * US);

/** A fresh project with one asset per kind (10 s video with audio, 10 s audio, an image). */
export function fixture() {
  const p = createProject({ name: 'Test' });
  addAsset(p, { id: 'vid', kind: 'video', duration: s(10), hasAudio: true, width: 1920, height: 1080 });
  addAsset(p, { id: 'silent', kind: 'video', duration: s(10), hasAudio: false, width: 1280, height: 720 });
  addAsset(p, { id: 'aud', kind: 'audio', duration: s(30), hasAudio: true });
  addAsset(p, { id: 'img', kind: 'image', width: 800, height: 600 });
  return p;
}

export function addAsset(p, fields) {
  const a = normalizeAsset({ name: fields.id, ...fields });
  p.assets[a.id] = a;
  return a;
}

/** A clip of type with start/duration in seconds; media clips default to the matching fixture asset. */
export function clip(type, start, duration, fields = {}) {
  const assetId = { video: 'vid', audio: 'aud', image: 'img' }[type];
  return makeClip(type, { ...(assetId ? { assetId } : {}), start: s(start), duration: s(duration), ...fields });
}

/** Put clips on the base track (sorted, no ripple), returning them. */
export function onMain(p, ...clips) {
  const main = mainTrack(p);
  main.clips.push(...clips);
  main.clips.sort((a, b) => a.start - b.start);
  return clips;
}

/** [start, duration] pairs in seconds for a track, for compact expectations. */
export const spans = (track) => track.clips.map((c) => [c.start / US, c.duration / US]);

export const kinds = (p) => p.tracks.map((t) => (t.main ? 'main' : t.kind));

/** Track holding the clip id. */
export const trackOf = (p, id) => p.tracks.find((t) => t.clips.some((c) => c.id === id));

/** True when no two clips on any track overlap. */
export function noOverlaps(p) {
  for (const t of p.tracks) {
    const cs = [...t.clips].sort((a, b) => a.start - b.start);
    for (let i = 1; i < cs.length; i++) if (cs[i].start < cs[i - 1].start + cs[i - 1].duration - 1) return false;
  }
  return true;
}
