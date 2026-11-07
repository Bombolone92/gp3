import type { DiagramLayoutNode } from "../../internal/diagram/layout.ts";
import { expandDiagramLayout } from "../../internal/diagram/layout.ts";
import { readDiagramHierarchy } from "../../internal/diagram/hierarchy.ts";
import { readDiagramLayoutStyles } from "../../internal/diagram/layout-styles.ts";
import { readDiagramListStyle } from "../../internal/diagram/styles.ts";
import { readDiagramTextCustomization } from "../../internal/diagram/text-customization.ts";
import type { DiagramInitialConstraints } from "../../internal/diagram/initial-constraints.ts";
import {
  reflowDiagramLayout,
  type DiagramReflowResult,
  type DiagramTextFit,
} from "../../internal/diagram/reflow.ts";
import type { DiagramLayoutRect } from "../../internal/diagram/arrange.ts";
import type { PartName } from "../../internal/opc/index.ts";
import { readGroupChildren } from "../../internal/presentationml/index.ts";
import {
  NS,
  type XmlElement,
  attr,
  elem,
  qname,
  getAttrValue,
  firstChildElement,
} from "../../internal/xml/index.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SHAPE_SNAPSHOT,
  SHAPE_XML_SOURCES,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import { readShapeDiagram, type DiagramView } from "./diagram-read.ts";
import { projectDiagramTextParagraphs } from "./diagram-text-paragraphs.ts";
import { projectDiagramTextBodyProperties } from "./diagram-text-body.ts";
import { diagramTextFontLayers } from "./diagram-text-fonts.ts";
import { themeForShape } from "./shape-theme.ts";
import { getEffectiveColorMap } from "./color-map.ts";
import { getShapeBounds } from "./shape-read-base.ts";

const element = (
  name: string,
  attributes: Readonly<Record<string, string | number>> = {},
  children: readonly XmlElement[] = [],
  namespace: string = NS.dml,
): XmlElement =>
  elem(qname(namespace === NS.dml ? "a" : "p", name, namespace), {
    attrs: Object.entries(attributes).map(([key, value]) =>
      attr(qname("", key, ""), String(value)),
    ),
    children: [...children],
  });
export interface DiagramTextProjector {
  /** Fresh measurement/display handle; never pass to shape mutation APIs. */
  project(
    node: DiagramLayoutNode,
    state: DiagramInitialConstraints,
    algorithm: DiagramInitialConstraints,
    bounds?: DiagramLayoutRect,
  ): SlideShapeData;
}

/**
 * Bind semantic text/style sources once for an expanded layout. Each projection
 * creates independent PML measurement text, preserving source-part ownership
 * for links, fields and extensions. No saved presentation points or drawing
 * cache are read. Shape geometry, paint, 3D and final rotation belong to the
 * drawing builder; this rectangle is only the text's unrotated layout box.
 */
