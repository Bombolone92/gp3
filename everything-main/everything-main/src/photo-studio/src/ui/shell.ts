import { svg } from '../app/icons';

// Compatibility helpers for markup builders shared with the workspace.
export const icon = (name: string) => svg(name === 'lock-keyhole' ? 'lock' : name, 16);
export const button = (action: string, label: string, glyph: string, extra = '') =>
  `<button type="button" data-action="${action}" title="${label}" aria-label="${label}" ${extra}>${icon(glyph)}</button>`;
export function refreshIcons() {
  /* Icons are inline SVG; nothing to hydrate. */
}
