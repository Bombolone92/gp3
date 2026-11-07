import type { PartName } from "../../internal/opc/index.ts";
import type { DiagramLayoutNode } from "../../internal/diagram/layout.ts";
import { readDiagramTextParagraphs } from "../../internal/diagram/text-content.ts";
import {
  readDiagramTextParameters,
  resolveDiagramTextFormatting,
} from "../../internal/diagram/text-parameters.ts";
import {
  NS,
  type XmlElement,
  attr,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";
import { cloneShapeSource } from "./shape-source.ts";

export interface DiagramTextBodyOptions {
  readonly dataOwner: PartName;
  /** Realized margin constraints in points, before conversion to DrawingML. */
  readonly margins: Readonly<Record<"l" | "r" | "t" | "b", number>>;
  /** Host-resolved direction, shared with paragraph projection. */
  readonly rtl?: boolean;
}

/**
 * Project semantic TX body properties without consulting a saved drawing.
 * Authored body formatting comes from the first presOf contributor,
 * independently of custT. An absent first body does not select a later one.
 * Authored properties override algorithm defaults except wrapping, columns,
 * outer paragraph spacing and autofit, which remain algorithm-controlled.
 *
 * Retain body extensions, text warps and 3D properties with their provenance.
 * This does not calculate geometry-dependent autoTxRot or grDir placement;
 * the layout stage must apply those to the completed text shape.
 */
export const projectDiagramTextBodyProperties = (
  node: DiagramLayoutNode,
  options: DiagramTextBodyOptions,
  sources: WeakMap<XmlElement, PartName>,
): XmlElement => {
  const text = node.contributors[0]?.point.text;
  const authored = text && firstChildElement(text, qname("", "bodyPr", NS.dml));
  const body = authored
    ? cloneShapeSource(authored, options.dataOwner, sources)
    : elem(qname("a", "bodyPr", NS.dml));
  const formatting = resolveDiagramTextFormatting(
    readDiagramTextParameters(node),
    readDiagramTextParagraphs(node),
    options.rtl ?? false,
  );
  const defaults: Record<string, string | number> = {
    // Diagram text defaults to false; ordinary PML shapes default to true.
    compatLnSpc: 0,
    vert: formatting.vertical,
    anchor: formatting.anchor,
    anchorCtr: Number(formatting.anchorCenter),
  };
  for (const side of ["l", "r", "t", "b"] as const) {
    const margin = options.margins[side];
    // Negative constraints remain available to references, but emit zero
    // insets. Direct authored insets are signed ST_Coordinate32 and survive.
    const emu = Math.round(Math.max(0, margin) * 12700);
    if (
      !Number.isFinite(margin) ||
      !Number.isSafeInteger(emu) ||
      emu > 2147483647
    )
      throw new Error("invalid diagram text margin");
    defaults[`${side}Ins`] = emu;
  }
  for (const [name, value] of Object.entries(defaults))
    if (getAttrValue(body, qname("", name, "")) === null)
      body.attrs.push(attr(qname("", name, ""), String(value)));
  for (const [name, value] of Object.entries({
    wrap: "square",
    numCol: "1",
    spcCol: "1270",
    spcFirstLastPara: "0",
  })) {
    const index = body.attrs.findIndex(
      (a) => a.name.namespaceURI === "" && a.name.localName === name,
    );
    const property = attr(qname("", name, ""), value);
    if (index < 0) body.attrs.push(property);
    else body.attrs[index] = property;
  }
  body.children = body.children.filter(
    (child) =>
      child.kind !== "element" ||
      child.name.namespaceURI !== NS.dml ||
      !["noAutofit", "normAutofit", "spAutoFit"].includes(child.name.localName),
  );
  // CT_TextBodyProperties places autofit after prstTxWarp and before 3D/extLst.
  const warp = firstChildElement(body, qname("", "prstTxWarp", NS.dml));
  body.children.splice(
    warp ? body.children.indexOf(warp) + 1 : 0,
    0,
    elem(qname("a", "noAutofit", NS.dml)),
  );
  return body;
};
