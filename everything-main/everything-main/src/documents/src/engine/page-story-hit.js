import { imageAtPoint } from './layout.js';
import { cellClipContains } from './cell-clipping.js';

function containsLine(line, page, x, y) {
  if (line.page !== page || !cellClipContains(line.cellClip, x, y)) return false;
  if (line.cellText) return x >= line.x && x <= line.x + line.width && y >= line.y && y <= line.y + line.height;
  return y >= line.y && y <= line.y + line.height && x >= Math.min(...line.stops.map(s => s.x)) && x <= Math.max(...line.stops.map(s => s.x)) + 7;
}

// A drawing's anchor line is not its hit rectangle. Reuse the painter's image
// geometry (including rotation and clipping) to find the owning page story.
export function pageStoryAtPoint(body, stories, page, x, y, preferBody = true) {
  if (preferBody && (imageAtPoint(body, page, x, y) || [...body.lines, ...(body.repeatedLines || [])].some(line => containsLine(line, page, x, y)))) return null;
  const image = imageAtPoint({ ...body, ...stories, repeatedLines: [] }, page, x, y);
  if (image) {
    const path = image.pageStory || stories.lines.find(line => line.page === page && line.fragments.includes(image))?.pageStory;
    if (path) return { page, pageStory: path };
  }
  return stories.lines.find(line => containsLine(line, page, x, y)) || null;
}
