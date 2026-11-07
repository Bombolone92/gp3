import { capitalizationPartStyle } from './capitalization.js';
import { paintText3d } from './canvas-text-3d.js';
import { setCanvasTextStyle, canvasText, canvasSyntheticBold, canvasSyntheticAdvanceFamily, renderedStyle, usesRoundedFontAdvances } from './canvas-text.js';
import { textShadowGeometry } from './text-shadow.js';
import { outlineTextScale, fractionalTextScale } from './outline-text-scale.js';
import { isBundledFont } from './font-families.js';

function draw(ctx, text, x, y, style) {
  const resolved = renderedStyle(ctx, style);
  if (resolved.text3d && paintText3d(ctx, text, x, y, resolved)) return;
  const scaled = usesRoundedFontAdvances(ctx, resolved) ? outlineTextScale(resolved)
    : isBundledFont(resolved.fontFamily || resolved.fontAscii || 'Noto Sans') ? {factor:1,style:resolved} : fractionalTextScale(resolved);
  if (scaled.factor === 1) { drawScaled(ctx, text, x, y, style); return; }
  ctx.save();
  setCanvasTextStyle(ctx, scaled.style);
  ctx.translate(x, y); ctx.scale(1 / scaled.factor, 1 / scaled.factor);
  drawScaled(ctx, text, 0, 0, scaled.style);
  ctx.restore();
}

function drawScaled(ctx, text, x, y, style) {
  if (!style.syntheticItalic) { drawUpright(ctx, text, x, y, style); return; }
  ctx.save();
  ctx.translate(x, y);
  // PDF coordinates point upwards; Canvas points downwards. Shear around
  // the text baseline without changing advances, line boxes or stored text.
  ctx.transform(1, 0, -1 / 3, 1, 0, 0);
  drawUpright(ctx, text, 0, 0, style);
  ctx.restore();
}

function drawUpright(ctx, text, x, y, style) {
  const hasFill = style.textFill !== 'none';
  if (hasFill && style.textFill) ctx.fillStyle = '#' + (style.textFill === 'empty' ? '000000' : style.textFill);
  if (hasFill && canvasSyntheticBold(ctx, style)) {
    // Synthetic bold uses regular glyphs with a centered em/35 stroke.
    // Keep the same derived advance face used by measurement, without asking
    // the browser to embolden its outlines a second time.
    const family = canvasSyntheticAdvanceFamily(ctx, style);
    ctx.save(); setCanvasTextStyle(ctx, { ...style, bold: false, ...(family ? { fontFamily: family } : {}) });
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = style.fontSize * 4 / 3 / 35;
    ctx.lineJoin = 'miter'; ctx.miterLimit = 10; ctx.lineCap = 'butt'; ctx.setLineDash([]);
    ctx.fillText(text, x, y); ctx.strokeText(text, x, y); ctx.restore();
    return;
  }
  // Paint the ordinary fill first; the centered outline remains visible on
  // both sides of the glyph contour. Glyph advances and shaping are unchanged.
  if (hasFill) ctx.fillText(text, x, y);
  const outline = style.textOutline;
  if (!outline?.width) return;
  ctx.save();
  ctx.strokeStyle = '#' + outline.color; ctx.lineWidth = outline.width / 9525;
  ctx.lineJoin = outline.join; ctx.lineCap = { flat: 'butt', rnd: 'round', sq: 'square' }[outline.cap];
  // Native reference PDF text-outline paths retain the default miter limit (10) for
  // omitted, zero, fractional and positive lim values. Preserve the authored
  // value in the model/export; this compatibility rule is only for painting.
  ctx.miterLimit = 10; ctx.setLineDash([]);
  ctx.strokeText(text, x, y); ctx.restore();
}

export function paintText(ctx, fragment, baseline) {
  if (fragment.bidiDirection) {
    ctx.save();ctx.direction=fragment.bidiDirection;ctx.textAlign='left';
    paintFragment(ctx,fragment,baseline);ctx.restore();return;
  }
  paintFragment(ctx,fragment,baseline);
}

