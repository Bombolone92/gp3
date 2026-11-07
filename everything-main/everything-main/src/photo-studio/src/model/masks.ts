import { type Layer, type MaskStroke, type Rect } from './document';
import { inverseMaskMatrix, maskStrokeMatrix, multiplyMaskMatrix, sourceMatrix } from './pixel-mask';

export const hasMask = (l: Layer) => !!(l.pixelMask || l.mask || l.maskAsset || l.maskStrokes);

// Shared by worker rasterization, thumbnails and one-pixel hit testing.
export function drawMask(
  c: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  l: Layer,
  width: number,
  height: number,
  bitmap?: ImageBitmap,
  base = 1,
) {
  c.save();
  c.fillStyle = '#fff';
  if (bitmap) c.drawImage(bitmap, 0, 0, width, height);
  else if (base) c.fillRect(0, 0, width, height);
  if (l.mask) {
    // Rectangular masks are in document space, including on rotated layers.
    c.save();
    c.globalCompositeOperation = 'destination-in';
    const t = l.transform,
      a = (-t.rotation * Math.PI) / 180;
    c.scale(width / t.width, height / t.height);
    c.translate(t.width / 2, t.height / 2);
    c.rotate(a);
    c.translate(-t.x - t.width / 2, -t.y - t.height / 2);
    c.fillRect(l.mask.x, l.mask.y, l.mask.width, l.mask.height);
    c.restore();
  }
  if (l.maskStrokes?.length) {
    const strokeCanvas = new OffscreenCanvas(c.canvas.width, c.canvas.height);
    const strokeContext = strokeCanvas.getContext('2d')!;
    for (const s of l.maskStrokes) {
      strokeContext.resetTransform();
      strokeContext.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height);
      strokeContext.setTransform(c.getTransform());
      if (l.pixelMask) strokeContext.transform(...multiplyMaskMatrix(
        inverseMaskMatrix(sourceMatrix(l.transform,width,height)), maskStrokeMatrix(l,s)));
      drawStroke(strokeContext, { ...s, opacity: 1, restore: true });
      c.save();
      c.resetTransform();
      c.globalCompositeOperation = s.restore
        ? 'source-over'
        : 'destination-out';
      c.globalAlpha = s.opacity;
      c.drawImage(strokeCanvas, 0, 0);
      c.restore();
    }
  }
  if (l.maskInverted) {
    c.globalCompositeOperation = 'source-out';
    c.fillStyle = '#fff';
    c.fillRect(0, 0, width, height);
  }
  c.restore();
}
function drawStroke(
  c: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  s: MaskStroke,
) {
  c.save();
  c.globalCompositeOperation = s.restore ? 'source-over' : 'destination-out';
  c.globalAlpha = s.opacity;
  if (s.clip) {
    c.beginPath();
    s.clip.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
    c.closePath();
    c.clip();
  }
  const radius = s.size / 2;
  const stamp = (x: number, y: number) => {
    c.save();
    c.translate(x, y);
    c.scale(1, s.aspect ?? 1);
    if (s.softness > 0) {
      const g = c.createRadialGradient(
        0,
        0,
        radius * (1 - s.softness),
        0,
        0,
        radius,
      );
      g.addColorStop(0, '#fff');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
    } else c.fillStyle = '#fff';
    c.beginPath();
    c.arc(0, 0, radius, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  // Fixed spacing along the entire path makes opacity independent of pointer event frequency.
  const step = Math.max(0.5, s.size / 8);
  let remaining = step;
  if (s.points.length) stamp(...s.points[0]);
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1],
      b = s.points[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = remaining;
    for (; d <= length; d += step)
      stamp(
        a[0] + ((b[0] - a[0]) * d) / length,
        a[1] + ((b[1] - a[1]) * d) / length,
      );
    remaining = d - length;
  }
  c.restore();
}

// Vector geometry is rasterized at document scale, so its independent pixel
// mask must be projected into the same viewport. Keep brush coordinates local
// to the editable layer, including anisotropic transforms and rotation.
export function drawWorldMask(
  c: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  l: Layer,
  viewport: Rect,
  bitmap?: ImageBitmap,
  base = 1,
) {
  const project = (
    context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  ) => {
    const t = l.transform;
    context.translate(t.x + t.width / 2, t.y + t.height / 2);
    context.rotate((t.rotation * Math.PI) / 180);
    context.scale(t.width / l.sourceWidth, t.height / l.sourceHeight);
    context.translate(-l.sourceWidth / 2, -l.sourceHeight / 2);
  };
  c.save();
  c.translate(-viewport.x, -viewport.y);
  c.fillStyle = '#fff';
  if (base) c.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  if (bitmap) {
    c.save();
    c.globalCompositeOperation = 'destination-in';
    project(c);
    c.drawImage(bitmap, 0, 0, l.sourceWidth, l.sourceHeight);
    c.restore();
  }
  if (l.mask) {
    c.save();
    c.globalCompositeOperation = 'destination-in';
    c.fillRect(l.mask.x, l.mask.y, l.mask.width, l.mask.height);
    c.restore();
  }
  if (l.maskStrokes?.length) {
    const canvas = new OffscreenCanvas(c.canvas.width, c.canvas.height),
      context = canvas.getContext('2d')!;
    for (const stroke of l.maskStrokes) {
      context.resetTransform();
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.translate(-viewport.x, -viewport.y);
      if (l.pixelMask) context.transform(...maskStrokeMatrix(l,stroke));
      else project(context);
      drawStroke(context, { ...stroke, restore: true, opacity: 1 });
      c.save();
      c.resetTransform();
      c.globalCompositeOperation = stroke.restore
        ? 'source-over'
        : 'destination-out';
      c.globalAlpha = stroke.opacity;
      c.drawImage(canvas, 0, 0);
      c.restore();
    }
  }
  if (l.maskInverted) {
    c.globalCompositeOperation = 'source-out';
    c.fillStyle = '#fff';
    c.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  }
  c.restore();
}
