/**
 * Built-in looks. All of these are original: effects and transitions are
 * GLSL shaders in engine/shaders.js keyed by id, filters are parameter sets
 * applied by the color shader, animations are transform curves evaluated in
 * engine/scene.js.
 */

import { EXTRA_EFFECTS, EXTRA_TRANSITIONS, EXTRA_FILTERS } from './looks-extra.js';
import { BODY_CATEGORY, BODY_EFFECTS } from './body-effects.js';

export const EFFECT_CATEGORIES = [
  { id: 'basic', label: 'Basic' },
  { id: 'motion', label: 'Motion' },
  { id: 'light', label: 'Light' },
  { id: 'retro', label: 'Retro' },
  { id: 'glitch', label: 'Glitch' },
  { id: 'distort', label: 'Distort' },
  { id: 'stylize', label: 'Stylize' },
  { id: 'party', label: 'Party' },
  { id: 'frames', label: 'Frames' },
  { id: 'weather', label: 'Weather' },
  BODY_CATEGORY,
];

/**
 * Effects: on an effect track (everything below) or in a clip's own stack.
 * Parameters per effect are in model/effect-params.js.
 */
export const EFFECTS = [
  { id: 'blur', label: 'Soft blur', cat: 'basic' },
  { id: 'vignette', label: 'Vignette', cat: 'basic' },
  { id: 'black-white', label: 'Mono', cat: 'basic' },
  { id: 'invert', label: 'Negative', cat: 'basic' },
  { id: 'sharpen', label: 'Crisp', cat: 'basic' },
  { id: 'zoom-pulse', label: 'Pulse zoom', cat: 'motion' },
  { id: 'shake', label: 'Camera shake', cat: 'motion' },
  { id: 'spin-blur', label: 'Spin blur', cat: 'motion' },
  { id: 'zoom-blur', label: 'Zoom blur', cat: 'motion' },
  { id: 'strobe', label: 'Strobe', cat: 'motion' },
  { id: 'vhs', label: 'Tape', cat: 'retro' },
  { id: 'film-grain', label: 'Film grain', cat: 'retro' },
  { id: 'old-film', label: 'Old reel', cat: 'retro' },
  { id: 'scanlines', label: 'Scan lines', cat: 'retro' },
  { id: 'posterize', label: 'Posterize', cat: 'retro' },
  { id: 'glow', label: 'Dream glow', cat: 'light' },
  { id: 'light-leak', label: 'Light leak', cat: 'light' },
  { id: 'flash', label: 'Flash', cat: 'light' },
  { id: 'sparkle', label: 'Sparkle', cat: 'light' },
  { id: 'rgb-split', label: 'Color split', cat: 'glitch' },
  { id: 'glitch', label: 'Glitch', cat: 'glitch' },
  { id: 'wave', label: 'Wave', cat: 'distort' },
  { id: 'bulge', label: 'Fisheye', cat: 'distort' },
  { id: 'pixelate', label: 'Pixelate', cat: 'distort' },
  { id: 'mirror', label: 'Mirror', cat: 'stylize' },
  { id: 'kaleidoscope', label: 'Kaleidoscope', cat: 'stylize' },
  { id: 'edge', label: 'Sketch', cat: 'stylize' },
  { id: 'halftone', label: 'Halftone', cat: 'stylize' },
  { id: 'split-screen', label: 'Split 3', cat: 'stylize' },
  { id: 'letterbox', label: 'Cinema bars', cat: 'stylize' },
  ...EXTRA_EFFECTS,
  ...BODY_EFFECTS,
];

