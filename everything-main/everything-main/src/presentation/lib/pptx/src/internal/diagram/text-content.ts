import type { DiagramLayoutNode } from "./layout.ts";
import { readDiagramTextParameters } from "./text-parameters.ts";
import type { DiagramHierarchyNode } from "./hierarchy.ts";
import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
} from "../xml/index.ts";

export interface DiagramTextParagraph {
  readonly source: DiagramHierarchyNode;
  /** Null represents the empty paragraph of a contributor without a text body. */
  readonly paragraph: XmlElement | null;
  /** Relative data depth, including the algorithm's starting bullet level. */
  readonly hierarchyLevel: number;
  /** Authored paragraph level wins without changing the semantic font role. */
  readonly level: number;
  /** Selects algorithm-controlled font/spacing defaults, not custom run sizes. */
  readonly font: "primary" | "secondary";
}

const attribute = (element: XmlElement, name: string) =>
  getAttrValue(element, qname("", name, ""));

/**
 * Map presOf contributors to semantic paragraphs, without a saved drawing.
 * Bullet depth is relative to the shallowest selected node, including empty
 * contributors. stBulletLvl defaults to 2; 1 makes the first level secondary.
 * Other accepted integers use the default behavior, including 0
 * found in built-in layouts. Native parameter tokens are signed 16-bit integers
 * without surrounding whitespace; fractions invalidate the native layout.
 * A direct pPr/lvl changes the emitted paragraph level but does not change its
 * hierarchy-derived font, indentation or spacing defaults. Native controls
 * establish this distinction for customized and algorithm-controlled text.
 * Source XML and contributor order remain intact for styling and editing.
 */
export const readDiagramTextParagraphs = (
  node: DiagramLayoutNode,
): readonly DiagramTextParagraph[] => {
  const start = readDiagramTextParameters(node).stBulletLvl;
  if (!node.contributors.length) return [];
  let depth = Infinity;
  for (const source of node.contributors) depth = Math.min(depth, source.depth);
  const result: DiagramTextParagraph[] = [];
  for (const source of node.contributors) {
    const hierarchyLevel = source.depth - depth + (start === 1 ? 1 : 0);
    const body = source.point.text;
    const paragraphs: readonly (XmlElement | null)[] = body
      ? body.children.filter(
          (child): child is XmlElement =>
            child.kind === "element" &&
            child.name.namespaceURI === NS.dml &&
            child.name.localName === "p",
        )
      : [null];
    if (!paragraphs.length)
      throw new Error("diagram text body has no paragraphs");
    for (const paragraph of paragraphs) {
      const properties =
        paragraph && firstChildElement(paragraph, qname("", "pPr", NS.dml));
      const raw = properties ? attribute(properties, "lvl") : null;
      const level = raw === null ? Math.min(8, hierarchyLevel) : Number(raw);
      if (
        (raw !== null && !/^\+?\d+$/.test(raw.trim())) ||
        !Number.isInteger(level) ||
        level < 0 ||
        level > 8
      )
        throw new Error("invalid diagram paragraph level");
      result.push({
        source,
        paragraph,
        hierarchyLevel,
        level,
        font: hierarchyLevel === 0 ? "primary" : "secondary",
      });
    }
  }
  return result;
};
