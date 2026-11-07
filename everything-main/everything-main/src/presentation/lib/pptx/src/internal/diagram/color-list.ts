import { NS, type XmlElement, getAttrValue, qname } from "../xml/index.ts";

export interface DiagramColorSample {
  /** Unresolved color nodes retain theme references, transforms and alpha. */
  readonly from: XmlElement;
  readonly to: XmlElement;
  readonly amount: number;
  readonly hueDirection: "cw" | "ccw";
}

const COLOR_NAMES = new Set([
  "srgbClr",
  "scrgbClr",
  "hslClr",
  "schemeClr",
  "sysClr",
  "prstClr",
]);

/**
 * Select the palette interval for one presentation element. Color resolution
 * and interpolation happen later in the containing slide's theme context.
 * ECMA-376 §21.4.7.16 defines repeat, span and cycle; CT_Colors defaults to
 * span/cw. An empty list supplies no color override.
 */
export const sampleDiagramColors = (
  list: XmlElement | null,
  index: number | null,
  count: number | null,
): DiagramColorSample | null => {
  if (!list || list.name.namespaceURI !== NS.diagram) return null;
  const colors = list.children.filter(
    (el): el is XmlElement =>
      el.kind === "element" &&
      el.name.namespaceURI === NS.dml &&
      COLOR_NAMES.has(el.name.localName),
  );
  if (!colors.length) return null;
  const method = getAttrValue(list, qname("", "meth", "")) ?? "span";
  const direction = getAttrValue(list, qname("", "hueDir", "")) ?? "cw";
  if (direction !== "cw" && direction !== "ccw")
    throw new Error(`unknown diagram hue direction ${direction}`);
  if (!["repeat", "span", "cycle"].includes(method))
    throw new Error(`unknown diagram color method ${method}`);
  const selected = (
    from: number,
    to = from,
    amount = 0,
  ): DiagramColorSample => ({
    from: colors[from]!,
    to: colors[to]!,
    amount,
    hueDirection: direction,
  });
  // A singleton palette is constant even when saved indexing is absent.
  if (colors.length === 1) return selected(0);
  if (
    index === null ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 0x7fffffff
  )
    throw new Error("diagram color application requires a valid style index");
  if (method === "repeat") return selected(index % colors.length);
  if (
    count === null ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 0x7fffffff ||
    index >= count
  )
    throw new Error("diagram color application requires a valid style count");
  if (count === 1) return selected(0);
  let progress = index / (count - 1);
  if (method === "cycle") {
    // `cycle` samples a full out-and-back pass over `count` intervals;
    // it does not duplicate the first color on the last node. This matches
    // the §21.4.7.16 illustration (whose prose says otherwise). Verified with
    // native PNG exports for two- and three-color palettes: six nodes sample
    // 0, 1/3, 2/3, 1, 2/3, 1/3 of the palette's forward path.
    progress = (2 * Math.min(index, count - index)) / count;
  }
  const position = progress * (colors.length - 1);
  // The final entry is the end of the preceding interval, not a discrete
  // repeat entry: that interval's ordered transforms still apply.
  const from = Math.min(colors.length - 2, Math.floor(position)),
    to = from + 1;
  return selected(from, to, position - from);
};
