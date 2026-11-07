import { measureCanvasText, setCanvasTextStyle } from './canvas-text.js';
import { kerningEnabled } from './kerning.js';

// Native reference controls establish 3pt horizontal / 1.5pt vertical insets,
// 6pt top placement, and an 80%-of-chart-width automatic title box limit.
export function columnTitleLayout(ctx, title, width) {
  const available = Math.max(1, width * .8 - 8), lines = [];
  let remaining = 255;
  const measure = r => measureCanvasText(ctx, r.text, r.style);
  const merge = parts => {
    const result = [];
    for (const part of parts) {
      const last = result.at(-1);
      if (last?.style === part.style) last.text += part.text;
      else result.push({ ...part });
    }
    return result;
  };
  for (const paragraph of title.paragraphs) {
    if (remaining <= 0) break;
    const tokens = [];
    for (const run of paragraph.runs) {
      const text = run.text.slice(0, remaining); remaining -= text.length;
      for (const part of text.match(/\s+|\S+/gu) || []) {
        const space = /^\s/u.test(part), last = tokens.at(-1);
        if (last?.space === space) last.parts.push({ text: part, style: run.style });
        else tokens.push({ space, parts: [{ text: part, style: run.style }] });
      }
    }
    let parts = [], pending = [], lineWidth = 0;
    const finish = () => {
      const runs = merge(parts), metrics = runs.map(measure);
      if (!metrics.length) metrics.push(measure({ text: 'Mg', style: paragraph.style || title.style }));
      const ascent = Math.max(...metrics.map(m => m.ascent)), descent = Math.max(...metrics.map(m => m.descent));
      lines.push({ runs, width: metrics.length && runs.length ? metrics.reduce((sum, m) => sum + m.width, 0) : 0, ascent, descent });
      parts = []; pending = []; lineWidth = 0;
    };
    for (const token of tokens) {
      if (token.space) { if (parts.length) pending.push(...token.parts); continue; }
      const tokenWidth = merge(token.parts).reduce((sum, r) => sum + measure(r).width, 0);
      const spacing = merge(pending).reduce((sum, r) => sum + measure(r).width, 0);
      if (parts.length && lineWidth + spacing + tokenWidth > available) finish();
      if (parts.length) { parts.push(...pending); lineWidth += spacing; }
      if (tokenWidth <= available) { parts.push(...token.parts); lineWidth += tokenWidth; }
      else {
        // An overlong word breaks at character boundaries. Measure the
        // complete candidate so kerning within each styled run is retained.
        for (const run of token.parts) for (const text of run.text) {
          const next = { text, style: run.style };
          const candidate = merge([...parts, next]).reduce((sum, r) => sum + measure(r).width, 0);
          if (parts.length && candidate > available) finish();
          parts.push(next);
          lineWidth = merge(parts).reduce((sum, r) => sum + measure(r).width, 0);
        }
      }
      pending = [];
    }
    finish(); remaining--;
  }
  const contentWidth = Math.max(0, ...lines.map(l => l.width));
  const textHeight = lines.reduce((sum, l) => sum + l.ascent + l.descent, 0);
  return { lines, x: (width - contentWidth - 8) / 2, y: 8, width: contentWidth + 8, height: textHeight + 4, plotTop: (20 * 4 / 3) + textHeight };
}

export function paintColumnTitle(ctx, title, box) {
  const background = title.background;
  ctx.save();
  if (background.fill) { ctx.fillStyle = background.fill; ctx.fillRect(box.x, box.y, box.width, box.height); }
  if (background.line) { ctx.strokeStyle = background.line; ctx.lineWidth = 1; ctx.strokeRect(box.x, box.y, box.width, box.height); }
  let top = box.y + 2;
  for (const line of box.lines) {
    let x = box.x + (box.width - line.width) / 2;
    for (const run of line.runs) {
      const scale = run.style.fontSize / 1536;
      ctx.save(); setCanvasTextStyle(ctx, { ...run.style, fontSize: 1536, kerning: kerningEnabled(run.style) ? 1 : 0 });
      ctx.scale(scale, scale); ctx.fillStyle = '#' + run.style.color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(run.text, x / scale, (top + line.ascent) / scale); ctx.restore();
      x += measureCanvasText(ctx, run.text, run.style).width;
    }
    top += line.ascent + line.descent;
  }
  ctx.restore();
}
