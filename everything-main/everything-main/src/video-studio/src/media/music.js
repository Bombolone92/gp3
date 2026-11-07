/**
 * Music beds: original, loopable background tracks composed and
 * synthesized entirely in code. Each track is a small recipe (tempo, key,
 * chord progression, drum patterns and instrument parts); a seeded
 * sequencer turns it into notes and a plain-JavaScript synthesizer renders
 * them to stereo samples, so the result is identical on every device and in
 * unit tests, nothing is downloaded and nothing is copied from elsewhere.
 *
 * Loops are seamless: the length is a whole number of bars, notes and
 * reverb tails that run past the end wrap around to the start.
 *
 * Track = {
 *   id, title, mood, bpm, bars, root (MIDI), scale, chords: [degree per bar],
 *   sevenths?, swing? (0..0.5 of a 16th), reverb (0..1), tone? (master low-pass Hz),
 *   duck? (sidechain depth 0..1), crackle? (vinyl noise level),
 *   drums: { kick, snare, hat, openhat, clap, shaker, tom, rim: 16-step patterns per bar },
 *   parts: [{ inst, gain, pan?, octave?, pattern?, melody?, arp? }]
 * }
 * Patterns are 16 characters per bar: 'x' full, 'o' medium, '-' soft, '.' rest
 * (a pattern of 32 spans two bars).
 */

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};

