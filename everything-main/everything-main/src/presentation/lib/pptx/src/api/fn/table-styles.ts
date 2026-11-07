// Effective DrawingML table formatting. Reading a style never changes the file.
import { readGradientTile } from "./shape-gradient-read.ts";
import type {
  GradientFillOptions,
  TextFormat,
} from "../../internal/drawingml/index.ts";
import { partName, resolveTarget } from "../../internal/opc/index.ts";
import type { OpcPackage, Part } from "../../internal/parts/index.ts";
import { readOnlyPartRoot } from "../../internal/parts/read-only-xml.ts";
import { REL_TYPES } from "../../internal/presentationml/index.ts";
import {
  NS,
  type XmlElement,
  attr,
  elem,
  firstChildElement,
  getAttrValue,
  parseXml,
  qname,
  withInheritedNamespaces,
} from "../../internal/xml/index.ts";
import {
  CELL_COL,
  CELL_ELEMENT,
  CELL_ROW,
  INTERNAL_PACKAGE,
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SLIDE_PART_NAME,
  type PresentationData,
  type SlideShapeData,
  type TableCellData,
} from "../_internal-symbols.ts";
import { getEffectiveColorMap } from "./color-map.ts";
import {
  parseRPrLikeElement,
  resolveDrawingColor,
  resolveDrawingOpacity,
  resolveSchemeToken,
} from "./shape-color.ts";
import { getSlideMasterPartName } from "./shape-read-base.ts";
import { readParagraphElements } from "./shape-runs.ts";
import {
  ALIGN_TOKEN_MAP,
  parsePPrLikeElement,
  type ParagraphProperties,
} from "./shape-paragraph.ts";
import { themeForShape } from "./shape-theme.ts";
import { builtInTableStyle, emptyTableStyle } from "./table-style-defaults.ts";
import {
  getTableDimensions,
  getTableCellSpan,
  getTableStyleFlags,
  type TableCellBorder,
  type TableCellBorders,
  type TableCellParagraph,
} from "./tables.ts";

const child = (
  el: XmlElement | null | undefined,
  local: string,
): XmlElement | null =>
  el ? firstChildElement(el, qname("a", local, NS.dml)) : null;
const value = (
  el: XmlElement | null | undefined,
  local: string,
): string | null => (el ? getAttrValue(el, qname("", local, "")) : null);
const children = (el: XmlElement | null | undefined): XmlElement[] =>
  el?.children.filter(
    (c): c is XmlElement =>
      c.kind === "element" && c.name.namespaceURI === NS.dml,
  ) ?? [];
const COLOR_NAMES = new Set([
  "srgbClr",
  "scrgbClr",
  "hslClr",
  "sysClr",
  "schemeClr",
  "prstClr",
]);
const firstColor = (el: XmlElement | null): XmlElement | null =>
  children(el).find((c) => COLOR_NAMES.has(c.name.localName)) ?? null;
const FILL_NAMES = new Set([
  "noFill",
  "solidFill",
  "gradFill",
  "pattFill",
  "blipFill",
  "grpFill",
]);
const firstFill = (el: XmlElement | null): XmlElement | null =>
  children(el).find((c) => FILL_NAMES.has(c.name.localName)) ?? null;
const readCache = new WeakMap<
  Part,
  { data: Uint8Array; root: XmlElement; styles: Map<string, XmlElement> }
>();
const readPart = (part: Part) => {
  const previous = readCache.get(part);
  if (previous?.data === part.data) return previous;
  const root = parseXml(new TextDecoder().decode(part.data)).root;
  const styles = new Map<string, XmlElement>();
  for (const el of children(root)) {
    const id = value(el, "styleId");
    if (el.name.localName === "tblStyle" && id)
      styles.set(id.toUpperCase(), withInheritedNamespaces(el, [root]));
  }
  const result = { data: part.data, root, styles };
  readCache.set(part, result);
  return result;
};

const tableProperties = (table: SlideShapeData): XmlElement | null =>
  child(
    child(child(child(table[SHAPE_ELEMENT], "graphic"), "graphicData"), "tbl"),
    "tblPr",
  );

