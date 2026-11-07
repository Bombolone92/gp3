// Category text belongs to the plot groups referencing an axis, not to the
// chart-wide editable category vector. Keep this native view read-only so
// independently cached labels/formulas survive edits and package transfers.
import {
  NS,
  type XmlElement,
  allChildElements,
  firstChildElement,
  qname,
} from "../xml/index.ts";
import type { chartPlotContext } from "./axis-context.ts";
import {
  type ChartCache,
  chartCacheCount,
  chartCachePoints,
  chartCacheNumber,
  chartStringCache,
  chartNumberCache,
  checkChartCacheSize,
  readCacheFormat,
} from "./chart-cache.ts";
const c = (name: string) => qname("", name, NS.chart);
const child = (host: XmlElement, name: string) =>
  firstChildElement(host, c(name));
const extent = (cache: ChartCache | null): number => {
  let count = cache ? chartCacheCount(cache) : 0;
  if (cache)
    for (const [index] of chartCachePoints(cache))
      count = Math.max(count, index + 1);
  return count;
};

export const readCategoryAxisData = (
  context: NonNullable<ReturnType<typeof chartPlotContext>>,
  axis: XmlElement,
) => {
  if (!["catAx", "dateAx"].includes(axis.name.localName)) return undefined;
  const id = context.axes.readAxisId(child(axis, "axId"));
  if (id === null) return undefined;
  let pointCount = 0;
  let hasCategorySource = false;
  let selected: {
    cache: ChartCache;
    extent: number;
    numeric: boolean;
    format?: string;
  } | null = null;
  for (const group of context.groups) {
    if (!context.axes.groupAxisIds(group.element).includes(id)) continue;
    for (const series of allChildElements(group.element, c("ser"))) {
      const values = child(series, "val");
      pointCount = Math.max(
        pointCount,
        extent(values && chartNumberCache(values)),
      );
      const category = child(series, "cat");
      hasCategorySource ||= category !== null;
      const strings = category && chartStringCache(category);
      const cache = strings ?? (category && chartNumberCache(category));
      // An empty cache can yield to a subsequent populated series, but still
      // distinguishes an entirely empty category source from an absent one.
      if (cache && (!selected || selected.extent === 0))
        selected = {
          cache,
          extent: extent(cache),
          numeric: !strings,
          ...(!strings
            ? { format: readCacheFormat(category) ?? "General" }
            : {}),
        };
    }
  }
  const emptyDomain = pointCount === 0;
  pointCount = Math.max(1, pointCount);
  checkChartCacheSize(pointCount);
  // Value channels define the lattice. A present category cache supplies
  // blanks outside its extent; only an absent source generates index labels.
  // Read sparse records directly instead of materializing a huge label-only
  // extent that lies outside the plotted value domain.
  const labels = Array.from({ length: pointCount }, (_, i) =>
    hasCategorySource ? "" : String(i + 1),
  );
  if (selected)
    for (const [index, raw] of chartCachePoints(selected.cache)) {
      if (index >= pointCount) continue;
      const n = selected.numeric ? chartCacheNumber(raw) : null;
      labels[index] = selected.numeric ? (n === null ? "" : String(n)) : raw;
    }
  return {
    pointCount,
    emptyDomain,
    labels,
    numberFormat: selected?.format,
  };
};
