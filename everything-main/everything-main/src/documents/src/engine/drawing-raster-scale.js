// Preserve the existing 2x baseline and per-surface 8192px / 16MP ceiling.
// Whole-number scales keep integer physical bounds on exact pixel boundaries.
export function drawingRasterScale(width, height, requested = 2) {
  const wanted = Number.isFinite(requested) ? Math.max(2,Math.ceil(requested)) : 2;
  const limit = Math.max(2,Math.floor(Math.min(8192/Math.max(1,width,height),Math.sqrt(16000000/Math.max(1,width*height)))));
  return Math.min(wanted,limit);
}
