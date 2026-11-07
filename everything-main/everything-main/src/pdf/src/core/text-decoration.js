/** Filled bands in the text's own axes, so decorations follow rotation and scaling. */
export function textDecorationQuads(origin, across, up, { underline, strikethrough }) {
  const levels = [];
  if (underline) levels.push(-0.12);
  if (strikethrough) levels.push(0.3);
  const point = (x, y) => origin.map((n, i) => n + across[i] * x + up[i] * y);
  return levels.map((y) => [
    point(0, y - 0.025),
    point(1, y - 0.025),
    point(1, y + 0.025),
    point(0, y + 0.025),
  ]);
}
