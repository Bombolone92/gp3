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
    0.15,
    Math.min(3, size.width / camera.w, size.height / camera.h),
  );
  return {
    x: size.width / 2 - camera.x * z,
    y: size.height / 2 - camera.y * z,
    z,
  };
}
export const validSession = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
export function readView(data, now) {
  if (
    !data ||
    !validCamera(data.camera) ||
    !Number.isSafeInteger(data.at) ||
    Math.abs(now - data.at) > 15000 ||
    (data.following !== null && !validSession(data.following))
  )
    return null;
  return { camera: { ...data.camera }, following: data.following, at: data.at };
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