export const MUSIC = [
  {
    id: 'still-water', title: 'Still Water', mood: 'Calm', bpm: 70, bars: 12, root: 60, scale: 'major', chords: [0, 4, 5, 3], reverb: 0.45,
    drums: null,
    parts: [
      { inst: 'pad', gain: 0.32 },
      { inst: 'keys', gain: 0.3, arp: { rate: 2, pattern: [0, 1, 2, 1] }, octave: 0 },
      { inst: 'bell', gain: 0.16, melody: { density: 0.35, octave: 1, seed: 3 } },
      { inst: 'bass', gain: 0.42, pattern: 'x...............' },
    ],
  },
  {
    id: 'bright-side', title: 'Bright Side', mood: 'Upbeat', bpm: 118, bars: 24, root: 62, scale: 'major', chords: [0, 4, 5, 3], reverb: 0.22, duck: 0.25,
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', clap: '....x.......x...', shaker: '-.--.--.-.--.--.' },
    parts: [
      { inst: 'pad', gain: 0.18 },
      { inst: 'pluck', gain: 0.32, pattern: '..x...x...x..xx.', pan: -0.3 },
      { inst: 'bass', gain: 0.5, pattern: 'x.x.x.x.x.x.x.xo' },
      { inst: 'lead', gain: 0.2, melody: { density: 0.6, octave: 1, seed: 11 }, pan: 0.25 },
    ],
  },
  {
    id: 'northern-ascent', title: 'Northern Ascent', mood: 'Cinematic', bpm: 80, bars: 16, root: 57, scale: 'minor', chords: [0, 5, 2, 6], reverb: 0.6,
    drums: { tom: 'x.......x.....o.', kick: 'x...............' },
    parts: [
      { inst: 'pad', gain: 0.36 },
      { inst: 'strings', gain: 0.3, octave: -1 },
      { inst: 'bell', gain: 0.2, melody: { density: 0.3, octave: 1, seed: 7, long: true } },
      { inst: 'bass', gain: 0.4, pattern: 'x.......x.......', octave: -1 },
      { inst: 'pulse', gain: 0.14, pattern: 'x.x.x.x.x.x.x.x.', octave: 0 },
    ],
  },
  {
    id: 'late-pages', title: 'Late Pages', mood: 'Lo-fi', bpm: 82, bars: 16, root: 63, scale: 'major', chords: [1, 4, 0, 5], sevenths: true, swing: 0.28, reverb: 0.3, tone: 3600, crackle: 0.05,
    drums: { kick: 'x......x..x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xo', rim: '..........-.....' },
    parts: [
      { inst: 'keys', gain: 0.42, pattern: 'x.......-..x....' },
      { inst: 'bass', gain: 0.5, pattern: 'x......x..x.....', octave: -1 },
      { inst: 'bell', gain: 0.12, melody: { density: 0.3, octave: 1, seed: 5 } },
    ],
  },
  {
    id: 'forward-plan', title: 'Forward Plan', mood: 'Corporate', bpm: 110, bars: 24, root: 64, scale: 'major', chords: [0, 3, 5, 4], reverb: 0.25, duck: 0.15,
    drums: { kick: 'x.......x.......', clap: '....x.......x...', hat: '-.o.-.o.-.o.-.o.', shaker: '..-...-...-...-.' },
    parts: [
      { inst: 'pad', gain: 0.22 },
      { inst: 'pluck', gain: 0.3, arp: { rate: 4, pattern: [0, 1, 2, 3, 2, 1, 0, 2] }, pan: 0.2 },
      { inst: 'bass', gain: 0.45, pattern: 'x.x.x.x.x.x.x.x.' },
      { inst: 'bell', gain: 0.12, melody: { density: 0.3, octave: 1, seed: 21 }, pan: -0.2 },
    ],
  },
  {
    id: 'paper-kites', title: 'Paper Kites', mood: 'Playful', bpm: 128, bars: 24, root: 65, scale: 'major', chords: [0, 3, 4, 0], reverb: 0.2,
    drums: { kick: 'x.....x...x.....', snare: '....x.......x...', shaker: 'o-o-o-o-o-o-o-o-', rim: '..x.......x..x..' },
    parts: [
      { inst: 'pluck', gain: 0.34, pattern: 'x.x.-xx.x.x.-xx.', pan: -0.25, octave: 0 },
      { inst: 'bass', gain: 0.45, pattern: 'x...x...x...x.x.', staccato: true },
      { inst: 'lead', gain: 0.18, melody: { density: 0.7, octave: 1, seed: 33 }, pan: 0.3, wave: 'square' },
      { inst: 'bell', gain: 0.1, pattern: '........x.......', octave: 2 },
    ],
  },
  {
    id: 'low-signal', title: 'Low Signal', mood: 'Tense', bpm: 90, bars: 16, root: 50, scale: 'harmonic', chords: [0, 0, 5, 4], reverb: 0.4,
    drums: { tom: 'x.........x.....', hat: '..-...-...-...-.', rim: '.......-.......o' },
    parts: [
      { inst: 'strings', gain: 0.34, octave: 0 },
      { inst: 'pulse', gain: 0.3, pattern: 'xoooxoooxoooxooo', octave: -1 },
      { inst: 'bell', gain: 0.14, melody: { density: 0.18, octave: 2, seed: 13, long: true } },
    ],
  },
  {
    id: 'drift', title: 'Drift', mood: 'Ambient', bpm: 60, bars: 12, root: 62, scale: 'lydian', chords: [0, 1, 5, 3], reverb: 0.75,
    drums: null,
    parts: [
      { inst: 'pad', gain: 0.4 },
      { inst: 'strings', gain: 0.2, octave: 1 },
      { inst: 'bell', gain: 0.2, melody: { density: 0.22, octave: 1, seed: 8, long: true } },
    ],
  },
  {
    id: 'night-circuit', title: 'Night Circuit', mood: 'Electronic', bpm: 124, bars: 24, root: 57, scale: 'minor', chords: [0, 5, 2, 6], reverb: 0.25, duck: 0.5,
    drums: { kick: 'x...x...x...x...', openhat: '..x...x...x...x.', clap: '....x.......x...', hat: 'o-o-o-o-o-o-o-o-' },
    parts: [
      { inst: 'pad', gain: 0.22 },
      { inst: 'sawbass', gain: 0.42, pattern: '..x...x...x...x.', octave: -1 },
      { inst: 'lead', gain: 0.18, arp: { rate: 4, pattern: [0, 2, 1, 3, 2, 1, 0, 1] }, wave: 'saw', octave: 1, pan: 0.2 },
    ],
  },
  {
    id: 'front-porch', title: 'Front Porch', mood: 'Acoustic', bpm: 96, bars: 16, root: 62, scale: 'major', chords: [0, 4, 5, 3], reverb: 0.25,
    drums: { kick: 'x.......x.......', shaker: '-.o.-.o.-.o.-.o.', rim: '....x.......x...' },
    parts: [
      { inst: 'pluck', gain: 0.4, pattern: 'x..x..x.x..x..x.', strum: true },
      { inst: 'bass', gain: 0.42, pattern: 'x.......x...x...' },
      { inst: 'keys', gain: 0.14, melody: { density: 0.35, octave: 1, seed: 9 } },
    ],
  },
];