/** @internal Resolve inline or referenced styles through OPC relationships. */
export const tableStyleDefinition = (
  pkg: OpcPackage,
  properties: XmlElement | null,
): XmlElement => {
  const inline = child(properties, "tableStyle");
  if (inline) return inline;
  const idNode = child(properties, "tableStyleId");
  const id = idNode?.children
    .map((c) => (c.kind === "text" || c.kind === "cdata" ? c.data : ""))
    .join("")
    .trim()
    .toUpperCase();
  // tblStyleLst@def selects the style for newly inserted tables. It does
  // not style existing tables that omit both tableStyle and tableStyleId.
  if (!id) return emptyTableStyle;
  const presName = partName("/ppt/presentation.xml");
  const rel = pkg
    .getRels(presName)
    ?.items.find(
      (r) => r.type === REL_TYPES.tableStyles && r.targetMode !== "External",
    );
  const part = rel ? pkg.getPart(resolveTarget(presName, rel.target)) : null;
  const parsed = part ? readPart(part) : null;
  return parsed?.styles.get(id) ?? builtInTableStyle(id) ?? emptyTableStyle;
};

export type TableResolvedFill =
  | { readonly kind: "none" }
  | { readonly kind: "solid"; readonly color: string; readonly opacity: number }
  | {
      readonly kind: "gradient";
      readonly stops: ReadonlyArray<{
        offset: number;
        color: string;
        opacity: number;
      }>;
      readonly angleDeg: number;
      readonly scaled?: boolean;
      readonly tileRect?: NonNullable<GradientFillOptions["tileRect"]>;
      readonly path?: "circle" | "rect" | "shape";
      readonly focus?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      };
    }
  | {
      readonly kind: "pattern";
      readonly preset: string;
      readonly foreground: string;
      readonly background: string;
      /** Exact DrawingML alpha; the legacy CSS colors retain their 8-bit alpha. */
      readonly foregroundOpacity?: number;
      readonly backgroundOpacity?: number;
    };

export interface TableResolvedBorder extends TableCellBorder {
  readonly opacity?: number;
  /** Cascade priority used to choose one stroke for a shared cell boundary. */
  readonly priority: number;
}
export interface TableResolvedCellStyle {
  readonly fill: TableResolvedFill | null;
  readonly textFormat: Readonly<TextFormat>;
  readonly borders: Readonly<
    Partial<Record<keyof TableCellBorders, TableResolvedBorder>>
  >;
}
export interface TableStyleResolver {
  readonly background: TableResolvedFill | null;
  cell(cell: TableCellData): TableResolvedCellStyle;
  paragraphs(
    cell: TableCellData,
    defaults: Readonly<TextFormat>,
  ): ReadonlyArray<TableCellParagraph>;
}

const PART_ORDER = [
  "wholeTbl",
  "band1H",
  "band2H",
  "band1V",
  "band2V",
  "lastCol",
  "firstCol",
  "lastRow",
  "seCell",
  "swCell",
  "firstRow",
  "neCell",
  "nwCell",
] as const;
type PartKey = (typeof PART_ORDER)[number];
type BorderKey =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "insideH"
  | "insideV"
  | "tl2br"
  | "tr2bl";
type PartStyle = {
  fill: TableResolvedFill | null;
  text: TextFormat;
  borders: Partial<Record<BorderKey, Omit<TableResolvedBorder, "priority">>>;
};

const resolverCache = new WeakMap<
  XmlElement,
  {
    pkg: OpcPackage;
    slideData: Uint8Array | undefined;
    definition: XmlElement;
    themeData: Uint8Array | undefined;
    masterData: Uint8Array | undefined;
    colorMap: string;
    resolver: TableStyleResolver;
  }
>();

/**
 * Resolve table formatting once per table/render. The returned view is
 * a snapshot; obtain a new view after editing the table, its theme, or styles.
 * Known built-in styles work without an embedded definition. Unknown style
 * IDs apply no style, while retaining direct cell and paragraph formatting.
 */
