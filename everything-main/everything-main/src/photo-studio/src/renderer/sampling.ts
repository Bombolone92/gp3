import type { Texture } from "./backend";

// A straight-RGBA filtering kernel is safe only when every color sample is a
// native texel copy (or a constant fill). Masks retain scalar interpolation in
// either pipeline. Keeping this decision uniform avoids adding resampling
// arithmetic/register pressure to ordinary layer compositing and painting.
export function needsRgbaResampling(
  u: Float32Array,
  back: Texture,
  source: Texture,
  width: number,
  height: number,
) {
  if (u[31] > 0.5) return source.width !== width || source.height !== height;
  if (back.width !== width || back.height !== height) return true;
  if ((source.width === 1 && source.height === 1) || u[29] === 1) return false;
  const viewport = u.length >= 36 && u[34] > 0 && u[35] > 0;
  if (viewport) {
    if (
      u[34] !== width ||
      u[35] !== height ||
      !Number.isInteger(u[32]) ||
      !Number.isInteger(u[33])
    )
      return true;
  } else if (u[0] !== width || u[1] !== height) return true;
  return (
    u[8] !== 1 ||
    u[9] !== 0 ||
    u[6] !== source.width ||
    u[7] !== source.height ||
    !Number.isInteger(u[4]) ||
    !Number.isInteger(u[5]) ||
    !Number.isInteger(u[15])
  );
}