export const MUSIC_BY_ID = new Map(MUSIC.map((m) => [m.id, m]));

/** Length in seconds (a whole number of bars). */
export function musicDuration(track) {
  const t = typeof track === 'string' ? MUSIC_BY_ID.get(track) : track;
  return (t.bars * 4 * 60) / t.bpm;
}

/* Randomness and pitch ----------------------------------------------------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

/** MIDI note of scale degree d (any integer; wraps into octaves) above root. */
function degreeNote(track, d) {
  const sc = SCALES[track.scale] || SCALES.major;
  const o = Math.floor(d / sc.length);
  return track.root + sc[((d % sc.length) + sc.length) % sc.length] + 12 * o;
}

/** Chord tones (MIDI) for the chord on scale degree deg. */
export function chordNotes(track, deg) {
  const n = track.sevenths ? 4 : 3;
  return Array.from({ length: n }, (_, i) => degreeNote(track, deg + i * 2));
}

const LEVEL = { x: 1, o: 0.65, '-': 0.38 };

/** Steps of a pattern string as [{ step (0..15 within its bar span), vel }]. */
function patternHits(p) {
  const out = [];
  for (let i = 0; i < p.length; i++) if (LEVEL[p[i]]) out.push({ step: i, vel: LEVEL[p[i]] });
  return out;
}

/* Note list --------------------------------------------------------------------- */

/**
 * The notes of a track: [{ inst, part, t, dur, midi, vel }] in seconds, plus
 * drum hits [{ drum, t, vel }]. Deterministic for a track.
 */
