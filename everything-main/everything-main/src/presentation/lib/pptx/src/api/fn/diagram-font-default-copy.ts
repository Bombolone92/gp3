import { readDiagramHierarchy } from "../../internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../../internal/diagram/layout.ts";
import { readDiagramLayoutStyles } from "../../internal/diagram/layout-styles.ts";
import { readDiagramTextParagraphs } from "../../internal/diagram/text-content.ts";
import { readDiagramListStyle } from "../../internal/diagram/styles.ts";
import type { PartName } from "../../internal/opc/index.ts";
import { readGroupChildren } from "../../internal/presentationml/index.ts";
import {
  NS,
  type XmlElement,
  attr,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SHAPE_SNAPSHOT,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import type { DiagramColorCopy } from "./diagram-color-copy.ts";
import { createDiagramFontCopy } from "./diagram-font-copy.ts";
import { readShapeDiagram } from "./diagram-read.ts";
import { readDiagramDrawing } from "./diagram-drawing.ts";
import { materializeDiagramText } from "./diagram-text.ts";
import { diagramTextFontLayers } from "./diagram-text-fonts.ts";
import {
  type DiagramTextPropertyLayer as Layer,
  diagramTextListLayers,
  mergeDiagramTextProperties as merge,
} from "./diagram-text-properties.ts";
import {
  textBody,
  textFontReferenceDefaults,
  textListStyleSources,
  listStyleLevel,
} from "./text-inheritance.ts";

const child = (el: XmlElement | null, name: string, ns: string = NS.dml) =>
  el && firstChildElement(el, qname("", name, ns));
const value = (el: XmlElement | null, name: string) =>
  el && getAttrValue(el, qname("", name, ""));
const paragraphs = (body: XmlElement | null): XmlElement[] =>
  (body?.children ?? []).filter(
    (n): n is XmlElement =>
      n.kind === "element" &&
      n.name.namespaceURI === NS.dml &&
      n.name.localName === "p",
  );
const fontNames = new Set(["latin", "ea", "cs", "sym"]);
const level = (paragraph: XmlElement): number | null => {
  const raw = value(child(paragraph, "pPr"), "lvl");
  if (raw === null) return 0;
  const n = Number(raw);
  return /^\+?\d+$/.test(raw.trim()) && Number.isInteger(n) && n >= 0 && n <= 8
    ? n
    : null;
};
const handle = (
  element: XmlElement,
  options: DiagramColorCopy,
): SlideShapeData => {
  const [snapshot] = readGroupChildren(
    elem(qname("p", "grpSp", NS.pml), { children: [element] }),
  );
  return {
    [SHAPE_ELEMENT]: element,
    [SHAPE_SLIDE]: options.sourceSlide,
    [SHAPE_SNAPSHOT]: snapshot!,
  };
};

interface FontDefault {
  readonly path: readonly number[];
  readonly fonts: XmlElement;
  readonly signature: string;
}

/**
 * Freeze implicit font defaults, not the diagram's text/layout/style graph.
 * CT_StyleReference cannot hold a typeface and dgm:txPr is a 3D vocabulary.
 * Native a:pPr/a:defRPr font members are the representable, editable defaults.
 * Resolve executed TX contributors independently of the saved drawing: cache
 * fontRef overrides must not become semantic defaults after a text edit.
 */
export const prepareDiagramFontDefaults = (
  options: DiagramColorCopy,
  sourceRoot: XmlElement,
): ReadonlyMap<PartName, readonly FontDefault[]> => {
  const resolve = createDiagramFontCopy(options);
  const plans = new Map<PartName, Map<string, FontDefault>>();
  const sources = new WeakMap<XmlElement, PartName>();
  const parents = new WeakMap<
    XmlElement,
    { parent: XmlElement | null; index: number }
  >();
  const indexed = new WeakSet<XmlElement>();
  const index = (root: XmlElement) => {
    if (indexed.has(root)) return;
    indexed.add(root);
    const pending = [root];
    parents.set(root, { parent: null, index: 0 });
    while (pending.length) {
      const element = pending.pop()!;
      for (const [i, node] of element.children.entries())
        if (node.kind === "element") {
          parents.set(node, { parent: element, index: i });
          pending.push(node);
        }
    }
  };
  const add = (
    owner: PartName,
    root: XmlElement,
    paragraph: XmlElement,
    fonts: XmlElement,
  ) => {
    index(root);
    const path: number[] = [];
    let current = paragraph;
    while (parents.get(current)!.parent) {
      const binding = parents.get(current)!;
      path.push(binding.index);
      current = binding.parent!;
    }
    path.reverse();
    const key = path.join("/");
    // Attribute order/prefix spelling do not make equivalent defaults conflict.
    const signature = JSON.stringify(
      fonts.children.map((node) => {
        const font = node as XmlElement;
        return [
          font.name.localName,
          font.attrs
            .map((a) => [
              `{${a.name.namespaceURI}}${a.name.localName}`,
              a.value,
            ])
            .sort(),
        ];
      }),
    );
    let part = plans.get(owner);
    if (!part) plans.set(owner, (part = new Map()));
    const old = part.get(key);
    if (old && old.signature !== signature)
      throw new Error(
        "cannot preserve conflicting diagram font defaults for shared semantic text",
      );
    part.set(key, { path, fonts, signature });
  };
  const fontDefaults = (
    shape: SlideShapeData,
    paragraph: XmlElement,
    owner: PartName,
  ): XmlElement => {
    const outline = level(paragraph);
    if (outline === null) return elem(qname("a", "defRPr", NS.dml));
    const minor = elem(qname("a", "defRPr", NS.dml), {
      children: [
        ["latin", "lt"],
        ["ea", "ea"],
        ["cs", "cs"],
      ].map(([name, slot]) =>
        elem(qname("a", name!, NS.dml), {
          attrs: [attr(qname("", "typeface", ""), `+mn-${slot}`)],
        }),
      ),
    });
    const reference = textFontReferenceDefaults(shape);
    const layers: Layer[] = [
      { element: minor, owner },
      ...(reference ? [reference] : []),
      ...textListStyleSources(shape)
        .reverse()
        .map((source) => ({
          element: child(listStyleLevel(source.element, outline), "defRPr"),
          owner: source.owner,
        })),
      { element: child(child(paragraph, "pPr"), "defRPr"), owner },
    ];
    // Copy only font declarations. Other native paragraph/run properties must
    // retain their original inheritance, geometry and resource ownership.
    const fonts = merge(
      layers.map(({ element, owner }) => ({
        owner,
        element:
          element &&
          elem(qname("a", "defRPr", NS.dml), {
            children: element.children.filter(
              (n) =>
                n.kind === "element" &&
                n.name.namespaceURI === NS.dml &&
                fontNames.has(n.name.localName),
            ),
          }),
      })),
      "defRPr",
      sources,
    );
    resolve(
      elem(qname("dgm", "t", NS.diagram), {
        children: [
          elem(qname("a", "p", NS.dml), {
            children: [elem(qname("a", "pPr", NS.dml), { children: [fonts] })],
          }),
        ],
      }),
    );
    // Empty/unresolved script slots remain authored and theme-dependent. Do not
    // invent supplemental-script choices or destination-bound aliases.
    fonts.children = fonts.children.filter(
      (n) =>
        n.kind === "element" &&
        !!value(n, "typeface") &&
        !/^\+m[jn]-(lt|ea|cs)$/.test(value(n, "typeface")!),
    );
    return fonts;
  };
  const frame = (element: XmlElement) => {
    const shape = handle(element, options),
      diagram = readShapeDiagram(shape);
    if (!diagram) return;
    if (diagram.data && diagram.model && diagram.layout) {
      // A lossless cache-only/partially supported diagram remains copyable.
      // Only a valid executed semantic tree can supply semantic defaults.
      const owner = diagram.data.part.name;
      const semantic: { paragraph: XmlElement; fonts: XmlElement }[] = [];
      try {
        const root = expandDiagramLayout(
          diagram.layout.root,
          readDiagramHierarchy(diagram.model),
        );
        const styles = readDiagramLayoutStyles(
          root,
          diagram.quickStyle?.root ?? null,
          null,
        );
        const list = readDiagramListStyle(diagram.layout.root);
        const pending = [root];
        while (pending.length) {
          const node = pending.pop()!;
          for (let i = node.children.length - 1; i >= 0; --i)
            pending.push(node.children[i]!);
          if (value(node.algorithm, "type") !== "tx") continue;
          const style = styles.get(node)!;
          if (style.issues.length) throw new Error(style.issues.join("; "));
          const defaults = diagramTextFontLayers(style, {
            quickOwner: diagram.quickStyle?.part.name ?? owner,
            colorOwner: owner,
            theme: () => null,
            colorMap: null,
            report: () => {},
          });
          for (const entry of readDiagramTextParagraphs(node)) {
            if (!entry.paragraph) continue;
            const local = level(entry.paragraph);
            const properties = merge(
              [
                ...defaults,
                ...diagramTextListLayers(
                  list,
                  entry.source.depth - 1,
                  diagram.layout.part.name,
                ),
                ...diagramTextListLayers(
                  child(entry.source.point.text, "lstStyle"),
                  local,
                  owner,
                ),
                { element: child(entry.paragraph, "pPr"), owner },
              ],
              "pPr",
              sources,
            );
            // PML's host styles use the projected outline level, independently
            // of the semantic paragraph's local level and diagram list depth.
            properties.attrs = properties.attrs.filter(
              (a) => a.name.namespaceURI !== "" || a.name.localName !== "lvl",
            );
            properties.attrs.push(
              attr(qname("", "lvl", ""), String(entry.level)),
            );
            const paragraph = elem(qname("a", "p", NS.dml), {
              children: [properties],
            });
            const text = elem(qname("p", "txBody", NS.pml), {
              children: [paragraph],
            });
            const projected = handle(
              elem(qname("p", "sp", NS.pml), { children: [text] }),
              options,
            );
            semantic.push({
              paragraph: entry.paragraph,
              fonts: fontDefaults(projected, paragraph, owner),
            });
          }
        }
      } catch {
        // Copy unsupported/malformed semantic definitions losslessly. Their
        // independently usable saved drawing still receives its own defaults.
        // Do not retain a partial set from an unexecutable text/layout tree.
        semantic.length = 0;
      }
      // Conflicts between valid executed uses are not malformed-input fallback:
      // reject before copying any graph rather than pick one shared default.
      for (const { paragraph, fonts } of semantic)
        add(owner, diagram.data.root, paragraph, fonts);
    }
    const saved = readDiagramDrawing(shape);
    if (!saved?.diagram.drawing) return;
    const native = saved.diagram.drawing.root;
    const owner = saved.diagram.drawing.part.name;
    // Projection renames wrappers but initially retains the exact XML tree.
    // Record native paragraph bindings before materialization adds properties.
    const bindings: [SlideShapeData, XmlElement, XmlElement][] = [];
    const pending: [XmlElement, XmlElement][] = [
      [saved.root[SHAPE_ELEMENT], child(native, "spTree", NS.diagramDrawing)!],
    ];
    while (pending.length) {
      const [projected, original] = pending.pop()!;
      if (!original) continue;
      if (
        original.name.namespaceURI === NS.diagramDrawing &&
        original.name.localName === "sp"
      ) {
        const shape = handle(projected, options);
        const sourceParagraphs = paragraphs(
          child(original, "txBody", NS.diagramDrawing),
        );
        paragraphs(textBody(projected)).forEach((p, i) =>
          bindings.push([shape, p, sourceParagraphs[i]!]),
        );
        continue;
      }
      if (
        original.name.namespaceURI !== NS.diagramDrawing ||
        !["spTree", "grpSp"].includes(original.name.localName)
      )
        continue;
      for (const [i, node] of original.children.entries()) {
        const projection = projected.children[i];
        if (node.kind === "element" && projection?.kind === "element")
          pending.push([projection, node]);
      }
    }
    materializeDiagramText(saved);
    for (const [shape, paragraph, original] of bindings)
      add(owner, native, original, fontDefaults(shape, paragraph, owner));
  };
  const pending = [sourceRoot];
  while (pending.length) {
    const element = pending.pop()!;
    const { namespaceURI: ns, localName: name } = element.name;
    if (ns === NS.pml && name === "graphicFrame") {
      frame(element);
      continue;
    }
    if (!(
      ns === NS.mc ||
      (ns === NS.pml && ["sld", "cSld", "spTree", "grpSp"].includes(name))
    ))
      continue;
    for (let i = element.children.length - 1; i >= 0; --i) {
      const node = element.children[i]!;
      if (node.kind === "element") pending.push(node);
    }
  }
  return new Map([...plans].map(([name, part]) => [name, [...part.values()]]));
};

export const applyDiagramFontDefaults = (
  root: XmlElement,
  defaults: readonly FontDefault[],
  owner: PartName,
): boolean => {
  let changed = false;
  for (const { path, fonts } of defaults) {
    if (!fonts.children.length) continue;
    changed = true;
    let paragraph = root;
    for (const i of path) paragraph = paragraph.children[i] as XmlElement;
    const properties = merge(
      [
        {
          element: elem(qname("a", "pPr", NS.dml), { children: [fonts] }),
          owner,
        },
        { element: child(paragraph, "pPr"), owner },
      ],
      "pPr",
      new WeakMap(),
    );
    const old = child(paragraph, "pPr");
    if (old) paragraph.children[paragraph.children.indexOf(old)] = properties;
    else paragraph.children.unshift(properties);
  }
  return changed;
};
