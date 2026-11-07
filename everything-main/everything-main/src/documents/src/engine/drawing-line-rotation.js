// Directed endpoints in physical coordinates, relative to the resized frame.
// A child's frame is resized before it is rotated. Around a quarter turn its
// local axes take the opposite group scale; see the independent reference probes.
export function rotatedLinePoints(node, sx, sy) {
  const degrees = node.lineRotation / 60000;
  const swap = degrees >= 45 && degrees < 135 || degrees >= 225 && degrees < 315;
  const angle = degrees * Math.PI / 180;
  const snap = value => Math.abs(value) < 1e-12 ? 0 : value;
  const cos = snap(Math.cos(angle)), sin = snap(Math.sin(angle));
  const dx = node.width * (swap ? sy : sx) * (node.flipH ? -1 : 1);
  const dy = node.height * (swap ? sx : sy) * (node.flipV ? -1 : 1);
  const x = dx * cos - dy * sin, y = dx * sin + dy * cos;
  const cx = node.width * sx / 2, cy = node.height * sy / 2;
  return [[cx - x / 2, cy - y / 2], [cx + x / 2, cy + y / 2]];
}
