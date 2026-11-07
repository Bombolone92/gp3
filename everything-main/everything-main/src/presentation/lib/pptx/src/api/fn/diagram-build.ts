import type { PartName } from "../../internal/opc/index.ts";
import { styleMatrixEntries } from "./theme-style-matrix.ts";
import { readGroupChildren } from "../../internal/presentationml/index.ts";
import { sampleDiagramColors } from "../../internal/diagram/color-list.ts";
import { readDiagramLayoutStyles } from "../../internal/diagram/layout-styles.ts";
import { readDiagramDrawingText } from "../../internal/diagram/drawing-text.ts";
import { readDiagramLayoutShapeProperties } from "../../internal/diagram/shape-properties.ts";
import {
  readDiagramZOrderOffset,
  orderDiagramDrawing,
} from "../../internal/diagram/drawing-order.ts";
import type { DiagramStyle } from "../../internal/diagram/styles.ts";
import type { DiagramLayoutNode } from "../../internal/diagram/layout.ts";
import {
  NS,
  type XmlElement,
  attr,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
  walkElements,
} from "../../internal/xml/index.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SHAPE_SNAPSHOT,
  SHAPE_XML_SOURCES,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import type { DiagramShapeReflow } from "./diagram-reflow.ts";
import type {
  DiagramDrawingView,
  DiagramDrawingShape,
} from "./diagram-drawing.ts";
import { expandDiagramColor } from "./diagram-color.ts";
import { cloneShapeSource } from "./shape-source.ts";
import { themeForShape } from "./shape-theme.ts";
import { getEffectiveColorMap } from "./color-map.ts";

const child = (e: XmlElement | null, name: string, ns: string = NS.dml) =>
  e && firstChildElement(e, qname("", name, ns));
const value = (e: XmlElement | null, name: string) =>
  e && getAttrValue(e, qname("", name, ""));
const elements = (e: XmlElement | null) =>
  e?.children.filter((c): c is XmlElement => c.kind === "element") ?? [];
const make = (
  name: string,
  attrs: Readonly<Record<string, string | number>> = {},
  children: XmlElement[] = [],
  ns: string = NS.dml,
) =>
  elem(qname(ns === NS.dml ? "a" : "p", name, ns), {
    attrs: Object.entries(attrs).map(([key, val]) =>
      attr(qname("", key, ""), String(val)),
    ),
    children,
  });
const colors = new Set([
  "srgbClr",
  "scrgbClr",
  "schemeClr",
  "hslClr",
  "sysClr",
  "prstClr",
]);
const noFill = () => make("noFill");
const fillNames = new Set([
  "noFill",
  "solidFill",
  "gradFill",
  "blipFill",
  "pattFill",
  "grpFill",
]);
const set = (e: XmlElement, name: string, val: string) => {
  e.attrs = e.attrs.filter(
    (a) => a.name.namespaceURI !== "" || a.name.localName !== name,
  );
  e.attrs.push(attr(qname("", name, ""), val));
};
const boolean = (raw: string | null, name: string): boolean => {
  if (raw === null || raw.trim() === "0" || raw.trim() === "false")
    return false;
  if (raw.trim() === "1" || raw.trim() === "true") return true;
  throw new Error(`invalid diagram shape ${name}`);
};

