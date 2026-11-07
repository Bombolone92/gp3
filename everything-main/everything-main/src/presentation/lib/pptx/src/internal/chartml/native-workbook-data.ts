// A chart model edits represented data, not unrelated workbook objects. Keep
// native reference/cache hosts and make the smallest corresponding cell edits.
import {
  NS,
  type XmlElement,
  type XmlNode,
  elem,
  text,
  qname,
  attr,
  firstChildElement,
  allChildElements,
  getAttrValue,
  withInheritedNamespaces,
} from "../xml/index.ts";
import type { ChartSpec } from "./types.ts";
import {
  type ChartCache,
  chartCacheCount,
  chartCachePoints,
  chartCacheNumber,
  chartCacheText,
  chartStringCache,
  chartNumberCache,
  readCacheFormat,
  MAX_MATERIALIZED_CACHE_POINTS,
} from "./chart-cache.ts";
import {
  nativeChartSeriesHosts,
  nativeChartCalendar,
  chartCacheMatches,
  nativeChartNameMatches,
} from "./native-data.ts";
import {
  NativeChartWorkbook,
  type WorkbookWrite,
  UneditableWorkbookRange,
} from "./native-workbook.ts";
import {
  type WorkbookRange,
  cellName,
  rangeLength,
  rangeCell,
  workbookRange,
  resizedRange,
  quotedSheet,
  columnName,
  XLSX_MAX_COLUMNS,
  XLSX_MAX_ROWS,
} from "./workbook-reference.ts";
import { readChartUnsignedInt } from "./axis-context.ts";
const c = (n: string) => qname("c", n, NS.chart),
  a = (n: string) => qname("", n, "");
const child = (e: XmlElement | null, n: string) =>
  e && firstChildElement(e, c(n));
const rawCache = (cache: ChartCache | null): Map<number, string> =>
  new Map(cache ? chartCachePoints(cache) : []);
const extent = (cache: ChartCache | null): number => {
  let count = cache ? chartCacheCount(cache) : 0;
  if (cache)
    for (const [idx] of chartCachePoints(cache))
      count = Math.max(count, idx + 1);
  return count;
};
const leaf = (e: XmlElement, v: string) => {
  e.children = [
    text(v),
    ...e.children.filter((n) => n.kind !== "text" && n.kind !== "cdata"),
  ];
};
const set = (e: XmlElement, n: string, v: string) => {
  e.attrs = e.attrs.filter(
    (x) => x.name.namespaceURI !== "" || x.name.localName !== n,
  );
  e.attrs.push(attr(a(n), v));
};
const ref = (channel: XmlElement | null): XmlElement | null =>
  channel?.children.find(
    (n): n is XmlElement =>
      n.kind === "element" &&
      n.name.namespaceURI === NS.chart &&
      ["strRef", "numRef", "multiLvlStrRef"].includes(n.name.localName),
  ) ?? null;
interface Plan {
  readonly series: number;
  readonly name: "tx" | "cat" | "val";
  readonly target: XmlElement;
  readonly native: XmlElement | null;
  readonly replacement: XmlElement | null;
  readonly values: ReadonlyArray<string | number | null>;
  readonly format: string | undefined;
  readonly numeric: boolean;
  readonly changed: boolean;
  readonly extentChanged: boolean;
  readonly formatChanged: boolean;
  readonly before: Map<number, string>;
  readonly oldNumeric: boolean;
  readonly cache: ChartCache | null;
  readonly oldExtent: number;
  range: WorkbookRange | null;
  readonly levels: XmlElement[];
  dataRange: WorkbookRange | null;
  readonly oldRef: XmlElement | null;
  relocated: boolean;
  writes: WorkbookWrite[];
  formula: string | null;
}
const clone = (channel: XmlElement, path: XmlElement[]) =>
  withInheritedNamespaces(channel, path);
