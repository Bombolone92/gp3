/**
 * Text looks: style presets (complete looks shown in the Text panel and the
 * Basic tab) and word-art effects (decoration bundles from the renderer's
 * features: gradients, outlines, glow, depth, color split, curves). All
 * values override DEFAULT_TEXT_STYLE. Every look here is original.
 */
import { DEFAULT_TEXT_STYLE } from './project.js';
import { DECOR_KEYS } from './text-style.js';

/** Style presets: id, label, sample text and style overrides. */
export const TEXT_PRESETS = [
  { id: 'plain', label: 'Plain', style: {} },
  { id: 'title-bold', label: 'Title', text: 'Big title', style: { font: 'Anton', size: 120, case: 'upper' } },
  { id: 'outline', label: 'Outline', text: 'Outline', style: { font: 'Montserrat', bold: true, size: 90, color: '#ffffff', strokeColor: '#111111', strokeWidth: 8 } },
  { id: 'subtitle', label: 'Subtitle', text: 'Subtitle text', style: { font: 'Inter', size: 48, bgOpacity: 0.6, bgColor: '#000000' } },
  { id: 'yellow-caption', label: 'Caption pop', text: 'CAPTION', style: { font: 'Poppins', bold: true, size: 72, color: '#ffe14d', strokeColor: '#000000', strokeWidth: 6, case: 'upper' } },
  { id: 'neon', label: 'Neon', text: 'Neon', style: { font: 'Pacifico', size: 96, color: '#ffffff', shadowColor: '#ff3df2', shadowOpacity: 1, shadowBlur: 24, shadowDistance: 0 } },
  { id: 'serif', label: 'Elegant', text: 'Elegant', style: { font: 'Playfair Display', italic: true, size: 88, letterSpacing: 2 } },
  { id: 'label', label: 'Label', text: 'LABEL', style: { font: 'Oswald', size: 56, color: '#111111', bgColor: '#ffffff', bgOpacity: 1, bgRadius: 6, letterSpacing: 6, case: 'upper' } },
  { id: 'marker', label: 'Marker', text: 'Hand written', style: { font: 'Permanent Marker', size: 84, color: '#ff5a36' } },
  { id: 'script', label: 'Script', text: 'Lovely day', style: { font: 'Dancing Script', size: 100, color: '#ffffff', shadowOpacity: 0.6, shadowBlur: 10 } },
  { id: 'mono', label: 'Terminal', text: '> typing...', style: { font: 'Roboto Mono', size: 52, color: '#5dff8a', bgColor: '#0b0f0c', bgOpacity: 0.85, bgRadius: 4 } },
  { id: 'lower-third', label: 'Lower third', text: 'Name Surname\nTitle', style: { font: 'Inter', bold: true, size: 44, align: 'left', bgColor: '#1f6feb', bgOpacity: 1, bgRadius: 2 } },
  { id: 'headline', label: 'Headline', text: 'HEADLINE', style: { font: 'Bebas Neue', size: 140, letterSpacing: 4, shadowOpacity: 0.45, shadowBlur: 16, shadowDistance: 6 } },
  { id: 'news', label: 'News bar', text: 'Live update', style: { font: 'Oswald', bold: true, size: 54, case: 'upper', bgColor: '#d7263d', bgOpacity: 1, bgRadius: 0, letterSpacing: 2 } },
  { id: 'quote', label: 'Quote', text: '“Say it well”', style: { font: 'Playfair Display', italic: true, size: 76, color: '#fff7e8', shadowOpacity: 0.5, shadowBlur: 12, shadowDistance: 3 } },
  { id: 'note', label: 'Note', text: 'Remember this', style: { font: 'Permanent Marker', size: 60, color: '#3b2f00', bubble: 'sticky', bubbleFill: '#ffe66d', bubbleStrokeWidth: 0 } },
  { id: 'speech', label: 'Speech', text: 'Hello there!', style: { font: 'Poppins', bold: true, size: 60, color: '#111111', bubble: 'speech', bubbleFill: '#ffffff', bubbleStroke: '#111111', bubbleStrokeWidth: 4 } },
  { id: 'thinking', label: 'Thinking', text: 'Hmm...', style: { font: 'Poppins', size: 60, color: '#222222', bubble: 'thought', bubbleFill: '#ffffff', bubbleStroke: '#222222', bubbleStrokeWidth: 3 } },
  { id: 'price', label: 'Price tag', text: 'NEW', style: { font: 'Montserrat', bold: true, size: 64, color: '#ffffff', bubble: 'tag', bubbleFill: '#e8453c', bubbleStrokeWidth: 0, letterSpacing: 3 } },
  { id: 'minimal', label: 'Minimal', text: 'minimal', style: { font: 'Inter', size: 44, letterSpacing: 14, case: 'upper' } },
  { id: 'heavy', label: 'Heavy', text: 'Heavy', style: { font: 'Montserrat', bold: true, size: 110, shadowOpacity: 1, shadowBlur: 0, shadowDistance: 7, shadowColor: '#1d1d1d' } },
  { id: 'retro', label: 'Retro', text: 'Retro', style: { font: 'Lobster', size: 110, color: '#ffb703', strokeColor: '#8d2a00', strokeWidth: 5, extrudeDepth: 6, extrudeColor: '#8d2a00' } },
  { id: 'clean-caption', label: 'Clean caption', text: 'Clean caption', style: { font: 'Inter', bold: true, size: 54, shadowOpacity: 0.85, shadowBlur: 12, shadowDistance: 2 } },
  { id: 'boxed', label: 'Boxed', text: 'Boxed text', style: { font: 'Poppins', bold: true, size: 54, color: '#111111', bgColor: '#ffffff', bgOpacity: 1, bgRadius: 14 } },
  { id: 'highlighter', label: 'Highlighter', text: 'Key point', style: { font: 'Poppins', bold: true, size: 64, color: '#111111', bubble: 'highlight', bubbleFill: '#ffe14d' } },
  { id: 'cinematic', label: 'Cinematic', text: 'The journey', style: { font: 'Playfair Display', size: 64, letterSpacing: 22, case: 'upper', color: '#f3eee6' } },
  { id: 'arcade', label: 'Arcade', text: 'LEVEL UP', style: { font: 'Roboto Mono', bold: true, size: 72, color: '#d9ffe1', glowColor: '#38ff6a', glowStrength: 60, glowRadius: 18 } },
  { id: 'playful', label: 'Playful', text: 'Yay!', style: { font: 'Pacifico', size: 104, color: '#ff4fa0', strokeColor: '#ffffff', strokeWidth: 7, stroke2Color: '#7a2bd6', stroke2Width: 4 } },
  { id: 'ribbon', label: 'Ribbon', text: 'Special', style: { font: 'Montserrat', bold: true, size: 58, color: '#ffffff', case: 'upper', bubble: 'ribbon', bubbleFill: '#c8102e', bubbleStrokeWidth: 0, letterSpacing: 3 } },
  { id: 'handle', label: 'Handle', text: '@yourname', style: { font: 'Poppins', bold: true, size: 52, color: '#ffffff', bubble: 'pill', bubbleFill: '#7a2bd6', bubbleStrokeWidth: 0 } },
  { id: 'chat', label: 'Chat', text: 'See you soon', style: { font: 'Inter', size: 52, color: '#ffffff', bubble: 'speech-right', bubbleFill: '#2f7cf6', bubbleStrokeWidth: 0 } },
];