const mergeAttributes = (target: XmlElement, layer: XmlElement): void => {
  for (const a of layer.attrs) {
    target.attrs = target.attrs.filter(
      (b) =>
        b.name.localName !== a.name.localName ||
        b.name.namespaceURI !== a.name.namespaceURI,
    );
    target.attrs.push(a);
  }
};
const propertyChoice = (name: string): ReadonlySet<string> | null => {
  if (fillNames.has(name)) return fillNames;
  if (name === "prstGeom" || name === "custGeom") return geometryNames;
  if (name === "effectLst" || name === "effectDag") return effectNames;
  if (name === "prstDash" || name === "custDash") return dashNames;
  if (joinNames.has(name)) return joinNames;
  return null;
};
const geometryNames = new Set(["prstGeom", "custGeom"]);
const effectNames = new Set(["effectLst", "effectDag"]);
const dashNames = new Set(["prstDash", "custDash"]);
const joinNames = new Set(["round", "bevel", "miter"]);
const mergeProperty = (target: XmlElement, property: XmlElement): void => {
  if (property.name.namespaceURI !== NS.dml)
    throw new Error("unsupported diagram shape property namespace");
  const name = property.name.localName,
    choice = propertyChoice(name);
  const index = target.children.findIndex(
    (c) =>
      c.kind === "element" &&
      c.name.namespaceURI === NS.dml &&
      (choice ? choice.has(c.name.localName) : c.name.localName === name),
  );
  if (name === "ln" && index >= 0) {
    const line = target.children[index] as XmlElement;
    mergeAttributes(line, property);
    for (const c of elements(property)) mergeProperty(line, c);
  } else if (index >= 0) target.children[index] = property;
  else target.children.push(property);
};

/** Theme paint < layout defaults < first presOf point customization.
 * Clone each layer with its relationship owner; never rewrite semantic XML.
 * Layout transforms need the layout stage rather than replacing its rectangle.
 * Direct data transforms are already excluded by native layout controls.
 */
const applyShapeProperties = (
  target: XmlElement,
  source: XmlElement,
  owner: PartName,
  sources: WeakMap<XmlElement, PartName>,
  layout: boolean,
): void => {
  const layer = cloneShapeSource(source, owner, sources);
  mergeAttributes(target, layer);
  for (const property of elements(layer)) {
    if (property.name.namespaceURI !== NS.dml)
      throw new Error("unsupported diagram shape property namespace");
    const name = property.name.localName;
    if (name === "xfrm") {
      if (layout && (property.attrs.length || elements(property).length))
        throw new Error("unsupported diagram layout shape transform");
      continue;
    }
    if (
      (name === "scene3d" || name === "sp3d") &&
      (property.attrs.length || elements(property).length)
    )
      throw new Error("unsupported diagram custom 3D shape");
    mergeProperty(target, property);
  }
};

/** Expand the selected theme entries with the diagram's paint palettes.
 * Palettes supply shape fills/lines and effect phClr; literal effect colors
 * remain literal. Reference
 * index zero and a missing quick-style reference mean no paint, even with a
 * nonempty palette. Source-part ownership survives theme image/effect clones.
 */