export function sequence(track) {
  const spb = 60 / track.bpm;
  const step = spb / 4;
  const bar = spb * 4;
  const swing = track.swing || 0;
  const at = (barIdx, s) => barIdx * bar + s * step + (s % 2 === 1 ? swing * step : 0);
  const notes = [];
  const hits = [];
  const chordAt = (b) => track.chords[b % track.chords.length];

  track.parts.forEach((part, pi) => {
    const oct = 12 * (part.octave || 0);
    const rnd = mulberry32(hashString(`${track.id}:${pi}`));
    if (part.inst === 'pad' || part.inst === 'strings') {
      for (let b = 0; b < track.bars; b++) {
        if (b > 0 && chordAt(b) === chordAt(b - 1)) {
          // Same chord again: extend the previous bar's voices.
          for (const n of notes) if (n.part === pi && Math.abs(n.t + n.dur - b * bar) < 1e-6) n.dur += bar;
          continue;
        }
        for (const m of chordNotes(track, chordAt(b))) notes.push({ inst: part.inst, part: pi, t: b * bar, dur: bar, midi: m + oct, vel: 0.8 });
      }
      return;
    }
    if (part.arp) {
      const per = Math.round(16 / (part.arp.rate * 4)) || 1; // steps between notes
      for (let b = 0; b < track.bars; b++) {
        const tones = chordNotes(track, chordAt(b));
        for (let s = 0, k = 0; s < 16; s += per, k++) {
          const idx = part.arp.pattern[k % part.arp.pattern.length];
          const m = tones[idx % tones.length] + 12 * Math.floor(idx / tones.length) + oct;
          notes.push({ inst: part.inst, part: pi, t: at(b, s), dur: per * step * 0.9, midi: m, vel: k % 4 === 0 ? 0.9 : 0.65 });
        }
      }
      return;
    }
    if (part.melody) {
      const { density = 0.5, octave = 1, seed = 1, long = false } = part.melody;
      const mr = mulberry32(seed * 7919 + hashString(track.id));
      // Two 2-bar phrases of chord-relative degrees, laid out A A B A.
      const phrase = () => {
        const out = [];
        let deg = Math.floor(mr() * 3) * 2;
        const slots = long ? 4 : 8; // per bar
        for (let i = 0; i < slots * 2; i++) {
          if (mr() > density && i % slots !== 0) continue;
          deg = Math.max(-2, Math.min(9, deg + [-2, -1, 0, 1, 2, 2][Math.floor(mr() * 6)]));
          // Strong beats land on chord tones.
          if (i % (slots / 2) === 0 && deg % 2 !== 0) deg += 1;
          let len = 1;
          while (i + len < slots * 2 && len < 3 && mr() > 0.6) len++;
          out.push({ slot: i, len, deg });
        }
        return { slots, out };
      };
      const A = phrase();
      const B = phrase();
      const form = [A, A, B, A];
      for (let b = 0; b < track.bars; b += 2) {
        const ph = form[(b / 2) % form.length];
        const slotDur = bar / ph.slots;
        for (const n of ph.out) {
          const barIdx = b + Math.floor(n.slot / ph.slots);
          if (barIdx >= track.bars) continue;
          const chordRoot = chordAt(barIdx);
          const m = degreeNote(track, chordRoot + n.deg) + 12 * octave;
          notes.push({ inst: part.inst, part: pi, t: b * bar + n.slot * slotDur, dur: n.len * slotDur * 0.92, midi: m, vel: 0.7 + rnd() * 0.25 });
        }
      }
      return;
    }
    if (part.pattern) {
      const hitsP = patternHits(part.pattern);
      const span = Math.max(1, Math.round(part.pattern.length / 16));
      for (let b = 0; b < track.bars; b += span) {
        for (const hp of hitsP) {
          const barIdx = b + Math.floor(hp.step / 16);
          if (barIdx >= track.bars) continue;
          const s = hp.step % 16;
          const next = hitsP.find((x) => x.step > hp.step);
          const gap = ((next ? next.step : part.pattern.length) - hp.step) * step;
          const tones = chordNotes(track, chordAt(barIdx));
          const isBass = part.inst === 'bass' || part.inst === 'sawbass' || part.inst === 'pulse';
          const dur = part.staccato ? step * 1.2 : Math.max(step, gap * 0.95);
          if (isBass) {
            // Root, with a fifth on the soft off-beats for movement.
            const m = tones[0] - 12 + oct + (hp.vel < 1 && part.inst === 'bass' && s % 4 === 2 ? 7 : 0);
            notes.push({ inst: part.inst, part: pi, t: at(barIdx, s), dur, midi: m, vel: hp.vel });
          } else {
            tones.forEach((m, k) => notes.push({ inst: part.inst, part: pi, t: at(barIdx, s) + (part.strum ? k * 0.018 : 0), dur, midi: m + oct, vel: hp.vel * (0.85 + rnd() * 0.15) }));
          }
        }
      }
    }
  });

  for (const [drum, p] of Object.entries(track.drums || {})) {
    const hitsP = patternHits(p);
    const span = Math.max(1, Math.round(p.length / 16));
    const rnd = mulberry32(hashString(`${track.id}:${drum}`));
    for (let b = 0; b < track.bars; b += span) {
      for (const hp of hitsP) {
        const barIdx = b + Math.floor(hp.step / 16);
        if (barIdx >= track.bars) continue;
        hits.push({ drum, t: at(barIdx, hp.step % 16), vel: hp.vel * (0.9 + rnd() * 0.1) });
      }
    }
  }
  return { notes, hits };
}

