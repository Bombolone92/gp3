import { underlineInk } from './underlines.js';

export function paintUnderline(context, span, baseline) {
  const ink = underlineInk(span);
  for (const r of ink.rects) context.fillRect(r.x, baseline + r.y, r.width, r.height);
  if (!ink.waves.length) return;
  context.save();
  // Keep partial periods within the logical span, independently of canvas zoom.
  context.beginPath(); context.rect(span.x, baseline + span.offset - 4 * span.thickness, span.width, 12 * span.thickness); context.clip();
  context.strokeStyle = context.fillStyle; context.lineCap = 'butt'; context.lineJoin = 'round';
  for (const wave of ink.waves) {
    context.lineWidth = wave.thickness; context.beginPath();
    wave.curve.forEach((c, i) => { if (!i) context.moveTo(c[0], baseline + c[1]); context.bezierCurveTo(c[2], baseline + c[3], c[4], baseline + c[5], c[6], baseline + c[7]); });
    context.stroke();
  }
  context.restore();
}
