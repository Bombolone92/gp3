// The native reference's SVG metafiles use this reference-device grid. These values
// come from the nested EMF headers, not from fitting document screenshots.
// A frame is expressed in 0.01 mm; the inclusive final device pixel is retained.
const device = { x: 4700 / 19900, y: 6200 / 26200 };

export function nativeSvgDimensions(root, dimensions, rounded = true) {
  const explicit = value => /^\s*(?:\d+(?:\.\d*)?|\.\d+)(?:px|pt|pc|in|cm|mm)?\s*$/.test(value || '');
  const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const ratioOnly = !explicit(root.getAttribute('width')) && !explicit(root.getAttribute('height')) && box?.length === 4;
  const size = value => rounded ? Math.max(1, Math.round(value)) : value;
  return { width: size(ratioOnly ? box[2] : dimensions.width), height: size(ratioOnly ? box[3] : dimensions.height) };
}

export function nativeSvgFrame(width, height) {
  const axis = (length, pixelsPerUnit) => {
    const start = Math.floor(-0.5 / pixelsPerUnit);
    const end = Math.floor((length - 0.5) / pixelsPerUnit);
    return { origin: start * pixelsPerUnit, length: (end - start) * pixelsPerUnit + 1 };
  };
  const x = axis(width, device.x), y = axis(height, device.y);
  return { x: x.origin, y: y.origin, width: x.length, height: y.length };
}

// Transform the root viewport, retaining its viewBox and tree. Rewriting the
// viewBox would also change percentage lengths; adding a wrapper changes CSS
// child/sibling selectors. The root clip uses viewport coordinates.
export function nativeSvgViewport(root, dimensions) {
  const style = getComputedStyle(root);
  // Root clipping and transforms need independent composition references.
  // Preserve their previous path rather than replacing an authored clip.
  if (style.clipPath !== 'none' || style.transform !== 'none') return false;
  const { width, height } = dimensions, frame = nativeSvgFrame(width, height);
  const sx = width / frame.width, sy = height / frame.height;
  root.style.transformBox = 'border-box';
  root.style.transformOrigin = '0px 0px';
  root.style.transform = `matrix(${sx},0,0,${sy},${-frame.x * sx},${-frame.y * sy})`;
  const ns = 'http://www.w3.org/2000/svg';
  let id = '_nativeSvgViewport';
  while (root.id === id || root.querySelector(`[id="${id}"]`)) id += '_';
  const clip = root.ownerDocument.createElementNS(ns, 'clipPath');
  clip.setAttribute('id', id); clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
  clip.setAttribute('style', 'all:initial');
  const outline = root.ownerDocument.createElementNS(ns, 'polygon');
  outline.setAttribute('points', `0,0 ${width},0 ${width},${height} 0,${height}`);
  outline.setAttribute('style', 'all:initial;fill:black');
  clip.append(outline); root.append(clip); root.style.clipPath = `url(#${id})`;
  return true;
}
