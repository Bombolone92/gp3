import { PDFArray, PDFDict, PDFName, PDFNumber } from 'pdf-lib';

const LABELS = PDFName.of('PageLabels');

/** The page label ranges as [first page index, label dictionary] pairs, from any number tree. */
function labelRanges(doc, tree) {
  const ranges = [];
  const seen = new Set();
  const pending = [tree];
  while (pending.length) {
    const node = pending.pop();
    if (!(node instanceof PDFDict) || seen.has(node)) continue;
    seen.add(node);
    const nums = node.lookup(PDFName.of('Nums'));
    if (nums instanceof PDFArray)
      for (let i = 0; i + 1 < nums.size(); i += 2) {
        const key = nums.lookup(i);
        if (key instanceof PDFNumber && Number.isInteger(key.asNumber()))
          ranges.push([key.asNumber(), nums.get(i + 1)]);
      }
    const kids = node.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray)
      for (const kid of kids.asArray()) pending.push(doc.context.lookup(kid));
  }
  return ranges;
}

/**
 * Keep page labels (front matter in roman numerals, then 1, 2, 3, and so on) with their pages
 * when `count` pages are inserted at index `at` (positive) or removed from it (negative). Label
 * ranges begin at page indices, so without this they slid onto other pages. Inserted pages
 * continue the range before them.
 */
export function shiftPageLabels(doc, at, count) {
  const tree = doc.catalog.lookup(LABELS);
  if (!(tree instanceof PDFDict) || !count) return;
  const pages = doc.getPageCount();
  const total = count < 0 ? pages + count : pages;
  const starts = new Map();
  for (const [start, label] of labelRanges(doc, tree).sort((a, b) => a[0] - b[0])) {
    let next = start;
    if (count > 0 && start >= at && start > 0) next = start + count;
    // A range that began on a removed page now begins where its first remaining page lands,
    // unless the range after it starts there too; then that page belongs to the later range.
    if (count < 0 && start > at) next = Math.max(at, start + count);
    if (next < total) starts.set(next, label);
  }
  if (!starts.size) return;
  const nums = [...starts]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([start, label]) => [PDFNumber.of(start), label]);
  doc.catalog.set(LABELS, doc.context.obj({ Nums: nums }));
}
