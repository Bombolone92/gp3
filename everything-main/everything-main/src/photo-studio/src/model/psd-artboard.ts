import type { Layer as PsdLayer } from 'ag-psd';
import type { ArtboardBackground, ArtboardData } from './artboard';

// Artboard groups in PSD carry an 'artb' descriptor: the rectangle, a preset
// name and a background type (1 white, 2 black, 3 transparent, 4 color).
type PsdArtboard = NonNullable<PsdLayer['artboard']>;
const types: ArtboardBackground[] = ['white', 'black', 'transparent', 'custom'];

const hex = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n || 0)))
    .toString(16)
    .padStart(2, '0');

export function exportPsdArtboard(a: ArtboardData): PsdArtboard {
  const r = a.rect;
  const color = a.color ?? '#ffffff';
  return {
    rect: { top: r.y, left: r.x, bottom: r.y + r.height, right: r.x + r.width },
    presetName: '',
    backgroundType: types.indexOf(a.background) + 1,
    color: { r: parseInt(color.slice(1, 3), 16), g: parseInt(color.slice(3, 5), 16), b: parseInt(color.slice(5, 7), 16) },
  };
}

export function importPsdArtboard(a: PsdArtboard): ArtboardData | undefined {
  const r = a.rect;
  if (![r.left, r.top, r.right, r.bottom].every(Number.isFinite) || r.right <= r.left || r.bottom <= r.top) return;
  const background = types[(a.backgroundType ?? 1) - 1] ?? 'white';
  const out: ArtboardData = {
    rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.right - r.left), height: Math.round(r.bottom - r.top) },
    background,
    clip: true,
  };
  const c = a.color as { r?: number; g?: number; b?: number } | undefined;
  if (background === 'custom' && c && 'r' in c) out.color = `#${hex(c.r!)}${hex(c.g!)}${hex(c.b!)}`;
  return out;
}