/* Synthesis --------------------------------------------------------------------- */

const TWO_PI = Math.PI * 2;
const tri = (p) => 1 - 4 * Math.abs((p - Math.floor(p)) - 0.5);
const saw = (p) => 2 * (p - Math.floor(p)) - 1;

/** Equal-power pan gains for p in -1..1. */
const panGains = (p) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];

/**
 * Write a voice into a stereo bus, wrapping past the end. fn(i, t) returns
 * the mono sample for frame i (t = i / sr seconds into the note).
 */
function voice(bus, sr, start, frames, pan, gain, fn) {
  const N = bus.l.length;
  const [gl, gr] = panGains(pan);
  let idx = ((Math.round(start * sr) % N) + N) % N;
  const n = Math.min(frames, N);
  for (let i = 0; i < n; i++) {
    const s = fn(i, i / sr) * gain;
    bus.l[idx] += s * gl;
    bus.r[idx] += s * gr;
    if (++idx === N) idx = 0;
  }
}

/** Attack/release gate with an exponential decay toward sustain. */
function adsr(t, dur, a, d, s, r) {
  let v;
  if (t < a) v = t / a;
  else if (t < a + d) v = 1 - (1 - s) * ((t - a) / d);
  else v = s;
  if (t > dur) v *= Math.max(0, 1 - (t - dur) / r);
  return v;
}

