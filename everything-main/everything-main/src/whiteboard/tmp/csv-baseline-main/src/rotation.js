import { assertUnlocked, hasLocked } from "./locking.js";
import { descendants, isConnector, updateConnectors } from "./scene.js";
import {
  canRotateItem,
  rotationOf,
  normalizeRotation,
  centerOf,
  rotatePoint,
  selectionBox,
  boxPoint,
} from "./geometry.js";

export function rotationItems(items, ids) {
  if (!ids.size) return [];
  const chosen = items.filter((i) => ids.has(i.id) && !isConnector(i));
  return chosen.length && chosen.every(canRotateItem) ? chosen : [];
}
export function rotationBox(items, ids) {
  const chosen = rotationItems(items, ids);
  return chosen.length ? selectionBox(chosen) : null;
}
export function rotationHandle(box, zoom) {
  return boxPoint(box, { x: box.x - 26 / zoom, y: box.y + box.h + 26 / zoom });
}
export function rotationHit(items, ids, point, zoom, touch = false) {
  if (!ids.size) return false;
  if (hasLocked(items, ids)) return false;
  const box = rotationBox(items, ids);
  if (!box) return false;
  const p = rotationHandle(box, zoom);
  return Math.hypot(point.x - p.x, point.y - p.y) <= (touch ? 22 : 14) / zoom;
}
export function createRotationPlan(items, ids, options) {
  const expanded = descendants(items, ids, options);
  assertUnlocked(items, expanded);
  const chosen = rotationItems(items, expanded);
  if (!chosen.length) return null;
  const box = selectionBox(chosen);
  return {
    box,
    center: centerOf(box),
    // Rotation needs no text, pixels, or stroke points in its gesture snapshot.
    items: chosen.map(({ id, type, x, y, w, h, rotation }) => ({
      id,
      type,
      x,
      y,
      w,
      h,
      rotation,
    })),
    ids: new Set(chosen.map((i) => i.id)),
  };
}
export function rotationSignature(items, ids, options) {
  const expanded = descendants(items, ids, options);
  return JSON.stringify(
    items
      .filter((i) => expanded.has(i.id) && !isConnector(i))
      .map((i) => [
        i.id,
        i.type,
        i.mindMap,
        i.groupId,
        i.x,
        i.y,
        i.w,
        i.h,
        i.rotation,
      ])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}
export function rotationDelta(plan, start, point, snap = false) {
  const angle = (p) =>
    (Math.atan2(p.y - plan.center.y, p.x - plan.center.x) * 180) / Math.PI;
  const delta = normalizeRotation(angle(point) - angle(start));
  const base = plan.items.length === 1 ? rotationOf(plan.items[0]) : 0;
  return snap ? Math.round((base + delta) / 15) * 15 - base : delta;
}
export function applyRotation(items, plan, delta) {
  assertUnlocked(items, plan.ids);
  if (!Number.isFinite(delta)) throw Error("Enter a valid angle.");
  delta = normalizeRotation(delta);
  const byId = new Map(items.map((i) => [i.id, i]));
  const updates = plan.items.map((original) => {
    const target = byId.get(original.id);
    if (!target || !canRotateItem(target))
      throw Error("The selection changed. Select it again.");
    const c = rotatePoint(centerOf(original), plan.center, delta);
    const update = {
      x: !delta || plan.items.length === 1 ? original.x : c.x - original.w / 2,
      y: !delta || plan.items.length === 1 ? original.y : c.y - original.h / 2,
      rotation: normalizeRotation(rotationOf(original) + delta),
    };
    if (
      ![update.x, update.y].every(
        (n) => Number.isFinite(n) && Math.abs(n) <= 1e6,
      )
    )
      throw Error("This rotation exceeds the board limits.");
    return { target, update, original };
  });
  for (const { target, update, original } of updates) {
    Object.assign(target, update);
    if (!update.rotation && original.rotation === undefined)
      delete target.rotation;
  }
  updateConnectors(items);
}
