import { MIN_ZOOM } from "../model.js";
// Ephemeral camera state is carried by authenticated peer packets, never by the
// board document or drawing history. World-space rectangles work across screens.
export function validCamera(camera) {
  return (
    !!camera &&
    typeof camera === "object" &&
    !Array.isArray(camera) &&
    Object.keys(camera).every((k) => ["x", "y", "w", "h"].includes(k)) &&
    [camera.x, camera.y, camera.w, camera.h].every(
      (n) => Number.isFinite(n) && Math.abs(n) <= 1e8,
    ) &&
    camera.w > 0 &&
    camera.h > 0
  );
}
export function captureCamera(view, size) {
  if (!size.width || !size.height || !(view.z > 0)) return null;
  const camera = {
    x: (size.width / 2 - view.x) / view.z,
    y: (size.height / 2 - view.y) / view.z,
    w: size.width / view.z,
    h: size.height / view.z,
  };
  return validCamera(camera) ? camera : null;
}
export function cameraView(camera, size) {
  if (!validCamera(camera) || !(size.width > 0 && size.height > 0)) return null;
  const z = Math.max(
    MIN_ZOOM,
    Math.min(3, size.width / camera.w, size.height / camera.h),
  );
  return {
    x: size.width / 2 - camera.x * z,
    y: size.height / 2 - camera.y * z,
    z,
  };
}
// A presenter's view also names the slide shown, so followers see that
// slide alone: its frame, if any, and its place in the presentation.
export function validSlide(slide) {
  if (!slide || typeof slide !== "object" || Array.isArray(slide)) return false;
  const { frame, at, of } = slide;
  return (
    Object.keys(slide).every((k) => ["frame", "at", "of"].includes(k)) &&
    (frame === undefined ||
      (typeof frame === "string" && frame.length > 0 && frame.length <= 200)) &&
    Number.isSafeInteger(at) &&
    Number.isSafeInteger(of) &&
    at >= 1 &&
    at <= of &&
    of <= 10000
  );
}
export const validSession = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
// A raised hand travels with its owner's view, as the time it went up on
// the owner's clock, so everyone keeps it while the owner is on the board
// and forgets it with the view once they leave. Clients without raised
// hands read the view and ignore it.
export const validHand = (hand, at) =>
  Number.isSafeInteger(hand) && hand > 0 && hand <= at;
export function readView(data, now) {
  if (
    !data ||
    !validCamera(data.camera) ||
    !Number.isSafeInteger(data.at) ||
    Math.abs(now - data.at) > 15000 ||
    (data.following !== null && !validSession(data.following)) ||
    (data.slide !== undefined && !validSlide(data.slide)) ||
    (data.hand !== undefined && !validHand(data.hand, data.at))
  )
    return null;
  return {
    camera: { ...data.camera },
    following: data.following,
    ...(data.slide ? { slide: { ...data.slide } } : {}),
    ...(data.hand ? { hand: data.hand } : {}),
    at: data.at,
  };
}
export function followCycle(views, target, self) {
  const visited = new Set([self]);
  while (target) {
    if (visited.has(target)) return true;
    visited.add(target);
    target = views.get(target)?.following;
  }
  return false;
}
