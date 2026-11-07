import { projection3d, intersectExtrusion } from './drawing-3d-geometry.js';
import { create3dShader } from './drawing-3d-lighting.js';
import { outlineDistance, outlineBoundary, intersectOffsetExtrusion } from './drawing-outline-geometry.js';
import { prepareBevel } from './drawing-bevel-geometry.js';
import { clippedRectangle } from './drawing-clipped-rectangle.js';

// Original retained-picture painter. Document dimensions remain independent
// of this session bitmap; all source DrawingML is kept for serialization.
export async function decodePicture3d(asset, bitmaps) {
  const scene = asset.scene, picture = bitmaps.get(scene.image.assetId);
  if (!picture || picture.bitmap || picture.previewPlaceholder) throw new Error('A 3D picture source could not be decoded.');
  const width = scene.width / 12700, height = scene.height / 12700;
  const { depth, contour, contourColor, geometry, turn, perspective } = scene;
  const shade3d = create3dShader(scene.lighting);
  const lineWidth = scene.outline?.width || 0, radius = lineWidth / 2;
  const bevelHeight = scene.bevel?.height || 0;
  // The centerline frame expands by half a line width on each side when
  // both extrusion and contour are zero. The independent flat/deep probes
  // distinguish this from the centered outline used for a non-flat solid.
  const flatExpansion = !depth && !contour && !bevelHeight ? lineWidth : 0;
  const baseWidth = width + flatExpansion, baseHeight = height + flatExpansion;
  const outlineColor = scene.outline?.color.match(/../g).map(c => parseInt(c, 16));
  const camera = projection3d({ turn, perspective }), shift = contour / 2 + bevelHeight;
  const scale = 8 / 3; // Existing drawing-preview density: twice CSS resolution.
  const project = (x, y, z) => camera.project([x, y, z - shift]);
  const outerWidth = baseWidth + lineWidth, outerHeight = baseHeight + lineWidth;
  // The solid rectangular mesh has sharp outer corners even with a:round.
  // The zero-depth/zero-contour path uses rounded stroke corners instead.
  const rectangularSolid = geometry === 'rect' && Boolean(depth || contour || bevelHeight || ['miter','bevel'].includes(scene.outline?.join));
  const clippedJoin = geometry === 'rect' && (scene.outline?.join==='bevel' || scene.outline?.join==='miter' && scene.outline.miterLimit<Math.SQRT2);
  const clipped = clippedJoin ? clippedRectangle(outerWidth,outerHeight,depth,radius) : null;
  const corners = [[-outerWidth / 2, -outerHeight / 2], [outerWidth / 2, -outerHeight / 2], [outerWidth / 2, outerHeight / 2], [-outerWidth / 2, outerHeight / 2]];
  // Bound the curved solid by its containing rectangular prism, including
  // physical contour width. This also checks the camera-plane constraint.
  const bounds = corners.flatMap(([x, y]) => [project(x, y, bevelHeight), project(x, y, -depth)]);
  const left = Math.floor((Math.min(...bounds.map(p => p[0])) - contour / 2 - 1 + width / 2) * 4 / 3);
  const top = Math.floor((Math.min(...bounds.map(p => p[1])) - contour / 2 - 1 + height / 2) * 4 / 3);
  const right = Math.ceil((Math.max(...bounds.map(p => p[0])) + contour / 2 + 1 + width / 2) * 4 / 3);
  const bottom = Math.ceil((Math.max(...bounds.map(p => p[1])) + contour / 2 + 1 + height / 2) * 4 / 3);
  const w = right - left, h = bottom - top;
  if (w > 4096 || h > 4096 || w * h > 4000000) throw new Error('This drawing preview exceeds the image resource limit.');
  const canvas = new OffscreenCanvas(w * 2, h * 2), ctx = canvas.getContext('2d');
  const crop = scene.image.crop;
  const requestedWidth = Math.ceil(width * scale / (1 - (crop.left + crop.right) / 100000));
  const requestedHeight = Math.ceil(height * scale / (1 - (crop.top + crop.bottom) / 100000));
  let source = new OffscreenCanvas(picture.width, picture.height), sourceCtx = source.getContext('2d');
  sourceCtx.globalAlpha = scene.image.opacity ?? 1;
  sourceCtx.drawImage(picture, 0, 0);
  // A four-texel lookup cannot filter a footprint spanning many source pixels.
  // Half-size levels average those pixels before projection, retaining the next
  // level above the preview's density. Crops determine the visible footprint;
  // opacity is applied once, and Canvas filters premultiplied color/alpha.
  while (source.width / 2 >= requestedWidth || source.height / 2 >= requestedHeight) {
    const nextWidth = source.width / 2 >= requestedWidth ? Math.floor(source.width / 2) : source.width;
    const nextHeight = source.height / 2 >= requestedHeight ? Math.floor(source.height / 2) : source.height;
    const next = new OffscreenCanvas(nextWidth, nextHeight), nextCtx = next.getContext('2d');
    nextCtx.drawImage(source, 0, 0, nextWidth, nextHeight);
    source.width = 0; source.height = 0;
    source = next; sourceCtx = nextCtx;
  }
  const sourceWidth = source.width, sourceHeight = source.height;
  const pixels = sourceCtx.getImageData(0, 0, sourceWidth, sourceHeight).data;
  const backing = scene.backingFill;
  const backingRgb = backing?.rgb.match(/../g).map(c => parseInt(c, 16));
  const compositeBacking = rgba => {
    if (!backing) return rgba;
    // Bilinear weights can sum a few ulps above one. Keep the source-over
    // weights nonnegative, and clamp rounding noise before the strict shader.
    const alpha = Math.max(0,Math.min(1,rgba[3] / 255)), behind = backing.alpha * (1 - alpha), total = alpha + behind;
    return total ? [...rgba.slice(0, 3).map((c, i) => Math.max(0,Math.min(255,(c * alpha + backingRgb[i] * behind) / total))), total * 255] : [0, 0, 0, 0];
  };
  const sample = (x, y) => {
    x = Math.max(-width / 2, Math.min(width / 2, x));
    y = Math.max(-height / 2, Math.min(height / 2, y));
    const u = crop.left / 100000 + (x / width + .5) * (1 - (crop.left + crop.right) / 100000);
    const v = crop.top / 100000 + (y / height + .5) * (1 - (crop.top + crop.bottom) / 100000);
    if (u < 0 || u > 1 || v < 0 || v > 1) return [0, 0, 0, 0];
    const sx = Math.max(0, Math.min(sourceWidth - 1, u * sourceWidth - .5));
    const sy = Math.max(0, Math.min(sourceHeight - 1, v * sourceHeight - .5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0 + 1, sourceWidth - 1), y1 = Math.min(y0 + 1, sourceHeight - 1);
    const fx = sx - x0, fy = sy - y0;
    const rgba = [0, 0, 0, 0];
    for (const [px, py, weight] of [[x0, y0, (1 - fx) * (1 - fy)], [x1, y0, fx * (1 - fy)], [x0, y1, (1 - fx) * fy], [x1, y1, fx * fy]]) {
      const i = (py * sourceWidth + px) * 4, alpha = pixels[i + 3] / 255;
      for (let channel = 0; channel < 3; channel++) rgba[channel] += pixels[i + channel] * weight * alpha;
      rgba[3] += pixels[i + 3] * weight;
    }
    if (rgba[3]) for (let channel = 0; channel < 3; channel++) rgba[channel] = Math.min(255, rgba[channel] * 255 / rgba[3]);
    return rgba;
  };
  const originX = width / 2 - left * .75, originY = height / 2 - top * .75;
  // Tessellation sagitta stays below 1/16 preview pixel at the larger radius.
  const segments = Math.max(32, Math.ceil(Math.PI * Math.sqrt(Math.max(width, height) * scale / .0625)));
  const boundary = clipped?.boundary || (rectangularSolid ? outlineBoundary(outerWidth, outerHeight, geometry, 0, segments) : outlineBoundary(baseWidth, baseHeight, geometry, radius, segments));
  const path = z => boundary.map(([x, y]) => project(x, y, z));
  const stroke = (points, closed = true) => {
    if (!contour) return;
    ctx.save(); ctx.scale(scale, scale); ctx.translate(originX, originY);
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (closed) ctx.closePath();
    ctx.lineWidth = contour; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = `#${contourColor}`; ctx.stroke(); ctx.restore();
  };
  stroke(path(-depth));
  if (bevelHeight) stroke(path(0));
  const face = new OffscreenCanvas(canvas.width, canvas.height), faceCtx = face.getContext('2d');
  const image = faceCtx.createImageData(canvas.width, canvas.height);
  const bevelShape = { width: rectangularSolid ? outerWidth : baseWidth, height: rectangularSolid ? outerHeight : baseHeight, depth, geometry };
  const intersectBevel = bevelHeight ? prepareBevel(bevelShape, scene.bevel) : null;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const ray = camera.ray((x + .5) / scale - originX, (y + .5) / scale - originY);
    ray.origin[2] += shift;
    const shape = { width: rectangularSolid ? outerWidth : baseWidth, height: rectangularSolid ? outerHeight : baseHeight, depth, geometry };
    const hit = intersectBevel ? intersectBevel(ray) : clipped ? clipped.intersect(ray) : radius && !rectangularSolid ? intersectOffsetExtrusion(ray, shape, radius) : intersectExtrusion(ray, shape);
    if (!hit) continue;
    let rgba = sample(hit.point[0], hit.point[1]);
    if (backing) rgba = compositeBacking(rgba);
    if (outlineColor && (hit.surface !== 'front' || outlineDistance(hit.point[0], hit.point[1], baseWidth, baseHeight, geometry).distance >= -radius)) rgba = [...outlineColor, 255];
    if (hit.surface !== 'front' && scene.extrusionColor) rgba = [...scene.extrusionColor.match(/../g).map(c => parseInt(c, 16)), 255];
    const view = ray.direction.map(value => -value);
    let color;
    if (hit.bevel) {
      color = shade3d.interpolate(rgba.slice(0, 3), hit.bevel.normals.map((normal, i) => ({ normal, view, weight: i ? hit.bevel.mix : 1 - hit.bevel.mix })));
    } else color = shade3d(rgba.slice(0, 3), hit.normal, view);
    image.data.set([...color, rgba[3]], (y * canvas.width + x) * 4);
  }
  faceCtx.putImageData(image, 0, 0); ctx.drawImage(face, 0, 0);
  if (geometry === 'rect' && depth && turn) {
    // Join the two visible side-wall corners; the opposite two connectors
    // are hidden by the solid. Supported cameras turn only about this axis.
    const x = turn > 0 ? -outerWidth / 2 : outerWidth / 2;
    for (const y of [-outerHeight / 2, outerHeight / 2]) stroke([project(x, y, -depth), project(x, y, 0)], false);
  }
  if (!bevelHeight) stroke(path(0));
  const bitmap = await createImageBitmap(canvas);
  return { bitmap, left, top, width: w, height: h, frameWidth: width * 4 / 3, frameHeight: height * 4 / 3, close: () => bitmap.close() };
}
