/**
 * Animated title templates: small stacks of text and graphic clips (lower
 * thirds, titles, cards, countdowns...). Inserting one puts each layer on a
 * new track at the playhead in a single undo step. Layouts are designed on
 * a 1920x1080 canvas and scale to the project's frame.
 *
 * Layer fields: type ('text' | 'sticker'), name, text, style, sticker,
 * color, dx/dy (design px from the anchor), scale, start/duration (seconds,
 * relative to the template), in/out/loop ([animation id, seconds]) and
 * track (layers with the same track key share one track).
 */
import { US } from '../lib/time.js';
import { makeClip, DEFAULT_TEXT_STYLE } from './project.js';
import { addTrack, sortTrack } from './timeline.js';
import { TEXT_EFFECTS } from './text-presets.js';

const fx = (id) => TEXT_EFFECTS.find((e) => e.id === id)?.style || {};
/** A plain box (an empty text clip with a fixed size and a fill). */
const box = (w, h, color, radius = 0, extra = {}) => ({ text: '', style: { size: 10, boxWidth: w, boxHeight: h, bgColor: color, bgOpacity: 1, bgRadius: radius, ...extra } });

export const TEXT_TEMPLATES = [
  {
    id: 'lower-third',
    label: 'Lower third',
    duration: 5,
    anchor: { x: -0.5, y: 0.5 },
    layers: [
      { name: 'Bar', ...box(720, 150, '#1f6feb', 6), dx: 480, dy: -220, in: ['slide-right-in', 0.5], out: ['fade-out', 0.4] },
      { name: 'Accent', ...box(12, 150, '#ffd23f'), dx: 126, dy: -220, start: 0.15, in: ['fade-in', 0.3], out: ['fade-out', 0.4] },
      { text: 'Your Name', style: { font: 'Inter', bold: true, size: 58, align: 'left', boxWidth: 640 }, dx: 490, dy: -248, start: 0.2, in: ['letters-rise', 0.6], out: ['fade-out', 0.4] },
      { text: 'Title or role', style: { font: 'Inter', size: 36, color: '#d6e4ff', align: 'left', boxWidth: 640 }, dx: 490, dy: -182, start: 0.35, in: ['letters-fade', 0.6], out: ['fade-out', 0.4] },
    ],
  },
  {
    id: 'big-title',
    label: 'Title and subtitle',
    duration: 4,
    anchor: { x: 0, y: 0 },
    layers: [
      { text: 'BIG TITLE', style: { font: 'Anton', size: 170, case: 'upper', shadowOpacity: 0.4, shadowBlur: 18, shadowDistance: 6 }, dy: -40, in: ['word-pop', 0.6], out: ['fade-out', 0.4] },
      { name: 'Line', ...box(260, 6, '#ffffff'), dy: 70, start: 0.3, in: ['zoom-in', 0.4], out: ['fade-out', 0.4] },
      { text: 'A short subtitle', style: { font: 'Inter', size: 44, letterSpacing: 8, case: 'upper', color: '#e8e8e8' }, dy: 125, start: 0.45, in: ['letters-fade', 0.8], out: ['fade-out', 0.4] },
    ],
  },
  {
    id: 'quote-card',
    label: 'Quote card',
    duration: 6,
    anchor: { x: 0, y: 0 },
    layers: [
      { name: 'Card', ...box(1100, 480, '#fffaf0', 28), in: ['pop-in', 0.5], out: ['fade-out', 0.5] },
      { text: '“', style: { font: 'Playfair Display', bold: true, size: 200, color: '#e0b25b' }, dx: -440, dy: -150, start: 0.2, in: ['fade-in', 0.5], out: ['fade-out', 0.5] },
      { text: 'Simplicity is the soul of a good story.', style: { font: 'Playfair Display', italic: true, size: 62, color: '#222222', boxWidth: 860 }, dy: -20, start: 0.3, in: ['word-rise', 1], out: ['fade-out', 0.5] },
      { text: '— Author Name', style: { font: 'Inter', size: 34, color: '#8a6d3b', letterSpacing: 2 }, dy: 150, start: 0.8, in: ['fade-in', 0.5], out: ['fade-out', 0.5] },
    ],
  },
  {
    id: 'countdown',
    label: 'Countdown 3-2-1',
    duration: 4,
    anchor: { x: 0, y: 0 },
    layers: [
      { type: 'sticker', sticker: 'ring', color: '#ffffff', scale: 1.4, duration: 3, loop: ['pulse', 1] },
      { text: '3', style: { font: 'Anton', size: 260 }, duration: 1, track: 'n', in: ['pop-in', 0.35], out: ['fade-out', 0.25] },
      { text: '2', style: { font: 'Anton', size: 260 }, start: 1, duration: 1, track: 'n', in: ['pop-in', 0.35], out: ['fade-out', 0.25] },
      { text: '1', style: { font: 'Anton', size: 260 }, start: 2, duration: 1, track: 'n', in: ['pop-in', 0.35], out: ['fade-out', 0.25] },
      { text: 'GO!', style: { font: 'Anton', size: 220, color: '#ffd23f' }, start: 3, duration: 1, track: 'n', in: ['word-pop', 0.4], out: ['zoom-in-out', 0.3] },
    ],
  },
  {
    id: 'social-handle',
    label: 'Social handle',
    duration: 4,
    anchor: { x: 0, y: 0.5 },
    layers: [
      { text: '@yourname', style: { font: 'Poppins', bold: true, size: 56, bubble: 'pill', bubbleFill: '#ff3d6e', bubbleStrokeWidth: 0 }, dx: 40, dy: -170, in: ['slide-up-in', 0.5], out: ['fade-out', 0.4] },
      { type: 'sticker', sticker: 'icon-heart', color: '#ff3d6e', scale: 0.35, dx: -230, dy: -170, start: 0.25, in: ['pop-in', 0.4], out: ['fade-out', 0.4] },
    ],
  },
  {
    id: 'chapter',
    label: 'Chapter title',
    duration: 4,
    anchor: { x: 0, y: 0 },
    layers: [
      { text: 'CHAPTER 01', style: { font: 'Inter', bold: true, size: 30, letterSpacing: 12, color: '#ffd23f' }, dy: -85, in: ['letters-fade', 0.6], out: ['fade-out', 0.4] },
      { text: 'The Beginning', style: { font: 'Playfair Display', size: 110 }, dy: 10, start: 0.25, in: ['letters-blur', 1], out: ['letters-blur-out', 0.6] },
      { name: 'Rule', ...box(520, 4, '#ffffff'), dy: 100, start: 0.5, in: ['zoom-in', 0.5], out: ['fade-out', 0.4] },
    ],
  },
  {
    id: 'update-banner',
    label: 'Update banner',
    duration: 5,
    anchor: { x: -0.5, y: 0.5 },
    layers: [
      { name: 'Band', ...box(1500, 96, '#ffffff'), dx: 870, dy: -150, in: ['slide-left-in', 0.5], out: ['slide-left-out', 0.4] },
      { text: 'UPDATE', style: { font: 'Oswald', bold: true, size: 54, letterSpacing: 3, boxWidth: 300, boxHeight: 96, bgColor: '#d7263d', bgOpacity: 1, bgRadius: 0 }, dx: 270, dy: -150, start: 0.15, in: ['slide-right-in', 0.4], out: ['slide-left-out', 0.4] },
      { text: 'Your headline goes here', style: { font: 'Oswald', size: 48, color: '#111111', align: 'left', boxWidth: 1080 }, dx: 1000, dy: -150, start: 0.4, in: ['letters-rise', 0.6], out: ['fade-out', 0.3] },
    ],
  },
  {
    id: 'end-card',
    label: 'End card',
    duration: 6,
    anchor: { x: 0, y: 0 },
    layers: [
      { text: 'Thanks for watching', style: { font: 'Montserrat', bold: true, size: 96 }, dy: -70, in: ['letters-rise', 0.8], out: ['fade-out', 0.5] },
      { text: 'Follow for more', style: { font: 'Inter', size: 44, color: '#cfcfcf' }, dy: 30, start: 0.4, in: ['fade-in', 0.6], out: ['fade-out', 0.5] },
      { text: 'FOLLOW', style: { font: 'Poppins', bold: true, size: 40, letterSpacing: 2, bubble: 'pill', bubbleFill: '#ff3d3d', bubbleStrokeWidth: 0 }, dy: 145, start: 0.8, in: ['pop-in', 0.5], out: ['fade-out', 0.5] },
    ],
  },
  {
    id: 'location',
    label: 'Location',
    duration: 4,
    anchor: { x: -0.5, y: 0.5 },
    layers: [
      { type: 'sticker', sticker: 'icon-pin', color: '#ff4d4d', scale: 0.45, dx: 170, dy: -195, in: ['bounce-in', 0.6], out: ['fade-out', 0.4] },
      { text: 'Location name', style: { font: 'Montserrat', bold: true, size: 60, align: 'left', boxWidth: 700, shadowOpacity: 0.5, shadowBlur: 10, shadowDistance: 2 }, dx: 610, dy: -215, start: 0.2, in: ['letters-rise', 0.6], out: ['fade-out', 0.4] },
      { text: 'City, Country', style: { font: 'Inter', size: 34, color: '#dddddd', align: 'left', boxWidth: 700, shadowOpacity: 0.5, shadowBlur: 8, shadowDistance: 2 }, dx: 610, dy: -160, start: 0.4, in: ['letters-fade', 0.6], out: ['fade-out', 0.4] },
    ],
  },
  {
    id: 'callout',
    label: 'Callout',
    duration: 3,
    anchor: { x: 0.18, y: -0.15 },
    layers: [
      { type: 'sticker', sticker: 'arrow-curve', color: '#ffd23f', scale: 0.5, dx: -260, dy: 170, start: 0.3, in: ['fade-in', 0.4], out: ['fade-out', 0.3] },
      { text: 'Look at this!', style: { font: 'Poppins', bold: true, size: 60, color: '#111111', bubble: 'speech', bubbleFill: '#ffffff', bubbleStroke: '#111111', bubbleStrokeWidth: 4 }, in: ['pop-in', 0.4], out: ['pop-out', 0.3] },
    ],
  },
  {
    id: 'neon-sign',
    label: 'Neon sign',
    duration: 4,
    anchor: { x: 0, y: 0 },
    layers: [
      { text: 'Open late', style: { ...fx('neon-cyan'), size: 130 }, dy: -20, loop: ['flicker', 2] },
      { text: 'every night', style: { font: 'Montserrat', size: 36, letterSpacing: 10, case: 'upper', color: '#ffe6fb', glowColor: '#ff3df2', glowStrength: 45, glowRadius: 14 }, dy: 100, start: 0.3, in: ['fade-in', 0.6], out: ['fade-out', 0.4] },
    ],
  },
  {
    id: 'sing-along',
    label: 'Sing-along line',
    duration: 5,
    anchor: { x: 0, y: 0.34 },
    layers: [
      { text: 'Sing every word with me', style: { font: 'Poppins', bold: true, size: 60, strokeColor: '#000000', strokeWidth: 5, boxWidth: 1200, highlightColor: '#ffd23f' }, loop: ['karaoke', 5] },
    ],
  },
  {
    id: 'big-number',
    label: 'Big number',
    duration: 4,
    anchor: { x: 0, y: 0 },
    layers: [
      { text: '1,000,000', style: { ...fx('sunset'), size: 200 }, dy: -30, in: ['decode', 1.2], out: ['fade-out', 0.4] },
      { text: 'views and counting', style: { font: 'Inter', size: 44, letterSpacing: 6, case: 'upper' }, dy: 120, start: 0.6, in: ['letters-fade', 0.6], out: ['fade-out', 0.4] },
    ],
  },
];

