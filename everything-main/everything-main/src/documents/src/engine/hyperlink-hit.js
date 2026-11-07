import { hitTest, selectionRects, imageAtPoint } from './layout.js';
import { hyperlinkAt } from './hyperlinks.js';

// Reuse source caret positions and painted line boxes. Link boundaries never split shaping.
export function hyperlinkAtPoint(layout, paragraphs, page, x, y, image = imageAtPoint(layout, page, x, y)) {
  if (image?.image.hyperlink) return { start: image.start, end: image.end, link: image.image.hyperlink };
  const position = hitTest(layout, page, x, y);
  for (const affinity of ['forward', 'backward']) {
    const range = hyperlinkAt(paragraphs, position, affinity);
    if (range && !range.drawing && selectionRects(layout, range.start, range.end).some(r => r.page === page && r.width > 0 && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)) return range;
  }
  return null;
}
