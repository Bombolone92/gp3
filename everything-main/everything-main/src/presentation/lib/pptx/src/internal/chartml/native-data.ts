// Appearance edits must keep both the original workbook and its reference
// channels. Rebuilding one without the other silently rebinds native ranges.
import {
  NS,
  type XmlElement,
  allChildElements,
  firstChildElement,
  getAttrValue,
  qname,
  withInheritedNamespaces,
} from "../xml/index.ts";
import type { ChartSpec } from "./types.ts";
import { CHART_PLOT_KINDS } from "./chart-reader.ts";
import { readChartUnsignedInt } from "./axis-context.ts";
import {
  type ChartCache,
  chartStringCache,
  chartNumberCache,
  chartCacheCount,
  chartCachePoints,
  chartCacheNumber,
  chartCacheText,
  readCacheFormat,
  MAX_MATERIALIZED_CACHE_POINTS,
} from "./chart-cache.ts";
const c = (name: string) => qname("c", name, NS.chart);
export const nativeChartSeriesHosts = (root: XmlElement) => {
  if (
    root.name.namespaceURI !== NS.chart ||
    root.name.localName !== "chartSpace"
  )
    return null;
  const chart = firstChildElement(root, c("chart")),
    area = chart && firstChildElement(chart, c("plotArea"));
  if (!chart || !area) return null;
  return area.children.flatMap((group) => {
    if (
      group.kind !== "element" ||
      group.name.namespaceURI !== NS.chart ||
      !CHART_PLOT_KINDS.some((k) => k.localName === group.name.localName)
    )
      return [];
    return allChildElements(group, c("ser")).map((series) => ({
      series,
      path: [root, chart, area, group, series],
    }));
  });
};
// Compare against the supplied model without materializing native ptCount.
// Sparse XML costs O(explicit points); hostile size metadata returns no match.
export const chartCacheMatches = <T>(
  cache: ChartCache | null,
  expected: ReadonlyArray<T>,
  parse: (raw: string) => T,
): boolean => {
  if (!cache) return expected.length === 0;
  let length = chartCacheCount(cache);
  if (length > expected.length || length > MAX_MATERIALIZED_CACHE_POINTS)
    return false;
  const points = new Map<number, T>();
  for (const [idx, raw] of chartCachePoints(cache)) {
    if (idx >= expected.length || idx >= MAX_MATERIALIZED_CACHE_POINTS)
      return false;
    length = Math.max(length, idx + 1);
    points.set(idx, parse(raw));
  }
  if (length !== expected.length) return false;
  const blank = parse("");
  for (let idx = 0; idx < expected.length; idx++)
    if (
      (expected[idx] ?? blank) !== (points.has(idx) ? points.get(idx) : blank)
    )
      return false;
  return true;
};
export const nativeChartNameMatches = (
  tx: XmlElement | null,
  expected: string,
): boolean => {
  const cache = tx && chartStringCache(tx);
  if (!cache) {
    const direct = tx && firstChildElement(tx, c("v"));
    return (direct ? chartCacheText(direct) : "") === expected;
  }
  if (chartCacheCount(cache) > MAX_MATERIALIZED_CACHE_POINTS) return false;
  let first = "";
  for (const [idx, raw] of chartCachePoints(cache)) {
    if (idx >= MAX_MATERIALIZED_CACHE_POINTS) return false;
    if (idx === 0) first = raw;
  }
  return first === expected;
};
export const nativeChartCalendar = (root: XmlElement): boolean | null => {
  const date = firstChildElement(root, c("date1904"));
  const raw =
    date &&
    getAttrValue(date, qname("", "val", ""))?.replace(
      /^[\t\n\r ]+|[\t\n\r ]+$/g,
      "",
    );
  // A present CT_Boolean defaults val to true. Invalid tokens do not provide
  // enough information to retain a workbook tied to an unknown calendar.
  const calendar = !date
    ? false
    : raw === undefined || raw === "1" || raw === "true"
      ? true
      : raw === "0" || raw === "false"
        ? false
        : null;
  return calendar;
};
export const preserveNativeChartData = (
  source: XmlElement,
  target: XmlElement,
  spec: ChartSpec,
): boolean => {
  const before = nativeChartSeriesHosts(source),
    after = nativeChartSeriesHosts(target);
  if (
    !before ||
    !after ||
    before.length !== spec.series.length ||
    after.length !== before.length
  )
    return false;
  const calendar = nativeChartCalendar(source);
  if (calendar === null || calendar !== (spec.date1904 ?? false)) return false;
  let foundCategories = false;
  for (const [index, { series }] of before.entries()) {
    // XY channels cannot be transplanted into the categorical writer's slots.
    if (
      ["xVal", "yVal", "bubbleSize"].some((name) =>
        firstChildElement(series, c(name)),
      )
    )
      return false;
    const model = spec.series[index]!,
      value = firstChildElement(series, c("val")),
      category = firstChildElement(series, c("cat"));
    if (
      !nativeChartNameMatches(firstChildElement(series, c("tx")), model.name) ||
      !chartCacheMatches(
        value && chartNumberCache(value),
        model.values,
        chartCacheNumber,
      ) ||
      readCacheFormat(value) !== model.numberFormat
    )
      return false;
    if (!foundCategories && category) {
      const strings = chartStringCache(category),
        numbers = chartNumberCache(category);
      if (strings || numbers) {
        foundCategories = true;
        if (
          !chartCacheMatches(
            strings ?? numbers,
            spec.categories,
            strings
              ? (raw) => raw
              : (raw) => {
                  const n = chartCacheNumber(raw);
                  return n === null ? "" : String(n);
                },
          ) ||
          (strings ? undefined : (readCacheFormat(category) ?? "General")) !==
            spec.categoryNumberFormat
        )
          return false;
      }
    }
  }
  if (
    !foundCategories &&
    (spec.categories.length > 0 || spec.categoryNumberFormat !== undefined)
  )
    return false;
  // Generated idx is the model position, independent of native idx/order and
  // of the writer's combo-group ordering. Validate every association first.
  const indices = after.map(({ series }) => {
    const idx = firstChildElement(series, c("idx"));
    return idx
      ? readChartUnsignedInt(getAttrValue(idx, qname("", "val", "")))
      : null;
  });
  if (
    new Set(indices).size !== before.length ||
    indices.some((idx) => idx === null || idx >= before.length)
  )
    return false;
  for (const [position, { series }] of after.entries()) {
    const native = before[indices[position]!]!;
    for (const name of ["tx", "cat", "val"]) {
      const old = firstChildElement(native.series, c(name)),
        generated = firstChildElement(series, c(name)),
        retained = old && withInheritedNamespaces(old, native.path);
      if (generated)
        series.children = series.children.flatMap((node) =>
          node === generated ? (retained ? [retained] : []) : [node],
        );
      else if (retained) {
        // An empty native category channel still has a meaningful reference.
        // CT_*Ser puts cat before val and tx before the formatting/data slots.
        const at =
          name === "tx"
            ? 2
            : series.children.findIndex(
                (node) =>
                  node.kind === "element" &&
                  node.name.namespaceURI === NS.chart &&
                  ["val", "extLst"].includes(node.name.localName),
              );
        series.children.splice(
          at < 0 ? series.children.length : at,
          0,
          retained,
        );
      }
    }
  }
  return true;
};