function renderNote(bus, sr, n, part, rnd) {
  const f = mtof(n.midi);
  const pan = part.pan || 0;
  const g = (part.gain ?? 0.3) * n.vel;
  switch (n.inst) {
    case 'pad': {
      const rel = 1.2;
      const detune = [1, 1.0035, 0.9968];
      const ph = detune.map(() => rnd());
      voice(bus, sr, n.t, Math.round((n.dur + rel) * sr), pan + (n.midi % 3 - 1) * 0.25, g * 0.3, (i, t) => {
        const e = adsr(t, n.dur, Math.min(0.8, n.dur / 3), 0.5, 0.85, rel);
        let s = 0;
        for (let k = 0; k < 3; k++) s += tri(ph[k] + f * detune[k] * t);
        return (s / 3 + 0.25 * Math.sin(TWO_PI * f * 2 * t) * Math.sin(TWO_PI * 0.3 * t)) * e;
      });
      break;
    }
    case 'strings': {
      const rel = 1;
      let lp = 0;
      const k = 1 - Math.exp((-TWO_PI * Math.min(3000, f * 4)) / sr);
      voice(bus, sr, n.t, Math.round((n.dur + rel) * sr), pan - 0.2 + (n.midi % 2) * 0.4, g * 0.35, (i, t) => {
        const vib = 1 + 0.004 * Math.sin(TWO_PI * 5 * t);
        const x = 0.5 * saw(f * vib * t) + 0.5 * saw(f * 1.006 * t + 0.3);
        lp += k * (x - lp);
        return lp * adsr(t, n.dur, Math.min(1.2, n.dur / 2), 0.2, 0.9, rel);
      });
      break;
    }
    case 'keys': {
      const rel = 0.3;
      voice(bus, sr, n.t, Math.round((n.dur + rel) * sr), pan, g * 0.5, (i, t) => {
        const idx = 1.4 * Math.exp(-t * 3) + 0.15;
        const s = Math.sin(TWO_PI * f * t + idx * Math.sin(TWO_PI * f * t));
        return s * Math.exp(-t * 1.1) * adsr(t, n.dur, 0.004, 0.1, 1, rel);
      });
      break;
    }
    case 'bell': {
      const len = part.melody?.long ? 3.5 : 2;
      voice(bus, sr, n.t, Math.round(len * sr), pan, g * 0.45, (i, t) => {
        const idx = 2.2 * Math.exp(-t * 2.5);
        return Math.sin(TWO_PI * f * t + idx * Math.sin(TWO_PI * f * 3.5 * t)) * Math.exp(-t * (3 / len)) * Math.min(1, t / 0.002);
      });
      break;
    }
    case 'lead': {
      const rel = 0.12;
      let lp = 0;
      const k = 1 - Math.exp((-TWO_PI * 2600) / sr);
      const wave = part.wave === 'square' ? (p) => (p - Math.floor(p) < 0.5 ? 0.7 : -0.7) : part.wave === 'saw' ? saw : tri;
      voice(bus, sr, n.t, Math.round((n.dur + rel) * sr), pan, g * 0.4, (i, t) => {
        lp += k * (wave(f * t) - lp);
        return lp * adsr(t, n.dur, 0.008, 0.15, 0.6, rel);
      });
      break;
    }
    case 'pluck': {
      // Karplus-Strong: a noise burst through a damped delay line.
      const period = Math.max(2, Math.round(sr / f));
      const buf = new Float32Array(period);
      let prev = 0;
      for (let i = 0; i < period; i++) {
        const x = rnd() * 2 - 1;
        buf[i] = 0.5 * (x + prev);
        prev = x;
      }
      const t60 = 1.4;
      const decay = 0.001 ** (1 / (f * t60));
      const len = Math.min(n.dur + 0.25, 2.5);
      let p = 0;
      voice(bus, sr, n.t, Math.round(len * sr), pan, g * 0.9, (i, t) => {
        const a = buf[p];
        const b = buf[(p + 1) % period];
        buf[p] = 0.5 * (a + b) * decay;
        p = (p + 1) % period;
        return a * (t > len - 0.05 ? (len - t) / 0.05 : 1);
      });
      break;
    }
    case 'bass': {
      const rel = 0.06;
      voice(bus, sr, n.t, Math.round((n.dur + rel) * sr), 0, g * 0.6, (i, t) => {
        const s = Math.sin(TWO_PI * f * t) + 0.25 * tri(f * t) + 0.15 * Math.sin(TWO_PI * f * 2 * t);
        return s * adsr(t, n.dur, 0.005, 0.2, 0.7, rel);
      });
      break;
    }
    case 'sawbass': {
      const rel = 0.05;
      let lp = 0;
      voice(bus, sr, n.t, Math.round((n.dur + rel) * sr), 0, g * 0.55, (i, t) => {
        const cut = 180 + 1400 * Math.exp(-t * 14);
        const k = 1 - Math.exp((-TWO_PI * cut) / sr);
        lp += k * (0.6 * saw(f * t) + 0.6 * saw(f * 1.01 * t) - lp);
        return (lp + 0.4 * Math.sin(TWO_PI * f * t)) * adsr(t, n.dur, 0.003, 0.1, 0.8, rel);
      });
      break;
    }
    case 'pulse': {
      const rel = 0.04;
      let lp = 0;
      const k = 1 - Math.exp((-TWO_PI * 900) / sr);
      voice(bus, sr, n.t, Math.round((Math.min(n.dur, 0.2) + rel) * sr), pan, g * 0.5, (i, t) => {
        lp += k * ((saw(f * t) + 0.5 * Math.sin(TWO_PI * f * 0.5 * t)) - lp);
        return lp * adsr(t, Math.min(n.dur, 0.2), 0.003, 0.08, 0.5, rel);
      });
      break;
    }
    default:
      break;
  }
}