/** Word-art effects: decoration bundles (fonts included where the look depends on it). */
export const TEXT_EFFECTS = [
  { id: 'sunset', label: 'Sunset', style: { font: 'Anton', fillType: 'linear', grad1: '#ffd23f', grad2: '#ff5e7e', grad3: '#8a4dff', gradAngle: 90 } },
  { id: 'ocean', label: 'Ocean', style: { font: 'Montserrat', bold: true, fillType: 'linear', grad1: '#7af0ff', grad2: '#2b6bff', gradAngle: 90, strokeColor: '#0b1f4d', strokeWidth: 3 } },
  { id: 'double-line', label: 'Double line', style: { font: 'Montserrat', bold: true, color: '#ffffff', strokeColor: '#111111', strokeWidth: 6, stroke2Color: '#ffd23f', stroke2Width: 6 } },
  { id: 'neon-pink', label: 'Neon pink', style: { font: 'Montserrat', bold: true, color: '#ffe6fb', glowColor: '#ff3df2', glowStrength: 75, glowRadius: 26 } },
  { id: 'neon-cyan', label: 'Neon cyan', style: { font: 'Dancing Script', bold: true, color: '#e8fdff', glowColor: '#29d3ff', glowStrength: 80, glowRadius: 22, strokeColor: '#29d3ff', strokeWidth: 1 } },
  { id: 'block', label: 'Block 3D', style: { font: 'Anton', color: '#ffd23f', strokeColor: '#1b1b1b', strokeWidth: 3, extrudeDepth: 12, extrudeColor: '#1b1b1b', extrudeAngle: 45 } },
  { id: 'retro-pop', label: 'Retro pop', style: { font: 'Lobster', color: '#ff6b4a', strokeColor: '#fff4d6', strokeWidth: 4, extrudeDepth: 9, extrudeColor: '#2d1b69', extrudeAngle: 35 } },
  { id: 'chrome', label: 'Chrome', style: { font: 'Montserrat', bold: true, fillType: 'linear', grad1: '#f4f7fb', grad2: '#6f7a88', grad3: '#e6ebf2', gradAngle: 90, strokeColor: '#30363f', strokeWidth: 2, shadowOpacity: 0.5, shadowBlur: 10, shadowDistance: 4 } },
  { id: 'gold', label: 'Gold', style: { font: 'Playfair Display', bold: true, fillType: 'linear', grad1: '#fff3b0', grad2: '#d9a227', grad3: '#8a5a00', gradAngle: 90, strokeColor: '#4d3200', strokeWidth: 2 } },
  { id: 'two-tone', label: 'Two-tone', style: { font: 'Anton', fillType: 'split', grad1: '#ffb703', grad2: '#fb5607', gradAngle: 90, strokeColor: '#1d1d1d', strokeWidth: 4 } },
  { id: 'glitch', label: 'Glitch', style: { font: 'Roboto Mono', bold: true, color: '#ffffff', glitch: 5, glitchColorA: '#00e5ff', glitchColorB: '#ff2d78' } },
  { id: 'hollow', label: 'Hollow', style: { font: 'Montserrat', bold: true, fillOpacity: 0, strokeColor: '#ffffff', strokeWidth: 3 } },
  { id: 'long-shadow', label: 'Long shadow', style: { font: 'Poppins', bold: true, color: '#ffffff', shadowColor: '#000000', shadowOpacity: 0.55, shadowBlur: 18, shadowDistance: 26, shadowAngle: 60 } },
  { id: 'comic', label: 'Comic', style: { font: 'Anton', italic: true, color: '#ffe14d', strokeColor: '#111111', strokeWidth: 7, extrudeDepth: 6, extrudeColor: '#111111', extrudeAngle: 60 } },
  { id: 'candy', label: 'Candy', style: { font: 'Pacifico', fillType: 'linear', grad1: '#ffb3e1', grad2: '#ff4fa0', gradAngle: 90, strokeColor: '#ffffff', strokeWidth: 6, stroke2Color: '#ff4fa0', stroke2Width: 4 } },
  { id: 'frost', label: 'Frost', style: { font: 'Montserrat', bold: true, fillType: 'linear', grad1: '#ffffff', grad2: '#9be7ff', gradAngle: 90, strokeColor: '#2a7ab0', strokeWidth: 2, glowColor: '#9be7ff', glowStrength: 35, glowRadius: 18 } },
  { id: 'ember', label: 'Ember', style: { font: 'Anton', fillType: 'linear', grad1: '#fff07a', grad2: '#ff8a00', grad3: '#ff2a00', gradAngle: 90, glowColor: '#ff5a00', glowStrength: 50, glowRadius: 20 } },
  { id: 'offset', label: 'Offset', style: { font: 'Poppins', bold: true, color: '#ffffff', extrudeDepth: 7, extrudeColor: '#19c39c', extrudeAngle: 45 } },
  { id: 'stamp', label: 'Stamp', style: { font: 'Oswald', bold: true, case: 'upper', letterSpacing: 4, color: '#d7263d', fillOpacity: 0.9, bubble: 'double-frame', bubbleFill: '#fff8ef', bubbleStroke: '#d7263d', bubbleStrokeWidth: 3 } },
  { id: 'sticker', label: 'Sticker', style: { font: 'Poppins', bold: true, color: '#2b2b2b', strokeColor: '#ffffff', strokeWidth: 10, shadowOpacity: 0.35, shadowBlur: 10, shadowDistance: 5 } },
  { id: 'pastel', label: 'Pastel', style: { font: 'Poppins', bold: true, fillType: 'linear', grad1: '#a1c4fd', grad2: '#fbc2eb', gradAngle: 0, strokeColor: '#ffffff', strokeWidth: 4 } },
  { id: 'drop-pop', label: 'Drop pop', style: { font: 'Montserrat', bold: true, color: '#ffffff', shadowColor: '#000000', shadowOpacity: 1, shadowBlur: 0, shadowDistance: 8, shadowAngle: 45 } },
  { id: 'vapor', label: 'Vapor', style: { font: 'Montserrat', bold: true, italic: true, fillType: 'split', grad1: '#ff71ce', grad2: '#01cdfe', gradAngle: 90, glowColor: '#b967ff', glowStrength: 40, glowRadius: 16 } },
  { id: 'halo', label: 'Halo', style: { font: 'Playfair Display', color: '#ffffff', glowColor: '#ffffff', glowStrength: 55, glowRadius: 30 } },
  { id: 'slime', label: 'Slime', style: { font: 'Anton', fillType: 'linear', grad1: '#c6ff4d', grad2: '#3ddc84', gradAngle: 90, strokeColor: '#0d3b1e', strokeWidth: 5, extrudeDepth: 5, extrudeColor: '#0d3b1e', extrudeAngle: 90 } },
  { id: 'arch', label: 'Arch', style: { font: 'Montserrat', bold: true, color: '#ffffff', strokeColor: '#1d1d1d', strokeWidth: 5, arc: 40 } },
  { id: 'smile', label: 'Smile curve', style: { font: 'Poppins', bold: true, fillType: 'linear', grad1: '#ffd23f', grad2: '#ff7a00', gradAngle: 0, strokeColor: '#3a1a00', strokeWidth: 3, arc: -35 } },
];

const NEUTRAL = Object.fromEntries(DECOR_KEYS.map((k) => [k, DEFAULT_TEXT_STYLE[k]]));

/**
 * Apply a word-art effect to a style: decorations go back to neutral, then
 * the effect's values apply. Size, box, alignment and spacing stay unless
 * the effect sets them. null removes the effect's decorations.
 */
export function applyTextEffect(style, effect) {
  if (!effect) return { ...style, ...NEUTRAL, arc: 0, effect: '' };
  return { ...style, ...NEUTRAL, arc: 0, ...effect.style, effect: effect.id };
}

/**
 * A preset or effect by id as a look { id, label, text, style, kind }.
 * Effects become full looks at a word-art size.
 */
export function findTextLook(id) {
  const p = TEXT_PRESETS.find((x) => x.id === id);
  if (p) return { ...p, kind: 'preset' };
  const e = TEXT_EFFECTS.find((x) => x.id === id);
  if (e) return { id: e.id, label: e.label, text: e.label, kind: 'effect', style: { size: 110, ...e.style, effect: e.id } };
  return null;
}
