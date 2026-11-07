// File → New: document presets by category, units and the settings a new
// document is created from. Sizes are common output dimensions; names are
// descriptive. Pure data and arithmetic (tested in tests/new-document.test.ts).

export type NewUnit = 'px' | 'in' | 'cm' | 'mm' | 'pt' | 'pica' | 'col';
export type NewCategory = 'recent' | 'saved' | 'photo' | 'print' | 'art' | 'web' | 'mobile' | 'film';
export type NewMode = 'rgb' | 'cmyk' | 'grayscale' | 'lab';
export type NewBackground = 'white' | 'black' | 'background' | 'transparent' | 'custom';

/** Everything a new document is made from. Sizes are kept in `unit`. */
export type DocSpec = {
  name: string;
  width: number;
  height: number;
  unit: NewUnit;
  ppi: number;
  ppiUnit: 'ppi' | 'ppcm';
  mode: NewMode;
  depth: 8;
  background: NewBackground;
  color: string;
  artboards: boolean;
  // Profile reference ('working', 'untagged' or a profile reference).
  profile: string;
  pixelAspect: number;
};

export type DocPreset = {
  id: string;
  category: Exclude<NewCategory, 'recent' | 'saved'>;
  name: string;
  width: number;
  height: number;
  unit: NewUnit;
  // 'print' and 'screen' use the preset resolutions from Preferences.
  ppi: number | 'print' | 'screen';
  background?: NewBackground;
  pixelAspect?: number;
  artboards?: boolean;
};

export const CATEGORIES: [NewCategory, string][] = [
  ['recent', 'Recent'],
  ['saved', 'Saved'],
  ['photo', 'Photo'],
  ['print', 'Print'],
  ['art', 'Art & Illustration'],
  ['web', 'Web'],
  ['mobile', 'Mobile'],
  ['film', 'Film & Video'],
];

export const UNITS: [NewUnit, string][] = [
  ['px', 'Pixels'],
  ['in', 'Inches'],
  ['cm', 'Centimeters'],
  ['mm', 'Millimeters'],
  ['pt', 'Points'],
  ['pica', 'Picas'],
  ['col', 'Columns'],
];

const p = (category: DocPreset['category'], id: string, name: string, width: number, height: number, unit: NewUnit, ppi: DocPreset['ppi'], extra: Partial<DocPreset> = {}): DocPreset => ({ id, category, name, width, height, unit, ppi, ...extra });

