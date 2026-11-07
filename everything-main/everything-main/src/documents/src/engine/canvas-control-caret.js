// Selection adornments only; these marks never enter the document package.
export function paintControlCarets(ctx, rectangles, page, scale) {
  ctx.save(); ctx.strokeStyle = '#375f91'; ctx.lineWidth = 1 / scale;
  for (const r of rectangles) if (r.page === page) {
    if (!r.empty) ctx.strokeRect(r.x, r.y, r.width, r.height);
    else {
      // A box with artificial width would cross the neighboring glyph. Caps
      // distinguish the empty inside stop without obscuring document text.
      ctx.beginPath();
      if (r.width > r.height) {
        const y = r.y + r.height / 2;
        ctx.moveTo(r.x, y - 3); ctx.lineTo(r.x, y + 3); ctx.moveTo(r.x + r.width, y - 3); ctx.lineTo(r.x + r.width, y + 3);
      } else {
        const x = r.x + (r.width ?? 1.5) / 2;
        ctx.moveTo(x - 3, r.y); ctx.lineTo(x + 3, r.y); ctx.moveTo(x - 3, r.y + r.height); ctx.lineTo(x + 3, r.y + r.height);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}
