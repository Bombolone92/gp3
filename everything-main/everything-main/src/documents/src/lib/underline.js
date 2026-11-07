/**
 * Underline styles and colors for the selected text: single, double,
 * thick, dotted, dashed, and wavy lines (`w:u`), in any color. The Document
 * API writes them but does not read them back, so the current line comes
 * from how the painter renders the run at the selection (`text-decoration`).
 */

import { inspectSelection } from './commands.js';

export const UNDERLINE_STYLES = [
  { id: 'single', label: 'Single', css: 'solid' },
  { id: 'double', label: 'Double', css: 'double' },
  { id: 'thick', label: 'Thick', css: 'solid' },
  { id: 'dotted', label: 'Dotted', css: 'dotted' },
  { id: 'dash', label: 'Dashed', css: 'dashed' },
  { id: 'wave', label: 'Wavy', css: 'wavy' },
];

/** "rgb(0, 0, 255)" or "#00f" -> "#0000ff"; black is an explicit color too. */
export function cssColorToHex(value) {
  const v = String(value || '').trim().toLowerCase();
  let hex = null;
  const rgb = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*1(?:\.0+)?)?\s*\)$/.exec(v);
  if (rgb) hex = `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')).join('')}`;
  else if (/^#[0-9a-f]{6}$/.test(v)) hex = v;
  else if (/^#[0-9a-f]{3}$/.test(v)) hex = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return hex;
}

/**
 * The underline a painted run carries, from its computed text decoration:
 * { style, color } or null when it has none. A solid line reads as single
 * (thick paints solid too).
 */
export function parseUnderline({ textDecorationLine, textDecorationStyle, textDecorationColor } = {}) {
  if (!/\bunderline\b/.test(String(textDecorationLine || ''))) return null;
  const css = String(textDecorationStyle || 'solid').toLowerCase();
  const style = UNDERLINE_STYLES.find((s) => s.css === css)?.id || 'single';
  return { style, color: cssColorToHex(textDecorationColor) };
}

/** The underline at the start of the selection ({ style, color }), null for none, undefined when unreadable. */
export function underlineAtSelection(ui, host) {
  return inspectSelection(ui, host, (el) => {
    if (!el.classList?.contains('document-text-run')) return null;
    return parseUnderline(getComputedStyle(el)) || null;
  });
}

/** The inline patch for a choice: a styled, optionally colored line, or `false` to remove it. */
export function underlinePatch({ style = 'single', color = null } = {}) {
  if (style === 'none') return { underline: false };
  const patch = { style: UNDERLINE_STYLES.some((s) => s.id === style) ? style : 'single' };
  if (color) patch.color = color.replace(/^#/, '').toUpperCase();
  else patch.color = null;
  return { underline: patch };
}

/** Apply an underline choice to a SelectionTarget; throws when the engine rejects it. */
export async function applyUnderline(api, target, choice) {
  const r = await api.format.apply({ target, inline: underlinePatch(choice) });
  if (r == null || (r.success === false && r.failure?.code !== 'NO_OP')) throw new Error(r?.failure?.message || 'The underline was not applied');
  return r;
}
