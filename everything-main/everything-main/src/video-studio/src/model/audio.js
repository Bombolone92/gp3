/**
 * Audio settings on clips (model side, no DSP): the per-clip sound effects,
 * the pitch option for speed changes and detected beats.
 *
 * Fields on audio and video clips, all optional so older projects load as is:
 *   keepPitch: false        speed changes shift pitch (absent = pitch kept)
 *   beats: [us]             detected beats in SOURCE time, so they follow
 *                           trims, splits and speed changes for free
 *   audioFx: {
 *     normalize: { on, target (LUFS), loudness (measured LUFS or null) },
 *     denoise:   { on, amount 0..100, profile: [dB per band] | null },
 *     enhance:   { on, amount 0..100 },
 *     separate:  { on, mode: 'voice'|'music', amount 0..100 }  keep the voice or the music of a mix
 *     pan:       { on, value -100..100 },
 *     channel:   { on, mode: 'stereo'|'left'|'right'|'swap'|'mono' },
 *     voice:     { id, params: { [key]: number } } | null,
 *   }
 */
import { US } from '../lib/time.js';
import { hasCurve, isFlatCurve, localAtSource, sourceSpan } from './speed-curve.js';

export const LOUDNESS_TARGETS = [
  { value: -23, label: '−23 LUFS (broadcast)' },
  { value: -16, label: '−16 LUFS (podcast)' },
  { value: -14, label: '−14 LUFS (online video)' },
  { value: -11, label: '−11 LUFS (loud)' },
];
export const DEFAULT_LOUDNESS_TARGET = -14;
/** Normalization never moves a clip by more than this many dB. */
export const NORMALIZE_LIMIT_DB = 24;

export const CHANNEL_MODES = [
  { id: 'stereo', label: 'Stereo' },
  { id: 'left', label: 'Left only' },
  { id: 'right', label: 'Right only' },
  { id: 'swap', label: 'Swap' },
  { id: 'mono', label: 'Mono' },
];

/** Bands of a stored noise profile (log spaced, Hz). Band b covers [EDGES[b], EDGES[b+1]). */
export const NOISE_BANDS = 32;
export const NOISE_BAND_EDGES = (() => {
  const out = [0];
  for (let b = 1; b < NOISE_BANDS; b++) out.push(40 * (20000 / 40) ** ((b - 1) / (NOISE_BANDS - 2)));
  out.push(Infinity);
  return out;
})();

/**
 * Voice presets. params: up to two adjustable values each, by key.
 * The DSP for each id lives in media/audio-fx.js.
 */