export const getTableStyleResolver = (
  pres: PresentationData,
  table: SlideShapeData,
  colorMap?: Readonly<Record<string, string>> | null,
): TableStyleResolver => {
  const pkg = pres[INTERNAL_PACKAGE];
  const definition = tableStyleDefinition(pkg, tableProperties(table));
  const clrMap = colorMap ?? getEffectiveColorMap(table[SHAPE_SLIDE]);
  const themeView = themeForShape(table);
  const tableElement = table[SHAPE_ELEMENT];
  const masterName = getSlideMasterPartName(table[SHAPE_SLIDE]);
  const masterPart = masterName ? pkg.getPart(partName(masterName)) : null;
  const slideData = pkg.getPart(table[SHAPE_SLIDE][SLIDE_PART_NAME])?.data;
  const mapKey = Object.keys(clrMap ?? {})
    .sort()
    .map((key) => `${key}:${clrMap?.[key]}`)
    .join(";");
  const cached = resolverCache.get(tableElement);
  // Public setters replace part bytes. Relationships and color maps are
  // re-read above, so rebinding a style or changing a master also invalidates
  // the view. XML nodes and cells are never rewritten by this read cache.
  if (
    cached?.pkg === pkg &&
    cached.slideData === slideData &&
    cached.definition === definition &&
    cached.themeData === themeView?.data &&
    cached.masterData === masterPart?.data &&
    cached.colorMap === mapKey
  )
    return cached.resolver;
  const theme = themeView?.theme ?? null;
  const fonts = themeView?.fonts ?? null;
  const themeElements = child(themeView?.root, "themeElements");
  const matrix = child(themeElements, "fmtScheme");
  const masterStyles = masterPart
    ? firstChildElement(
        readOnlyPartRoot(masterPart),
        qname("p", "txStyles", NS.pml),
      )
    : null;
  const otherStyle = masterStyles
    ? firstChildElement(masterStyles, qname("p", "otherStyle", NS.pml))
    : null;
  const defaultColor = resolveSchemeToken("tx1", theme, clrMap) ?? "#000000";

  const color = (
    el: XmlElement | null,
    placeholder: XmlElement | null = null,
  ): { color: string; opacity: number } | null => {
    if (!el) return null;
    let concrete = el;
    if (
      el.name.localName === "schemeClr" &&
      value(el, "val") === "phClr" &&
      placeholder
    ) {
      const base = color(placeholder);
      if (!base) return null;
      concrete = elem(qname("a", "srgbClr", NS.dml), {
        attrs: [attr(qname("", "val", ""), base.color.slice(1))],
        children: [
          elem(qname("a", "alpha", NS.dml), {
            attrs: [
              attr(
                qname("", "val", ""),
                String(Math.round(base.opacity * 100000)),
              ),
            ],
          }),
          ...el.children,
        ],
      });
    }
    const hex = resolveDrawingColor(concrete, theme, clrMap);
    return hex
      ? { color: hex, opacity: resolveDrawingOpacity(concrete) }
      : null;
  };
  const pct = (raw: string | null, fallback = 0): number => {
    if (raw === null) return fallback;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n)
      ? n / (raw.endsWith("%") ? 100 : 100000)
      : fallback;
  };
  const fill = (
    el: XmlElement | null,
    placeholder: XmlElement | null = null,
  ): TableResolvedFill | null => {
    if (!el) return null;
    switch (el.name.localName) {
      case "noFill":
        return { kind: "none" };
      case "solidFill": {
        const c = color(firstColor(el), placeholder);
        return c ? { kind: "solid", ...c } : null;
      }
      case "gradFill": {
        const stops = children(child(el, "gsLst")).flatMap((stop) => {
          const c = color(firstColor(stop), placeholder);
          return c
            ? [
                {
                  offset: Math.max(0, Math.min(1, pct(value(stop, "pos")))),
                  ...c,
                },
              ]
            : [];
        });
        if (!stops.length) return null;
        const angle = Number(value(child(el, "lin"), "ang") ?? 0) / 60000;
        const pathEl = child(el, "path"),
          path = value(pathEl, "path"),
          rect = child(pathEl, "fillToRect");
        return {
          kind: "gradient",
          ...readGradientTile(el),
          stops,
          angleDeg: Number.isFinite(angle) ? angle : 0,
          ...(["1", "true"].includes(value(child(el, "lin"), "scaled") ?? "")
            ? { scaled: true }
            : {}),
          ...(path === "circle" || path === "rect" || path === "shape"
            ? { path }
            : {}),
          ...(rect
            ? {
                focus: {
                  left: pct(value(rect, "l")),
                  top: pct(value(rect, "t")),
                  right: pct(value(rect, "r")),
                  bottom: pct(value(rect, "b")),
                },
              }
            : {}),
        };
      }
      case "pattFill": {
        const fg = color(firstColor(child(el, "fgClr")), placeholder),
          bg = color(firstColor(child(el, "bgClr")), placeholder);
        const css = (
          c: { color: string; opacity: number } | null,
          fallback: string,
        ): string =>
          c
            ? c.opacity === 1
              ? c.color
              : `${c.color}${Math.round(c.opacity * 255)
                  .toString(16)
                  .padStart(2, "0")}`
            : fallback;
        return {
          kind: "pattern",
          preset: value(el, "prst") ?? "pct5",
          foreground: css(fg, "#000000"),
          background: css(bg, "#FFFFFF"),
          ...(fg && fg.opacity !== 1 ? { foregroundOpacity: fg.opacity } : {}),
          ...(bg && bg.opacity !== 1 ? { backgroundOpacity: bg.opacity } : {}),
        };
      }
      default:
        return null;
    }
  };
  const themedFill = (parent: XmlElement | null): TableResolvedFill | null => {
    const own = child(parent, "fill");
    if (own) return fill(firstFill(own));
    const ref = child(parent, "fillRef");
    if (!ref) return null;
    const index = Number(value(ref, "idx"));
    if (index === 0 || index === 1000) return { kind: "none" };
    const list = child(
      matrix,
      index > 1000 ? "bgFillStyleLst" : "fillStyleLst",
    );
    const selected = children(list)[index > 1000 ? index - 1001 : index - 1];
    return fill(selected ?? null, firstColor(ref));
  };
  const border = (
    ln: XmlElement | null,
    placeholder: XmlElement | null = null,
  ): Omit<TableResolvedBorder, "priority"> | null => {
    if (!ln) return null;
    const raw = value(ln, "w"),
      n = raw === null ? null : Number(raw);
    // A present line is a complete border definition, not a partial override
    // of the lower-priority style. It uses no paint when its fill is
    // omitted, and 0.75pt when the line's width is omitted.
    const noFill = firstFill(ln) === null || child(ln, "noFill") !== null;
    const c = noFill
      ? null
      : color(firstColor(child(ln, "solidFill")), placeholder);
    return {
      color: c?.color ?? null,
      widthEmu: n !== null && Number.isFinite(n) ? Math.max(0, n) : 9525,
      dash: value(child(ln, "prstDash"), "val"),
      ...(noFill ? { noFill: true } : {}),
      ...(c ? { opacity: c.opacity } : {}),
    };
  };
  const part = (el: XmlElement): PartStyle => {
    const tc = child(el, "tcStyle"),
      tx = child(el, "tcTxStyle"),
      text: TextFormat = {};
    for (const [xml, key] of [
      ["b", "bold"],
      ["i", "italic"],
    ] as const) {
      const v = value(tx, xml);
      if (v === "on" || v === "off") text[key] = v === "on";
    }
    const ref = child(tx, "fontRef"),
      font = child(tx, "font"),
      family = value(ref, "idx");
    const latin =
      value(child(font, "latin"), "typeface") ??
      (family === "major"
        ? fonts?.majorLatin
        : family === "minor"
          ? fonts?.minorLatin
          : null);
    const east =
      value(child(font, "ea"), "typeface") ??
      (family === "major"
        ? fonts?.majorEastAsian
        : family === "minor"
          ? fonts?.minorEastAsian
          : null);
    if (latin) text.font = latin;
    if (east) text.fontEastAsian = east;
    const c = color(firstColor(tx) ?? firstColor(ref));
    if (c) {
      text.color = c.color;
      text.colorOpacity = c.opacity;
    }
    const borders: PartStyle["borders"] = {};
    for (const side of children(child(tc, "tcBdr"))) {
      const key = side.name.localName;
      if (
        ![
          "left",
          "right",
          "top",
          "bottom",
          "insideH",
          "insideV",
          "tl2br",
          "tr2bl",
        ].includes(key)
      )
        continue;
      const ref = child(side, "lnRef");
      const index = Number(value(ref, "idx"));
      const ln =
        child(side, "ln") ??
        (ref
          ? (children(child(matrix, "lnStyleLst"))[index - 1] ?? null)
          : null);
      const line =
        ref && index === 0
          ? { color: null, widthEmu: null, dash: null, noFill: true }
          : border(ln, firstColor(ref));
      if (line) borders[key as BorderKey] = line;
    }
    return { fill: themedFill(tc), text, borders };
  };
  const parts = new Map<PartKey, PartStyle>();
  for (const key of PART_ORDER) {
    const el = child(definition, key);
    if (el) parts.set(key, part(el));
  }
  const flags = getTableStyleFlags(table),
    dims = getTableDimensions(table);
  const cellCache = new WeakMap<XmlElement, TableResolvedCellStyle>();
  const resolved = (cell: TableCellData): TableResolvedCellStyle => {
    const previous = cellCache.get(cell[CELL_ELEMENT]);
    if (previous) return previous;
    const r = cell[CELL_ROW],
      c = cell[CELL_COL],
      span = getTableCellSpan(cell);
    const er = Math.min(dims.rows, r + span.rowSpan),
      ec = Math.min(dims.cols, c + span.gridSpan);
    const firstRow = flags.firstRow && r === 0,
      lastRow = flags.lastRow && er === dims.rows;
    const firstCol = flags.firstCol && c === 0,
      lastCol = flags.lastCol && ec === dims.cols;
    const rowBand = r - (flags.firstRow ? 1 : 0),
      colBand = c - (flags.firstCol ? 1 : 0);
    const enabled: Record<PartKey, boolean> = {
      wholeTbl: true,
      band1H: flags.bandRow && rowBand >= 0 && rowBand % 2 === 0 && !lastRow,
      band2H: flags.bandRow && rowBand >= 0 && rowBand % 2 === 1 && !lastRow,
      band1V: flags.bandCol && colBand >= 0 && colBand % 2 === 0 && !lastCol,
      band2V: flags.bandCol && colBand >= 0 && colBand % 2 === 1 && !lastCol,
      lastCol,
      firstCol,
      lastRow,
      seCell: lastRow && lastCol,
      swCell: lastRow && firstCol,
      firstRow,
      neCell: firstRow && lastCol,
      nwCell: firstRow && firstCol,
    };
    let fillValue: TableResolvedFill | null = null;
    const textFormat: TextFormat = {},
      borders: Partial<Record<keyof TableCellBorders, TableResolvedBorder>> =
        {};
    const merge = (
      side: keyof TableCellBorders,
      line: Omit<TableResolvedBorder, "priority"> | null | undefined,
      priority: number,
    ): void => {
      if (!line) return;
      borders[side] = {
        ...line,
        priority,
      };
    };
    for (const [priority, key] of PART_ORDER.entries()) {
      if (!enabled[key]) continue;
      const p = parts.get(key);
      if (!p) continue;
      if (p.fill) fillValue = p.fill;
      Object.assign(textFormat, p.text);
      const rowPart = key.endsWith("H") || key.endsWith("Row"),
        colPart = key.endsWith("V") || key.endsWith("Col"),
        corner = key.endsWith("Cell");
      const r0 = rowPart || corner ? r : 0,
        r1 = rowPart || corner ? er : dims.rows,
        c0 = colPart || corner ? c : 0,
        c1 = colPart || corner ? ec : dims.cols;
      merge("left", p.borders[c === c0 ? "left" : "insideV"], priority);
      merge("right", p.borders[ec === c1 ? "right" : "insideV"], priority);
      merge("top", p.borders[r === r0 ? "top" : "insideH"], priority);
      merge("bottom", p.borders[er === r1 ? "bottom" : "insideH"], priority);
      merge("tlToBr", p.borders.tl2br, priority);
      merge("blToTr", p.borders.tr2bl, priority);
    }
    const tcPr = child(cell[CELL_ELEMENT], "tcPr"),
      ownFill = fill(firstFill(tcPr));
    if (ownFill) fillValue = ownFill;
    for (const [side, local] of [
      ["left", "lnL"],
      ["right", "lnR"],
      ["top", "lnT"],
      ["bottom", "lnB"],
      ["tlToBr", "lnTlToBr"],
      ["blToTr", "lnBlToTr"],
    ] as const) {
      // Shared interior edges use right/bottom direct formatting.
      if ((side === "left" && c > 0) || (side === "top" && r > 0)) continue;
      merge(side, border(child(tcPr, local)), 100);
    }
    // With no line definition at any level, a 1pt black grid
    // applies, independently of theme lines or tblStyleLst@def. Diagonals have
    // no implicit stroke. Explicit empty/noFill lines replace this default.
    for (const side of ["left", "right", "top", "bottom"] as const)
      borders[side] ??= {
        color: "#000000",
        widthEmu: 12700,
        dash: null,
        priority: -1,
      };
    const result = { fill: fillValue, textFormat, borders };
    cellCache.set(cell[CELL_ELEMENT], result);
    return result;
  };
  const levelDefaults = new Map<
    number,
    {
      format: TextFormat;
      properties: Partial<ParagraphProperties>;
      alignment: string | null;
      authoredSize: number | undefined;
    }
  >();
  const inheritedLevel = (level: number) => {
    const cached = levelDefaults.get(level);
    if (cached) return cached;
    const masterPr = child(otherStyle, `lvl${level + 1}pPr`),
      masterRPr = child(masterPr, "defRPr");
    // Native table paragraphs inherit otherStyle at their own outline
    // level, not bodyStyle or presentation/defaultTextStyle. Table
    // font/color defaults then select the minor theme font and tx1.
    // defPPr in either list style does not supply table defaults.
    const masterFormat = masterRPr
      ? parseRPrLikeElement(masterRPr, { theme, clrMap })
      : {};
    const format: TextFormat = {
      size: 18,
      ...masterFormat,
    };
    delete format.font;
    delete format.fontEastAsian;
    format.color = defaultColor;
    format.colorOpacity = 1;
    if (fonts?.minorLatin) format.font = fonts.minorLatin;
    if (fonts?.minorEastAsian) format.fontEastAsian = fonts.minorEastAsian;
    const result = {
      format,
      properties: {
        // An unstyled table outline advances half an inch per
        // level. An authored master/local paragraph margin replaces it.
        marL: level * 457200,
        ...(masterPr ? parsePPrLikeElement(masterPr) : {}),
      },
      alignment: value(masterPr, "algn"),
      authoredSize: masterFormat.size,
    };
    levelDefaults.set(level, result);
    return result;
  };
  const paragraphCache = new WeakMap<
    XmlElement,
    {
      defaults: Readonly<TextFormat>;
      paragraphs: ReadonlyArray<TableCellParagraph>;
    }
  >();
  const resolver: TableStyleResolver = {
    background:
      fill(firstFill(tableProperties(table))) ??
      themedFill(child(definition, "tblBg")),
    cell: resolved,
    paragraphs(cell, defaults) {
      const previous = paragraphCache.get(cell[CELL_ELEMENT]);
      if (previous?.defaults === defaults) return previous.paragraphs;
      const body = child(cell[CELL_ELEMENT], "txBody"),
        list = child(body, "lstStyle");
      const paragraphs = children(body)
        .filter((p) => p.name.localName === "p")
        .map((p) => {
          const pPr = child(p, "pPr"),
            level = Math.max(
              0,
              Math.min(8, Number(value(pPr, "lvl") ?? 0) || 0),
            );
          const levelPr = child(list, `lvl${level + 1}pPr`),
            inherited = inheritedLevel(level);
          const format: TextFormat = {
            ...inherited.format,
            ...defaults,
          };
          let authoredSize = defaults.size ?? inherited.authoredSize;
          const properties: Partial<ParagraphProperties> = {
            ...inherited.properties,
          };
          for (const props of [levelPr, pPr]) {
            if (props) {
              const layer = parsePPrLikeElement(props);
              // Each spacing side is one unit choice. A point override must
              // also discard an outer percentage before this last-wins merge.
              if (layer.spcBefPts !== undefined) delete properties.spcBefPct;
              if (layer.spcAftPts !== undefined) delete properties.spcAftPct;
              Object.assign(properties, layer);
            }
            const rPr = child(props, "defRPr");
            if (rPr) {
              const local = parseRPrLikeElement(rPr, { theme, clrMap });
              Object.assign(format, local);
              authoredSize = local.size ?? authoredSize;
            }
          }
          let lastFormat = format,
            lastSize = authoredSize;
          const elements = readParagraphElements(p, (rPr) => {
            const direct = rPr
              ? parseRPrLikeElement(rPr, { theme, clrMap })
              : {};
            lastSize = direct.size ?? authoredSize;
            return (lastFormat = { ...format, ...direct });
          });
          const end = child(p, "endParaRPr");
          const endProperties = end
            ? parseRPrLikeElement(end, { theme, clrMap })
            : {};
          const defaultFormat = { ...format, ...endProperties };
          const alignment =
            value(pPr, "algn") ?? value(levelPr, "algn") ?? inherited.alignment;
          return {
            align: alignment ? (ALIGN_TOKEN_MAP[alignment] ?? null) : null,
            properties,
            defaultFormat,
            emptyLineFormat: { ...lastFormat, ...endProperties },
            // The table paragraph-end character has no advance or
            // glyph. Its font contributes to the final line's metrics. Its
            // size falls back to endParaRPr only when the final inline item
            // has no size through the run/paragraph/list/master cascade.
            ...(end
              ? {
                  endMarkerFormat: {
                    ...lastFormat,
                    ...endProperties,
                    size: lastSize ?? defaultFormat.size ?? 18,
                  },
                }
              : {}),
            elements,
          };
        });
      paragraphCache.set(cell[CELL_ELEMENT], { defaults, paragraphs });
      return paragraphs;
    },
  };
  resolverCache.set(tableElement, {
    pkg,
    slideData,
    definition,
    themeData: themeView?.data,
    masterData: masterPart?.data,
    colorMap: mapKey,
    resolver,
  });
  return resolver;
};
