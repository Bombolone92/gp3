// Colors in the model are resolved sRGB hex strings or the automatic sentinel.
export function normalizeColor(value) {
  if (typeof value !== 'string' || !/^(auto|[0-9a-fA-F]{6})$/.test(value)) throw new Error('Choose Automatic or a six-digit RGB color.');
  return value === 'auto' ? value : value.toUpperCase();
}

// MS-OI29500 §2.1.72 specifies HSL lightness for WML byte modifiers.
// Native controls match 1530-unit L/S and branch-coupled integer endpoints.
// Relative channel positions encode hue without a rounded whole-circle angle.
export function themeColorTransform(rgb, tint, shade) {
  if (tint === undefined && shade === undefined) return rgb;
  const amount = Math.round((tint ?? shade) * 255);
  if (amount === 255) return rgb.toUpperCase();
  const channels = rgb.match(/../g).map(v => parseInt(v, 16));
  const hi = Math.max(...channels), lo = Math.min(...channels), delta = hi - lo;
  if (delta === 0) {
    // WML modifiers are bytes. Transformed achromatic colors are truncated;
    // integer arithmetic also keeps exact endpoints clear of floating error.
    const base = lo;
    const value = Math.floor((tint !== undefined ? 65025 - (255 - base) * amount : base * amount) / 255);
    return value.toString(16).padStart(2, '0').repeat(3).toUpperCase();
  }
  const saturation = Math.floor(delta * 1530 / Math.min(hi + lo, 510 - hi - lo));
  const initial = (hi + lo) * 3;
  const light = Math.floor((initial * amount + (tint !== undefined ? 1530 * (255 - amount) : 0)) / 255);
  const maximum = light <= 765 ? Math.floor(light * (1530 + saturation) / 1530)
    : light + saturation - Math.floor(light * saturation / 1530);
  const minimum = 2 * light - maximum;
  return channels.map(c => {
    const position = Math.floor((c - lo) * 255 / delta);
    const value = Math.floor((minimum * 255 + (maximum - minimum) * position) / 1530);
    return value.toString(16).padStart(2, '0');
  }).join('').toUpperCase();
}

// Automatic foreground follows the shading/cell/page background. Explicit RGB
// remains explicit even when the user chooses a low-contrast combination.
export function paintColor(value, background = '#FFFFFF') {
  if (value && value !== 'auto') return `#${value}`;
  const channels = background.replace('#', '').match(/../g).map(v => {
    const c = parseInt(v, 16) / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? '#000000' : '#FFFFFF';
}

// Ordered DrawingML/W14 lightness transforms retain floating-point channels
// until the final color is encoded. Preserve hue and saturation at each step.
export function luminanceTransform(channels, amount, offset = false) {
  const hi = Math.max(...channels), lo = Math.min(...channels), delta = hi - lo, light = (hi + lo) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  const next = Math.max(0, Math.min(1, offset ? light + amount : light * amount));
  const chroma = (1 - Math.abs(2 * next - 1)) * saturation, min = next - chroma / 2;
  return channels.map(c => delta ? min + (c - lo) / delta * chroma : next);
}

// Table/cell borders use black for Automatic, independently of
// cell shading and page color. Text and paragraph borders have other rules.
export const tableBorderColor = value => value && value !== 'auto' ? `#${value}` : '#000000';
