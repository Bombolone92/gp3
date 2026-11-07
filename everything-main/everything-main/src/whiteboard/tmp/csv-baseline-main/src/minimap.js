import { shapePath } from "./shapes.js";
import { visibleMindItems } from "./mind-visibility.js";
import { connectorPath } from "./connectors.js";
import { objectBounds, rotationOf } from "./geometry.js";

// This overview deliberately uses geometry only: no text layout, asset decode,
// pen-point scans, object mutation, or backing buffers sized to the full board.
export function minimapScene(items) {
  const entries = [],
    frames = [];
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const i of visibleMindItems(items)) {
    const {
      x,
      y,
      w,
      h,
      type,
      color,
      shape,
      rotation: storedRotation,
      mindMap,
    } = i;
    const rotation = rotationOf({ type, mindMap, rotation: storedRotation });
    const b = objectBounds({ x, y, w, h }, rotation);
    left = Math.min(left, b.x);
    top = Math.min(top, b.y);
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
    const entry = {
      x,
      y,
      w,
      h,
      type,
      color,
      shape,
      ...(rotation ? { rotation } : {}),
      oval:
        type === "ellipse" || (type === "image" && i.crop?.mask === "ellipse"),
    };
    if (type === "arrow") {
      entry.path = connectorPath(i);
      entry.curved = i.lineType === "curved";
    }
    (type === "frame" ? frames : entries).push(entry);
  }
  return {
    entries: [...frames, ...entries],
    box: items.length
      ? { x: left, y: top, w: right - left, h: bottom - top }
      : null,
  };
}

export function visibleWorld(view, size) {
  return {
    x: -view.x / view.z,
    y: -view.y / view.z,
    w: size.width / view.z,
    h: size.height / view.z,
  };
}

export function minimapLayout(box, visible, width, height) {
  const left = Math.min(box?.x ?? visible.x, visible.x);
  const top = Math.min(box?.y ?? visible.y, visible.y);
  const right = Math.max(
    box ? box.x + box.w : visible.x + visible.w,
    visible.x + visible.w,
  );
  const bottom = Math.max(
    box ? box.y + box.h : visible.y + visible.h,
    visible.y + visible.h,
  );
  const w = Math.max(1, right - left),
    h = Math.max(1, bottom - top);
  const scale = Math.min(
    Math.max(1, width - 20) / w,
    Math.max(1, height - 20) / h,
  );
  return {
    width,
    height,
    scale,
    x: width / 2 - ((left + right) / 2) * scale,
    y: height / 2 - ((top + bottom) / 2) * scale,
  };
}

export function mapPoint(layout, point) {
  return {
    x: (point.x - layout.x) / layout.scale,
    y: (point.y - layout.y) / layout.scale,
  };
}

export function mapRect(layout, box) {
  return {
    x: box.x * layout.scale + layout.x,
    y: box.y * layout.scale + layout.y,
    w: box.w * layout.scale,
    h: box.h * layout.scale,
  };
}

export function centerView(view, size, point) {
  return {
    x: size.width / 2 - point.x * view.z,
    y: size.height / 2 - point.y * view.z,
    z: view.z,
  };
}

export function paintMinimapScene(ctx, scene, layout, colors) {
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const i of scene.entries) {
    const r = mapRect(layout, i);
    ctx.save();
    if (i.rotation) {
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.rotate((i.rotation * Math.PI) / 180);
      ctx.translate(-r.x - r.w / 2, -r.y - r.h / 2);
    }
    ctx.fillStyle =
      i.type === "image" || i.type === "file"
        ? colors.media
        : i.color || colors.object;
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = 1;
    if (i.type === "arrow") {
      const path = i.path.map((p) => ({
        x: p.x * layout.scale + layout.x,
        y: p.y * layout.scale + layout.y,
      }));
      ctx.strokeStyle = i.color || colors.outline;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      if (i.curved)
        ctx.bezierCurveTo(
          path[1].x,
          path[1].y,
          path[2].x,
          path[2].y,
          path[3].x,
          path[3].y,
        );
      else for (const p of path.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (i.type === "pen") {
      ctx.strokeStyle = i.color || colors.outline;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x + r.w, r.y + r.h);
      ctx.stroke();
      if (!r.w && !r.h) ctx.fillRect(r.x, r.y, 1, 1);
    } else {
      const w = Math.max(1, Math.abs(r.w)),
        h = Math.max(1, Math.abs(r.h));
      ctx.translate(
        Math.min(r.x, r.x + r.w) - (w - Math.abs(r.w)) / 2,
        Math.min(r.y, r.y + r.h) - (h - Math.abs(r.h)) / 2,
      );
      ctx.beginPath();
      if (i.oval) ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
      else if (i.type === "rect" && i.shape) shapePath(ctx, i.shape, w, h);
      else ctx.rect(0, 0, w, h);
      if (i.type !== "frame") ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function paintMinimapViewport(ctx, box, colors) {
  ctx.fillStyle = colors.viewportFill;
  ctx.strokeStyle = colors.viewport;
  ctx.lineWidth = 2;
  // Keep a far-away or very zoomed viewport visible and usable as a target.
  const w = Math.max(4, box.w),
    h = Math.max(4, box.h);
  const x = box.x - (w - box.w) / 2,
    y = box.y - (h - box.h) / 2;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  return { x, y, w, h };
}