export const createDiagramTextProjector = (
  frame: SlideShapeData,
  diagram: DiagramView,
  root: DiagramLayoutNode,
  options: { readonly rtl?: boolean } = {},
): DiagramTextProjector => {
  const data = diagram.data,
    layout = diagram.layout;
  if (!data || !layout || !diagram.model)
    throw new Error("diagram semantic text sources are missing");
  const styles = readDiagramLayoutStyles(
    root,
    diagram.quickStyle?.root ?? null,
    diagram.colors?.root ?? null,
  );
  const listStyle = readDiagramListStyle(layout.root);
  const colorMap = getEffectiveColorMap(frame[SHAPE_SLIDE]);
  const layers = new Map<
    DiagramLayoutNode,
    ReturnType<typeof diagramTextFontLayers>
  >();
  return {
    project(node, state, algorithm, bounds = { x: 0, y: 0, ...state.size }) {
      // An exact point never initializes a native TX display rectangle. Its
      // semantic text still supplies associated geometry, using the native
      // one-inch origin rectangle and zero font/margin preferences. Keep these
      // display defaults out of fitting, references and custom text overrides.
      const point = bounds.w === 0 && bounds.h === 0;
      const style = styles.get(node);
      if (
        !style ||
        !node.algorithm ||
        getAttrValue(node.algorithm, qname("", "type", "")) !== "tx"
      )
        throw new Error(
          "diagram text projection requires a text node from this layout",
        );
      if (style.issues.length) throw new Error(style.issues.join("; "));
      const quickText =
        style.quickStyle &&
        firstChildElement(style.quickStyle, qname("", "txPr", NS.diagram));
      if (
        quickText &&
        (quickText.attrs.length ||
          quickText.children.some((c) => c.kind === "element"))
      )
        throw new Error("unsupported diagram quick-style text body properties");
      let defaults = layers.get(node);
      if (!defaults) {
        defaults = diagramTextFontLayers(style, {
          quickOwner: diagram.quickStyle?.part.name ?? data.part.name,
          colorOwner: diagram.colors?.part.name ?? data.part.name,
          theme: () => themeForShape(frame)?.theme ?? null,
          colorMap,
          report: (message) => {
            throw new Error(message);
          },
        });
        layers.set(node, defaults);
      }
      const sources = new WeakMap<XmlElement, PartName>();
      // Custom first-character fallback is a layout override. It must not replace
      // the algorithm ruler font for a mixed, partially sized contributor.
      const fonts = readDiagramTextCustomization(node) ? algorithm : state;
      const paragraphs = projectDiagramTextParagraphs(
        node,
        {
          dataOwner: data.part.name,
          ...(listStyle
            ? {
                layoutListStyle: {
                  element: listStyle,
                  owner: layout.part.name,
                },
              }
            : {}),
          rtl: options.rtl ?? false,
          customizationScope: point ? "contributor" : "shape",
          fontSize: (role) =>
            point
              ? 0
              : fonts.values.get(
                  role === "primary" ? "primFontSz" : "secFontSz",
                )!,
          defaults: () => defaults!,
        },
        sources,
      );
      const body = projectDiagramTextBodyProperties(
        node,
        {
          dataOwner: data.part.name,
          rtl: options.rtl ?? false,
          margins: {
            l: point ? 0 : state.values.get("lMarg")!,
            r: point ? 0 : state.values.get("rMarg")!,
            t: point ? 0 : state.values.get("tMarg")!,
            b: point ? 0 : state.values.get("bMarg")!,
          },
        },
        sources,
      );
      const emu = (value: number) => {
        const result = Math.trunc(value * 36000);
        if (!Number.isSafeInteger(result))
          throw new Error("invalid diagram text rectangle");
        return result;
      };
      if (bounds.w < 0 || bounds.h < 0)
        throw new Error("negative diagram text rectangle");
      const textBounds = point ? { x: 0, y: 0, w: 25.4, h: 25.4 } : bounds;
      const shape = element(
        "sp",
        {},
        [
          element(
            "nvSpPr",
            {},
            [
              element("cNvPr", { id: 0, name: node.name }, [], NS.pml),
              element("cNvSpPr", {}, [], NS.pml),
              element("nvPr", {}, [], NS.pml),
            ],
            NS.pml,
          ),
          element(
            "spPr",
            {},
            [
              element("xfrm", {}, [
                element("off", { x: emu(textBounds.x), y: emu(textBounds.y) }),
                // Native drawing text has a one-EMU minimum rectangle even
                // when the owning geometry has a genuinely zero extent.
                element("ext", {
                  cx: Math.max(1, emu(textBounds.w)),
                  cy: Math.max(1, emu(textBounds.h)),
                }),
              ]),
              element("prstGeom", { prst: "rect" }),
            ],
            NS.pml,
          ),
          element(
            "txBody",
            {},
            [body, element("lstStyle"), ...paragraphs],
            NS.pml,
          ),
        ],
        NS.pml,
      );
      const [snapshot] = readGroupChildren(
        element("grpSp", {}, [shape], NS.pml),
      );
      return {
        [SHAPE_SLIDE]: frame[SHAPE_SLIDE],
        [SHAPE_ELEMENT]: shape,
        [SHAPE_SNAPSHOT]: snapshot!,
        [SHAPE_XML_SOURCES]: sources,
      };
    },
  };
};

export interface DiagramShapeReflow extends DiagramReflowResult {
  readonly diagram: DiagramView;
  readonly root: DiagramLayoutNode;
  /** Text projection only, not replacement drawings for the semantic shapes. */
  readonly text: ReadonlyMap<DiagramLayoutNode, SlideShapeData>;
}

/** Production entry point for semantic text/geometry reflow, independent of the
 * host's glyph measurer. Leaves all original parts, caches and handles intact.
 * A drawing builder must add semantic shape geometry/styles before rendering or
 * serializing the result as a complete SmartArt drawing.
 */
export const reflowShapeDiagram = (
  frame: SlideShapeData,
  options: {
    readonly textFits: (
      shape: SlideShapeData,
      state: DiagramInitialConstraints,
      node: DiagramLayoutNode,
    ) => DiagramTextFit;
    readonly rtl?: boolean;
    readonly maxOperations?: number;
  },
): DiagramShapeReflow | null => {
  const diagram = readShapeDiagram(frame);
  if (!diagram) return null;
  if (!diagram.model || !diagram.layout)
    throw new Error("diagram semantic layout sources are missing");
  const root = expandDiagramLayout(
    diagram.layout.root,
    readDiagramHierarchy(diagram.model),
  );
  const projector = createDiagramTextProjector(frame, diagram, root, options);
  const frameBounds = getShapeBounds(frame);
  if (!frameBounds) throw new Error("diagram frame bounds are missing");
  const result = reflowDiagramLayout(
    root,
    { w: frameBounds.w / 36000, h: frameBounds.h / 36000 },
    {
      ...(options.maxOperations === undefined
        ? {}
        : { maxOperations: options.maxOperations }),
      textFits: (node, state, algorithm) => {
        return options.textFits(
          projector.project(node, state, algorithm),
          state,
          node,
        );
      },
    },
  );
  const text = new Map<DiagramLayoutNode, SlideShapeData>();
  // Projection follows layout order and includes TX nodes that needed no
  // measurement. A zero-size text node still owns semantic text and formatting.
  for (const [node, state] of result.drawing) {
    const algorithm = result.algorithms.get(node)!;
    if (
      node.algorithm &&
      getAttrValue(node.algorithm, qname("", "type", "")) === "tx"
    )
      text.set(
        node,
        projector.project(node, state, algorithm, result.bounds.get(node)!),
      );
  }
  return { ...result, diagram, root, text };
};