function renderHit(bus, sr, hit, rnd) {
  const v = hit.vel;
  const noise = () => rnd() * 2 - 1;
  switch (hit.drum) {
    case 'kick':
      voice(bus, sr, hit.t, Math.round(0.45 * sr), 0, 0.9 * v, (i, t) => {
        const ph = 45 * t + (75 / 30) * (1 - Math.exp(-t * 30));
        return Math.sin(TWO_PI * ph) * Math.exp(-t * 7) + (t < 0.003 ? noise() * 0.3 : 0);
      });
      break;
    case 'tom':
      voice(bus, sr, hit.t, Math.round(1.2 * sr), 0, 0.7 * v, (i, t) => {
        const ph = 62 * t + (40 / 12) * (1 - Math.exp(-t * 12));
        return Math.sin(TWO_PI * ph) * Math.exp(-t * 3.2) + noise() * 0.05 * Math.exp(-t * 30);
      });
      break;
    case 'snare': {
      let lp = 0;
      const k = 1 - Math.exp((-TWO_PI * 1800) / sr);
      voice(bus, sr, hit.t, Math.round(0.25 * sr), 0.05, 0.45 * v, (i, t) => {
        const x = noise();
        lp += k * (x - lp);
        return (x - lp) * Math.exp(-t * 18) + 0.5 * Math.sin(TWO_PI * 185 * t) * Math.exp(-t * 30);
      });
      break;
    }
    case 'clap': {
      let lp = 0;
      const k = 1 - Math.exp((-TWO_PI * 1200) / sr);
      voice(bus, sr, hit.t, Math.round(0.25 * sr), -0.05, 0.4 * v, (i, t) => {
        const x = noise();
        lp += k * (x - lp);
        const bursts = t < 0.03 ? Math.exp(-((t % 0.01) * 300)) : Math.exp(-(t - 0.03) * 16);
        return (x - lp) * bursts;
      });
      break;
    }
    case 'hat':
    case 'openhat': {
      let lp = 0;
      const k = 1 - Math.exp((-TWO_PI * 7000) / sr);
      const d = hit.drum === 'openhat' ? 6 : 45;
      voice(bus, sr, hit.t, Math.round((hit.drum === 'openhat' ? 0.4 : 0.08) * sr), 0.25, 0.18 * v, (i, t) => {
        const x = noise();
        lp += k * (x - lp);
        return (x - lp) * Math.exp(-t * d);
      });
      break;
    }
    case 'shaker': {
      let lp = 0;
      const k = 1 - Math.exp((-TWO_PI * 5000) / sr);
      voice(bus, sr, hit.t, Math.round(0.1 * sr), -0.3, 0.12 * v, (i, t) => {
        const x = noise();
        lp += k * (x - lp);
        return (x - lp) * Math.min(1, t / 0.012) * Math.exp(-t * 30);
      });
      break;
    }
    case 'rim':
      voice(bus, sr, hit.t, Math.round(0.06 * sr), 0.15, 0.3 * v, (i, t) => (tri(1700 * t) * 0.6 + noise() * 0.2) * Math.exp(-t * 70));
      break;
    default:
      break;
  }
}

/** Small Schroeder reverb run twice over the loop so the tail wraps seamlessly. */
function reverb(inL, inR, sr, amount) {
  const N = inL.length;
  const k = sr / 44100;
  const combs = [1116, 1188, 1277, 1356].map((d) => Math.max(1, Math.round(d * k)));
  const alls = [556, 441].map((d) => Math.max(1, Math.round(d * k)));
  const run = (src, spread) => {
    const out = new Float32Array(N);
    const cbufs = combs.map((d) => new Float32Array(d + spread));
    const cidx = combs.map(() => 0);
    const cfilt = combs.map(() => 0);
    const abufs = alls.map((d) => new Float32Array(d + spread));
    const aidx = alls.map(() => 0);
    const fb = 0.78 + amount * 0.12;
    const damp = 0.25;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        const x = src[i] * 0.015;
        let y = 0;
        for (let c = 0; c < cbufs.length; c++) {
          const b = cbufs[c];
          const o = b[cidx[c]];
          cfilt[c] = o * (1 - damp) + cfilt[c] * damp;
          b[cidx[c]] = x + cfilt[c] * fb;
          if (++cidx[c] >= b.length) cidx[c] = 0;
          y += o;
        }
        for (let a = 0; a < abufs.length; a++) {
          const b = abufs[a];
          const o = b[aidx[a]];
          b[aidx[a]] = y + o * 0.5;
          if (++aidx[a] >= b.length) aidx[a] = 0;
          y = o - y * 0.5;
        }
        if (pass === 1) out[i] = y;
      }
    }
    return out;
  };
  return [run(inL, 0), run(inR, Math.round(23 * k))];
}

