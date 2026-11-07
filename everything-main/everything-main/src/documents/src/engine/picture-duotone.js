import { imageWithPixelEffects } from './vector-image-effects.js';
// DrawingML duotone as measured against the native reference: quantized Rec.709 luma in sRGB,
// followed by interpolation of the two sRGB endpoints. Keep source alpha.
export function duotonePixels(data, effects) {
  if (!Array.isArray(effects) || !effects.length || effects.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(color => typeof color !== 'string' || !/^[\da-f]{6}$/i.test(color)))) throw new Error('Invalid picture duotone colors.');
  // The first effect quantizes every source pixel to one of 256 gray levels.
  // Compose the color remapping once, then visit each image pixel only once.
  const lookup = Uint8Array.from({ length: 256 * 3 }, (_, i) => Math.floor(i / 3));
  for (const pair of effects) {
    const [dark, light] = pair.map(color => color.match(/../g).map(c => parseInt(c, 16)));
    for (let i = 0; i < lookup.length; i += 3) {
      const gray = Math.floor((2126 * lookup[i] + 7152 * lookup[i + 1] + 722 * lookup[i + 2]) / 10000);
      for (let channel = 0; channel < 3; channel++) lookup[i + channel] = Math.round(dark[channel] + (light[channel] - dark[channel]) * gray / 255);
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.floor((2126 * data[i] + 7152 * data[i + 1] + 722 * data[i + 2]) / 10000) * 3;
    for (let channel = 0; channel < 3; channel++) data[i + channel] = lookup[gray + channel];
  }
  return data;
}

export function decodeDuotone(image, effects) {
  return imageWithPixelEffects(image, data => duotonePixels(data, effects));
}