// Cast the complete shaped glyph mask before painting foreground color windows.
// Clipping the finished shadow at a run's color boundary would cut off its blur
// and offset; only the source mask is clipped at that boundary.
export function paintTextShadows(ctx, fragment, baseline) {
  if (!fragment.hasTextShadow && !fragment.textShadow?.alpha) return;
  const spans = fragment.colors || [{ textShadow: fragment.textShadow, textOutline: fragment.textOutline, textFill: fragment.textFill, x: 0, width: fragment.width }];
  if (!spans.some(span => span.textShadow?.alpha)) return;
  const em = (fragment.fontSize || 12) * 4 / 3;
  const ascent = fragment.ascent ?? em, descent = fragment.descent ?? em / 3;
  const matrix = ctx.getTransform(), resolution = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
  for (const [index, span] of spans.entries()) {
    const shadow = span.textShadow;
    if (!shadow?.alpha || !shadow.scaleX || !shadow.scaleY) continue;
    const width = span.width ?? ctx.measureText(fragment.text).width;
    const geometry = textShadowGeometry(shadow, fragment.fontSize || 12, width, ascent, descent);
    const outline = span.textOutline ?? null;
    const shadowStyle = { ...fragment, textShadow: null, text3d: null, textScene: null, textFill: span.textFill === 'none' ? 'none' : shadow.color,
      textOutline: outline ? { ...outline, color: shadow.color } : null };
    if (!geometry.blur && geometry.a === 1 && geometry.d === 1 && !geometry.b && !geometry.c && (!outline?.width || shadow.alpha === 1)) {
      // A rigid hard shadow is another native glyph paint, not a rasterized
      // glyph resampled at a fractional offset (which softens its edges).
      ctx.save(); ctx.globalAlpha *= shadow.alpha; ctx.translate(geometry.e, geometry.f);
      if (spans.length > 1) {
        const left = index ? fragment.x + span.x : fragment.x - em;
        const right = index < spans.length - 1 ? fragment.x + span.x + width : fragment.x + (fragment.width ?? width) + em;
        ctx.beginPath(); ctx.rect(left, baseline - ascent - em, right - left, ascent + descent + 2 * em); ctx.clip();
      }
      ctx.fillStyle = '#' + shadow.color; paintText(ctx, shadowStyle, baseline); ctx.restore();
      continue;
    }
    const padding = em + (outline?.width || 0) / 9525 * 5;
    const left = Math.floor(-padding), top = Math.floor(-ascent - padding);
    const right = Math.ceil((fragment.width ?? width) + padding), bottom = Math.ceil(descent + padding);
    const mask = new OffscreenCanvas(Math.max(1, Math.ceil((right - left) * resolution)), Math.max(1, Math.ceil((bottom - top) * resolution)));
    const m = mask.getContext('2d');
    m.scale(resolution, resolution); m.translate(-left, -top);
    if (spans.length > 1) {
      const x = index ? span.x : left, end = index < spans.length - 1 ? span.x + width : right;
      m.beginPath(); m.rect(x, top, end - x, bottom - top); m.clip();
    }
    const style = { ...shadowStyle, x: 0 };
    setCanvasTextStyle(m, style); m.fillStyle = '#' + shadow.color;
    paintText(m, style, 0);
    ctx.save();
    ctx.globalAlpha *= shadow.alpha;
    ctx.translate(fragment.x + (span.x || 0), baseline);
    ctx.transform(geometry.a, geometry.b, geometry.c, geometry.d, geometry.e, geometry.f);
    ctx.filter = geometry.blur ? `blur(${geometry.blur * resolution / 3}px)` : 'none';
    ctx.drawImage(mask, 0, 0, mask.width, mask.height, left - (span.x || 0), top, mask.width / resolution, mask.height / resolution);
    ctx.restore();
  }
}

function paintFragment(ctx, fragment, baseline) {
  if (!fragment.textParts && !fragment.textTransform) { draw(ctx, canvasText(ctx, fragment.text, fragment), fragment.x + (fragment.textOffsetX || 0), baseline, fragment); return; }
  ctx.save();
  const s = fragment.textTransform;
  ctx.translate(fragment.x + (s?.offsetX || 0), baseline + (s?.offsetY || 0));
  if (s) ctx.scale(s.scaleX, s.scaleY);
  if (fragment.textParts) for (const part of fragment.textParts) { const style = capitalizationPartStyle(fragment, part); setCanvasTextStyle(ctx, style); draw(ctx, canvasText(ctx, part.text, style), part.x, 0, style); }
  else draw(ctx, canvasText(ctx, fragment.text, fragment), fragment.textOffsetX || 0, 0, fragment);
  ctx.restore();
}
