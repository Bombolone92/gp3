// Materialize source DrawingML paint when a copy changes template contexts.
// Keep native fills, line properties, effects and their relationship owners.
import { type PartName } from "../../internal/opc/index.ts";
import { styleMatrixEntries } from "./theme-style-matrix.ts";
import {
  readGroupChildren,
  readShapeTreeFromCsldRoot,
} from "../../internal/presentationml/index.ts";
import {
  NS,
  attr,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
  type XmlAttr,
  type XmlElement,
} from "../../internal/xml/index.ts";
import {
  SHAPE_SLIDE,
  SHAPE_SNAPSHOT,
  SLIDE_SHAPES,
  type SlideData,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import { getEffectiveColorMap } from "./color-map.ts";
import { inheritFill } from "./shape-fill-inheritance.ts";
import { getGroupChildren } from "./shape-read-base.ts";
import { resolveDrawingColor } from "./shape-color.ts";
import { themeForShape } from "./shape-theme.ts";
import { readStrokeWidth } from "./shape-stroke-width.ts";
import {
  readStrokeCap,
  readStrokeCompound,
  readStrokeDash,
  readStrokeEnd,
} from "./shape-stroke-formatting.ts";
import {
  shapePropertySources,
  type ShapePropertySource,
} from "./shape-property-sources.ts";

const child = (el: XmlElement | null, local: string, ns: string = NS.dml) =>
  el && firstChildElement(el, qname("", local, ns));
const elements = (el: XmlElement | null) =>
  el?.children.filter((c): c is XmlElement => c.kind === "element") ?? [];
const value = (el: XmlElement, local: string) =>
  getAttrValue(el, qname("", local, ""));
const fills = new Set([
  "noFill",
  "solidFill",
  "gradFill",
  "blipFill",
  "pattFill",
  "grpFill",
]);
const colors = new Set([
  "srgbClr",
  "scrgbClr",
  "hslClr",
  "schemeClr",
  "sysClr",
  "prstClr",
]);
const fill = (el: XmlElement | null) =>
  elements(el).find(
    (c) => c.name.namespaceURI === NS.dml && fills.has(c.name.localName),
  ) ?? null;
const effect = (el: XmlElement | null) =>
  child(el, "effectLst") ?? child(el, "effectDag");
const none = () => elem(qname("a", "noFill", NS.dml));
const noLine = () => elem(qname("a", "ln", NS.dml), { children: [none()] });
const noEffects = () => elem(qname("a", "effectLst", NS.dml));
const key = (el: XmlElement | XmlAttr) =>
  `${el.name.namespaceURI}|${el.name.localName}`;

export interface PaintStyleCopy {
  readonly references: WeakMap<XmlAttr, PartName>;
  preserve(source: SlideShapeData, clone: XmlElement): boolean;
}

export const createPaintStyleCopy = (
  references = new WeakMap<XmlAttr, PartName>(),
): PaintStyleCopy => {
  const scopes = new WeakMap<
    XmlElement,
    WeakMap<XmlElement, Map<string, string>>
  >();
  const scopeFor = (root: XmlElement, node: XmlElement) => {
    let index = scopes.get(root);
    if (!index) {
      index = new WeakMap();
      scopes.set(root, index);
      const pending = [{ el: root, scope: new Map<string, string>() }];
      while (pending.length) {
        const { el, scope } = pending.pop()!,
          next = new Map([...scope, ...el.prefixDecls]);
        index.set(el, next);
        for (const c of elements(el)) {
          // Paint does not use text or geometry namespace contexts. Avoid indexing
          // large path lists and text bodies for each clipboard operation.
          if (
            ["custGeom", "prstGeom", "txBody", "txStyles"].includes(
              c.name.localName,
            )
          )
            continue;
          pending.push({ el: c, scope: next });
        }
      }
    }
    return index.get(node) ?? node.prefixDecls;
  };
  const clone = (el: XmlElement, source: ShapePropertySource): XmlElement => ({
    ...el,
    name: { ...el.name },
    attrs: el.attrs.map((a) => {
      const copy = { ...a, name: { ...a.name } };
      if (a.name.namespaceURI === NS.officeDocRels)
        references.set(copy, references.get(a) ?? source.owner);
      return copy;
    }),
    prefixDecls: new Map(scopeFor(source.root, el)),
    children: el.children.map((c) =>
      c.kind === "element" ? clone(c, source) : { ...c },
    ),
  });
  const mergeLine = (own: XmlElement, fallback: XmlElement): XmlElement => {
    // Materialization uses the same validity rules as effective reads. Only
    // replace malformed properties when a valid fallback actually exists;
    // the original source XML remains untouched.
    const replace = new Set<string>();
    for (const [name, read] of [
      ["w", readStrokeWidth],
      ["cap", readStrokeCap],
      ["cmpd", readStrokeCompound],
    ] as const)
      if (read(own) === null && read(fallback) !== null) replace.add(name);
    const ownAttrs = own.attrs.filter(
      (a) => a.name.namespaceURI !== "" || !replace.has(a.name.localName),
    );
    const replaceChildren = new Set<string>();
    if (readStrokeDash(own) === null && readStrokeDash(fallback) !== null) {
      replaceChildren.add("prstDash");
      replaceChildren.add("custDash");
    }
    for (const end of ["headEnd", "tailEnd"] as const)
      if (
        readStrokeEnd(own, end) === null &&
        readStrokeEnd(fallback, end) !== null
      )
        replaceChildren.add(end);
    own = {
      ...own,
      attrs: ownAttrs,
      children: own.children.filter(
        (c) =>
          c.kind !== "element" ||
          c.name.namespaceURI !== NS.dml ||
          !replaceChildren.has(c.name.localName),
      ),
    };
    const attrs = new Set(ownAttrs.map(key)),
      ownFill = fill(own),
      oldFill = fill(fallback);
    const result = {
      ...own,
      attrs: [...ownAttrs, ...fallback.attrs.filter((a) => !attrs.has(key(a)))],
      children: [...own.children],
    };
    for (const c of elements(fallback)) {
      if (c.name.namespaceURI === NS.dml && fills.has(c.name.localName))
        continue;
      if (!elements(own).some((x) => key(x) === key(c)))
        result.children.push(c);
    }
    const resolved = ownFill
      ? oldFill
        ? inheritFill(ownFill, oldFill)
        : ownFill
      : oldFill;
    if (resolved) {
      result.children = result.children.filter(
        (c) =>
          c.kind !== "element" ||
          c.name.namespaceURI !== NS.dml ||
          !fills.has(c.name.localName),
      );
      result.children.unshift(resolved);
    }
    // CT_LineProperties sequence: fill, dash choice, join choice, ends, extLst.
    const ranks = [
      "noFill solidFill gradFill pattFill blipFill grpFill",
      "prstDash custDash",
      "round bevel miter",
      "headEnd",
      "tailEnd",
      "extLst",
    ];
    const rank = (el: XmlElement) =>
      ranks.findIndex(
        (g) =>
          el.name.namespaceURI === NS.dml &&
          g.split(" ").includes(el.name.localName),
      );
    const ownChoices = new Set(
      elements(own)
        .map(rank)
        .filter((r) => r >= 0),
    );
    result.children = result.children.filter(
      (c) =>
        c.kind !== "element" ||
        elements(own).includes(c) ||
        rank(c) < 0 ||
        !ownChoices.has(rank(c)) ||
        fills.has(c.name.localName),
    );
    result.children.sort((a, b) =>
      a.kind === "element" && b.kind === "element"
        ? (rank(a) < 0 ? ranks.length : rank(a)) -
          (rank(b) < 0 ? ranks.length : rank(b))
        : 0,
    );
    return result;
  };
  const preserve = (shape: SlideShapeData, target: XmlElement): boolean => {
    const kind = shape[SHAPE_SNAPSHOT].kind;
    if (!["shape", "picture", "connector", "group"].includes(kind))
      return false;
    const theme = themeForShape(shape),
      map = getEffectiveColorMap(shape[SHAPE_SLIDE]);
    const freeze = (
      el: XmlElement,
      placeholder: XmlElement | null = null,
    ): XmlElement => {
      // Geometry and transforms contain no paint. Keep large path subtrees
      // shared with the already-independent clone rather than walking them.
      if (
        el.name.namespaceURI === NS.dml &&
        ["custGeom", "prstGeom", "xfrm"].includes(el.name.localName)
      )
        return el;
      if (
        el.name.namespaceURI === NS.dml &&
        el.name.localName === "schemeClr"
      ) {
        if (value(el, "val") === "phClr" && placeholder) {
          const base = freeze(placeholder);
          return {
            ...base,
            children: [
              ...base.children,
              ...el.children.map((c) => (c.kind === "element" ? freeze(c) : c)),
            ],
          };
        }
        const rgb = resolveDrawingColor(
          { ...el, children: [] },
          theme?.theme ?? null,
          map,
        );
        if (rgb)
          return {
            ...el,
            name: qname(el.name.prefix, "srgbClr", NS.dml),
            attrs: [
              ...el.attrs.filter(
                (a) => a.name.namespaceURI !== "" || a.name.localName !== "val",
              ),
              attr(qname("", "val", ""), rgb.slice(1)),
            ],
          };
      }
      return {
        ...el,
        children: el.children.map((c) =>
          c.kind === "element" ? freeze(c, placeholder) : c,
        ),
      };
    };
    const matrix = child(
      child(theme?.root ?? null, "themeElements"),
      "fmtScheme",
    );
    const style = (
      source: ShapePropertySource,
      type: "fillRef" | "lnRef" | "effectRef",
    ): XmlElement | null => {
      const ref = child(child(source.element, "style", NS.pml), type);
      if (!ref) return null;
      const raw = value(ref, "idx");
      if (raw === null || !/^\+?\d+$/.test(raw.trim())) return null;
      const idx = Number(raw);
      if (!Number.isSafeInteger(idx)) return null;
      if (idx === 0 || (type === "fillRef" && idx === 1000))
        return type === "fillRef"
          ? none()
          : type === "lnRef"
            ? noLine()
            : noEffects();
      const listName =
        type === "fillRef"
          ? idx > 1000
            ? "bgFillStyleLst"
            : "fillStyleLst"
          : type === "lnRef"
            ? "lnStyleLst"
            : "effectStyleLst";
      const list = child(matrix, listName);
      const selected = styleMatrixEntries(list, listName)[
        type === "fillRef" && idx > 1000 ? idx - 1001 : idx - 1
      ];
      if (!selected || !theme) return null;
      const color = elements(ref).find(
        (c) => c.name.namespaceURI === NS.dml && colors.has(c.name.localName),
      );
      const result = freeze(
        clone(selected, {
          element: selected,
          root: theme.root,
          owner: theme.partName,
        }),
        color ? freeze(clone(color, source)) : null,
      );
      return type === "effectRef" ? effect(result) : result;
    };
    let resolvedFill: XmlElement | null = null,
      resolvedLine: XmlElement | null = null,
      resolvedEffects: XmlElement | null = null;
    for (const source of shapePropertySources(shape).reverse()) {
      const sp = child(
        source.element,
        kind === "group" ? "grpSpPr" : "spPr",
        NS.pml,
      );
      const directFill = fill(sp),
        directLine = child(sp, "ln"),
        directEffects = effect(sp);
      const styledFill = style(source, "fillRef"),
        styledLine = style(source, "lnRef"),
        styledEffects = style(source, "effectRef");
      let currentFill = directFill
        ? freeze(clone(directFill, source))
        : styledFill;
      if (currentFill && styledFill)
        currentFill = inheritFill(currentFill, styledFill);
      resolvedFill = currentFill
        ? resolvedFill
          ? inheritFill(currentFill, resolvedFill)
          : currentFill
        : resolvedFill;
      let currentLine = directLine
        ? freeze(clone(directLine, source))
        : styledLine;
      if (currentLine && styledLine)
        currentLine = mergeLine(currentLine, styledLine);
      resolvedLine = currentLine
        ? resolvedLine
          ? mergeLine(currentLine, resolvedLine)
          : currentLine
        : resolvedLine;
      resolvedEffects = directEffects
        ? freeze(clone(directEffects, source))
        : (styledEffects ?? resolvedEffects);
    }
    const name = kind === "group" ? "grpSpPr" : "spPr";
    let props = child(target, name, NS.pml);
    if (!props) {
      props = elem(qname("p", name, NS.pml));
      target.children.splice(1, 0, props);
    }
    const existing = props;
    props.children = props.children.filter(
      (c) =>
        c.kind !== "element" ||
        c.name.namespaceURI !== NS.dml ||
        (!fills.has(c.name.localName) &&
          !["ln", "effectLst", "effectDag"].includes(c.name.localName)),
    );
    const paints =
      kind === "group"
        ? [resolvedFill ?? none(), resolvedEffects ?? noEffects()]
        : [
            resolvedFill ?? none(),
            resolvedLine ?? noLine(),
            resolvedEffects ?? noEffects(),
          ];
    // CT_ShapeProperties places paint after xfrm/geometry and before 3D/extLst.
    const index = props.children.findIndex(
      (c) =>
        c.kind === "element" &&
        c.name.namespaceURI === NS.dml &&
        ["scene3d", "sp3d", "extLst"].includes(c.name.localName),
    );
    props.children.splice(
      index < 0 ? props.children.length : index,
      0,
      ...paints,
    );
    const frozen = freeze(props);
    existing.children = frozen.children;
    // Picture-specific blip effects may use source theme colors as well.
    const pictureFill = child(target, "blipFill", NS.pml);
    if (pictureFill) pictureFill.children = freeze(pictureFill).children;
    return true;
  };
  return { references, preserve };
};

export const preserveImportedPaint = (
  source: SlideData,
  root: XmlElement,
  copy: PaintStyleCopy,
): boolean => {
  const targets = readShapeTreeFromCsldRoot(root, "sld").shapes;
  let changed = false;
  source[SLIDE_SHAPES].forEach((shape, i) => {
    const target = targets[i];
    if (target) changed = copy.preserve(shape, target.element) || changed;
  });
  return changed;
};
export const preserveCopiedPaint = (
  source: SlideShapeData,
  root: XmlElement,
  copy: PaintStyleCopy,
): void => {
  copy.preserve(source, root);
  if (source[SHAPE_SNAPSHOT].kind !== "group") return;
  const targets = readGroupChildren(root);
  getGroupChildren(source).forEach((shape, i) => {
    const target = targets[i];
    if (target) preserveCopiedPaint(shape, target.element, copy);
  });
};
