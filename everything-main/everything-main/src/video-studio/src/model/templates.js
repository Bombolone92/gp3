/**
 * Project templates: complete, playable starting points built only from what
 * the editor already has (generated backdrops, text styles, graphics,
 * animations, transitions, effects, filters and synthesized sound effects).
 * Everything here is original.
 *
 * A template's build(k) describes tracks with the kit below. Media it needs
 * is generated when the template is used:
 *   k.art(spec, name)  an image drawn by engine/template-art.js; spec.slot
 *                      marks a placeholder meant to be replaced by the user
 *   k.sfx(id)          a sound effect from media/sfx.js
 * templateDraft() turns a template into a raw project plus the list of media
 * to generate; the caller fills in real assets and normalizes it.
 */
import { US } from '../lib/time.js';
import { createProject, makeClip, makeTrack, DEFAULT_TEXT_STYLE } from './project.js';
import { TEXT_PRESETS } from './catalog.js';
import { SFX_BY_ID } from '../media/sfx.js';

export const TEMPLATE_CATEGORIES = [
  { id: 'intro', label: 'Intros and outros' },
  { id: 'slideshow', label: 'Slideshows' },
  { id: 'social', label: 'Social' },
  { id: 'business', label: 'Business' },
  { id: 'event', label: 'Events' },
];

const s = (sec) => Math.round(sec * US);
const anim = (a) => (a ? { id: a[0], duration: s(a[1]) } : null);

/** Keyframes from { prop: [[seconds, value, ease?], ...] }. */
function keys(spec = {}) {
  const out = {};
  for (const [prop, list] of Object.entries(spec)) out[prop] = list.map(([t, v, ease = 'linear']) => ({ t: s(t), v, ease }));
  return out;
}

/** The build kit handed to each template. */
function kit(media) {
  const visual = (clip, o) => {
    clip.transform = { ...clip.transform, x: o.x ?? 0, y: o.y ?? 0, scale: o.scale ?? clip.transform.scale, rotation: o.rotation ?? 0 };
    if (o.opacity !== undefined) clip.opacity = o.opacity;
    if (o.blend) clip.blend = o.blend;
    clip.animIn = anim(o.in);
    clip.animOut = anim(o.out);
    clip.animLoop = anim(o.loop);
    if (o.keys) clip.keyframes = keys(o.keys);
    if (o.name) clip.name = o.name;
    return clip;
  };
  return {
    s,
    art(spec, name) {
      const id = `tpl-art-${media.length + 1}`;
      media.push({ id, kind: 'image', spec, name });
      return id;
    },
    sfx(sfxId) {
      const have = media.find((m) => m.kind === 'audio' && m.sfx === sfxId);
      if (have) return have.id;
      const id = `tpl-sfx-${media.length + 1}`;
      const recipe = SFX_BY_ID.get(sfxId);
      media.push({ id, kind: 'audio', sfx: sfxId, name: `${recipe?.label || sfxId}.wav`, duration: s(recipe?.dur || 1) });
      return id;
    },
    track(kind, clips, extra = {}) {
      return makeTrack(kind, { ...extra, clips: clips.filter(Boolean) });
    },
    /** Image clip from k.art(); zoom: [from, to] slow push over the clip. */
    image(assetId, start, dur, o = {}) {
      const c = visual(makeClip('image', { assetId, start: s(start), duration: s(dur) }), o);
      if (o.zoom) c.keyframes = { ...c.keyframes, ...keys({ scale: [[0, o.zoom[0]], [dur, o.zoom[1]]] }) };
      if (o.transition) c.transition = { id: o.transition[0], duration: s(o.transition[1]) };
      if (o.filter) c.filter = { id: o.filter[0], intensity: o.filter[1] ?? 100 };
      if (o.slot) c.name = o.slot;
      return c;
    },
    text(presetId, text, start, dur, o = {}) {
      const preset = TEXT_PRESETS.find((p) => p.id === presetId);
      if (!preset) throw new Error(`Unknown text preset ${presetId}`);
      return visual(makeClip('text', {
        start: s(start),
        duration: s(dur),
        text,
        preset: preset.id,
        style: { ...DEFAULT_TEXT_STYLE, ...preset.style, ...o.style },
      }), o);
    },
    sticker(stickerId, color, start, dur, o = {}) {
      return visual(makeClip('sticker', { start: s(start), duration: s(dur), sticker: stickerId, color }), { scale: 0.5, ...o });
    },
    effect(effectId, start, dur, { speed = 50, strength = 50, name } = {}) {
      return makeClip('effect', { start: s(start), duration: s(dur), effect: effectId, params: { speed, strength }, name: name || '' });
    },
    filter(filterId, start, dur, intensity = 100) {
      return makeClip('filter', { start: s(start), duration: s(dur), filter: filterId, intensity });
    },
    sound(sfxId, start, { volume = 1 } = {}) {
      const assetId = this.sfx(sfxId);
      const m = media.find((x) => x.id === assetId);
      return makeClip('audio', { assetId, start: s(start), duration: m.duration, volume });
    },
  };
}

