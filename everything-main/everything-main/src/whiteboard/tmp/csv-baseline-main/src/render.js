import { drawGrid } from "./grid.js";
import { rotationOf, boxPoint, objectBounds } from "./geometry.js";
import { rotationBox, rotationHandle } from "./rotation.js";
import { drawTags, tagCatalog, clearTagLayouts } from "./tag-renderer.js";
import { tagFooter } from "./tags.js";
import { drawTaskBadge } from "./planning/task-renderer.js";
import { mindLines } from "./mind-map.js";
import { tableLayout } from "./table-layout.js";
import { visibleMindItems, mindVisibility } from "./mind-visibility.js";
import { bounds, escape, stackedItems, resizeBounds } from "./model.js";
import { linkColor } from "./text-link-data.js";
import {
  fontFamily,
  fontStack,
  itemFontFamilies,
  loadFontFamily,
  loadItemFonts,
} from "./fonts.js";
import {
  textStyle,
  richTextLayout,
  listTextLayout,
  cachedWrapText,
  shapeTextLayout,
  fitTextLayout,
  canAutoFitText,
  growsWithText,
  autoHeightLayout,
  reflowTextItems,
  clearTextLayoutCache,
} from "./text.js";
import { updateConnectors } from "./scene.js";
import { drawShape } from "./shape-art.js";
import { SHAPE_COLORS } from "./shape-specs.js";
export { wrapText } from "./text.js";
import {
  connectorPath,
  connectorLabel,
  clearConnectorLabelCache,
} from "./connectors.js";
import { imageLayout } from "./image-crop.js";
import { drawEmbedCard } from "./content/embed-card.js";

