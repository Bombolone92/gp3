import { imageCropRect } from './images.js';

// Source cropping is evaluated before mapping into the destination rectangle.
// The painter clips this mapped image to each filled shape path, including
// destination outsets and transparent space from negative source offsets.
export function pictureFillRect(fill, width, height, pixelWidth, pixelHeight) {
  const rect = imageCropRect(fill.image.crop, pixelWidth, pixelHeight);
  if (!rect) return null;
  const d = fill.destination, x = d.left / 100000, y = d.top / 100000;
  const w = 1 - (d.left + d.right) / 100000, h = 1 - (d.top + d.bottom) / 100000;
  const [sx, sy, sw, sh] = rect.destination;
  return { source: rect.source, destination: [(x + sx * w) * width, (y + sy * h) * height, sw * w * width, sh * h * height] };
}
