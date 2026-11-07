// The color key allows sixteen-byte differences for decoded JPEG pixels.
// Other formats use one byte with useA, or exact opaque RGB without it.
// Independent source-alpha/near-color controls document both behaviors.
export function colorChangePixels(data, effect, mime) {
  const { from, to, useAlpha } = effect;
  const valid = color => color && /^[\da-f]{6}$/i.test(color.rgb) && Number.isFinite(color.alpha) && color.alpha >= 0 && color.alpha <= 1;
  if (!valid(from) || !valid(to) || typeof useAlpha !== 'boolean') throw new Error('Invalid picture color change.');
  const channels = color => [...color.rgb.match(/../g).map(c => parseInt(c, 16)), Math.round(color.alpha * 255)];
  const source = channels(from), target = channels(to), tolerance = mime === 'image/jpeg' ? 16 : useAlpha ? 1 : 0;
  if (!useAlpha) source[3] = target[3] = 255;
  for (let i = 0; i < data.length; i += 4) {
    // Native and browser image decoding discard hidden RGB at zero alpha.
    const transparent = data[i + 3] === 0;
    if (Math.abs((transparent ? 0 : data[i]) - source[0]) > tolerance || Math.abs((transparent ? 0 : data[i + 1]) - source[1]) > tolerance ||
        Math.abs((transparent ? 0 : data[i + 2]) - source[2]) > tolerance || Math.abs(data[i + 3] - source[3]) > tolerance) continue;
    data[i] = target[0]; data[i + 1] = target[1]; data[i + 2] = target[2]; data[i + 3] = target[3];
  }
  return data;
}
