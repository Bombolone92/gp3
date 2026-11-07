import { MIN_ZOOM } from "./model.js";
export const GRID_STORAGE_KEY = "whiteboard-grid";
export const GRID_MODES = ["none", "lines", "dots"];

export function gridSettings(value) {
  const mode = GRID_MODES.includes(value?.mode) ? value.mode : "dots";
  return { mode, snap: mode !== "none" && value?.snap === true };
}
export function readGrid(value) {
  try {
    return gridSettings(JSON.parse(value));
  } catch {
    return gridSettings();
  }
}
// Match the existing 24-unit dots and progressively reveal coarser grid lines
// at low zoom. Rendering and placement share the same world-space interval.
export function gridStep(zoom) {
  let step = 24;
  const z = Number.isFinite(zoom) ? Math.max(MIN_ZOOM, Math.min(3, zoom)) : 1;
  while (step * z < 12) step *= 2;
  return step;
}
export function snapGridPoint(point, step) {
  if (!(step > 0) || !Number.isFinite(step)) return point;
  return {
    x: Math.round(point.x / step) * step,
    y: Math.round(point.y / step) * step,
  };
}
export function snapGridMove(box, move, step) {
  if (!box || !(step > 0)) return move;
  // Equal-spacing guides require overlap in the perpendicular direction.
  // Preserve that lane instead of shifting it out from under an active guide.
  if (move.guides.some((g) => g.kind === "spacing")) return move;
  const point = snapGridPoint({ x: box.x + move.dx, y: box.y + move.dy }, step);
  return {
    ...move,
    dx: move.guides.some((g) => g.axis === "x") ? move.dx : point.x - box.x,
    dy: move.guides.some((g) => g.axis === "y") ? move.dy : point.y - box.y,
  };
}
export function gridMatch(
  position,
  step,
  minimum = -Infinity,
  maximum = Infinity,
) {
  if (!(step > 0) || !Number.isFinite(step)) return null;
  const low = Math.ceil(minimum / step) * step,
    high = Math.floor(maximum / step) * step;
  if (low > high) return null;
  const snapped = Math.max(
    low,
    Math.min(high, Math.round(position / step) * step),
  );
  return { position: snapped, delta: snapped - position, grid: true };
}
export function drawGrid(ctx, view, width, height, mode, color) {
  if (!["dots", "lines"].includes(mode)) return;
  const step = gridStep(view.z) * view.z;
  if (!(step > 0) || !Number.isFinite(step)) return;
  const left = ((view.x % step) + step) % step,
    top = ((view.y % step) + step) % step;
  ctx.save();
  if (mode === "lines") {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.65;
    for (let x = left; x < width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = top; y < height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    // A large view at a small spacing holds over ten thousand dots. Filling
    // each as its own path costs several milliseconds a frame while panning;
    // a path spanning the whole view is slow to rasterize too. One path per
    // row fills the same circles in a fraction of the time.
    for (let y = top; y < height; y += step) {
      ctx.beginPath();
      for (let x = left; x < width; x += step) {
        ctx.moveTo(x + 0.8, y);
        ctx.arc(x, y, 0.8, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }
  ctx.restore();
}
