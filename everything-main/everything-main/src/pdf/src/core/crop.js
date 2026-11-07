/**
 * Cropping trims what a page shows without touching its content: the crop box shrinks, and
 * "Remove crop" brings the full page back. Margins are given as the reader sees the page, so
 * one set of margins applies to every page whatever its rotation.
 */
import { PDFName } from 'pdf-lib';
import { uprightFrame } from './page-marks.js';
import { visibleBox } from './document.js';
import { pageBox, pageUserUnit } from './structure.js';

/** Half an inch of a page always stays visible. */
export const MIN_CROP_SIDE = 36;
const SIDES = ['top', 'right', 'bottom', 'left'];

/** The margins that keep exactly `rect` (PDF user space) of page `index`, as the reader sees it. */
export function cropMargins(doc, index, rect) {
  const page = doc.getPage(index);
  const frame = uprightFrame(page);
  const unit = pageUserUnit(page);
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ].map(([x, y]) => frame.toReader(x, y));
  const clamp = (value, limit) => Math.max(0, Math.min(limit, value));
  const u0 = clamp(Math.min(...corners.map((c) => c.u)), frame.width);
  const u1 = clamp(Math.max(...corners.map((c) => c.u)), frame.width);
  const v0 = clamp(Math.min(...corners.map((c) => c.v)), frame.height);
  const v1 = clamp(Math.max(...corners.map((c) => c.v)), frame.height);
  return {
    left: u0 * unit,
    right: (frame.width - u1) * unit,
    bottom: v0 * unit,
    top: (frame.height - v1) * unit,
  };
}

/**
 * Trim `margins` (reader-frame points) from every page in `indices`. A single page that would
 * lose too much is refused; among several pages, smaller ones keep at least half an inch.
 */
export function cropPages(doc, indices, margins) {
  const pages = [...new Set(indices)];
  if (!pages.length) throw new Error('Choose at least one page.');
  for (const side of SIDES)
    if (!(Number.isFinite(margins[side]) && margins[side] >= 0))
      throw new Error('Margins must be zero or more.');
  for (const index of pages) {
    const page = doc.getPage(index);
    const frame = uprightFrame(page);
    const unit = pageUserUnit(page);
    const minimum = MIN_CROP_SIDE / unit;
    let { left, right, top, bottom } = Object.fromEntries(
      SIDES.map((side) => [side, margins[side] / unit]),
    );
    const fit = (size, a, b) => {
      if (size - a - b >= minimum) return [a, b];
      if (pages.length === 1) throw new Error('Keep at least half an inch of the page.');
      const room = Math.max(0, size - minimum);
      const factor = a + b ? room / (a + b) : 0;
      return [a * factor, b * factor];
    };
    [left, right] = fit(frame.width, left, right);
    [bottom, top] = fit(frame.height, bottom, top);
    const a = frame.toPdf(left, bottom),
      b = frame.toPdf(frame.width - right, frame.height - top);
    page.setCropBox(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(b.x - a.x),
      Math.abs(b.y - a.y),
    );
  }
}

const sameBox = (a, b) =>
  ['x', 'y', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) < 1e-9);

/** Show the full page again. Returns false when none of the pages showed less than that. */
export function resetCrop(doc, indices) {
  let changed = false;
  for (const index of new Set(indices)) {
    const page = doc.getPage(index),
      media = pageBox(page, 'MediaBox') || { x: 0, y: 0, width: 612, height: 792 },
      before = visibleBox(page);
    if (page.node.has(PDFName.of('CropBox'))) page.node.delete(PDFName.of('CropBox'));
    // A crop box can also come down from the page tree; the full page then has to be spelled
    // out on the page itself, since there is nothing on the page left to delete.
    if (!sameBox(visibleBox(page), media))
      page.setCropBox(media.x, media.y, media.width, media.height);
    if (!sameBox(before, media)) changed = true;
  }
  return changed;
}
