// Shared cache selection and point semantics for reading and data comparisons.
// A native channel may contain opaque records beyond the represented points.
import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
} from "../xml/index.ts";
import { readChartUnsignedInt } from "./axis-context.ts";
const c = (name: string) => qname("c", name, NS.chart);
export interface ChartCache {
  readonly points: XmlElement;
  readonly countOwner: XmlElement;
}
export const chartCacheText = (node: XmlElement): string => {
  let text = "";
  for (const nodeChild of node.children)
    if (nodeChild.kind === "text" || nodeChild.kind === "cdata")
      text += nodeChild.data;
  return text;
};
export const chartStringCache = (parent: XmlElement): ChartCache | null => {
  const ref = firstChildElement(parent, c("strRef")),
    cache = ref && firstChildElement(ref, c("strCache")),
    lit = firstChildElement(parent, c("strLit"));
  if (cache || lit)
    return { points: (cache ?? lit)!, countOwner: (cache ?? lit)! };
  const multi = firstChildElement(parent, c("multiLvlStrRef")),
    levels = multi && firstChildElement(multi, c("multiLvlStrCache")),
    level = levels && firstChildElement(levels, c("lvl"));
  return level && levels ? { points: level, countOwner: levels } : null;
};
export const chartNumberCache = (parent: XmlElement): ChartCache | null => {
  const ref = firstChildElement(parent, c("numRef")),
    cache =
      (ref && firstChildElement(ref, c("numCache"))) ??
      firstChildElement(parent, c("numLit"));
  return cache ? { points: cache, countOwner: cache } : null;
};
export const chartCacheCount = (cache: ChartCache): number => {
  const count = firstChildElement(cache.countOwner, c("ptCount"));
  return count
    ? (readChartUnsignedInt(getAttrValue(count, qname("", "val", ""))) ?? 0)
    : 0;
};
export function* chartCachePoints(
  cache: ChartCache,
): Generator<readonly [number, string]> {
  for (const point of cache.points.children) {
    if (
      point.kind !== "element" ||
      point.name.namespaceURI !== NS.chart ||
      point.name.localName !== "pt"
    )
      continue;
    const idx = readChartUnsignedInt(getAttrValue(point, qname("", "idx", ""))),
      value = firstChildElement(point, c("v"));
    if (idx !== null && value) yield [idx, chartCacheText(value)];
  }
}
export const chartCacheNumber = (raw: string): number | null => {
  const value = raw === "" ? NaN : Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
};
export const readCacheFormat = (
  channel: XmlElement | null,
): string | undefined => {
  const cache = channel && chartNumberCache(channel),
    code = cache && firstChildElement(cache.points, c("formatCode"));
  return code ? chartCacheText(code) : undefined;
};
// This bounds dense model allocation, not the reader's chart point count. The
// original part is retained even when a model cannot materialize its caches.
export const MAX_MATERIALIZED_CACHE_POINTS = 8 * 1024 * 1024;
export const checkChartCacheSize = (count: number): void => {
  if (count > MAX_MATERIALIZED_CACHE_POINTS)
    throw new RangeError(
      `Chart cache has ${count} slots, exceeding the materialization limit of ${MAX_MATERIALIZED_CACHE_POINTS}`,
    );
};
export const readChartCache = (cache: ChartCache): string[] => {
  const length = chartCacheCount(cache);
  checkChartCacheSize(length);
  const out = new Array<string>(length).fill("");
  for (const [idx, value] of chartCachePoints(cache)) {
    if (idx >= out.length) {
      const oldLength = out.length;
      checkChartCacheSize(idx + 1);
      out.length = idx + 1;
      out.fill("", oldLength);
    }
    out[idx] = value;
  }
  return out;
};