export const VOICE_PRESETS = [
  { id: 'low', label: 'Low Voice', hue: 220, params: [{ key: 'pitch', label: 'Pitch', min: -12, max: 0, step: 0.5, unit: 'st', def: -4 }] },
  { id: 'high', label: 'High Voice', hue: 300, params: [{ key: 'pitch', label: 'Pitch', min: 0, max: 12, step: 0.5, unit: 'st', def: 4 }] },
  { id: 'squeaky', label: 'Squeaky', hue: 330, params: [{ key: 'pitch', label: 'Pitch', min: 5, max: 12, step: 0.5, unit: 'st', def: 9 }] },
  { id: 'giant', label: 'Giant', hue: 15, params: [{ key: 'pitch', label: 'Pitch', min: -12, max: -4, step: 0.5, unit: 'st', def: -8 }, { key: 'grit', label: 'Growl', min: 0, max: 100, def: 40, unit: '%' }] },
  { id: 'android', label: 'Android', hue: 190, params: [{ key: 'tone', label: 'Tone', min: 30, max: 200, def: 80, unit: 'Hz' }, { key: 'mix', label: 'Amount', min: 0, max: 100, def: 80, unit: '%' }] },
  { id: 'phone', label: 'Phone Call', hue: 40, params: [{ key: 'grit', label: 'Grit', min: 0, max: 100, def: 30, unit: '%' }] },
  { id: 'twoway', label: 'Two-Way Radio', hue: 90, params: [{ key: 'grit', label: 'Grit', min: 0, max: 100, def: 60, unit: '%' }, { key: 'hiss', label: 'Hiss', min: 0, max: 100, def: 30, unit: '%' }] },
  { id: 'bullhorn', label: 'Bullhorn', hue: 0, params: [{ key: 'grit', label: 'Drive', min: 0, max: 100, def: 55, unit: '%' }] },
  { id: 'submerged', label: 'Submerged', hue: 200, params: [{ key: 'depth', label: 'Depth', min: 0, max: 100, def: 60, unit: '%' }] },
  { id: 'hall', label: 'Concert Hall', hue: 260, params: [{ key: 'mix', label: 'Amount', min: 0, max: 100, def: 35, unit: '%' }, { key: 'size', label: 'Size', min: 0, max: 100, def: 80, unit: '%' }] },
  { id: 'closet', label: 'Small Room', hue: 30, params: [{ key: 'mix', label: 'Amount', min: 0, max: 100, def: 30, unit: '%' }] },
  { id: 'canyon', label: 'Canyon', hue: 25, params: [{ key: 'time', label: 'Delay', min: 80, max: 800, step: 10, def: 320, unit: 'ms' }, { key: 'feedback', label: 'Repeats', min: 0, max: 90, def: 45, unit: '%' }] },
  { id: 'ensemble', label: 'Ensemble', hue: 160, params: [{ key: 'mix', label: 'Amount', min: 0, max: 100, def: 60, unit: '%' }] },
  { id: 'amradio', label: 'AM Radio', hue: 50, params: [{ key: 'hiss', label: 'Static', min: 0, max: 100, def: 40, unit: '%' }] },
  { id: 'wobble', label: 'Wobble', hue: 120, params: [{ key: 'rate', label: 'Rate', min: 1, max: 12, step: 0.5, def: 6, unit: 'Hz' }, { key: 'depth', label: 'Depth', min: 0, max: 100, def: 50, unit: '%' }] },
  { id: 'lowend', label: 'Low End', hue: 280, params: [{ key: 'boost', label: 'Boost', min: 0, max: 15, step: 0.5, def: 9, unit: 'dB' }] },
  { id: 'spirit', label: 'Spirit', hue: 240, params: [{ key: 'mix', label: 'Amount', min: 0, max: 100, def: 55, unit: '%' }] },
];
export const VOICE_IDS = new Set(VOICE_PRESETS.map((p) => p.id));
export const voicePreset = (id) => VOICE_PRESETS.find((p) => p.id === id) || null;

export function defaultVoiceParams(id) {
  const p = voicePreset(id);
  const out = {};
  for (const d of p?.params || []) out[d.key] = d.def;
  return out;
}

export function defaultAudioFx() {
  return {
    normalize: { on: false, target: DEFAULT_LOUDNESS_TARGET, loudness: null },
    denoise: { on: false, amount: 60, profile: null },
    enhance: { on: false, amount: 50 },
    separate: { on: false, mode: 'voice', amount: 80 },
    pan: { on: false, value: 0 },
    channel: { on: false, mode: 'stereo' },
    voice: null,
  };
}

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, num(v, d)));
const o = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Validate untrusted audioFx JSON. Returns null when nothing is set. */
export function normalizeAudioFx(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const d = defaultAudioFx();
  const n = o(raw.normalize);
  const dn = o(raw.denoise);
  const en = o(raw.enhance);
  const sp = o(raw.separate);
  const pn = o(raw.pan);
  const ch = o(raw.channel);
  const loud = num(n.loudness, null);
  const out = {
    normalize: { on: Boolean(n.on), target: clamp(n.target, -40, -5, d.normalize.target), loudness: loud === null ? null : clamp(loud, -100, 10, null) },
    denoise: {
      on: Boolean(dn.on),
      amount: clamp(dn.amount, 0, 100, d.denoise.amount),
      profile: Array.isArray(dn.profile) && dn.profile.length === NOISE_BANDS ? dn.profile.map((x) => clamp(x, -200, 50, -120)) : null,
    },
    enhance: { on: Boolean(en.on), amount: clamp(en.amount, 0, 100, d.enhance.amount) },
    separate: { on: Boolean(sp.on), mode: sp.mode === 'music' ? 'music' : 'voice', amount: clamp(sp.amount, 0, 100, d.separate.amount) },
    pan: { on: Boolean(pn.on), value: clamp(pn.value, -100, 100, 0) },
    channel: { on: Boolean(ch.on), mode: CHANNEL_MODES.some((m) => m.id === ch.mode) ? ch.mode : 'stereo' },
    voice: null,
  };
  const v = o(raw.voice);
  if (typeof v.id === 'string' && VOICE_IDS.has(v.id)) {
    const params = defaultVoiceParams(v.id);
    for (const def of voicePreset(v.id).params) params[def.key] = clamp(o(v.params)[def.key], def.min, def.max, def.def);
    out.voice = { id: v.id, params };
  }
  return out;
}