export const PRESETS: DocPreset[] = [
  // Photo
  p('photo', 'photo-4x6', 'Photo print 6 × 4', 6, 4, 'in', 'print', { background: 'white' }),
  p('photo', 'photo-5x7', 'Photo print 7 × 5', 7, 5, 'in', 'print', { background: 'white' }),
  p('photo', 'photo-8x10', 'Photo print 10 × 8', 10, 8, 'in', 'print', { background: 'white' }),
  p('photo', 'photo-11x14', 'Photo print 14 × 11', 14, 11, 'in', 240, { background: 'white' }),
  p('photo', 'photo-square', 'Square photo', 2048, 2048, 'px', 'screen', { background: 'white' }),
  p('photo', 'photo-3x2', 'Camera frame 3:2', 6000, 4000, 'px', 'screen', { background: 'white' }),
  p('photo', 'photo-4x3', 'Camera frame 4:3', 4032, 3024, 'px', 'screen', { background: 'white' }),
  // Print
  p('print', 'print-letter', 'US Letter', 8.5, 11, 'in', 'print', { background: 'white' }),
  p('print', 'print-legal', 'US Legal', 8.5, 14, 'in', 'print', { background: 'white' }),
  p('print', 'print-tabloid', 'Tabloid', 11, 17, 'in', 'print', { background: 'white' }),
  p('print', 'print-a3', 'A3 sheet', 297, 420, 'mm', 'print', { background: 'white' }),
  p('print', 'print-a4', 'A4 sheet', 210, 297, 'mm', 'print', { background: 'white' }),
  p('print', 'print-a5', 'A5 sheet', 148, 210, 'mm', 'print', { background: 'white' }),
  p('print', 'print-b5', 'B5 sheet', 176, 250, 'mm', 'print', { background: 'white' }),
  p('print', 'print-card', 'Business card', 3.5, 2, 'in', 'print', { background: 'white' }),
  p('print', 'print-postcard', 'Postcard', 6, 4, 'in', 'print', { background: 'white' }),
  p('print', 'print-poster', 'Small poster', 11, 17, 'in', 150, { background: 'white' }),
  // Art & illustration
  p('art', 'art-a4', 'Sketch sheet A4', 210, 297, 'mm', 'print', { background: 'white' }),
  p('art', 'art-square', 'Square canvas', 3000, 3000, 'px', 'print', { background: 'white' }),
  p('art', 'art-wide', 'Wide canvas 16:9', 3840, 2160, 'px', 'print', { background: 'white' }),
  p('art', 'art-comic', 'Comic page', 6.625, 10.25, 'in', 'print', { background: 'white' }),
  p('art', 'art-poster', 'Poster 18 × 24', 18, 24, 'in', 150, { background: 'white' }),
  p('art', 'art-cover', 'Book cover 6 × 9', 6, 9, 'in', 'print', { background: 'white' }),
  // Web
  p('web', 'web-common', 'Common web page', 1366, 768, 'px', 'screen', { background: 'white' }),
  p('web', 'web-large', 'Large web page', 1920, 1080, 'px', 'screen', { background: 'white' }),
  p('web', 'web-medium', 'Medium web page', 1440, 900, 'px', 'screen', { background: 'white' }),
  p('web', 'web-hero', 'Wide header image', 1920, 600, 'px', 'screen', { background: 'white' }),
  p('web', 'web-banner', 'Leaderboard banner', 728, 90, 'px', 'screen', { background: 'white' }),
  p('web', 'web-rect', 'Medium rectangle ad', 300, 250, 'px', 'screen', { background: 'white' }),
  p('web', 'web-link', 'Link preview card', 1200, 630, 'px', 'screen', { background: 'white' }),
  p('web', 'web-post', 'Square social post', 1080, 1080, 'px', 'screen', { background: 'white' }),
  p('web', 'web-portrait', 'Portrait social post', 1080, 1350, 'px', 'screen', { background: 'white' }),
  p('web', 'web-story', 'Vertical story', 1080, 1920, 'px', 'screen', { background: 'white' }),
  p('web', 'web-icon', 'Site icon', 512, 512, 'px', 'screen', { background: 'transparent' }),
  // Mobile
  p('mobile', 'mobile-small', 'Compact phone', 1080, 1920, 'px', 'screen', { background: 'white', artboards: true }),
  p('mobile', 'mobile-standard', 'Standard phone', 1170, 2532, 'px', 'screen', { background: 'white', artboards: true }),
  p('mobile', 'mobile-large', 'Large phone', 1290, 2796, 'px', 'screen', { background: 'white', artboards: true }),
  p('mobile', 'mobile-android', 'Tall phone', 1080, 2400, 'px', 'screen', { background: 'white', artboards: true }),
  p('mobile', 'mobile-tablet', 'Tablet', 1640, 2360, 'px', 'screen', { background: 'white', artboards: true }),
  p('mobile', 'mobile-tablet-large', 'Large tablet', 2048, 2732, 'px', 'screen', { background: 'white', artboards: true }),
  p('mobile', 'mobile-watch', 'Watch face', 396, 484, 'px', 'screen', { background: 'black', artboards: true }),
  p('mobile', 'mobile-icon', 'App icon', 1024, 1024, 'px', 'screen', { background: 'white' }),
  // Film & video
  p('film', 'film-720', 'HD 720p', 1280, 720, 'px', 'screen', { background: 'black' }),
  p('film', 'film-1080', 'Full HD 1080p', 1920, 1080, 'px', 'screen', { background: 'black' }),
  p('film', 'film-uhd', 'Ultra HD 4K', 3840, 2160, 'px', 'screen', { background: 'black' }),
  p('film', 'film-2k', 'Cinema 2K', 2048, 1080, 'px', 'screen', { background: 'black' }),
  p('film', 'film-4k', 'Cinema 4K', 4096, 2160, 'px', 'screen', { background: 'black' }),
  p('film', 'film-ntsc', 'NTSC standard definition', 720, 480, 'px', 'screen', { background: 'black', pixelAspect: 10 / 11 }),
  p('film', 'film-pal', 'PAL standard definition', 720, 576, 'px', 'screen', { background: 'black', pixelAspect: 59 / 54 }),
  p('film', 'film-hdv', 'Anamorphic HD 1440 × 1080', 1440, 1080, 'px', 'screen', { background: 'black', pixelAspect: 4 / 3 }),
  p('film', 'film-vertical', 'Vertical video', 1080, 1920, 'px', 'screen', { background: 'black' }),
  p('film', 'film-square', 'Square video', 1080, 1080, 'px', 'screen', { background: 'black' }),
];

