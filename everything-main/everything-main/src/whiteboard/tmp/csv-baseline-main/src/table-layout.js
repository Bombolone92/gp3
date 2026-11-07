export const TABLE_AXES = {
  column: { key: "columnWidths", dimension: "w", minimum: 40 },
  row: { key: "rowHeights", dimension: "h", minimum: 24 },
};
export const trackCount = (i, axis) =>
  axis === "column" ? i.cells[0].length : i.cells.length;
export const sumTracks = (values) =>
  values.reduce((sum, value) => sum + value, 0);
export function tableTracks(i, axis) {
  const { key, dimension } = TABLE_AXES[axis],
    count = trackCount(i, axis),
    values = i[key];
  if (!values || values.length !== count)
    return Array(count).fill(i[dimension] / count);
  const scale = i[dimension] / sumTracks(values);
  return values.map((value) => value * scale);
}
export function tableLayout(i) {
  const columns = tableTracks(i, "column"),
    rows = tableTracks(i, "row");
  const offsets = (values, total) => {
    const points = [0];
    for (const value of values) points.push(points.at(-1) + value);
    points[points.length - 1] = total;
    return points;
  };
  return { columns, rows, x: offsets(columns, i.w), y: offsets(rows, i.h) };
}
export function validTableSizes(i) {
  return Object.entries(TABLE_AXES).every(
    ([axis, { key }]) =>
      i[key] === undefined ||
      (i.type === "table" &&
        Array.isArray(i[key]) &&
        i[key].length === trackCount(i, axis) &&
        i[key].every((n) => Number.isFinite(n) && n > 0 && n <= 1e6)),
  );
}
export function resizeTableTracks(i, axis, indices, size) {
  const { key, dimension, minimum } = TABLE_AXES[axis],
    values = tableTracks(i, axis);
  if (
    !indices.length ||
    indices.some((n) => !Number.isInteger(n) || n < 0 || n >= values.length) ||
    !Number.isFinite(size) ||
    size < minimum
  )
    throw Error("Enter a valid row height or column width.");
  for (const n of indices) values[n] = size;
  const total = sumTracks(values);
  if (total > 1e6) throw Error("This size exceeds the board limits.");
  return { [key]: values, [dimension]: total };
}
export function remapTableTracks(i, cells, structure) {
  const patch = {};
  for (const [axis, { key, dimension }] of Object.entries(TABLE_AXES)) {
    const values = tableTracks(i, axis),
      count = axis === "column" ? cells[0].length : cells.length;
    if (structure?.axis === axis)
      values.splice(
        structure.index,
        structure.remove || 0,
        ...Array(structure.insert || 0).fill(
          values[structure.index] || values.at(-1),
        ),
      );
    while (values.length < count) values.push(values.at(-1));
    values.length = count;
    patch[key] = values;
    patch[dimension] = sumTracks(values);
  }
  return patch;
}
// Merge individual resized tracks while a queued local edit receives remote data.
export function rebaseTableSizes(result, local, before, remote) {
  if (local.type !== "table" || remote.type !== "table") return result;
  for (const [axis, { key, dimension }] of Object.entries(TABLE_AXES)) {
    if (!local[key] && !before[key] && !remote[key]) continue;
    if (
      local.cells.length !== before.cells.length ||
      local.cells[0].length !== before.cells[0].length ||
      remote.cells.length !== before.cells.length ||
      remote.cells[0].length !== before.cells[0].length
    ) {
      const source =
        JSON.stringify(result.cells) === JSON.stringify(local.cells)
          ? local
          : remote;
      if (source[key]) result[key] = tableTracks(source, axis);
      else delete result[key];
      result[dimension] = source[dimension];
      continue;
    }
    const mine = tableTracks(local, axis),
      old = tableTracks(before, axis),
      theirs = tableTracks(remote, axis);
    result[key] = mine.map((value, n) =>
      Math.abs(value - old[n]) > 1e-8 ? value : theirs[n],
    );
    const total = sumTracks(result[key]);
    if (total > 1e6)
      result[key] = result[key].map((value) => value * (1e6 / total));
    result[dimension] = Math.min(1e6, total);
  }
  return result;
}
