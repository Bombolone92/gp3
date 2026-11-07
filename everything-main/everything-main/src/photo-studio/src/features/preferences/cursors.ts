// Cursors preferences: tool icon cursors ("standard") or a plain crosshair
// ("precise") for tools that point at pixels, and the painting cursor shapes.
import type { Editor } from '../../editor';
import type { Tool } from '../../app/registry';
import { svg } from '../../app/icons';

const cache = new Map<string, string>();
/** A cursor with a precise cross at its hotspot and the tool's icon beside it. */
export function iconCursor(icon: string): string {
  let url = cache.get(icon);
  if (url) return url;
  const inner = svg(icon, 16).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const glyph = (stroke: string, width: number) => `<g transform="translate(13 13) scale(0.6667)" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
  const cross = (stroke: string, width: number) => `<path d="M6 0v4M6 8v4M0 6h4M8 6h4" stroke="${stroke}" stroke-width="${width}"/>`;
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${cross('#fff', 3)}${cross('#000', 1)}${glyph('#fff', 4.5)}${glyph('#000', 1.8)}</svg>`;
  url = `url("data:image/svg+xml,${encodeURIComponent(body)}") 6 6, crosshair`;
  cache.set(icon, url);
  return url;
}

/** The CSS cursor of a tool under the Cursors preferences. */
export function toolCursor(e: Editor, tool: Tool | undefined): string {
  const raw = tool?.cursor?.(e) ?? '';
  if (raw === 'crosshair' && tool && e.preferences.otherCursor === 'standard') return iconCursor(tool.icon);
  return raw;
}
