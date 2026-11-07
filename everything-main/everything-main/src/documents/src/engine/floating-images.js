import { OBJECT, EMU_PER_PX, isSideWrappedImage } from './images.js';
import { visibleParagraphBorders } from './paragraph-borders.js';

// A centered, column-wide square wrap excludes the entire text band. Keep its
// paragraph as an atomic band; arbitrary side wrapping remains outside the subset.
export function floatingParagraph(p, offset, format, page) {
  const drawings = p.runs.filter(r => r.image?.anchor?.wrap === 'square' && !isSideWrappedImage(r.image));
  if (!drawings.length) return null;
  const image = drawings[0].image, text = p.runs.map(r => r.text).join('');
  if (drawings.length !== 1 || text !== OBJECT || p.cellId || p.list || visibleParagraphBorders(format.paragraphBorders) || format.paragraphShading !== 'auto') throw new Error('Floating pictures require a standalone, unshaded body paragraph without a list or borders.');
  const width = image.width / EMU_PER_PX, height = image.height / EMU_PER_PX, column = page.width - page.left - page.right;
  if (Math.abs(width - column) > 1 / EMU_PER_PX) throw new Error('This floating picture must span the full text column. Side-wrapped pictures are not supported yet.');
  if (height > page.height - page.top - page.bottom) throw new Error('This floating picture is taller than the page writing area.');
  const x = page.left + (column - width) / 2;
  return {
    format, styleId: p.resolvedStyleId ?? p.styleId ?? null, leadingFlowBreaks: 0,
    lines: [{ paragraphId: p.id, start: offset, end: offset + 1, paragraphEnd: true, hardBreak: null, virtual: false,
      width, height, ascent: height, descent: 0, baseline: height, clip: false, marker: null,
      fragments: [{ image, text: '', x, width, ascent: height, descent: 0, start: offset, end: offset + 1 }],
      stops: [{ x, offset }, { x: x + width, offset: offset + 1 }], leaders: [], backgrounds: [], underlines: [], strikes: [],
    }],
  };
}