export type ColumnSize = { columnWidth: number; columnGutter: number; columnUnit: string };
const perInch: Record<string, number> = { in: 1, cm: 2.54, mm: 25.4, pt: 72, pica: 6 };
/** Document pixels per unit at `ppi` (Columns use the column width and gutter). */
function unitPixels(unit: NewUnit | string, ppi: number) {
  if (unit === 'px') return 1;
  return ppi / (perInch[unit] ?? 1);
}
/** A length in `unit` as whole pixels (at least 1). */
export function toPixels(value: number, unit: NewUnit, ppi: number, cols?: ColumnSize): number {
  if (unit === 'col') {
    const c = cols ?? { columnWidth: 180, columnGutter: 12, columnUnit: 'pt' };
    const n = Math.max(0, value);
    return Math.max(1, Math.round((n * c.columnWidth + Math.max(0, n - 1) * c.columnGutter) * unitPixels(c.columnUnit, ppi)));
  }
  return Math.max(1, Math.round(value * unitPixels(unit, ppi)));
}
/** Pixels expressed in `unit` (rounded for display). */
export function fromPixels(px: number, unit: NewUnit, ppi: number, cols?: ColumnSize): number {
  if (unit === 'col') {
    const c = cols ?? { columnWidth: 180, columnGutter: 12, columnUnit: 'pt' };
    const k = unitPixels(c.columnUnit, ppi);
    // Inverse of n columns = n·width + (n − 1)·gutter (no gutter below one column).
    const x = px / k;
    const n = x <= c.columnWidth ? x / c.columnWidth : (x + c.columnGutter) / (c.columnWidth + c.columnGutter);
    return Math.round(n * 1000) / 1000;
  }
  const v = px / unitPixels(unit, ppi);
  return Math.round(v * (unit === 'px' ? 1 : 1000)) / (unit === 'px' ? 1 : 1000);
}
/** Pixels per inch from a resolution in either unit. */
export const ppiOf = (spec: Pick<DocSpec, 'ppi' | 'ppiUnit'>) => (spec.ppiUnit === 'ppcm' ? spec.ppi * 2.54 : spec.ppi);

/** The preset's resolution given the preference resolutions. */
export function presetPpi(preset: Pick<DocPreset, 'ppi'>, prefs: { printPpi: number; screenDocPpi: number }) {
  return preset.ppi === 'print' ? prefs.printPpi : preset.ppi === 'screen' ? prefs.screenDocPpi : preset.ppi;
}

/** Pixel size of a spec, or an explanation when it cannot be created. */
export function specPixels(spec: DocSpec, cols?: ColumnSize): { width: number; height: number; error?: string } {
  const ppi = ppiOf(spec);
  const width = toPixels(spec.width, spec.unit, ppi, cols),
    height = toPixels(spec.height, spec.unit, ppi, cols);
  let error: string | undefined;
  if (!(spec.width > 0) || !(spec.height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) error = 'Enter a width and height greater than zero.';
  else if (!(ppi >= 1 && ppi <= 10000)) error = 'Use a resolution from 1 to 10,000 pixels per inch.';
  else if (width > 8192 || height > 8192) error = `${width} × ${height} px is larger than 8192 pixels on a side.`;
  else if (width * height > 24_000_000) error = `${width} × ${height} px exceeds 24 megapixels.`;
  return { width, height, error };
}

/** Bytes of an 8-bit RGBA document of that size (shown in the dialog). */
export const documentBytes = (width: number, height: number, mode: NewMode) => width * height * (mode === 'grayscale' ? 1 : mode === 'cmyk' ? 4 : 3);

/** A spec from a preset with the preference resolutions. */
export function specFromPreset(preset: DocPreset, prefs: { printPpi: number; screenDocPpi: number }, base: DocSpec): DocSpec {
  return {
    ...base,
    name: base.name,
    width: preset.width,
    height: preset.height,
    unit: preset.unit,
    ppi: presetPpi(preset, prefs),
    ppiUnit: 'ppi',
    background: preset.background ?? base.background,
    artboards: !!preset.artboards,
    pixelAspect: preset.pixelAspect ?? 1,
  };
}

export const defaultSpec = (): DocSpec => ({
  name: 'Untitled',
  width: 1600,
  height: 1000,
  unit: 'px',
  ppi: 72,
  ppiUnit: 'ppi',
  mode: 'rgb',
  depth: 8,
  background: 'transparent',
  color: '#ffffff',
  artboards: false,
  profile: 'working',
  pixelAspect: 1,
});

/** A stored spec (recent or saved preset) with every field valid. */
export function validSpec(raw: unknown): DocSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<DocSpec>;
  const d = defaultSpec();
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
  const width = num(r.width, 0.001, 100000),
    height = num(r.height, 0.001, 100000);
  if (width === undefined || height === undefined) return undefined;
  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 120) : d.name,
    width,
    height,
    unit: UNITS.some(([u]) => u === r.unit) ? (r.unit as NewUnit) : 'px',
    ppi: num(r.ppi, 1, 10000) ?? d.ppi,
    ppiUnit: r.ppiUnit === 'ppcm' ? 'ppcm' : 'ppi',
    mode: (['rgb', 'cmyk', 'grayscale', 'lab'] as const).find((m) => m === r.mode) ?? 'rgb',
    depth: 8,
    background: (['white', 'black', 'background', 'transparent', 'custom'] as const).find((b) => b === r.background) ?? d.background,
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : d.color,
    artboards: r.artboards === true,
    profile: typeof r.profile === 'string' && r.profile.length < 200 ? r.profile : 'working',
    pixelAspect: num(r.pixelAspect, 0.1, 10) ?? 1,
  };
}
