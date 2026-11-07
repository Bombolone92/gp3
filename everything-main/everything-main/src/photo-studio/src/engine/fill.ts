import { assertSize } from '../model/document';

// The UI tolerance is expressed in 8-bit code steps. Apply that same distance
// to normalized document channels without clipping HDR or rounding to bytes.
export function fillFloat(
  data: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number,
): Uint8Array {
  assertSize(width, height);
  if (
    data.length !== width * height * 4 ||
    !data.every(Number.isFinite) ||
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    tolerance > 255
  )
    throw new Error('Invalid floating-point fill input.');
  const mask = new Uint8Array(data.length);
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= width ||
    y >= height
  )
    return mask;
  const count = width * height;
  const visited = new Uint8Array(Math.ceil(count / 8));
  const stack = new Uint32Array(count);
  let length = 0;
  const push = (index: number) => {
    const bit = 1 << (index % 8),
      at = Math.floor(index / 8);
    if (visited[at] & bit) return;
    visited[at] |= bit;
    stack[length++] = index;
  };
  const seed = (y * width + x) * 4,
    distance = tolerance / 255;
  push(y * width + x);
  while (length) {
    const index = stack[--length],
      at = index * 4;
    let matches = true;
    for (let c = 0; c < 4; c++)
      if (Math.abs(data[at + c] - data[seed + c]) > distance) {
        matches = false;
        break;
      }
    if (!matches) continue;
    mask.fill(255, at, at + 4);
    const px = index % width;
    if (px > 0) push(index - 1);
    if (px + 1 < width) push(index + 1);
    if (index >= width) push(index - width);
    if (index + width < count) push(index + width);
  }
  return mask;
}