const previews = new Map();
const canvasFonts = new WeakMap();
const images = new Map();
export function imageFor(src) {
  let entry = images.get(src);
  if (entry) {
    // Keep least-recently-used order so eviction skips images still drawn.
    images.delete(src);
    images.set(src, entry);
    entry.used = performance.now();
  } else {
    const image = new window.Image();
    const ready = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(Error("Could not decode an image."));
    });
    // One pending repaint per canvas: registering a callback on every paint
    // made each load replay all earlier paints, doubling work per image.
    entry = { image, ready, waiting: new Map(), used: performance.now() };
    ready.then(
      () => {
        const repaints = [...entry.waiting.values()];
        entry.waiting.clear();
        for (const repaint of repaints)
          try {
            repaint();
          } catch {
            /* A failed repaint must not prevent other canvases from updating. */
          }
      },
      () => {
        entry.failed = true;
        entry.waiting.clear();
      },
    );
    image.src = src;
    images.set(src, entry);
    // Evict beyond 64 only images not drawn recently. Evicting by count alone
    // recreated every image on each paint once more than 64 were visible.
    for (const [key, old] of images) {
      if (images.size <= 64 || entry.used - old.used < 2000) break;
      images.delete(key);
    }
  }
  return entry;
}
export function drawObject(ctx, i, textColor, repaint, hideText = false, tags) {
  const flowing = growsWithText(i) ? autoHeightLayout(i, ctx) : null;
  const w = Math.abs(i.w),
    h = flowing?.height ?? Math.abs(i.h),
    fill = i.color || "#f6e7a4";
  ctx.save();
  ctx.translate(i.x, i.y);
  if (rotationOf(i)) {
    ctx.translate(i.w / 2, i.h / 2);
    ctx.rotate((rotationOf(i) * Math.PI) / 180);
    ctx.translate(-i.w / 2, -i.h / 2);
  }
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (i.type === "arrow") {
    const path = connectorPath(i).map((p) => ({ x: p.x - i.x, y: p.y - i.y }));
    ctx.lineWidth = i.lineWidth || 2.5;
    const thickness = ctx.lineWidth;
    ctx.setLineDash(
      i.lineStyle === "dashed"
        ? [thickness * 4, thickness * 3]
        : i.lineStyle === "dotted"
          ? [0.1, thickness * 2.5]
          : [],
    );
    ctx.beginPath();
    ctx.moveTo(0, 0);
    if (i.lineType === "curved")
      ctx.bezierCurveTo(path[1].x, path[1].y, path[2].x, path[2].y, i.w, i.h);
    else path.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.setLineDash([]);
    const cap = (kind, point, neighbor) => {
      if (kind === "none") return;
      const angle = Math.atan2(point.y - neighbor.y, point.x - neighbor.x),
        length = 9 + thickness * 1.2;
      ctx.beginPath();
      if (kind === "circle") {
        ctx.arc(point.x, point.y, thickness + 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(
          point.x - length * Math.cos(angle - 0.5),
          point.y - length * Math.sin(angle - 0.5),
        );
        ctx.lineTo(point.x, point.y);
        ctx.lineTo(
          point.x - length * Math.cos(angle + 0.5),
          point.y - length * Math.sin(angle + 0.5),
        );
        ctx.stroke();
      }
    };
    cap(
      i.startCap || "none",
      path[0],
      path.find((p) => p.x !== path[0].x || p.y !== path[0].y) || path.at(-1),
    );
    cap(
      i.endCap || "arrow",
      path.at(-1),
      [...path].reverse().find((p) => p.x !== i.w || p.y !== i.h) || path[0],
    );
    if (i.text && !hideText) {
      const box = connectorLabel(i),
        style = textStyle(i);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(box.x - i.x, box.y - i.y, box.w, box.h, 4);
      ctx.fill();
      drawObject(
        ctx,
        {
          ...i,
          type: "connector-label",
          x: box.x - i.x,
          y: box.y - i.y,
          w: box.w,
          h: box.h,
          color: "#ffffff",
          fontSize: style.size,
          textAlign: style.align,
        },
        textColor,
        repaint,
        false,
      );
    }
  } else if (i.type === "pen") {
    ctx.lineWidth = 3;
    ctx.beginPath();
    i.points.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    if (i.points.length === 1) {
      ctx.beginPath();
      ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (i.type === "table") {
    const rows = i.cells.length,
      cols = i.cells[0].length,
      layout = tableLayout(i);
    ctx.font = `400 ${i.fontSize || 15}px ${fontStack(fontFamily(i))}`;
    ctx.textBaseline = "top";
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const cw = layout.columns[col],
          rh = layout.rows[row],
          x = layout.x[col],
          y = layout.y[row];
        ctx.fillStyle = row === 0 ? "#e6ebdf" : i.color || "#ffffff";
        ctx.fillRect(x, y, cw, rh);
        ctx.strokeStyle = "#a2aaa0";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cw, rh);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 6, y + 6, Math.max(0, cw - 12), Math.max(0, rh - 12));
        ctx.clip();
        ctx.fillStyle = "#30342f";
        const lineHeight = (i.fontSize || 15) * 1.35;
        // Lines below the cell are clipped; skip drawing them.
        cachedWrapText(ctx, i.cells[row][col], cw - 18)
          .slice(0, Math.max(0, Math.ceil((rh - 9) / lineHeight)))
          .forEach((line, n) =>
            ctx.fillText(line, x + 9, y + 9 + n * lineHeight),
          );
        ctx.restore();
      }
  } else if (["link", "file"].includes(i.type)) {
    ctx.fillStyle = i.color || "#ffffff";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = "#92998d";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(12, 12, w - 24, h - 24);
    ctx.clip();
    ctx.fillStyle = "#30342f";
    ctx.textBaseline = "top";
    const labelSize = i.fontSize || 18;
    ctx.font = `500 ${labelSize}px ${fontStack(fontFamily(i))}`;
    const lines = cachedWrapText(
      ctx,
      i.text || i.fileName || i.url || "",
      w - 32,
    );
    lines
      .slice(0, 3)
      .forEach((line, n) =>
        ctx.fillText(line, 16, 16 + (n * labelSize * 4) / 3),
      );
    ctx.font = `400 ${(labelSize * 2) / 3}px ${fontStack(fontFamily(i))}`;
    ctx.fillStyle = "#52624b";
    ctx.fillText(
      i.type === "link" ? new URL(i.url).hostname : i.fileName || "",
      16,
      h - 30,
    );
    ctx.restore();
  } else if (i.type === "embed") {
    drawEmbedCard(ctx, i);
  } else if (i.type === "image") {
    const image = imageFor(i.src);
    if (image.image.complete && image.image.naturalWidth) {
      const { source: s, box: b } = imageLayout(
        i,
        image.image.naturalWidth,
        image.image.naturalHeight,
      );
      if (i.crop?.mask === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(
          b.x - i.x + b.w / 2,
          b.y - i.y + b.h / 2,
          b.w / 2,
          b.h / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.clip();
      }
      ctx.drawImage(
        image.image,
        s.x,
        s.y,
        s.w,
        s.h,
        b.x - i.x,
        b.y - i.y,
        b.w,
        b.h,
      );
    } else if (repaint && !image.failed)
      image.waiting.set(ctx.canvas || ctx, repaint);
  } else {
    if (i.type === "rect" && i.shape) drawShape(ctx, i.shape, w, h, i);
    else if (i.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = SHAPE_COLORS.LINE;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (i.type !== "text") {
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, i.type === "note" ? 2 : 10);
      if (i.type !== "frame") ctx.fill();
      if (["frame", "rect"].includes(i.type)) {
        ctx.strokeStyle = i.type === "frame" ? "#a2aaa0" : SHAPE_COLORS.LINE;
        ctx.lineWidth = 1;
        if (i.type === "frame") ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const fitted =
      !hideText && i.autoFontSize && canAutoFitText(i)
        ? fitTextLayout(i, ctx, i.text || "", textColor)
        : null;
    const { size, font, color, align, padding } =
      fitted?.style || textStyle(i, textColor);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = "top";
    const layout =
      fitted ||
      (!hideText && i.type === "rect" && i.shape
        ? shapeTextLayout(i, ctx)
        : null);
    const area = layout?.box || { x: 0, y: 0, w, h: h - tagFooter(i) };
    const richLines =
      !hideText && (i.textRuns?.length || i.textBlocks?.length)
        ? flowing?.richLines ||
          layout?.richLines ||
          (i.textBlocks?.length
            ? listTextLayout(
                i,
                ctx,
                Math.max(20, w - padding * 2),
                i.text || "",
                i.textRuns,
                i.textBlocks,
                textColor,
              )
            : richTextLayout(
                i,
                ctx,
                Math.max(20, w - padding * 2),
                i.text || "",
                i.textRuns,
                textColor,
              ))
        : null;
    const lines = richLines
      ? richLines.map((line) => line.text)
      : hideText
        ? []
        : flowing?.lines ||
          layout?.lines ||
          cachedWrapText(ctx, i.text || "", Math.max(20, w - padding * 2));
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    lines.forEach((line, n) => {
      const rich = richLines?.[n];
      const width = rich
        ? rich.width
        : align !== "left" || i.underline || i.strike || i.highlight
          ? ctx.measureText(flowing ? line.replace(/ +$/, "") : line).width
          : 0;
      const indent = rich?.indent || 0;
      const x =
        align === "center"
          ? indent + (area.w - indent - width) / 2
          : align === "right"
            ? area.w - padding - width
            : padding + indent;
      const y = area.y + (layout?.top ?? padding) + n * size * 1.35;
      if (rich) {
        if (rich.marker) {
          ctx.font = rich.markerStyle.font;
          ctx.fillStyle = rich.markerStyle.autoColor
            ? textColor || "#30342f"
            : rich.markerStyle.color;
          ctx.fillText(
            rich.marker,
            area.x + padding + indent - size * 0.5 - rich.markerWidth,
            y,
          );
        }
        let left = area.x + x;
        for (const part of rich.segments) {
          const style = part.style;
          const partColor = style.autoLinkColor
            ? linkColor(textColor)
            : style.autoColor
              ? textColor || "#30342f"
              : style.color;
          if (style.highlight) {
            ctx.fillStyle = style.highlight;
            ctx.fillRect(left, y, part.width, size * 1.35);
          }
          ctx.font = style.font;
          ctx.fillStyle = partColor;
          ctx.fillText(part.text, left, y);
          ctx.strokeStyle = partColor;
          ctx.lineWidth = Math.max(1, size / 16);
          for (const offset of [
            style.underline && size * 1.05,
            style.strike && size * 0.55,
          ]) {
            if (!offset) continue;
            ctx.beginPath();
            ctx.moveTo(left, y + offset);
            ctx.lineTo(left + part.width, y + offset);
            ctx.stroke();
          }
          left += part.width;
        }
        return;
      }
      if (i.highlight) {
        ctx.fillStyle = i.highlight;
        ctx.fillRect(area.x + x, y, width, size * 1.35);
        ctx.fillStyle = color;
      }
      ctx.fillText(line, area.x + x, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, size / 16);
      for (const offset of [
        i.underline && size * 1.05,
        i.strike && size * 0.55,
      ]) {
        if (!offset) continue;
        ctx.beginPath();
        ctx.moveTo(area.x + x, y + offset);
        ctx.lineTo(area.x + x + width, y + offset);
        ctx.stroke();
      }
    });
    ctx.restore();
  }
  if (tagFooter(i) && tags) drawTags(ctx, i, tags);
  if (tagFooter(i)) drawTaskBadge(ctx, i);
  ctx.restore();
}
export function paint(canvas, items, view, options = {}) {
  const tags = tagCatalog(options.tags);
  const counts =
    options.mindBadges === false
      ? null
      : options.mindCounts || mindVisibility(items, options.comments).counts;
  items = visibleMindItems(items);
  const rect = canvas.getBoundingClientRect();
  const width = options.width || rect.width || 300,
    height = options.height || rect.height || 150;
  const dpr = options.dpr || Math.min(window.devicePixelRatio || 1, 2);
  const pixelW = Math.max(1, Math.round(width * dpr)),
    pixelH = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelW) canvas.width = pixelW;
  if (canvas.height !== pixelH) canvas.height = pixelH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (reflowTextItems(items, ctx)) updateConnectors(items);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const style = getComputedStyle(document.documentElement);
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, width, height);
  }
  if (options.grid) {
    drawGrid(
      ctx,
      view,
      width,
      height,
      options.grid === true ? "dots" : options.grid,
      style.getPropertyValue("--dot").trim() || "#d6ddd2",
    );
  }
  ctx.translate(view.x, view.y);
  ctx.scale(view.z, view.z);
  const repaint = () => {
    if (canvas.isConnected) {
      if (options.repaint) options.repaint();
      else paint(canvas, items, view, options);
    }
  };
  if (document.fonts?.load) {
    let state = canvasFonts.get(canvas);
    if (!state) canvasFonts.set(canvas, (state = { families: new Set() }));
    state.repaint = repaint;
    const needed = [...itemFontFamilies(items)].filter(
      (id) => !state.families.has(id),
    );
    if (needed.length) {
      needed.forEach((id) => state.families.add(id));
      Promise.all(needed.map((id) => loadFontFamily(id)))
        .then(() => {
          clearTextLayoutCache();
          clearTagLayouts();
          clearConnectorLabelCache();
          state.repaint();
        })
        .catch(() => {});
    }
  }
  const visible = (b) =>
    !(
      (b.x + b.w) * view.z + view.x < -30 ||
      b.x * view.z + view.x > width + 30 ||
      (b.y + b.h) * view.z + view.y < -30 ||
      b.y * view.z + view.y > height + 30
    );
  for (const line of mindLines(items)) {
    if (visible(bounds([line]))) drawObject(ctx, line, "#30342f", repaint);
  }
  for (const i of stackedItems(items)) {
    if (i.id === options.cropId) continue;
    const b = bounds([i]);
    if (!visible(b)) continue;
    if (options.searchMatches)
      ctx.globalAlpha = options.searchMatches.has(i.id) ? 1 : 0.25;
    drawObject(
      ctx,
      i,
      options.textColor || style.getPropertyValue("--text").trim() || "#30342f",
      repaint,
      options.editingId === i.id,
      tags,
    );
  }
  if (counts?.size) {
    ctx.save();
    ctx.globalAlpha = 1;
    for (const i of items) {
      const count = counts.get(i.id);
      if (!count || !visible(i)) continue;
      const x = i.x + i.w,
        y = i.y;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#0869d6";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#0869d6";
      ctx.font = "600 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(count.total), x, y, 25);
    }
    ctx.restore();
  }
  if (options.quickPreview) {
    const { node, line, target, existing } = options.quickPreview;
    ctx.save();
    ctx.globalAlpha = 0.5;
    const accent = style.getPropertyValue("--accent").trim() || "#0869d6";
    if (!existing)
      drawObject(
        ctx,
        { ...line, color: accent, lineStyle: "dashed" },
        "#30342f",
        repaint,
      );
    if (node) drawObject(ctx, node, "#30342f", repaint);
    else {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3 / view.z;
      ctx.strokeRect(
        target.x - 4 / view.z,
        target.y - 4 / view.z,
        target.w + 8 / view.z,
        target.h + 8 / view.z,
      );
    }
    ctx.restore();
  }
  if (options.searchMatches) {
    ctx.globalAlpha = 1;
    ctx.save();
    for (const i of items) {
      if (!options.searchMatches.has(i.id)) continue;
      const b = bounds([i]);
      if (!visible(b)) continue;
      ctx.strokeStyle = i.id === options.searchActive ? "#d36b13" : "#587ac6";
      ctx.lineWidth = (i.id === options.searchActive ? 3 : 1.5) / view.z;
      ctx.strokeRect(
        b.x - 5 / view.z,
        b.y - 5 / view.z,
        b.w + 10 / view.z,
        b.h + 10 / view.z,
      );
    }
    ctx.restore();
  }
  ctx.strokeStyle = style.getPropertyValue("--accent").trim() || "#0869d6";
  ctx.lineWidth = 1.5 / view.z;
  if (options.groupFocus) {
    const members = items.filter((i) => i.groupId === options.groupFocus);
    if (members.length) {
      const b = bounds(members),
        pad = 10 / view.z;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1 / view.z;
      ctx.setLineDash([5 / view.z, 4 / view.z]);
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.restore();
    }
  }
  for (const i of items.filter((i) => options.selection?.has(i.id))) {
    const b = rotationOf(i) ? i : bounds([i]);
    ctx.save();
    if (rotationOf(i)) {
      ctx.translate(i.x + i.w / 2, i.y + i.h / 2);
      ctx.rotate((rotationOf(i) * Math.PI) / 180);
      ctx.translate(-i.x - i.w / 2, -i.y - i.h / 2);
    }
    ctx.setLineDash(options.selectionLocked ? [5 / view.z, 4 / view.z] : []);
    ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    ctx.setLineDash([]);
    ctx.restore();
  }
  const resizeBox =
    options.resizeBox === undefined
      ? resizeBounds(items, options.selection || new Set())
      : options.resizeBox;
  if (resizeBox && !options.selectionLocked) {
    const b = resizeBox;
    if (options.selection?.size > 1)
      ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    const s = 11 / view.z;
    const corner = boxPoint(b, { x: b.x + b.w, y: b.y + b.h });
    ctx.fillStyle = "#fff";
    ctx.fillRect(corner.x - s / 2, corner.y - s / 2, s, s);
    ctx.strokeRect(corner.x - s / 2, corner.y - s / 2, s, s);
  }
  const rotating =
    !options.selectionLocked &&
    !options.rotationDisabled &&
    (options.rotationBox || rotationBox(items, options.selection || new Set()));
  if (rotating) {
    const p = rotationHandle(rotating, view.z),
      r = 10 / view.z;
    ctx.save();
    ctx.fillStyle = "#fff";
    if (options.rotationBox && options.selection?.size > 1) {
      ctx.save();
      ctx.translate(rotating.x + rotating.w / 2, rotating.y + rotating.h / 2);
      ctx.rotate(((rotating.rotation || 0) * Math.PI) / 180);
      ctx.strokeRect(
        -rotating.w / 2 - 4,
        -rotating.h / 2 - 4,
        rotating.w + 8,
        rotating.h + 8,
      );
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 / view.z, 0.4, 5.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x + 2 / view.z, p.y - 6 / view.z);
    ctx.lineTo(p.x + 4 / view.z, p.y - 3 / view.z);
    ctx.lineTo(p.x + 0 / view.z, p.y - 3 / view.z);
    ctx.stroke();
    if (options.rotationAngle !== undefined) {
      const label = `${Math.round(options.rotationAngle * 10) / 10}°`;
      ctx.font = `500 ${12 / view.z}px sans-serif`;
      const width = ctx.measureText(label).width;
      ctx.fillRect(
        p.x + 16 / view.z,
        p.y - 12 / view.z,
        width + 12 / view.z,
        24 / view.z,
      );
      ctx.fillStyle = ctx.strokeStyle;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, p.x + 22 / view.z, p.y);
    }
    ctx.restore();
  }
  if (options.selection?.size === 1 && !options.selectionLocked) {
    const line = items.find(
      (i) => options.selection.has(i.id) && i.type === "arrow",
    );
    if (line)
      for (const p of [
        { x: line.x, y: line.y },
        { x: line.x + line.w, y: line.y + line.h },
      ]) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 / view.z, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
  }
  if (options.connectorTarget) {
    const target = items.find((i) => i.id === options.connectorTarget);
    const i = target && objectBounds(target);
    if (i) {
      ctx.lineWidth = 3 / view.z;
      ctx.strokeRect(
        i.x - 4 / view.z,
        i.y - 4 / view.z,
        i.w + 8 / view.z,
        i.h + 8 / view.z,
      );
    }
  }
  if (options.guides?.length) {
    ctx.save();
    ctx.strokeStyle =
      style.getPropertyValue("--snap-guide").trim() || "#aa3d9b";
    ctx.lineWidth = 1 / view.z;
    ctx.setLineDash([4 / view.z, 3 / view.z]);
    const pad = 10 / view.z;
    for (const guide of options.guides) {
      if (["spacing", "dimension"].includes(guide.kind)) {
        // Spacing axes describe the measured direction; alignment guides run
        // perpendicular to their snap axis.
        ctx.setLineDash([]);
        const horizontal = guide.axis === "x",
          tick = 4 / view.z;
        const point = (along, across) =>
          horizontal ? [along, across] : [across, along];
        ctx.beginPath();
        ctx.moveTo(...point(guide.from, guide.position));
        ctx.lineTo(...point(guide.to, guide.position));
        for (const edge of [guide.from, guide.to]) {
          ctx.moveTo(...point(edge, guide.position - tick));
          ctx.lineTo(...point(edge, guide.position + tick));
        }
        ctx.stroke();
        const label = String(Math.round((guide.gap ?? guide.size) * 10) / 10);
        ctx.font = `500 ${11 / view.z}px "DM Sans", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const width = ctx.measureText(label).width;
        if (
          (guide.to - guide.from) * view.z >
          (horizontal ? width * view.z : 11) + 12
        ) {
          const [x, y] = point((guide.from + guide.to) / 2, guide.position);
          ctx.fillStyle =
            style.getPropertyValue("--surface").trim() || "#ffffff";
          ctx.fillRect(
            x - width / 2 - 3 / view.z,
            y - 7 / view.z,
            width + 6 / view.z,
            14 / view.z,
          );
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fillText(label, x, y);
        }
        continue;
      }
      ctx.setLineDash([4 / view.z, 3 / view.z]);
      ctx.beginPath();
      if (guide.axis === "x") {
        ctx.moveTo(guide.position, guide.from - pad);
        ctx.lineTo(guide.position, guide.to + pad);
      } else {
        ctx.moveTo(guide.from - pad, guide.position);
        ctx.lineTo(guide.to + pad, guide.position);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  if (options.marquee) {
    const b = options.marquee;
    ctx.save();
    ctx.setLineDash(b.precise === false ? [6 / view.z, 4 / view.z] : []);
    ctx.fillStyle = "#879b6c22";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }
}
export function preview(b) {
  previews.set(b.id, b);
  return `<canvas data-preview="${escape(b.id)}" aria-hidden="true"></canvas>`;
}
export function paintPreviews() {
  const active = new Set();
  document.querySelectorAll("canvas[data-preview]").forEach((canvas) => {
    const b = previews.get(canvas.dataset.preview);
    if (!b) return;
    active.add(b.id);
    if (reflowTextItems(b.items, canvas.getContext("2d")))
      updateConnectors(b.items);
    const rect = canvas.getBoundingClientRect(),
      a = bounds(visibleMindItems(b.items));
    const width = rect.width || 300,
      height = rect.height || 150,
      z = Math.min(width / (a.w + 110), height / (a.h + 110));
    paint(
      canvas,
      b.items,
      {
        x: width / 2 - (a.x + a.w / 2) * z,
        y: height / 2 - (a.y + a.h / 2) * z,
        z,
      },
      { comments: b.comments, tags: b.tags },
    );
  });
  for (const id of previews.keys()) if (!active.has(id)) previews.delete(id);
}
export async function rasterRegion(b, region, options = {}) {
  const counts =
    options.mindCounts || mindVisibility(b.items, b.comments).counts;
  b = { ...b, items: visibleMindItems(b.items) };
  await loadItemFonts(b.items);
  await document.fonts?.ready;
  clearTextLayoutCache();
  clearTagLayouts();
  clearConnectorLabelCache();
  await Promise.all(
    b.items.filter((i) => i.type === "image").map((i) => imageFor(i.src).ready),
  );
  const canvas = document.createElement("canvas");
  if (reflowTextItems(b.items, canvas.getContext("2d")))
    updateConnectors(b.items);
  const a = region || bounds(b.items),
    padding = region ? 0 : (options.padding ?? 50);
  const scale = Math.min(
    options.scale || 2,
    // PNG/JPEG exports are capped at 4,096 pixels on the longest side, which
    // also stays within mobile canvas limits.
    (options.maxSize || 4096) / (Math.max(a.w, a.h) + padding * 2),
  );
  const width = Math.max(1, Math.ceil((a.w + padding * 2) * scale)),
    height = Math.max(1, Math.ceil((a.h + padding * 2) * scale));
  paint(
    canvas,
    b.items,
    { x: (padding - a.x) * scale, y: (padding - a.y) * scale, z: scale },
    {
      width,
      height,
      dpr: 1,
      // Vector PDF places single rasterized objects over other content.
      background: options.transparent ? null : "#ffffff",
      textColor: "#30342f",
      mindCounts: counts,
      tags: b.tags,
    },
  );
  return canvas;
}
export async function exportImage(b, region, format = "png", options = {}) {
  const canvas = await rasterRegion(b, region, options);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(Error("Could not export this board.")),
      format === "jpeg" ? "image/jpeg" : "image/png",
      0.95,
    ),
  );
}
export const exportPNG = (b) => exportImage(b);