export const FILTER_CATEGORIES = [
  { id: 'featured', label: 'Essentials' },
  { id: 'portrait', label: 'Portrait' },
  { id: 'landscape', label: 'Landscape' },
  { id: 'food', label: 'Food' },
  { id: 'film', label: 'Film' },
  { id: 'vintage', label: 'Vintage' },
  { id: 'mono', label: 'Mono' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'night', label: 'Night' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
];

/**
 * Filter parameters (all optional, -100..100 like the Color tab):
 * brightness, contrast, saturation, exposure, temperature, tint, highlights,
 * shadows, fade, vignette, grain, plus split toning as shadowTint / highlightTint
 * hex colors with splitAmount 0..1, and mono for black and white. Filters may
 * also carry hsl and curves tables (see model/looks-extra.js).
 */
export const FILTERS = [
  { id: 'vivid', label: 'Vivid', cat: 'featured', p: { saturation: 30, contrast: 12, brightness: 3 } },
  { id: 'clear', label: 'Bright', cat: 'featured', p: { contrast: 10, highlights: -15, shadows: 15, sharpen: 20 } },
  { id: 'warm', label: 'Warm', cat: 'warm', p: { temperature: 35, saturation: 8, highlights: -6 } },
  { id: 'cool', label: 'Cool', cat: 'cool', p: { temperature: -35, tint: -4, saturation: 4 } },
  { id: 'teal-orange', label: 'Teal and orange', cat: 'cinematic', p: { contrast: 14, saturation: 10, shadowTint: '#0f6f7a', highlightTint: '#ff9d4d', splitAmount: 0.35 } },
  { id: 'soft', label: 'Soft', cat: 'portrait', p: { contrast: -18, fade: 18, saturation: -6, brightness: 6 } },
  { id: 'fresh', label: 'Fresh', cat: 'landscape', p: { exposure: 8, saturation: 14, temperature: -8, tint: -6 } },
  { id: 'peach', label: 'Peach', cat: 'portrait', p: { temperature: 18, tint: 14, fade: 8, brightness: 6 } },
  { id: 'sunset', label: 'Golden hour', cat: 'warm', p: { temperature: 45, tint: 10, saturation: 16, highlightTint: '#ffb35c', splitAmount: 0.25 } },
  { id: 'food', label: 'Rich', cat: 'food', p: { saturation: 26, temperature: 16, contrast: 8, shadows: 10 } },
  { id: 'pastel', label: 'Pastel', cat: 'vintage', p: { fade: 28, saturation: -14, brightness: 10, tint: 6 } },
  { id: 'moody', label: 'Moody', cat: 'cinematic', p: { contrast: 18, saturation: -22, exposure: -10, shadowTint: '#1b2a3a', splitAmount: 0.3, vignette: 25 } },
  { id: 'vintage', label: 'Vintage', cat: 'vintage', p: { fade: 22, temperature: 22, saturation: -18, grain: 30, vignette: 20, highlightTint: '#ffe0a8', splitAmount: 0.2 } },
  { id: 'film-stock', label: 'Stock 400', cat: 'film', p: { contrast: 8, fade: 10, saturation: -6, grain: 22, shadowTint: '#163b37', highlightTint: '#ffd9a0', splitAmount: 0.22 } },
  { id: 'cinema', label: 'Feature', cat: 'cinematic', p: { contrast: 22, saturation: -8, temperature: -6, shadowTint: '#0e3a48', highlightTint: '#f2b27a', splitAmount: 0.3 } },
  { id: 'faded', label: 'Faded', cat: 'film', p: { fade: 40, contrast: -10, saturation: -20 } },
  { id: 'cyber', label: 'Neon night', cat: 'night', p: { saturation: 30, tint: 28, temperature: -30, contrast: 16, shadowTint: '#3a0d6b', splitAmount: 0.3 } },
  { id: 'mono', label: 'Mono', cat: 'mono', p: { mono: 1, contrast: 8 } },
  { id: 'noir', label: 'Noir', cat: 'mono', p: { mono: 1, contrast: 40, exposure: -8, vignette: 35 } },
  { id: 'silver', label: 'Silver', cat: 'mono', p: { mono: 1, fade: 20, brightness: 8, contrast: -6 } },
  { id: 'sepia', label: 'Sepia', cat: 'mono', p: { mono: 1, highlightTint: '#d9a66b', shadowTint: '#3b2412', splitAmount: 0.6, fade: 10 } },
  { id: 'selenium', label: 'Cold print', cat: 'mono', p: { mono: 1, shadowTint: '#18243a', highlightTint: '#cfd8e6', splitAmount: 0.5 } },
  ...EXTRA_FILTERS,
];

export const TRANSITION_CATEGORIES = [
  { id: 'basic', label: 'Basic' },
  { id: 'slide', label: 'Slide' },
  { id: 'shape', label: 'Wipe' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'light', label: 'Light' },
  { id: 'glitch', label: 'Glitch' },
  { id: '3d', label: '3D' },
  { id: 'blur', label: 'Blur' },
];

export const TRANSITIONS = [
  { id: 'mix', label: 'Dissolve', cat: 'basic' },
  { id: 'dip-black', label: 'Dip to black', cat: 'basic' },
  { id: 'dip-white', label: 'Dip to white', cat: 'light' },
  { id: 'blur', label: 'Blur', cat: 'blur' },
  { id: 'zoom-in', label: 'Zoom in', cat: 'zoom' },
  { id: 'zoom-out', label: 'Zoom out', cat: 'zoom' },
  { id: 'wipe-left', label: 'Wipe left', cat: 'shape' },
  { id: 'wipe-right', label: 'Wipe right', cat: 'shape' },
  { id: 'wipe-up', label: 'Wipe up', cat: 'shape' },
  { id: 'wipe-down', label: 'Wipe down', cat: 'shape' },
  { id: 'slide-left', label: 'Push left', cat: 'slide' },
  { id: 'slide-right', label: 'Push right', cat: 'slide' },
  { id: 'slide-up', label: 'Push up', cat: 'slide' },
  { id: 'slide-down', label: 'Push down', cat: 'slide' },
  { id: 'circle-open', label: 'Iris open', cat: 'shape' },
  { id: 'circle-close', label: 'Iris close', cat: 'shape' },
  { id: 'diamond', label: 'Diamond', cat: 'shape' },
  { id: 'clock', label: 'Clock wipe', cat: 'shape' },
  { id: 'blinds', label: 'Blinds', cat: 'shape' },
  { id: 'split-open', label: 'Doors', cat: 'shape' },
  { id: 'pixelize', label: 'Pixels', cat: 'glitch' },
  { id: 'glitch', label: 'Glitch', cat: 'glitch' },
  { id: 'spin', label: 'Spin', cat: 'zoom' },
  { id: 'flash', label: 'Flash', cat: 'light' },
  { id: 'ripple', label: 'Ripple', cat: 'glitch' },
  { id: 'color-burn', label: 'Burn', cat: 'light' },
  ...EXTRA_TRANSITIONS,
];

/** In, out and loop animations for visual clips. */
export const ANIMATIONS = {
  in: [
    { id: 'fade-in', label: 'Fade in', cat: 'basic' },
    { id: 'zoom-in', label: 'Zoom in', cat: 'zoom' },
    { id: 'zoom-out-in', label: 'Shrink in', cat: 'zoom' },
    { id: 'slide-left-in', label: 'Slide from right', cat: 'slide' },
    { id: 'slide-right-in', label: 'Slide from left', cat: 'slide' },
    { id: 'slide-up-in', label: 'Slide up', cat: 'slide' },
    { id: 'slide-down-in', label: 'Slide down', cat: 'slide' },
    { id: 'rotate-in', label: 'Rotate in', cat: 'spin' },
    { id: 'pop-in', label: 'Pop', cat: 'bounce' },
    { id: 'bounce-in', label: 'Bounce', cat: 'bounce' },
    { id: 'blur-in', label: 'Blur in', cat: 'blur' },
    { id: 'rise-in', label: 'Rise', cat: 'slide' },
    { id: 'drop-in', label: 'Drop', cat: 'slide' },
    { id: 'peek-in', label: 'Peek', cat: 'basic' },
    { id: 'settle-in', label: 'Settle', cat: 'zoom' },
    { id: 'glide-in', label: 'Glide', cat: 'slide' },
    { id: 'whip-left-in', label: 'Whip from right', cat: 'slide' },
    { id: 'whip-right-in', label: 'Whip from left', cat: 'slide' },
    { id: 'roll-in', label: 'Roll in', cat: 'spin' },
    { id: 'spin-up-in', label: 'Spin up', cat: 'spin' },
    { id: 'twist-in', label: 'Twist in', cat: 'spin' },
    { id: 'swing-in', label: 'Swing', cat: 'spin' },
    { id: 'elastic-in', label: 'Elastic', cat: 'bounce' },
    { id: 'rubber-in', label: 'Rubber band', cat: 'bounce' },
    { id: 'spring-in', label: 'Spring up', cat: 'bounce' },
    { id: 'back-in', label: 'Overshoot', cat: 'bounce' },
    { id: 'dive-in', label: 'Dive in', cat: 'zoom' },
    { id: 'focus-in', label: 'Focus pull', cat: 'blur' },
    { id: 'shake-in', label: 'Shake in', cat: 'shake' },
    { id: 'flicker-in', label: 'Flicker on', cat: 'shake' },
    { id: 'typewriter', label: 'Typewriter', textOnly: true },
    // Letter and word animations (engine/text-anim.js), text clips only.
    { id: 'letters-rise', label: 'Letters rise', textOnly: true, glyph: true },
    { id: 'letters-fade', label: 'Letter fade', textOnly: true, glyph: true },
    { id: 'word-pop', label: 'Word pop', textOnly: true, glyph: true },
    { id: 'word-rise', label: 'Word rise', textOnly: true, glyph: true },
    { id: 'letters-drop', label: 'Letter drop', textOnly: true, glyph: true },
    { id: 'letters-swing', label: 'Swing in', textOnly: true, glyph: true },
    { id: 'letters-blur', label: 'Blur by letter', textOnly: true, glyph: true },
    { id: 'decode', label: 'Decode', textOnly: true, glyph: true },
    { id: 'spacing-expand', label: 'Spread in', textOnly: true, glyph: true },
  ],
  out: [
    { id: 'fade-out', label: 'Fade out', cat: 'basic' },
    { id: 'zoom-out', label: 'Zoom out', cat: 'zoom' },
    { id: 'zoom-in-out', label: 'Grow out', cat: 'zoom' },
    { id: 'slide-left-out', label: 'Slide to left', cat: 'slide' },
    { id: 'slide-right-out', label: 'Slide to right', cat: 'slide' },
    { id: 'slide-up-out', label: 'Slide up out', cat: 'slide' },
    { id: 'slide-down-out', label: 'Slide down out', cat: 'slide' },
    { id: 'rotate-out', label: 'Rotate out', cat: 'spin' },
    { id: 'pop-out', label: 'Pop out', cat: 'bounce' },
    { id: 'blur-out', label: 'Blur out', cat: 'blur' },
    { id: 'sink-out', label: 'Sink', cat: 'slide' },
    { id: 'lift-out', label: 'Lift', cat: 'slide' },
    { id: 'settle-out', label: 'Release', cat: 'zoom' },
    { id: 'whip-left-out', label: 'Whip to left', cat: 'slide' },
    { id: 'whip-right-out', label: 'Whip to right', cat: 'slide' },
    { id: 'roll-out', label: 'Roll out', cat: 'spin' },
    { id: 'spin-away-out', label: 'Spin away', cat: 'spin' },
    { id: 'twist-out', label: 'Twist out', cat: 'spin' },
    { id: 'fall-out', label: 'Fall', cat: 'slide' },
    { id: 'shrink-back-out', label: 'Snap back', cat: 'bounce' },
    { id: 'squeeze-out', label: 'Squeeze', cat: 'zoom' },
    { id: 'dive-out', label: 'Dive out', cat: 'zoom' },
    { id: 'focus-out', label: 'Defocus', cat: 'blur' },
    { id: 'shake-out', label: 'Shake out', cat: 'shake' },
    { id: 'flicker-out', label: 'Flicker off', cat: 'shake' },
    { id: 'letters-sink', label: 'Letters sink', textOnly: true, glyph: true },
    { id: 'letters-fade-out', label: 'Letter fade out', textOnly: true, glyph: true },
    { id: 'word-shrink', label: 'Word shrink', textOnly: true, glyph: true },
    { id: 'letters-blur-out', label: 'Blur by letter out', textOnly: true, glyph: true },
    { id: 'decode-out', label: 'Decode out', textOnly: true, glyph: true },
    { id: 'spacing-out', label: 'Spread out', textOnly: true, glyph: true },
  ],
  loop: [
    { id: 'sway', label: 'Sway', cat: 'sway' },
    { id: 'pulse', label: 'Pulse', cat: 'pulse' },
    { id: 'float', label: 'Float', cat: 'sway' },
    { id: 'spin', label: 'Spin', cat: 'spin' },
    { id: 'wobble', label: 'Wobble', cat: 'shake' },
    { id: 'zoom-loop', label: 'Breathe', cat: 'pulse' },
    { id: 'heartbeat', label: 'Heartbeat', cat: 'pulse' },
    { id: 'bob', label: 'Bob', cat: 'sway' },
    { id: 'rock', label: 'Rock', cat: 'sway' },
    { id: 'orbit', label: 'Orbit', cat: 'sway' },
    { id: 'hover', label: 'Hover', cat: 'sway' },
    { id: 'pendulum', label: 'Pendulum', cat: 'sway' },
    { id: 'jiggle', label: 'Jiggle', cat: 'shake' },
    { id: 'blink', label: 'Blink', cat: 'pulse' },
    // Played once across the whole clip, for photos and slow b-roll.
    { id: 'push-in', label: 'Slow push in', cat: 'camera', whole: true },
    { id: 'pull-out', label: 'Slow pull out', cat: 'camera', whole: true },
    { id: 'pan-left', label: 'Pan left', cat: 'camera', whole: true },
    { id: 'pan-right', label: 'Pan right', cat: 'camera', whole: true },
    { id: 'pan-up', label: 'Pan up', cat: 'camera', whole: true },
    { id: 'pan-down', label: 'Pan down', cat: 'camera', whole: true },
    { id: 'drift-zoom', label: 'Drift', cat: 'camera', whole: true },
    { id: 'wave', label: 'Wave', textOnly: true, glyph: true },
    { id: 'letters-jelly', label: 'Jelly', textOnly: true, glyph: true },
    { id: 'flicker', label: 'Flicker', textOnly: true, glyph: true },
    { id: 'jitter', label: 'Jitter', textOnly: true, glyph: true },
    // Spans the whole clip: words light up in the highlight color as it plays.
    { id: 'karaoke', label: 'Karaoke', textOnly: true, glyph: true, whole: true },
  ],
};

/** Animation categories shown as chips in the Animation tab. */
export const ANIMATION_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'text', label: 'Letters and words' },
  { id: 'basic', label: 'Basic' },
  { id: 'slide', label: 'Slide' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'spin', label: 'Spin' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'blur', label: 'Blur' },
  { id: 'shake', label: 'Shake' },
  { id: 'sway', label: 'Sway' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'camera', label: 'Camera moves' },
];