/**
 * Copy the audio fields of a raw clip onto a normalized one (normalizeClip
 * calls this for audio and video clips).
 */
export function normalizeAudioFields(raw, out) {
  if (raw.keepPitch === false) out.keepPitch = false;
  const fx = normalizeAudioFx(raw.audioFx);
  if (fx) out.audioFx = fx;
  if (Array.isArray(raw.beats)) {
    const beats = raw.beats.map(Number).filter((t) => Number.isFinite(t) && t >= 0).map(Math.round).sort((a, b) => a - b).slice(0, 5000);
    if (beats.length) out.beats = beats;
  }
  return out;
}

/** True when the clip carries sound settings (audio clips and video clips). */
export const hasSound = (clip) => clip?.type === 'audio' || clip?.type === 'video';

/** Extra linear gain from loudness normalization (1 when off or not measured). */
export function loudnessGain(clip) {
  const n = clip?.audioFx?.normalize;
  if (!n?.on || !Number.isFinite(n.loudness)) return 1;
  const db = Math.max(-NORMALIZE_LIMIT_DB, Math.min(NORMALIZE_LIMIT_DB, n.target - n.loudness));
  return 10 ** (db / 20);
}

/**
 * Settings for the per-clip effect chain (media/audio-fx.js ClipChain), or
 * null when the clip needs none. Plain data so it can cross to a worklet.
 */
export function chainSettings(clip) {
  const fx = clip?.audioFx;
  if (!fx) return null;
  const s = {
    channel: fx.channel?.on && fx.channel.mode !== 'stereo' ? fx.channel.mode : null,
    separate: fx.separate?.on && fx.separate.amount > 0 ? { mode: fx.separate.mode, amount: fx.separate.amount } : null,
    denoise: fx.denoise?.on && fx.denoise.amount > 0 ? { amount: fx.denoise.amount, profile: fx.denoise.profile || null } : null,
    enhance: fx.enhance?.on && fx.enhance.amount > 0 ? { amount: fx.enhance.amount } : null,
    voice: fx.voice ? { id: fx.voice.id, params: { ...fx.voice.params } } : null,
    pan: fx.pan?.on && fx.pan.value !== 0 ? fx.pan.value : null,
  };
  return s.channel || s.separate || s.denoise || s.enhance || s.voice || s.pan !== null ? s : null;
}

/** Whether export must time-stretch this clip (speed change with pitch kept). */
export function needsStretch(clip) {
  if (!clip || clip.freeze || clip.keepPitch === false) return false;
  if (hasCurve(clip)) return !(isFlatCurve(clip.speedCurve) && Math.abs(clip.speedCurve[0].v - 1) <= 1e-3);
  return Math.abs((clip.speed || 1) - 1) > 1e-3;
}

/** Beat times on the timeline (us) that fall inside the clip. */
export function beatTimes(clip) {
  const out = [];
  if (!clip?.beats?.length) return out;
  const end = clip.start + clip.duration;
  for (const b of clip.beats) {
    const t = clip.start + Math.round(hasCurve(clip) ? localAtSource(clip, b - clip.in) : (b - clip.in) / (clip.speed || 1));
    if (t >= clip.start && t <= end) out.push(t);
  }
  return out;
}

/** The clip's audioFx, created with defaults when missing (for edits). */
export function ensureAudioFx(clip) {
  clip.audioFx ||= defaultAudioFx();
  // Settings added later start at their defaults on clips that predate them.
  for (const [k, v] of Object.entries(defaultAudioFx())) if (!(k in clip.audioFx)) clip.audioFx[k] = v;
  return clip.audioFx;
}

/** Source range (seconds) a clip plays: [from, to). */
export function sourceRange(clip) {
  const from = clip.in / US;
  return [from, from + sourceSpan(clip) / US];
}
