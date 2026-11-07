// Keep a pressable center between opposite drawn grips. Rectangle handles can
// move out along each axis; a connector's end handles stay on its own line.
export function selectionHandleLayout(w, h, grip, interior, line = false) {
  const room = grip + interior;
  let frameW = Math.max(w, grip),
    frameH = Math.max(h, grip);
  if (frameW < room && frameH < room) {
    frameW = room;
    frameH = room;
  }
  if (line) {
    const span = Math.max(w, h);
    const scale = span ? Math.max(1, room / span) : 1;
    frameW = span ? w * scale : room;
    frameH = h * scale;
  }
  return {
    offsetX: (frameW - w) / 2,
    offsetY: (frameH - h) / 2,
    // An edge grip sits between two corners and needs its drawn width of
    // separation on either side, plus a free object center on the other axis.
    topBottom: !line && frameW >= 2 * grip && frameH >= room,
    leftRight: !line && frameH >= 2 * grip && frameW >= room,
  };
}
