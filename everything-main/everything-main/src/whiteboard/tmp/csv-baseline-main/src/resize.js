import { clone, resizeBounds } from "./model.js";
import { assertUnlocked } from "./locking.js";
import { descendants, isConnector, updateConnectors } from "./scene.js";
import { canEditText, textStyle, growsWithText } from "./text.js";
import { rotationOf, boxPoint } from "./geometry.js";

const textSize = (i) =>
  canEditText(i)
    ? textStyle(i).size
    : i.type === "table"
      ? i.fontSize || 15
      : ["link", "file"].includes(i.type)
        ? i.fontSize || 18
        : null;
export function createResizePlan(items, ids, frameId = null, options) {
  const expanded = descendants(items, ids, options);
  assertUnlocked(items, expanded);
  const box = resizeBounds(items, expanded, frameId);
  if (!box) return null;
  const frame = items.find(
    (i) =>
      i.id === frameId &&
      expanded.has(i.id) &&
      i.type === "frame" &&
      !i.groupId,
  );
  const chosen = items.filter(
    (i) => (frame ? i === frame : expanded.has(i.id)) && !isConnector(i),
  );
  return {
    box,
    items: clone(chosen),
    ids: new Set(chosen.map((i) => i.id)),
    proportional: chosen.length > 1 || chosen[0].type === "image",
    fixedProportions: chosen.length > 1 && chosen.some(rotationOf),
    scaleText: chosen.length > 1,
    autoHeight: chosen.length === 1 && growsWithText(chosen[0]),
    frameOnly: !!frame,
  };
}
export function resizeLimits(plan, scaleText = plan.scaleText) {
  let minX = 0,
    minY = 0,
    maxX = Infinity,
    maxY = Infinity;
  for (const i of plan.items) {
    for (const [size, axis] of [
      [Math.abs(i.w), "x"],
      [Math.abs(i.h), "y"],
    ]) {
      if (!size) continue;
      const min = ["arrow", "pen"].includes(i.type)
        ? 1
        : axis === "x"
          ? 60
          : 45;
      const lower = Math.min(min, size) / size,
        upper = 1e6 / size;
      if (axis === "x") {
        minX = Math.max(minX, lower);
        maxX = Math.min(maxX, upper);
      } else {
        minY = Math.max(minY, lower);
        maxY = Math.min(maxY, upper);
      }
    }
    const size = scaleText && textSize(i);
    if (size) {
      minX = Math.max(minX, 8 / size);
      minY = Math.max(minY, 8 / size);
      maxX = Math.min(maxX, 100 / size);
      maxY = Math.min(maxY, 100 / size);
    }
  }
  return {
    minW: plan.box.w * minX,
    minH: plan.box.h * minY,
    maxW: plan.box.w * maxX,
    maxH: plan.box.h * maxY,
  };
}
// Compute every update before writing anything. Geometry always comes from the
// gesture snapshot so repeated pointer updates cannot accumulate rounding error.
export function applyResize(items, plan, w, h, scaleText = plan.scaleText) {
  assertUnlocked(items, plan.ids);
  if (![w, h].every((n) => Number.isFinite(n) && n > 0))
    throw Error("Enter valid dimensions.");
  const sx = w / plan.box.w,
    sy = h / plan.box.h;
  if (plan.fixedProportions && Math.abs(sx - sy) > 1e-9)
    throw Error("Keep proportions when resizing rotated objects together.");
  const updates = plan.items.map((i) => {
    const update = {
      x: plan.box.x + (i.x - plan.box.x) * sx,
      y: plan.box.y + (i.y - plan.box.y) * sy,
      w: i.w * sx,
      h: i.h * sy,
    };
    if (plan.box.rotation) {
      const center = boxPoint(plan.box, {
        x: plan.box.x + update.w / 2,
        y: plan.box.y + update.h / 2,
      });
      update.x = center.x - update.w / 2;
      update.y = center.y - update.h / 2;
    }
    if (
      !Object.values(update).every(
        (n) => Number.isFinite(n) && Math.abs(n) <= 1e6,
      )
    )
      throw Error("This size exceeds the board limits.");
    if (i.type === "pen")
      update.points = i.points.map(([x, y]) => [x * sx, y * sy]);
    if (
      update.points?.some((p) =>
        p.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e6),
      )
    )
      throw Error("This size exceeds the board limits.");
    const size = scaleText && textSize(i);
    if (size) {
      const scaled = size * Math.min(sx, sy);
      if (scaled < 8 - 1e-9 || scaled > 100 + 1e-9)
        throw Error("Keep text between 8 and 100 pixels.");
      update.fontSize =
        Math.abs(scaled - size) < 1e-9
          ? i.fontSize
          : Math.min(100, Math.max(8, scaled));
    }
    return { id: i.id, update };
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  if (updates.some(({ id }) => !byId.has(id)))
    throw Error("The selection changed. Select it again.");
  for (const { id, update } of updates) {
    const target = byId.get(id);
    Object.assign(target, update);
    if (Object.hasOwn(update, "fontSize") && update.fontSize === undefined)
      delete target.fontSize;
  }
  updateConnectors(items);
}