export const projectDiagramShapePaint = (
  frame: SlideShapeData,
  result: DiagramShapeReflow,
  style: DiagramStyle,
  hidden: boolean,
  sources: WeakMap<XmlElement, PartName>,
): { properties: XmlElement[]; style: XmlElement | null } => {
  if (style.issues.length) throw new Error(style.issues.join("; "));
  const diagram = result.diagram,
    theme = themeForShape(frame),
    map = getEffectiveColorMap(frame[SHAPE_SLIDE]);
  const matrix = child(
    child(theme?.root ?? null, "themeElements"),
    "fmtScheme",
  );
  const quick = child(style.quickStyle, "style", NS.diagram);
  const quickOwner = diagram.quickStyle?.part.name ?? diagram.data!.part.name;
  const colorOwner = diagram.colors?.part.name ?? diagram.data!.part.name;
  const paint = (
    reference: string,
    palette: string,
    list: string,
    fallback: () => XmlElement,
  ): XmlElement => {
    const ref = child(quick, reference);
    if (!ref) return fallback();
    const raw = (value(ref, "idx") ?? "").trim(),
      index = Number(raw);
    if (
      !/^\+?\d+$/.test(raw) ||
      !Number.isSafeInteger(index) ||
      index > 0xffffffff
    )
      throw new Error(`invalid diagram ${reference} index`);
    if (index === 0 || (reference === "fillRef" && index === 1000))
      return fallback();
    const background = reference === "fillRef" && index > 1000;
    const listName = background ? "bgFillStyleLst" : list;
    const entry = styleMatrixEntries(child(matrix, listName), listName)[
      index - (background ? 1001 : 1)
    ];
    if (!entry || !theme)
      throw new Error(`missing diagram theme ${reference} entry ${index}`);
    const sample =
      hidden && reference !== "effectRef"
        ? null
        : sampleDiagramColors(
            child(style.colors, palette, NS.diagram),
            style.styleIndex,
            style.styleCount,
          );
    const placeholder = sample
      ? expandDiagramColor(sample, theme.theme, map)
      : (elements(ref).find(
          (e) => e.name.namespaceURI === NS.dml && colors.has(e.name.localName),
        ) ?? null);
    if (sample && !placeholder)
      throw new Error(`unresolved diagram ${palette} color`);
    const copy = cloneShapeSource(entry, theme.partName, sources);
    // SmartArt palettes replace solid fills and the line's entire fill. A
    // gradient fill instead retains its stop transforms after substitution.
    // Native controls distinguish these from universal phClr substitution.
    if (
      sample &&
      placeholder &&
      reference === "fillRef" &&
      copy.name.localName === "solidFill"
    )
      return make("solidFill", {}, [
        cloneShapeSource(placeholder, colorOwner, sources),
      ]);
    if (sample && placeholder && reference === "lnRef") {
      copy.children = copy.children.filter(
        (c) => c.kind !== "element" || !fillNames.has(c.name.localName),
      );
      copy.children.unshift(
        make("solidFill", {}, [
          cloneShapeSource(placeholder, colorOwner, sources),
        ]),
      );
    }
    const replace = (parent: XmlElement): void => {
      parent.children = parent.children.map((node) => {
        if (node.kind !== "element") return node;
        if (
          node.name.namespaceURI === NS.dml &&
          node.name.localName === "schemeClr" &&
          value(node, "val") === "phClr"
        ) {
          if (
            !placeholder ||
            (placeholder.name.localName === "schemeClr" &&
              value(placeholder, "val") === "phClr")
          )
            throw new Error(
              `unresolved diagram ${reference} placeholder color`,
            );
          const color = cloneShapeSource(
            placeholder,
            sample ? colorOwner : quickOwner,
            sources,
          );
          color.children.push(...node.children);
          return color;
        }
        replace(node);
        return node;
      });
    };
    replace(copy);
    walkElements(copy, (node) => {
      if (
        node.name.namespaceURI === NS.dml &&
        (node.name.localName === "outerShdw" ||
          (reference === "fillRef" && node.name.localName === "gradFill"))
      )
        set(node, "rotWithShape", "0");
    });
    return copy;
  };
  let fill = paint("fillRef", "fillClrLst", "fillStyleLst", noFill);
  const line = paint("lnRef", "linClrLst", "lnStyleLst", () =>
    make("ln", {}, [noFill()]),
  );
  const effectStyle = paint("effectRef", "effectClrLst", "effectStyleLst", () =>
    make("effectStyle", {}, [make("effectLst")]),
  );
  if (hidden) {
    fill = noFill();
    line.children = line.children.filter(
      (c) => c.kind !== "element" || !fillNames.has(c.name.localName),
    );
    line.children.unshift(noFill());
  }
  // Default orthographic scenes do not turn flat geometry into 3D. Non-flat
  // scenes/bevels need the geometry stage, not a two-dimensional substitution.
  for (const source of [style.quickStyle, effectStyle]) {
    const ns = source === style.quickStyle ? NS.diagram : NS.dml;
    const scene = child(source, "scene3d", ns),
      shape3d = child(source, "sp3d", ns);
    if (shape3d && (shape3d.attrs.length || elements(shape3d).length))
      throw new Error("unsupported diagram 3D shape");
    const camera = child(scene, "camera");
    if (
      scene &&
      (!camera ||
        value(camera, "prst") !== "orthographicFront" ||
        elements(camera).length)
    )
      throw new Error("unsupported diagram 3D scene");
  }
  const effects =
    child(effectStyle, "effectLst") ??
    child(effectStyle, "effectDag") ??
    make("effectLst");
  const projectedStyle = quick
    ? cloneShapeSource(quick, quickOwner, sources)
    : null;
  if (projectedStyle) projectedStyle.name = qname("p", "style", NS.pml);
  return { properties: [fill, line, effects], style: projectedStyle };
};