/**
 * Render a track (or its id) to stereo samples:
 * { left, right, sampleRate, duration }. Peak normalized to about -1 dBFS.
 */
export function renderMusic(trackOrId, sampleRate = 44100) {
  const track = typeof trackOrId === 'string' ? MUSIC_BY_ID.get(trackOrId) : trackOrId;
  if (!track) throw new Error(`Unknown music track ${trackOrId}`);
  const sr = sampleRate;
  const duration = musicDuration(track);
  const N = Math.round(duration * sr);
  const music = { l: new Float32Array(N), r: new Float32Array(N) };
  const drums = { l: new Float32Array(N), r: new Float32Array(N) };
  const { notes, hits } = sequence(track);
  const rnd = mulberry32(hashString(`${track.id}:synth`));
  for (const n of notes) renderNote(music, sr, n, track.parts[n.part], rnd);
  for (const hit of hits) renderHit(drums, sr, hit, rnd);

  // Sidechain: the music dips under each kick, wrapping around the loop.
  if (track.duck) {
    const env = new Float32Array(N).fill(1);
    for (const hit of hits) {
      if (hit.drum !== 'kick') continue;
      const start = Math.round(hit.t * sr);
      const len = Math.round(0.25 * sr);
      for (let i = 0; i < len; i++) {
        const j = (start + i) % N;
        env[j] = Math.min(env[j], 1 - track.duck * Math.exp(-i / sr / 0.09));
      }
    }
    for (let i = 0; i < N; i++) {
      music.l[i] *= env[i];
      music.r[i] *= env[i];
    }
  }

  const left = new Float32Array(N);
  const right = new Float32Array(N);
  const [rl, rr] = track.reverb ? reverb(music.l, music.r, sr, track.reverb) : [null, null];
  const wet = (track.reverb || 0) * 1.2;
  for (let i = 0; i < N; i++) {
    left[i] = music.l[i] + drums.l[i] + (rl ? rl[i] * wet : 0);
    right[i] = music.r[i] + drums.r[i] + (rr ? rr[i] * wet : 0);
  }

  if (track.crackle) {
    const cr = mulberry32(hashString(`${track.id}:crackle`));
    for (let i = 0; i < N; i++) {
      const pop = cr() < 6 / sr ? (cr() * 2 - 1) * 0.6 : 0;
      const hiss = (cr() * 2 - 1) * 0.02;
      left[i] += (pop + hiss) * track.crackle * 3;
      right[i] += (pop * 0.8 + hiss) * track.crackle * 3;
    }
  }

  if (track.tone && track.tone < sr / 2) {
    const k = 1 - Math.exp((-TWO_PI * track.tone) / sr);
    for (const ch of [left, right]) {
      // Two passes so the filter state at the loop point matches.
      let y = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < N; i++) {
          y += k * (ch[i] - y);
          if (pass === 1) ch[i] = y;
        }
      }
    }
  }

  // Gentle saturation, then normalize.
  let peak = 0;
  for (let i = 0; i < N; i++) {
    left[i] = Math.tanh(left[i] * 1.2);
    right[i] = Math.tanh(right[i] * 1.2);
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (peak > 0) {
    const k = 0.89 / peak;
    for (let i = 0; i < N; i++) {
      left[i] *= k;
      right[i] *= k;
    }
  }
  return { left, right, sampleRate: sr, duration: N / sr };
}