/* Shared looks ----------------------------------------------------------------- */

const slot = (n, stops, extra = {}) => ({ slot: `Photo ${n}`, stops, angle: 140, pattern: { type: 'dots', color: '#ffffff', alpha: 0.08, size: 3, gap: 34 }, ...extra });

/* Templates -------------------------------------------------------------------- */

export const TEMPLATES = [
  {
    id: 'title-intro',
    name: 'Title intro',
    description: 'A bold title over a glowing backdrop with a slow push in.',
    category: 'intro',
    ratio: '16:9',
    build(k) {
      const bg = k.art({ stops: ['#0b1026', '#2a1b5c', '#120a2e'], angle: 160, glows: [{ x: 0.22, y: 0.3, r: 0.55, color: '#ff4fa3', alpha: 0.45 }, { x: 0.82, y: 0.75, r: 0.6, color: '#2fd4ff', alpha: 0.4 }], pattern: { type: 'grid', color: '#ffffff', alpha: 0.05, gap: 80 } }, 'Night glow backdrop');
      return [
        k.track('text', [k.sticker('sparkle', '#ffffff', 1.6, 4.2, { x: 0.27, y: -0.2, scale: 0.16, in: ['pop-in', 0.5], loop: ['pulse', 1.2], out: ['fade-out', 0.5] })]),
        k.track('text', [k.text('serif', 'A story worth telling', 1.1, 4.7, { y: 0.12, style: { size: 56, color: '#e9e4ff' }, in: ['slide-up-in', 0.7], out: ['fade-out', 0.6] })]),
        k.track('text', [k.text('title-bold', 'Your title', 0.4, 5.4, { y: -0.04, style: { size: 170, letterSpacing: 6 }, in: ['zoom-out-in', 0.8], out: ['fade-out', 0.6] })]),
        k.track('effect', [k.effect('light-leak', 0, 6, { speed: 35, strength: 40 })]),
        k.track('video', [k.image(bg, 0, 6, { zoom: [1, 1.15] })], { main: true }),
        k.track('audio', [k.sound('riser', 0, { volume: 0.7 }), k.sound('impact', 3.2, { volume: 0.6 })]),
      ];
    },
  },
  {
    id: 'photo-slideshow',
    name: 'Photo slideshow',
    description: 'Four photo slots with gentle motion, soft transitions and captions.',
    category: 'slideshow',
    ratio: '16:9',
    build(k) {
      const looks = [['#3a6186', '#89253e'], ['#355c4f', '#c7a35a'], ['#4b3f72', '#e08e6d'], ['#20475e', '#9fd3c7']];
      const slots = looks.map((stops, i) => k.art(slot(i + 1, stops), `Photo ${i + 1} placeholder`));
      const D = 3.5;
      const trans = [['mix', 0.8], ['slide-left', 0.8], ['circle-open', 0.8], null];
      const captions = ['Where it started', 'The good days', 'Little moments', 'Until next time'];
      return [
        k.track('text', [k.text('serif', 'Our memories', 0.3, 2.8, { y: -0.26, style: { size: 120 }, in: ['blur-in', 0.8], out: ['fade-out', 0.5] })]),
        k.track('text', captions.map((c, i) => k.text('subtitle', c, i * D + 0.5, D - 1, { y: 0.38, style: { size: 44 }, in: ['fade-in', 0.4], out: ['fade-out', 0.4] }))),
        k.track('filter', [k.filter('warm', 0, D * 4, 60)]),
        k.track('video', slots.map((id, i) => k.image(id, i * D, D, { slot: `Photo ${i + 1} (replace me)`, zoom: i % 2 ? [1.08, 1] : [1, 1.08], transition: trans[i] })), { main: true }),
        k.track('audio', [1, 2, 3].map((i) => k.sound('whoosh', i * D - 0.5, { volume: 0.5 }))),
      ];
    },
  },
  {
    id: 'quote-card',
    name: 'Quote card',
    description: 'A typed-out quote with an author line on a warm paper backdrop.',
    category: 'social',
    ratio: '1:1',
    build(k) {
      const bg = k.art({ stops: ['#fdebdc', '#f5c6b0'], angle: 135, pattern: { type: 'dots', color: '#b4532f', alpha: 0.16, size: 3, gap: 30 }, vignette: 0.15 }, 'Paper backdrop');
      return [
        k.track('text', [k.sticker('sparkle', '#c2552f', 0.6, 7.4, { x: 0.3, y: -0.28, scale: 0.18, in: ['pop-in', 0.5], loop: ['spin', 8] })]),
        k.track('text', [k.text('label', 'YOUR NAME', 2.8, 5.2, { y: 0.24, style: { size: 34, color: '#fdebdc', bgColor: '#3b1f17' }, in: ['slide-up-in', 0.5], out: ['fade-out', 0.5] })]),
        k.track('text', [k.text('serif', 'Make something small,\nevery single day.', 0.4, 7.6, { y: -0.04, style: { size: 78, color: '#3b1f17', lineHeight: 1.3 }, in: ['typewriter', 2.2], out: ['fade-out', 0.5] })]),
        k.track('text', [k.sticker('blob', '#ffffff', 0, 8, { scale: 2.3, opacity: 0.5, loop: ['zoom-loop', 4] })]),
        k.track('video', [k.image(bg, 0, 8)], { main: true }),
        k.track('audio', [k.sound('keyboard-typing', 0.4, { volume: 0.5 })]),
      ];
    },
  },
  {
    id: 'countdown',
    name: 'Countdown',
    description: 'Five, four, three, two, one with a pulsing ring and a flash at go.',
    category: 'intro',
    ratio: '16:9',
    build(k) {
      const bg = k.art({ radial: true, stops: ['#22283a', '#07080c'], pattern: { type: 'rings', color: '#ffffff', alpha: 0.05, gap: 90 } }, 'Dark rings backdrop');
      const numbers = [5, 4, 3, 2, 1].map((n, i) => k.text('title-bold', String(n), i, 1, { style: { size: 360 }, in: ['pop-in', 0.35], out: ['zoom-in-out', 0.3] }));
      return [
        k.track('effect', [k.effect('flash', 5, 0.5, { speed: 60, strength: 70 })]),
        k.track('text', [...numbers, k.text('title-bold', "Let's go", 5, 1.5, { style: { size: 200, color: '#ffd23f' }, in: ['zoom-in', 0.4], loop: ['wobble', 0.8] })]),
        k.track('text', [k.sticker('ring', '#4f8ff7', 0, 5, { scale: 1.7, loop: ['pulse', 1], out: ['fade-out', 0.3] })]),
        k.track('effect', [k.effect('film-grain', 0, 6.5, { strength: 30 })]),
        k.track('video', [k.image(bg, 0, 6.5)], { main: true }),
        k.track('audio', [...[0, 1, 2, 3, 4].map((t) => k.sound('click', t)), k.sound('drum-hit', 5)]),
      ];
    },
  },
  {
    id: 'product-promo',
    name: 'Product promo',
    description: 'Show off a product with a price burst and a call to action.',
    category: 'business',
    ratio: '4:5',
    build(k) {
      const bg = k.art({ stops: ['#ffe8d6', '#ffd1e3', '#d9e4ff'], angle: 200, glows: [{ x: 0.5, y: 0.45, r: 0.5, color: '#ffffff', alpha: 0.7 }] }, 'Pastel studio backdrop');
      const product = k.art({ slot: 'Your product', icon: 'product', size: [1080, 1080], stops: ['#ffffff', '#eef1f6'], angle: 90, radius: 0.08 }, 'Product placeholder');
      return [
        k.track('text', [k.sticker('icon-click', '#111827', 6.2, 2.8, { x: 0.25, y: 0.42, scale: 0.2, in: ['pop-in', 0.4], loop: ['pulse', 0.9] })]),
        k.track('text', [k.text('title-bold', 'New arrival', 0.2, 5.6, { y: -0.36, style: { size: 120, color: '#111827' }, in: ['slide-down-in', 0.6], out: ['fade-out', 0.4] }), k.text('yellow-caption', 'Shop now', 6, 3, { y: 0.36, style: { size: 96 }, in: ['bounce-in', 0.7] })]),
        k.track('text', [k.text('label', 'SAVE 20%', 1.4, 4.4, { x: 0.27, y: 0.22, rotation: -8, style: { size: 40, color: '#111827', bgColor: '#ffd23f' }, in: ['pop-in', 0.4], out: ['pop-out', 0.3] })]),
        k.track('text', [k.sticker('burst', '#ff5a5f', 1.3, 4.5, { x: 0.27, y: 0.22, scale: 0.7, in: ['pop-in', 0.4], loop: ['spin', 10], out: ['pop-out', 0.3] })]),
        k.track('video', [k.image(product, 0.2, 8.8, { slot: 'Your product (replace me)', y: 0.02, scale: 0.72, in: ['pop-in', 0.6], loop: ['float', 3] })]),
        k.track('video', [k.image(bg, 0, 9)], { main: true }),
        k.track('audio', [k.sound('pop', 0.3), k.sound('pop', 1.4), k.sound('cash-register', 6.1, { volume: 0.7 })]),
      ];
    },
  },
  {
    id: 'vertical-story',
    name: 'Vertical story',
    description: 'Three tall photo slots that push up, with neon and script titles.',
    category: 'social',
    ratio: '9:16',
    build(k) {
      const looks = [['#ff9a8b', '#ff6a88', '#a75fd6'], ['#43cea2', '#185a9d'], ['#f7b267', '#f25c54']];
      const slots = looks.map((stops, i) => k.art(slot(i + 1, stops, { angle: 170 }), `Photo ${i + 1} placeholder`));
      const D = 3;
      return [
        k.track('text', [k.sticker('heart', '#ff4f7a', 6.3, 2.7, { x: 0.28, y: -0.14, scale: 0.4, in: ['pop-in', 0.4], loop: ['float', 1.6] })]),
        k.track('text', [k.text('neon', "Today's mood", 0.3, 2.5, { y: -0.3, style: { size: 120 }, in: ['pop-in', 0.5], out: ['fade-out', 0.3] }), k.text('script', 'Golden hour', 3.4, 2.4, { y: 0.3, style: { size: 110 }, in: ['slide-up-in', 0.5], out: ['fade-out', 0.3] }), k.text('script', 'See you soon', 6.4, 2.6, { y: 0.3, style: { size: 110 }, in: ['blur-in', 0.6] })]),
        k.track('filter', [k.filter('peach', 0, 9, 70)]),
        k.track('video', slots.map((id, i) => k.image(id, i * D, D, { slot: `Photo ${i + 1} (replace me)`, zoom: [1.05, 1], transition: i < 2 ? ['slide-up', 0.6] : null })), { main: true }),
        k.track('audio', [k.sound('swoosh-up', 2.6, { volume: 0.6 }), k.sound('swoosh-up', 5.6, { volume: 0.6 })]),
      ];
    },
  },
  {
    id: 'event-invite',
    name: 'Event invite',
    description: 'Confetti, a script greeting and the details of your event.',
    category: 'event',
    ratio: '4:5',
    build(k) {
      const bg = k.art({ stops: ['#2b1055', '#5b3a9b', '#7597de'], angle: 165, pattern: { type: 'confetti', alpha: 0.85, seed: 7, count: 140 }, vignette: 0.25 }, 'Confetti backdrop');
      return [
        k.track('text', [k.sticker('icon-party', '#ffd23f', 2.8, 5.2, { y: 0.39, scale: 0.3, in: ['pop-in', 0.5], loop: ['sway', 1.4] })]),
        k.track('text', [k.text('subtitle', '12 Example Street, rooftop', 2.2, 5.8, { y: 0.25, style: { size: 38, bgOpacity: 0.35 }, in: ['fade-in', 0.5] })]),
        k.track('text', [k.text('label', 'SATURDAY  ·  7 PM', 1.6, 6.4, { y: 0.13, style: { size: 44, color: '#2b1055' }, in: ['slide-up-in', 0.5] })]),
        k.track('text', [k.text('title-bold', 'Summer party', 0.8, 7.2, { y: -0.08, style: { size: 150, color: '#fff6d6' }, in: ['zoom-in', 0.6] })]),
        k.track('text', [k.text('script', "You're invited", 0.1, 7.9, { y: -0.27, style: { size: 104 }, in: ['blur-in', 0.8] })]),
        k.track('effect', [k.effect('sparkle', 0, 8, { strength: 45 })]),
        k.track('video', [k.image(bg, 0, 8, { zoom: [1.06, 1] })], { main: true }),
        k.track('audio', [k.sound('chime', 0.7, { volume: 0.7 })]),
      ];
    },
  },
  {
    id: 'travel-recap',
    name: 'Travel recap',
    description: 'A title card, four photo slots and a location tag on each.',
    category: 'slideshow',
    ratio: '16:9',
    build(k) {
      const title = k.art({ stops: ['#0f4c5c', '#2a9d8f', '#f4a261'], angle: 120, pattern: { type: 'waves', color: '#ffffff', alpha: 0.12, gap: 46 } }, 'Coast backdrop');
      const looks = [['#1d4350', '#a43931'], ['#134e5e', '#71b280'], ['#614385', '#516395'], ['#c06c84', '#355c7d']];
      const slots = looks.map((stops, i) => k.art(slot(i + 1, stops), `Photo ${i + 1} placeholder`));
      const I = 2.5;
      const D = 3;
      const places = ['First stop', 'Old town', 'By the sea', 'Last night'];
      const end = I + D * 4;
      const trans = [['slide-left', 0.7], ['zoom-in', 0.7], ['wipe-right', 0.7], ['mix', 0.7], null];
      return [
        k.track('text', places.map((p, i) => k.sticker('icon-pin', '#ffffff', I + i * D + 0.4, D - 0.8, { x: -0.43, y: 0.36, scale: 0.13, in: ['pop-in', 0.4], out: ['fade-out', 0.3] }))),
        k.track('text', [
          k.text('title-bold', 'Travel recap', 0.2, 2.2, { y: -0.05, style: { size: 160 }, in: ['zoom-out-in', 0.7], out: ['fade-out', 0.3] }),
          ...places.map((p, i) => k.text('marker', p, I + i * D + 0.5, D - 0.9, { x: -0.3, y: 0.36, style: { size: 58, color: '#ffffff', align: 'left', shadowOpacity: 0.5, shadowBlur: 8 }, in: ['slide-right-in', 0.5], out: ['fade-out', 0.3] })),
        ]),
        k.track('text', [k.text('script', 'a few days somewhere new', 0.9, 1.5, { y: 0.12, style: { size: 64 }, in: ['fade-in', 0.4], out: ['fade-out', 0.3] })]),
        k.track('effect', [k.effect('film-grain', 0, end, { strength: 22 })]),
        k.track('filter', [k.filter('teal-orange', I, end - I, 70)]),
        k.track('video', [title, ...slots].map((id, i) => (i === 0
          ? k.image(id, 0, I, { transition: trans[0], zoom: [1.1, 1] })
          : k.image(id, I + (i - 1) * D, D, { slot: `Photo ${i} (replace me)`, transition: trans[i], zoom: i % 2 ? [1, 1.1] : [1.1, 1] }))), { main: true }),
        k.track('audio', places.map((p, i) => k.sound('camera-shutter', I + i * D + 0.1, { volume: 0.6 }))),
      ];
    },
  },
  {
    id: 'tutorial-lower-third',
    name: 'Tutorial lower third',
    description: 'Name and title lower third, then a typed step with pointers.',
    category: 'business',
    ratio: '16:9',
    build(k) {
      const screen = k.art({ slot: 'Your recording', icon: 'video', stops: ['#1f2933', '#323f4b'], angle: 135, pattern: { type: 'grid', color: '#ffffff', alpha: 0.06, gap: 60 } }, 'Recording placeholder');
      return [
        k.track('text', [k.sticker('icon-click', '#ffffff', 6, 3.6, { x: 0.33, y: 0.06, scale: 0.18, in: ['pop-in', 0.3], loop: ['pulse', 0.8] })]),
        k.track('text', [k.sticker('arrow-curve', '#ffd23f', 5.5, 4.1, { x: 0.2, y: -0.1, scale: 0.45, rotation: 20, in: ['pop-in', 0.4], loop: ['wobble', 1.5] })]),
        k.track('text', [k.text('lower-third', 'Your Name\nWhat you do', 0.5, 4.5, { x: -0.3, y: 0.32, in: ['slide-right-in', 0.5], out: ['slide-left-out', 0.5] }), k.text('mono', 'Step 1: open the settings', 5, 4.8, { y: -0.38, in: ['typewriter', 1.2], out: ['fade-out', 0.4] })]),
        k.track('video', [k.image(screen, 0, 10, { slot: 'Your recording (replace me)' })], { main: true }),
        k.track('audio', [k.sound('pop', 0.5), k.sound('click', 6.1)]),
      ];
    },
  },
  {
    id: 'end-screen',
    name: 'End screen',
    description: 'Thanks for watching, two next-video slots and a follow reminder.',
    category: 'intro',
    ratio: '16:9',
    build(k) {
      const bg = k.art({ stops: ['#0f172a', '#1e293b'], angle: 120, glows: [{ x: 0.5, y: 0.0, r: 0.7, color: '#4f8ff7', alpha: 0.35 }], pattern: { type: 'grid', color: '#ffffff', alpha: 0.05, gap: 70 } }, 'Slate backdrop');
      const next = [1, 2].map((n) => k.art({ slot: `Next video ${n}`, icon: 'video', size: [1280, 720], stops: n === 1 ? ['#334155', '#475569'] : ['#3b3355', '#57507a'], angle: 135, frame: { color: '#ffffff', alpha: 0.6, width: 10 } }, `Next video ${n} placeholder`));
      return [
        k.track('text', [k.sticker('icon-bell', '#ffd23f', 2, 8, { x: -0.1, y: 0.38, scale: 0.2, in: ['pop-in', 0.4], loop: ['wobble', 1.6] })]),
        k.track('text', [
          k.text('title-bold', 'Thanks for watching', 0.2, 9.8, { y: -0.36, style: { size: 110 }, in: ['slide-down-in', 0.6] }),
        ]),
        k.track('text', [k.text('subtitle', 'Follow for more', 2, 8, { x: 0.04, y: 0.38, style: { size: 44 }, in: ['fade-in', 0.5] })]),
        k.track('text', [k.text('label', 'WATCH NEXT', 1, 9, { x: -0.22, y: 0.22, style: { size: 30 }, in: ['fade-in', 0.4] })]),
        k.track('text', [k.text('label', 'ALSO GOOD', 1.2, 8.8, { x: 0.22, y: 0.22, style: { size: 30 }, in: ['fade-in', 0.4] })]),
        k.track('video', [k.image(next[0], 0.6, 9.4, { slot: 'Next video 1 (replace me)', x: -0.22, y: -0.02, scale: 0.4, in: ['pop-in', 0.5] })]),
        k.track('video', [k.image(next[1], 0.8, 9.2, { slot: 'Next video 2 (replace me)', x: 0.22, y: -0.02, scale: 0.4, in: ['pop-in', 0.5] })]),
        k.track('video', [k.image(bg, 0, 10)], { main: true }),
        k.track('audio', [k.sound('ding', 0.6, { volume: 0.6 })]),
      ];
    },
  },
];

export const TEMPLATES_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

/**
 * A raw project for template tpl plus the media it needs:
 * { project, media: [{ id, kind: 'image', spec, name } | { id, kind: 'audio', sfx, name, duration }] }.
 * Clip assetIds point at media ids; the caller adds the matching assets.
 */
export function templateDraft(tpl, { name } = {}) {
  const media = [];
  const tracks = tpl.build(kit(media));
  const project = createProject({ name: name || tpl.name, ratio: tpl.ratio });
  project.tracks = tracks;
  project.settings.background = { type: 'color', color: '#000000', blur: 0.5 };
  return { project, media };
}

/** Image size for a template's art: the project size (longest side up to 1920) unless the spec sets one. */
export function artSize(spec, settings) {
  if (Array.isArray(spec.size)) return { width: spec.size[0], height: spec.size[1] };
  const k = Math.min(1, 1920 / Math.max(settings.width, settings.height));
  return { width: Math.round(settings.width * k), height: Math.round(settings.height * k) };
}
