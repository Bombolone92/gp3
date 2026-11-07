// Point <-> paragraph text conversion (pure; the caller supplies the layout).

import { deleteRange, insertText, textLength, type TextLayerData } from '../../imaging/text/model';
import type { TextLayout } from '../../imaging/text/layout';

// Point text <-> paragraph text, keeping the visible lines where they are.
export function convertParagraphMode(d: TextLayerData, layout: TextLayout): TextLayerData {
  const vertical = d.orientation === 'vertical';
  if (d.mode === 'point') {
    const b = layout.bounds;
    const pad = 1;
    return { ...d, mode: 'paragraph', origin: { x: b.x - pad, y: b.y }, box: { width: Math.max(8, b.width + pad * 2 + 1), height: Math.max(8, b.height + pad) } };
  }
  // Paragraph -> point: soft wraps become paragraph breaks, hidden overflow is dropped.
  let content = d.content;
  if (layout.overflow) content = deleteRange(content, layout.visibleEnd, textLength(content));
  const breaks = layout.lines.filter((l) => l.visible && !l.lastInParagraph && l.end < layout.visibleEnd);
  for (let i = breaks.length - 1; i >= 0; i--) {
    const l = breaks[i];
    const keep = l.stops[Math.max(0, l.stops.length - 1 - l.hang)];
    content = insertText(deleteRange(content, keep, l.end), keep, '\n');
  }
  const first = layout.lines[0];
  const align = d.content.paragraphs[0]?.style.align ?? 'left';
  const base = align.startsWith('justify') ? (align === 'justify-center' ? 'center' : align === 'justify-right' ? 'right' : 'left') : align;
  const box = d.box!;
  const origin = vertical
    ? { x: first.x, y: d.origin.y + (base === 'center' ? box.height / 2 : base === 'right' ? box.height : 0) }
    : { x: d.origin.x + (base === 'center' ? box.width / 2 : base === 'right' ? box.width : 0), y: first.y };
  const paragraphs = content.paragraphs.map((p) => ({ ...p, style: { ...p.style, align: base as typeof align } }));
  return { ...d, mode: 'point', box: undefined, origin, content: { paragraphs } };
}

