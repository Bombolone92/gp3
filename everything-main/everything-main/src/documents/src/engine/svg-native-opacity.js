// The native vector SVG export combines paint/object alpha, then truncates to a
// byte. Translucent ancestor groups use a different raster path there.
// References: svg-opacity-values and svg-opacity-composition reference captures.
export function nativeSvgAlpha(opacity, paintOpacity, colorAlpha = 1) {
  return Math.floor(Math.max(0, Math.min(1, opacity * paintOpacity * colorAlpha)) * 255 + 1e-10) / 255;
}

function solidPaint(value) {
  if (value === 'none') return { color: 'none', alpha: 1 };
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value);
  return match ? { color: `rgb(${match[1]}, ${match[2]}, ${match[3]})`, alpha: Number(match[4] ?? 1) } : null;
}

export function nativeSvgOpacities(root) {
  const snapshots = new Map();
  // Snapshot the cascade before writing overrides: fill/stroke opacity inherit.
  for (const node of [root, ...root.querySelectorAll('*')]) {
    const s = getComputedStyle(node);
    snapshots.set(node, { opacity: Number(s.opacity), fillOpacity: Number(s.fillOpacity),
      strokeOpacity: Number(s.strokeOpacity), fill: solidPaint(s.fill), stroke: solidPaint(s.stroke) });
  }
  for (const node of root.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')) {
    const s = snapshots.get(node);
    // The native reference rasterizes translucent fill+stroke shapes, like translucent groups.
    // Gradient/stroke paint needs its own reference-backed compatibility path.
    if (!s.fill || !s.stroke || s.stroke.color !== 'none') continue;
    let rasterGroup = false;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (snapshots.get(parent)?.opacity < 1) { rasterGroup = true; break; }
      if (parent === root) break;
    }
    if (rasterGroup) continue;
    const fill = nativeSvgAlpha(s.opacity, s.fillOpacity, s.fill.alpha);
    if (s.opacity === 1 && fill === s.fillOpacity && s.fill.alpha === 1) continue;
    node.style.opacity = '1';
    node.style.fill = s.fill.color;
    node.style.fillOpacity = String(fill);
  }
}