const replaceChannel = (
  target: XmlElement,
  name: Plan["name"],
  channel: XmlElement | null,
) => {
  const old = child(target, name);
  if (old) {
    target.children = target.children.flatMap((n) =>
      n === old ? (channel ? [channel] : []) : [n],
    );
    return;
  }
  if (channel) {
    const at =
      name === "tx"
        ? 2
        : target.children.findIndex(
            (n) =>
              n.kind === "element" &&
              n.name.namespaceURI === NS.chart &&
              ["val", "extLst"].includes(n.name.localName),
          );
    target.children.splice(at < 0 ? target.children.length : at, 0, channel);
  }
};
const updatePoints = (
  cache: ChartCache,
  values: ReadonlyArray<string | number | null>,
  numeric: boolean,
  keepExtent = false,
) => {
  const host = cache.points,
    existing = rawCache(cache),
    length = values.length;
  const last = new Map<number, XmlElement>();
  for (const point of allChildElements(host, c("pt"))) {
    const idx = readChartUnsignedInt(getAttrValue(point, a("idx")));
    if (idx !== null && child(point, "v")) last.set(idx, point);
  }
  if (numeric)
    host.children = host.children.filter((n) => {
      if (
        n.kind !== "element" ||
        n.name.namespaceURI !== NS.chart ||
        n.name.localName !== "pt"
      )
        return true;
      const i = readChartUnsignedInt(getAttrValue(n, a("idx")));
      return (
        i === null ||
        i >= length ||
        values[i] != null ||
        chartCacheNumber(existing.get(i) ?? "") === null
      );
    });
  if (!keepExtent) {
    host.children = host.children.filter((n) => {
      if (
        n.kind !== "element" ||
        n.name.namespaceURI !== NS.chart ||
        n.name.localName !== "pt"
      )
        return true;
      const idx = readChartUnsignedInt(getAttrValue(n, a("idx")));
      return idx === null || idx < length;
    });
    let count = child(cache.countOwner, "ptCount");
    if (!count) {
      count = elem(c("ptCount"));
      const at = cache.countOwner.children.findIndex(
        (n) =>
          n.kind === "element" &&
          n.name.namespaceURI === NS.chart &&
          ["pt", "lvl", "extLst"].includes(n.name.localName),
      );
      cache.countOwner.children.splice(
        at < 0 ? cache.countOwner.children.length : at,
        0,
        count,
      );
    }
    set(count, "val", String(length));
  }
  let insertion = host.children.findIndex(
    (n) =>
      n.kind === "element" &&
      n.name.namespaceURI === NS.chart &&
      n.name.localName === "extLst",
  );
  if (insertion < 0) insertion = host.children.length;
  for (let idx = 0; idx < length; idx++) {
    const wanted = values[idx] ?? null,
      raw = existing.get(idx) ?? "",
      prior = numeric ? chartCacheNumber(raw) : raw;
    if (prior === wanted || (numeric && wanted === null)) continue;
    const point = last.get(idx);
    if (point) {
      leaf(child(point, "v")!, wanted === null ? "" : String(wanted));
      continue;
    }
    if (wanted === null || wanted === "") continue;
    const fresh = elem(c("pt"), {
      attrs: [attr(a("idx"), String(idx))],
      children: [elem(c("v"), { children: [text(String(wanted))] })],
    });
    host.children.splice(insertion++, 0, fresh);
  }
};
const authoredChannel = (p: Plan): XmlElement => {
  const native = p.replacement;
  if (!native) return elem(c(p.name));
  if (p.name === "tx" && child(native, "v")) {
    leaf(child(native, "v")!, String(p.values[0] ?? ""));
    return native;
  }
  let reference = ref(native),
    cache = p.numeric ? chartNumberCache(native) : chartStringCache(native);
  if (
    !cache ||
    (p.levels.length === 0 && extent(cache) > MAX_MATERIALIZED_CACHE_POINTS)
  ) {
    // A complete model can repair unmaterializable cache metadata. Use a
    // fresh owned cache, retaining the reference host's other records.
    const wanted = p.numeric ? "numCache" : "strCache",
      body = elem(c(wanted));
    if (reference) {
      reference.children = reference.children.filter(
        (n) =>
          n.kind !== "element" ||
          n.name.namespaceURI !== NS.chart ||
          !["numCache", "strCache", "multiLvlStrCache"].includes(
            n.name.localName,
          ),
      );
      const at = reference.children.findIndex(
        (n) =>
          n.kind === "element" &&
          n.name.namespaceURI === NS.chart &&
          n.name.localName === "extLst",
      );
      reference.children.splice(
        at < 0 ? reference.children.length : at,
        0,
        body,
      );
      cache = { points: body, countOwner: body };
    } else {
      const literal = elem(c(p.numeric ? "numLit" : "strLit"));
      native.children = native.children.filter(
        (n) =>
          n.kind !== "element" ||
          n.name.namespaceURI !== NS.chart ||
          !["numLit", "strLit", "v"].includes(n.name.localName),
      );
      native.children.unshift(literal);
      cache = { points: literal, countOwner: literal };
    }
  }
  const stringCache = chartStringCache(native),
    numberCache = chartNumberCache(native);
  if ((p.numeric && !numberCache) || (!p.numeric && !stringCache)) {
    const old = cache!,
      body = withInheritedNamespaces(old.countOwner, [
        native,
        ...(reference ? [reference] : []),
      ]);
    body.name = c(p.numeric ? "numCache" : "strCache");
    if (reference) {
      reference.name = c(p.numeric ? "numRef" : "strRef");
      reference.children = reference.children.map((n) =>
        n === old.countOwner ? body : n,
      );
    } else {
      body.name = c(p.numeric ? "numLit" : "strLit");
      native.children = native.children.map((n) =>
        n === old.countOwner ? body : n,
      );
    }
    cache = { points: body, countOwner: body };
  }
  updatePoints(
    cache!,
    p.values,
    p.numeric,
    p.name === "tx" &&
      p.cache !== null &&
      extent(p.cache) <= MAX_MATERIALIZED_CACHE_POINTS,
  );
  if (p.levels.length && !p.numeric && p.extentChanged) {
    for (const level of allChildElements(cache!.countOwner, c("lvl")).slice(1))
      level.children = level.children.filter(
        (n) =>
          n.kind !== "element" ||
          n.name.namespaceURI !== NS.chart ||
          n.name.localName !== "pt" ||
          (readChartUnsignedInt(getAttrValue(n, a("idx"))) ?? -1) <
            p.values.length,
      );
  }
  if (p.numeric) {
    let format = child(cache!.countOwner, "formatCode");
    if (!format) {
      format = elem(c("formatCode"));
      cache!.countOwner.children.unshift(format);
    }
    leaf(format, p.format ?? "General");
  } else
    cache!.countOwner.children = cache!.countOwner.children.filter(
      (n) =>
        n.kind !== "element" ||
        n.name.namespaceURI !== NS.chart ||
        n.name.localName !== "formatCode",
    );
  if (p.formula !== null) {
    reference = ref(native);
    const f = reference && child(reference, "f");
    if (f) leaf(f, p.formula);
  }
  return native;
};
export const updateNativeChartWorkbook = (
  bytes: Uint8Array,
  source: XmlElement,
  target: XmlElement,
  spec: ChartSpec,
): Uint8Array | null => {
  const before = nativeChartSeriesHosts(source) ?? [],
    after = nativeChartSeriesHosts(target);
  if (!after) return null;
  const firstCategory =
    before
      .map((x) => child(x.series, "cat"))
      .find((x) => x && (chartStringCache(x) || chartNumberCache(x))) ?? null;
  const firstStrings = firstCategory && chartStringCache(firstCategory),
    firstNumbers = firstCategory && chartNumberCache(firstCategory),
    oldCategoryLength = extent(firstStrings ?? firstNumbers);
  const categoriesSame =
    chartCacheMatches(
      firstStrings ?? firstNumbers,
      spec.categories,
      firstStrings
        ? (raw) => raw
        : (raw) => {
            const n = chartCacheNumber(raw);
            return n === null ? "" : String(n);
          },
    ) &&
    (firstStrings
      ? undefined
      : firstNumbers
        ? (readCacheFormat(firstCategory) ?? "General")
        : undefined) === spec.categoryNumberFormat;
  const plans: Plan[] = [];
  for (const host of after) {
    const idx = child(host.series, "idx"),
      index = idx && readChartUnsignedInt(getAttrValue(idx, a("val")));
    if (index === null || index === undefined || !spec.series[index])
      return null;
    const old = before[index],
      model = spec.series[index]!;
    for (const name of ["tx", "cat", "val"] as const) {
      const native = old ? child(old.series, name) : null,
        generated = child(host.series, name);
      const oldStrings = native && chartStringCache(native),
        oldNumbers = native && chartNumberCache(native),
        cache = name === "val" ? oldNumbers : (oldStrings ?? oldNumbers);
      const oldFormat =
        name === "cat"
          ? oldStrings
            ? undefined
            : oldNumbers
              ? (readCacheFormat(native) ?? "General")
              : undefined
          : name === "val"
            ? readCacheFormat(native)
            : undefined;
      const format =
          name === "cat"
            ? spec.categoryNumberFormat
            : name === "val"
              ? model.numberFormat
              : undefined,
        numeric = name === "val" || (name === "cat" && format !== undefined);
      const same =
        name === "tx"
          ? nativeChartNameMatches(native, model.name)
          : name === "cat"
            ? categoriesSame
            : chartCacheMatches(oldNumbers, model.values, chartCacheNumber) &&
              oldFormat === model.numberFormat;
      const values: ReadonlyArray<string | number | null> =
        name === "tx"
          ? [model.name]
          : name === "cat"
            ? spec.categories.map((v) =>
                numeric ? (v.trim() === "" ? null : Number(v)) : v,
              )
            : model.values;
      const changed =
        !same ||
        (name === "val" && oldCategoryLength !== spec.categories.length);
      const reference = ref(native),
        f = reference && child(reference, "f"),
        range = f && workbookRange(chartCacheText(f));
      const replacement =
        // Absence is meaningful too: an unchanged missing category channel
        // must not acquire the writer's chart-wide fallback on a value edit.
        old && !changed && !native
          ? null
          : native && old
            ? clone(native, old.path)
            : generated
              ? clone(generated, [target, host.series])
              : null;
      plans.push({
        series: index,
        name,
        target: host.series,
        native,
        replacement,
        values,
        format,
        numeric,
        changed,
        extentChanged: !cache || extent(cache) !== values.length,
        formatChanged: oldFormat !== format,
        before: rawCache(cache),
        oldNumeric:
          name === "val" || (name === "cat" && !oldStrings && !!oldNumbers),
        cache,
        oldExtent: extent(cache),
        range: range ?? null,
        dataRange: range ?? null,
        levels:
          reference?.name.localName === "multiLvlStrRef" && cache
            ? allChildElements(cache.countOwner, c("lvl"))
            : [],
        oldRef: reference,
        relocated: false,
        writes: [],
        formula: f ? chartCacheText(f) : null,
      });
    }
  }
  // A numeric category vector has no OOXML slot for parent string levels.
  // Refuse that incompatible representation rather than silently flattening it.
  if (plans.some((p) => p.levels.length && p.numeric))
    throw new TypeError(
      "Numeric category formats cannot represent multilevel string categories",
    );
  let book: NativeChartWorkbook;
  try {
    book = new NativeChartWorkbook(bytes);
  } catch {
    return null;
  }
  for (const p of plans) {
    if (!p.range && p.formula) p.range = book.sourceRange(p.formula);
    p.dataRange = p.range;
    if (p.levels.length && p.range) {
      const r = p.range,
        vertical =
          r.end.row - r.start.row + 1 === p.oldExtent &&
          r.end.col - r.start.col + 1 === p.levels.length,
        horizontal =
          r.end.col - r.start.col + 1 === p.oldExtent &&
          r.end.row - r.start.row + 1 === p.levels.length;
      // Only write a hierarchy's innermost source vector when its orientation
      // is unambiguous. Its other levels and rectangular reference stay native.
      p.dataRange =
        vertical !== horizontal
          ? {
              ...r,
              start: vertical
                ? { row: r.start.row, col: r.end.col }
                : { row: r.end.row, col: r.start.col },
              end: r.end,
            }
          : null;
    }
  }
  const resize: Array<{ before: WorkbookRange; after: WorkbookRange }> = [];
  for (const plan of plans) {
    if (!plan.changed) {
      if (plan.range) resize.push({ before: plan.range, after: plan.range });
      continue;
    }
    if (plan.values.length === 0) {
      // Excel has no zero-cell range. Retain an empty literal channel without
      // erasing workbook cells that may also back other workbook objects.
      const literal = elem(c(plan.numeric ? "numLit" : "strLit"));
      if (plan.replacement) {
        plan.replacement.children = plan.replacement.children.filter(
          (n) =>
            n.kind !== "element" ||
            n.name.namespaceURI !== NS.chart ||
            ![
              "numRef",
              "strRef",
              "multiLvlStrRef",
              "numLit",
              "strLit",
            ].includes(n.name.localName),
        );
        plan.replacement.children.unshift(literal);
      }
      plan.formula = null;
      continue;
    }
    if (!plan.oldRef && plan.native) continue; // Native literal data has no cell edit.
    if (
      !plan.range ||
      !plan.dataRange ||
      rangeLength(plan.dataRange) === null ||
      (plan.levels.length > 0 && (plan.extentChanged || plan.numeric))
    ) {
      plan.relocated = true;
      continue;
    }
    const formula = plan.extentChanged
      ? resizedRange(plan.range, plan.values.length)
      : plan.formula;
    if (!formula) {
      plan.relocated = true;
      continue;
    }
    plan.formula = formula;
    const afterRange = plan.extentChanged
      ? workbookRange(formula)!
      : plan.dataRange;
    try {
      const prototype =
        book.cell(plan.dataRange.sheet, plan.dataRange.start) ?? undefined;
      for (let i = 0; i < plan.values.length; i++) {
        const old = plan.oldNumeric
            ? chartCacheNumber(plan.before.get(i) ?? "")
            : (plan.before.get(i) ?? ""),
          v = plan.values[i] ?? null,
          changed = old !== v || i >= plan.oldExtent;
        if (!changed && !plan.formatChanged) continue;
        const address = rangeCell(afterRange, i),
          write: WorkbookWrite = {
            sheet: plan.range.sheet,
            address,
            ...(changed ? { value: v } : {}),
            ...(plan.formatChanged
              ? { numberFormat: plan.format ?? "General" }
              : {}),
            ...(prototype ? { prototype } : {}),
          };
        // Expanding a range must not overwrite unrelated existing content.
        const existing = book.cell(write.sheet, address);
        if (
          i >= (rangeLength(plan.dataRange) ?? 0) &&
          existing &&
          existing.children.some(
            (n) =>
              n.kind === "element" &&
              ["v", "is", "f"].includes(n.name.localName),
          )
        ) {
          plan.relocated = true;
          break;
        }
        if (!book.canWrite(write)) {
          plan.relocated = true;
          break;
        }
        plan.writes.push(write);
      }
      if (!plan.relocated)
        resize.push({ before: plan.range, after: afterRange });
    } catch (error) {
      if (error instanceof UneditableWorkbookRange) {
        plan.relocated = true;
      } else return null;
    }
  }
  // Protect other channels sharing the same source cells. A model can edit
  // one series independently even when native series originally aliased data.
  const coordinate = (p: Plan, w: WorkbookWrite): number | null => {
    const full = p.range;
    if (
      full &&
      p.levels.length &&
      full.sheet.toLowerCase() === w.sheet.toLowerCase() &&
      w.address.row >= full.start.row &&
      w.address.row <= full.end.row &&
      w.address.col >= full.start.col &&
      w.address.col <= full.end.col &&
      (!p.dataRange ||
        (p.dataRange.start.row === p.dataRange.end.row
          ? w.address.row !== p.dataRange.start.row
          : w.address.col !== p.dataRange.start.col))
    )
      return -1;
    const r = p.dataRange;
    if (
      !r ||
      r.sheet.toLowerCase() !== w.sheet.toLowerCase() ||
      rangeLength(r) === null
    )
      return null;
    if (
      r.start.col === r.end.col &&
      w.address.col === r.start.col &&
      w.address.row >= r.start.row &&
      w.address.row <= r.end.row
    )
      return w.address.row - r.start.row;
    if (
      r.start.row === r.end.row &&
      w.address.row === r.start.row &&
      w.address.col >= r.start.col &&
      w.address.col <= r.end.col
    )
      return w.address.col - r.start.col;
    return null;
  };
  for (const p of plans.filter((p) => p.changed && !p.relocated))
    for (const write of p.writes)
      for (const other of plans) {
        if (other === p || other.relocated) continue;
        const i = coordinate(other, write);
        if (i === null) continue;
        if (i < 0) {
          p.relocated = true;
          continue;
        }
        const expected = other.changed
          ? (other.values[i] ?? null)
          : other.oldNumeric
            ? chartCacheNumber(other.before.get(i) ?? "")
            : (other.before.get(i) ?? "");
        const expectedFormat =
          other.name === "tx" ? undefined : (other.format ?? "General");
        if (
          (write.value !== undefined && write.value !== expected) ||
          (write.numberFormat !== undefined &&
            write.numberFormat !== expectedFormat)
        ) {
          p.relocated = true;
          if (other.changed) other.relocated = true;
        }
      }
  try {
    let wrote = false;
    for (const p of plans)
      if (p.changed && !p.relocated)
        for (const write of p.writes) {
          book.write(write);
          wrote = true;
        }
    const safeRanges = resize.filter(
      (r) => !plans.some((p) => p.relocated && p.range === r.before),
    );
    book.extendTables(safeRanges);
    let sheet: string | null = null,
      col = 0;
    const seriesColumns = new Map<number, { sheet: string; col: number }>();
    for (const p of plans.filter((p) => p.changed && p.relocated)) {
      if (p.values.length >= XLSX_MAX_ROWS)
        throw new RangeError("chart data exceeds Excel's worksheet row limit");
      if (p.levels.length && !p.numeric) {
        if (p.levels.length > XLSX_MAX_COLUMNS)
          throw new RangeError(
            "chart hierarchy exceeds Excel's worksheet column limit",
          );
        if (!sheet || col + p.levels.length > XLSX_MAX_COLUMNS) {
          sheet = book.newSheet();
          col = 0;
        }
        const firstCol = col;
        col += p.levels.length;
        p.formula = `${quotedSheet(sheet)}!$${columnName(firstCol)}$2:$${columnName(col - 1)}$${p.values.length + 1}`;
        for (let level = 0; level < p.levels.length; level++) {
          const cached = rawCache({
            points: p.levels[level]!,
            countOwner: p.cache!.countOwner,
          });
          let label = "";
          for (let i = 0; i < p.values.length; i++) {
            if (cached.has(i)) label = cached.get(i)!;
            book.write({
              sheet,
              address: { row: i + 1, col: col - level - 1 },
              value:
                level === 0
                  ? (p.values[i] ?? "")
                  : i < p.oldExtent
                    ? label
                    : "",
            });
          }
        }
        wrote = true;
        continue;
      }
      let allocated =
        p.name === "cat" ? undefined : seriesColumns.get(p.series);
      if (!allocated) {
        if (!sheet || col >= XLSX_MAX_COLUMNS) {
          sheet = book.newSheet();
          col = 0;
        }
        allocated = { sheet, col: col++ };
        if (p.name !== "cat") seriesColumns.set(p.series, allocated);
      }
      const start = p.name === "tx" ? 0 : 1,
        name = columnName(allocated.col),
        prefix = `${quotedSheet(allocated.sheet)}!$${name}$`;
      p.formula =
        p.values.length === 1
          ? prefix + (start + 1)
          : `${prefix}${start + 1}:$${name}$${start + p.values.length}`;
      let prototype: XmlElement | undefined;
      try {
        if (p.range)
          prototype = book.cell(p.range.sheet, p.range.start) ?? undefined;
      } catch {}
      if (p.name === "val")
        book.write({
          sheet: allocated.sheet,
          address: { row: 0, col: allocated.col },
          value: spec.series[p.series]!.name,
        });
      for (let i = 0; i < p.values.length; i++)
        book.write({
          sheet: allocated.sheet,
          address: { row: start + i, col: allocated.col },
          value: p.values[i] ?? null,
          ...(prototype ? { prototype } : {}),
          ...(p.numeric && (!p.native || p.formatChanged)
            ? { numberFormat: p.format ?? "General" }
            : {}),
        });
      wrote = true;
    }
    if (nativeChartCalendar(source) !== (spec.date1904 ?? false))
      book.setCalendar(spec.date1904 ?? false);
    if (wrote) book.recalculate();
    const output = book.save();
    // Prepare every channel before mutating the caller's generated document.
    const channels = plans.map((p) =>
      p.changed ? authoredChannel(p) : p.replacement,
    );
    plans.forEach((p, i) => replaceChannel(p.target, p.name, channels[i]!));
    return output;
  } catch (error) {
    if (error instanceof RangeError) throw error;
    return null;
  }
};
