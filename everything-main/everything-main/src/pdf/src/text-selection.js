/** PDF.js can retain a cached canvas font after its ascent measurement resets the
 * canvas. Re-measure each span so a 30px effective font never uses the 10px default. */
export function alignTextLayer(textLayer, content, viewport) {
  const ctx = document.createElement('canvas').getContext('2d');
  const items = content.items.filter((item) => typeof item.str === 'string');
  const scales = textLayer.textDivs.map((span, i) => {
    const item = items[i];
    if (!item?.str) return null;
    const style = getComputedStyle(span);
    ctx.font = style.font;
    const width = ctx.measureText(item.str).width;
    const desired =
      (content.styles[item.fontName]?.vertical ? item.height : item.width) *
      viewport.scale *
      viewport.userUnit;
    const minFont = Number(style.getPropertyValue('--min-font-size')) || 1;
    return width > 0 && desired > 0 ? (desired * minFont) / width : null;
  });
  // Reading the next font after each scale write forced a style recalculation per span.
  // Finish the measurements first so the browser can apply every transform together.
  textLayer.textDivs.forEach((span, i) => {
    if (scales[i] !== null) span.style.setProperty('--scale-x', scales[i]);
  });
}

/** Read actual browser-selected glyph extents before mapping them into PDF space.
 * Measuring an untransformed clone keeps partial words, bidi runs and oblique text
 * accurate; axis-aligned client rectangles alone lose a rotated line's shape. */
export function selectedTextQuads(textLayer, viewport, paper, selection = window.getSelection()) {
  // WebKit rounds range rectangles out to whole pixels. Magnify only the hidden probes
  // so those rounded edges map back to subpixel bounds, including at low page zoom.
  const container = textLayer?.textDivs[0]?.closest('.textLayer');
  const range = pageTextRange(container, selection);
  if (!range) return null;
  const original = selection.getRangeAt(0);
  const clipped =
    !container.contains(original.startContainer) || !container.contains(original.endContainer);
  const pageRect = paper.getBoundingClientRect();
  const quads = [];
  const measurements = [];
  const probes = document.createDocumentFragment();
  for (const span of textLayer.textDivs) {
    if (!span.textContent.trim() || !range.intersectsNode(span)) continue;
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let start = span.textContent.length,
      end = 0,
      offset = 0;
    for (const node of nodes) {
      // Native ranges can use element boundaries around search marks, not only text
      // offsets. Count just the intersected text nodes before applying partial offsets.
      if (range.intersectsNode(node)) {
        start = Math.min(start, offset + (node === range.startContainer ? range.startOffset : 0));
        end = offset + (node === range.endContainer ? range.endOffset : node.length);
      }
      offset += node.length;
    }
    if (start >= end || !span.textContent.slice(start, end).trim()) continue;
    const style = getComputedStyle(span);
    // Large text at high zoom can hit the browser's font-size cap in a 32x probe.
    // Keep the enlarged font bounded so its measured glyphs still scale linearly.
    const probeScale = Math.min(32, 1536 / (parseFloat(style.fontSize) || 1));
    const clone = document.createElement('span');
    clone.textContent = span.textContent;
    Object.assign(clone.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      visibility: 'hidden',
      whiteSpace: 'pre',
      font: style.font,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      direction: style.direction,
      unicodeBidi: style.unicodeBidi,
      padding: '0',
      margin: '0',
      border: '0',
      zoom: String(probeScale),
    });
    probes.append(clone);
    measurements.push({ span, clone, start, end, probeScale });
  }
  // Inserting, measuring and removing each span separately forced a full layout per
  // fragment. Insert every probe together, then perform all geometry reads before cleanup.
  document.body.append(probes);
  try {
    for (const { span, clone, start, end, probeScale } of measurements) {
      const full = clone.getBoundingClientRect();
      let transform = new DOMMatrix();
      for (let node = span; node && node !== paper; node = node.parentElement) {
        const css = getComputedStyle(node).transform;
        if (css !== 'none') transform = new DOMMatrix(css).multiply(transform);
      }
      const map = (x, y) => ({
        x: (transform.a * x + transform.c * y) / probeScale,
        y: (transform.b * x + transform.d * y) / probeScale,
      });
      const corners = [
        map(0, 0),
        map(full.width, 0),
        map(0, full.height),
        map(full.width, full.height),
      ];
      const box = span.getBoundingClientRect();
      const left = box.left - Math.min(...corners.map((p) => p.x));
      const top = box.top - Math.min(...corners.map((p) => p.y));
      const part = document.createRange();
      part.setStart(clone.firstChild, start);
      part.setEnd(clone.firstChild, end);
      for (const r of part.getClientRects()) {
        if (r.width < 0.01 || r.height < 0.01) continue;
        const coords = [
          [r.left, r.top],
          [r.right, r.top],
          [r.left, r.bottom],
          [r.right, r.bottom],
        ];
        quads.push(
          coords.flatMap(([x, y]) => {
            const p = map(x - full.left, y - full.top);
            return viewport.convertToPdfPoint(
              ((left + p.x - pageRect.left) * viewport.width) / pageRect.width,
              ((top + p.y - pageRect.top) * viewport.height) / pageRect.height,
            );
          }),
        );
      }
    }
  } finally {
    for (const { clone } of measurements) clone.remove();
  }
  return quads.length ? { quads, text: clipped ? range.toString() : selection.toString() } : null;
}

/** A drag may finish outside the page. Keep its PDF portion without changing native selection. */
export function pageTextRange(container, selection = window.getSelection()) {
  if (!container || !selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!range.intersectsNode(container)) return null;
  if (!container.contains(range.startContainer)) range.setStart(container, 0);
  if (!container.contains(range.endContainer)) range.setEnd(container, container.childNodes.length);
  return range.collapsed ? null : range;
}
