/** Apply DrawingML color transforms in order, retaining precision between stops. */
export function drawingmlColor(hex, transforms) {
  let rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const clamp = v => Math.max(0, Math.min(1, v));
  const hsl = () => {
    const hi = Math.max(...rgb), lo = Math.min(...rgb), d = hi - lo, l = (hi + lo) / 2;
    return { h: !d ? 0 : hi === rgb[0] ? ((rgb[1] - rgb[2]) / d + 6) % 6 : hi === rgb[1] ? (rgb[2] - rgb[0]) / d + 2 : (rgb[0] - rgb[1]) / d + 4,
      s: d ? d / (1 - Math.abs(2 * l - 1)) : 0, l };
  };
  for (const t of transforms || []) {
    const v = Number(t.attrs?.val) / 100000;
    if (!Number.isFinite(v)) continue;
    // Add the white contribution directly; adding one then subtracting the
    // tint loses low bits and can round an exact half-channel downward.
    if (t.name === 'tint') rgb = rgb.map(c => clamp(c * v + (1 - v)));
    else if (t.name === 'shade') rgb = rgb.map(c => clamp(c * v));
    else if (/^(lum|sat)(Mod|Off)?$/.test(t.name)) {
      const c = hsl(), key = t.name.startsWith('lum') ? 'l' : 's';
      c[key] = clamp(t.name.endsWith('Mod') ? c[key] * v : t.name.endsWith('Off') ? c[key] + v : v);
      const chroma = (1 - Math.abs(2 * c.l - 1)) * c.s, x = chroma * (1 - Math.abs(c.h % 2 - 1)), m = c.l - chroma / 2;
      rgb = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(c.h) % 6].map(c => c + m);
    }
  }
  return '#' + rgb.map(c => Math.round(clamp(c) * 255).toString(16).padStart(2, '0')).join('');
}