/** How much a 1920x1080 design scales in a project frame. */
export function templateScale(settings) {
  return Math.min(settings.width / 1600, settings.height / 1080, 1);
}

const anim = (a, maxUs) => (a ? { id: a[0], duration: Math.max(100_000, Math.min(Math.round(a[1] * US), maxUs)) } : null);

/**
 * Clips for a template starting at `start` (µs), back to front, each with
 * its track key: [{ track, clip }].
 */
export function templateClips(tpl, settings, start = 0) {
  const k = templateScale(settings);
  return tpl.layers.map((l, i) => {
    const t0 = start + Math.round((l.start || 0) * US);
    const duration = Math.round((l.duration ?? tpl.duration - (l.start || 0)) * US);
    const type = l.type || 'text';
    const fields = { start: t0, duration, name: l.name || '' };
    const clip = type === 'sticker'
      ? makeClip('sticker', { ...fields, sticker: l.sticker, color: l.color || '#ffffff' })
      : makeClip('text', { ...fields, text: l.text ?? 'Text', style: { ...DEFAULT_TEXT_STYLE, ...l.style } });
    clip.transform.x = tpl.anchor.x + ((l.dx || 0) * k) / settings.width;
    clip.transform.y = tpl.anchor.y + ((l.dy || 0) * k) / settings.height;
    clip.transform.scale = k * (l.scale || 1);
    clip.animIn = anim(l.in, duration / 2);
    clip.animOut = anim(l.out, duration / 2);
    clip.animLoop = l.loop ? anim(l.loop, duration) : null;
    return { track: l.track ?? `layer${i}`, clip };
  });
}

/**
 * Put a template's clips on new tracks (one per track key, stacked in
 * layer order with the first layer lowest). Mutates the project.
 */
export function insertTemplate(project, tpl, start = 0) {
  const items = templateClips(tpl, project.settings, start);
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.track)) groups.set(it.track, []);
    groups.get(it.track).push(it.clip);
  }
  const tracks = [];
  for (const clips of groups.values()) {
    const t = addTrack(project, 'text');
    t.clips.push(...clips);
    sortTrack(t);
    tracks.push(t);
  }
  const clips = items.map((it) => it.clip);
  // Select the main text: the first layer that has letters (not a mark or an empty box).
  const main = clips.find((c) => c.type === 'text' && /\p{L}|\p{N}/u.test(c.text)) || clips[0];
  return { clips, tracks, main };
}

/** Insert a template at the playhead as one undo step and select its main text. */
export function addTextTemplate(store, id, start = store.time) {
  const tpl = TEXT_TEMPLATES.find((t) => t.id === id);
  if (!tpl) return null;
  let made = null;
  const ok = store.update(`Add ${tpl.label}`, (p) => {
    made = insertTemplate(p, tpl, start);
  });
  if (!ok || !made) return null;
  store.select(made.main.id);
  return made;
}