export const BLEND_MODES = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'color-dodge', label: 'Color dodge' },
  { id: 'color-burn', label: 'Color burn' },
  { id: 'soft-light', label: 'Soft light' },
  { id: 'hard-light', label: 'Hard light' },
  { id: 'difference', label: 'Difference' },
  { id: 'add', label: 'Add' },
];

/** Fonts bundled with the app (all SIL OFL or Apache licensed). */
export const FONTS = [
  { id: 'Inter', label: 'Inter', css: "'Inter', system-ui, sans-serif" },
  { id: 'Poppins', label: 'Poppins', css: "'Poppins', sans-serif" },
  { id: 'Montserrat', label: 'Montserrat', css: "'Montserrat', sans-serif" },
  { id: 'Oswald', label: 'Oswald', css: "'Oswald', sans-serif" },
  { id: 'Bebas Neue', label: 'Bebas Neue', css: "'Bebas Neue', sans-serif" },
  { id: 'Anton', label: 'Anton', css: "'Anton', sans-serif" },
  { id: 'Playfair Display', label: 'Playfair Display', css: "'Playfair Display', serif" },
  { id: 'Merriweather', label: 'Merriweather', css: "'Merriweather', serif" },
  { id: 'Lobster', label: 'Lobster', css: "'Lobster', cursive" },
  { id: 'Pacifico', label: 'Pacifico', css: "'Pacifico', cursive" },
  { id: 'Dancing Script', label: 'Dancing Script', css: "'Dancing Script', cursive" },
  { id: 'Permanent Marker', label: 'Permanent Marker', css: "'Permanent Marker', cursive" },
  { id: 'Roboto Mono', label: 'Roboto Mono', css: "'Roboto Mono', monospace" },
];

/** Text presets shown in the Text panel; values override DEFAULT_TEXT_STYLE. */
export { TEXT_PRESETS } from './text-presets.js';

/** Sticker ids map to original vector shapes in engine/stickers.js. */
export const STICKER_CATEGORIES = [
  { id: 'shapes', label: 'Shapes' },
  { id: 'arrows', label: 'Arrows' },
  { id: 'callouts', label: 'Callouts' },
  { id: 'icons', label: 'Icons' },
];