/** Build an editable-shape vocabulary display tree from semantic reflow.
 * This is a private PML projection, not a flattened bitmap or a mutation of the
 * diagram/cache. The package retains its semantic data and authored layout.
 * Unsupported geometry cannot silently become a rectangle.
 */
export const buildDiagramDrawing = (
  frame: SlideShapeData,
  result: DiagramShapeReflow,
): DiagramDrawingView => {
  const { diagram } = result,
    sources = new WeakMap<XmlElement, PartName>();
  const styles = readDiagramLayoutStyles(
    result.root,
    diagram.quickStyle?.root ?? null,
    diagram.colors?.root ?? null,
  );
  const textFor = readDiagramDrawingText(result.root);
  const shapes: XmlElement[] = [];
  const zOrderOffsets = new Map<XmlElement, number>();
  const information = new WeakMap<XmlElement, DiagramDrawingShape>();
  const visit = (node: DiagramLayoutNode): void => {
    const shape = node.shape,
      type = value(shape, "type") ?? "none";
    if (!shape || type === "none" || type === "") return;
    if (type === "conn")
      throw new Error("unsupported diagram connector geometry");
    if (Number(value(shape, "rot") ?? 0) !== 0)
      throw new Error("unsupported diagram rotated geometry");
    const zOrderOffset = readDiagramZOrderOffset(shape);
    if (
      getAttrValue(shape, qname("r", "blip", NS.officeDocRels)) ||
      boolean(value(shape, "blipPhldr"), "blipPhldr")
    )
      throw new Error("unsupported diagram picture geometry");
    if (elements(child(shape, "adjLst", NS.diagram)).length)
      throw new Error("unsupported diagram geometry adjustments");
    // Native drawing omits exact points for every geometry algorithm. They
    // still participate in text association (including hidden-TX absorption)
    // above, and their semantic data and layout remain intact. Lines and tiny
    // positive extents must survive even when they quantize to zero EMU.
    const bounds = result.bounds.get(node)!;
    if (bounds.w === 0 && bounds.h === 0) return;
    const hidden = boolean(value(shape, "hideGeom"), "hideGeom");
    if (!textFor.has(node)) return;
    const textNode = textFor.get(node);
    const text = textNode ? result.text.get(textNode) : undefined;
    let element: XmlElement;
    if (text) {
      walkElements(text[SHAPE_ELEMENT], (e) => {
        const owner = text[SHAPE_XML_SOURCES]?.get(e);
        if (owner) sources.set(e, owner);
      });
      element = cloneShapeSource(
        text[SHAPE_ELEMENT],
        diagram.data!.part.name,
        sources,
      );
    } else {
      const rect = result.bounds.get(node)!;
      const emu = (v: number) => Math.trunc(v * 36000);
      element = make(
        "sp",
        {},
        [
          make(
            "nvSpPr",
            {},
            [
              make(
                "cNvPr",
                { id: shapes.length + 1, name: node.name },
                [],
                NS.pml,
              ),
              make("cNvSpPr", {}, [], NS.pml),
              make("nvPr", {}, [], NS.pml),
            ],
            NS.pml,
          ),
          make(
            "spPr",
            {},
            [
              make("xfrm", {}, [
                make("off", { x: emu(rect.x), y: emu(rect.y) }),
                make("ext", { cx: emu(rect.w), cy: emu(rect.h) }),
              ]),
            ],
            NS.pml,
          ),
        ],
        NS.pml,
      );
    }
    const properties = child(element, "spPr", NS.pml)!;
    if (text) {
      information.set(element, {
        modelId: null,
        textStyle: null,
        textTransform: child(properties, "xfrm"),
      });
      // The TX supplier owns text formatting and its rectangle. The receiving
      // node still owns geometry, paint, direct shape properties and its name.
      const rect = result.bounds.get(node)!;
      if (textNode !== node || rect.w * 36000 < 1 || rect.h * 36000 < 1) {
        const emu = (v: number) => Math.trunc(v * 36000);
        properties.children = [
          make("xfrm", {}, [
            make("off", { x: emu(rect.x), y: emu(rect.y) }),
            make("ext", { cx: emu(rect.w), cy: emu(rect.h) }),
          ]),
        ];
        set(
          child(child(element, "nvSpPr", NS.pml), "cNvPr", NS.pml)!,
          "name",
          node.name,
        );
      }
    }
    properties.children = properties.children.filter(
      (c) => c.kind !== "element" || c.name.localName === "xfrm",
    );
    properties.children.push(make("prstGeom", { prst: type }, [make("avLst")]));
    const paint = projectDiagramShapePaint(
      frame,
      result,
      styles.get(node)!,
      hidden,
      sources,
    );
    properties.children.push(...paint.properties);
    const layoutProperties = readDiagramLayoutShapeProperties(shape);
    if (layoutProperties)
      applyShapeProperties(
        properties,
        layoutProperties,
        diagram.layout!.part.name,
        sources,
        true,
      );
    // Formatting follows the first presOf point, not the structural context or
    // a later contributor with nonempty properties. Direct xfrm coordinates
    // are ignored by native layout; semantic customization is a separate stage.
    const direct = node.contributors[0]?.point.shapeProperties;
    if (direct)
      applyShapeProperties(
        properties,
        direct,
        diagram.data!.part.name,
        sources,
        false,
      );
    if (hidden) {
      properties.children = properties.children.filter(
        (c) => c.kind !== "element" || !fillNames.has(c.name.localName),
      );
      const line = child(properties, "ln");
      const index = properties.children.findIndex((c) => c === line);
      properties.children.splice(
        index < 0 ? properties.children.length : index,
        0,
        noFill(),
      );
      if (line) {
        line.children = line.children.filter(
          (c) => c.kind !== "element" || !fillNames.has(c.name.localName),
        );
        line.children.unshift(noFill());
      }
    }
    if (paint.style) element.children.push(paint.style);
    if (zOrderOffset) zOrderOffsets.set(element, zOrderOffset);
    shapes.push(element);
  };
  const pending = [result.root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.childOrder !== "b")
      throw new Error("unsupported diagram child drawing order");
    visit(node);
    pending.push(...[...node.children].reverse());
  }
  const tree = make(
    "grpSp",
    {},
    [
      make(
        "nvGrpSpPr",
        {},
        [
          make("cNvPr", { id: 0, name: "" }, [], NS.pml),
          make("cNvGrpSpPr", {}, [], NS.pml),
          make("nvPr", {}, [], NS.pml),
        ],
        NS.pml,
      ),
      make("grpSpPr", {}, [], NS.pml),
      ...(zOrderOffsets.size
        ? orderDiagramDrawing(shapes, zOrderOffsets)
        : shapes),
    ],
    NS.pml,
  );
  const [snapshot] = readGroupChildren(make("grpSp", {}, [tree], NS.pml));
  return {
    diagram,
    root: {
      [SHAPE_SLIDE]: frame[SHAPE_SLIDE],
      [SHAPE_ELEMENT]: tree,
      [SHAPE_SNAPSHOT]: snapshot!,
      [SHAPE_XML_SOURCES]: sources,
    },
    styles: null,
    issues: diagram.issues,
    information: (shape) => information.get(shape[SHAPE_ELEMENT]) ?? null,
  };
};
