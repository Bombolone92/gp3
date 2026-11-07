import * as Y from "yjs";
import {
  TABLE_AXES,
  tableTracks,
  trackCount,
  sumTracks,
} from "../table-layout.js";

export function sizeKey(key) {
  const match = /^(row|column):(0|[1-9]\d?)$/.exec(key);
  return match && +match[2] < (match[1] === "row" ? 20 : 12)
    ? { axis: match[1], index: +match[2] }
    : null;
}
export const validSharedSize = (value) =>
  Number.isFinite(value) && value > 0 && value <= 1e6;
export function sharedTableShape(entry, cells) {
  const old = entry.get("cells");
  return old instanceof Y.Map
    ? old.get("rows") === cells.length && old.get("cols") === cells[0].length
    : Array.isArray(old) &&
        old.length === cells.length &&
        old[0]?.length === cells[0].length;
}
const container = (entry) =>
  entry.get("cells") instanceof Y.Map ? entry.get("cells") : entry;

// Geometry retains the original equal-size baseline. Only changed tracks get
// registers, so simultaneous first resizes and per-track undo remain independent.
export function changeSharedTableSizes(entry, item) {
  if (item.type !== "table") return;
  const map = container(entry),
    geometry = entry.get("geometry");
  for (const [axis, { key, dimension }] of Object.entries(TABLE_AXES)) {
    const values = item[key] && tableTracks(item, axis),
      count = trackCount(item, axis),
      base = geometry[dimension] / count;
    for (let n = 0; n < count; n++) {
      const name = `${axis}:${n}`,
        value = values?.[n];
      if (value === undefined || Math.abs(value - base) < 1e-8) {
        if (map.has(name)) map.delete(name);
      } else if (map.get(name) !== value) map.set(name, value);
    }
  }
}
export function readSharedTableSizes(entry, item) {
  if (item.type !== "table") return;
  const map = container(entry);
  const keys = [...map.keys()].filter((key) => sizeKey(key));
  if (!keys.length) return;
  if (item.type !== "table" || !Array.isArray(item.cells))
    throw Error("Invalid shared table dimensions.");
  for (const key of keys) {
    const { axis, index } = sizeKey(key);
    if (index >= trackCount(item, axis) || !validSharedSize(map.get(key)))
      throw Error("Invalid shared table dimensions.");
  }
  for (const [axis, { key, dimension }] of Object.entries(TABLE_AXES)) {
    if (!keys.some((k) => sizeKey(k).axis === axis)) continue;
    const count = trackCount(item, axis),
      base = item[dimension] / count;
    const values = Array.from(
      { length: count },
      (_, n) => map.get(`${axis}:${n}`) ?? base,
    );
    const total = sumTracks(values),
      scale = Math.min(1, 1e6 / total);
    item[key] = values.map((value) => value * scale);
    item[dimension] = Math.min(1e6, total);
  }
}
