import type { DiagramLayoutNode } from "./layout.ts";
import type { DiagramTextParagraph } from "./text-content.ts";
import { NS, type XmlElement, getAttrValue, qname } from "../xml/index.ts";

type Alignment = "l" | "ctr" | "r";
type VerticalAnchor = "t" | "mid" | "b";
type HorizontalAnchor = "none" | "ctr";

export interface DiagramTextParameters {
  readonly stBulletLvl: number;
  /** Percent of a line, not a multiplier or DrawingML thousandths of percent. */
  readonly lnSpPar: number;
  readonly lnSpCh: number;
  readonly lnSpAfParP: number;
  readonly lnSpAfChP: number;
  readonly parTxLTRAlign: Alignment;
  readonly parTxRTLAlign: Alignment;
  readonly shpTxLTRAlignCh: Alignment;
  readonly shpTxRTLAlignCh: Alignment;
  readonly txAnchorVert: VerticalAnchor;
  readonly txAnchorVertCh: VerticalAnchor;
  readonly txAnchorHorz: HorizontalAnchor;
  readonly txAnchorHorzCh: HorizontalAnchor;
  readonly txBlDir: "horz" | "vert";
  readonly txDir: "fromT" | "fromB";
  readonly autoTxRot: "none" | "upr" | "grav";
}

const attribute = (element: XmlElement, name: string) =>
  getAttrValue(element, qname("", name, ""));

/**
 * Defaults: MS-OE376 2.1.1688. Enum domains: ECMA-376 21.4.7.
 * Keep parameter values separate from DrawingML output (notably mid vs ctr
 * and percent numbers vs thousandths of percent).
 *
 * Native controls establish the numeric compatibility details: empty spacing
 * is zero; leading whitespace is accepted but trailing whitespace is not;
 * syntactically valid nonfinite/out-of-range spacing uses its own default.
 * Invalid lexical tokens reject the layout, rather than silently becoming zero.
 */
export const readDiagramTextParameters = (
  node: DiagramLayoutNode,
): DiagramTextParameters => {
  if (!node.algorithm || attribute(node.algorithm, "type") !== "tx")
    throw new Error("diagram text parameters require a text algorithm");
  const parameters = new Map<string, string | null>();
  for (const element of node.algorithm.children) {
    if (
      element.kind !== "element" ||
      element.name.namespaceURI !== NS.diagram ||
      element.name.localName !== "param"
    )
      continue;
    const type = attribute(element, "type");
    if (type === null) throw new Error("missing diagram parameter type");
    if (parameters.has(type))
      throw new Error(
        type === "stBulletLvl"
          ? "duplicate diagram starting bullet level"
          : `duplicate diagram text parameter ${type}`,
      );
    parameters.set(type, attribute(element, "val"));
  }
  const spacing = (type: string, fallback: number): number => {
    if (!parameters.has(type)) return fallback;
    const raw = parameters.get(type);
    if (
      raw === null ||
      raw === undefined ||
      (raw !== "" &&
        !/^[\x20\t\r\n]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(
          raw,
        ) &&
        !["INF", "-INF", "NaN"].includes(raw))
    )
      throw new Error(`invalid diagram text parameter ${type}`);
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 1000
      ? Math.max(0, value)
      : fallback;
  };
  const enumeration = <T extends string>(
    type: string,
    fallback: T,
    values: readonly T[],
  ): T => {
    if (!parameters.has(type)) return fallback;
    const raw = parameters.get(type);
    if (raw === null || raw === undefined || !values.includes(raw as T))
      throw new Error(`invalid diagram text parameter ${type}`);
    return raw as T;
  };
  let start = 2;
  if (parameters.has("stBulletLvl")) {
    const raw = parameters.get("stBulletLvl");
    start = raw ? Number(raw) : NaN;
    // Native accepts signed 16-bit integer tokens. Only 1 selects bullets at
    // the first level; all other accepted values behave like the default 2.
    if (
      !raw ||
      !/^[+-]?\d+$/.test(raw) ||
      !Number.isInteger(start) ||
      start < -32768 ||
      start > 32767
    )
      throw new Error("invalid diagram starting bullet level");
  }
  const alignments = ["l", "ctr", "r"] as const;
  const vertical = ["t", "mid", "b"] as const;
  const horizontal = ["none", "ctr"] as const;
  return {
    stBulletLvl: start,
    lnSpPar: spacing("lnSpPar", 90),
    lnSpCh: spacing("lnSpCh", 90),
    lnSpAfParP: spacing("lnSpAfParP", 35),
    lnSpAfChP: spacing("lnSpAfChP", 15),
    parTxLTRAlign: enumeration("parTxLTRAlign", "ctr", alignments),
    parTxRTLAlign: enumeration("parTxRTLAlign", "ctr", alignments),
    shpTxLTRAlignCh: enumeration("shpTxLTRAlignCh", "l", alignments),
    shpTxRTLAlignCh: enumeration("shpTxRTLAlignCh", "r", alignments),
    txAnchorVert: enumeration("txAnchorVert", "mid", vertical),
    txAnchorVertCh: enumeration("txAnchorVertCh", "t", vertical),
    txAnchorHorz: enumeration("txAnchorHorz", "none", horizontal),
    txAnchorHorzCh: enumeration("txAnchorHorzCh", "none", horizontal),
    txBlDir: enumeration("txBlDir", "horz", ["horz", "vert"]),
    txDir: enumeration("txDir", "fromT", ["fromT", "fromB"]),
    autoTxRot: enumeration("autoTxRot", "upr", ["none", "upr", "grav"]),
  };
};

/**
 * Resolve algorithm defaults before host/list/direct formatting is layered on.
 * Any selected secondary paragraph switches the WHOLE text shape to the child
 * alignment and anchors, including its primary paragraphs. Multiple paragraphs
 * alone do not do this, nor do unselected descendants or a direct pPr/lvl.
 * Spacing still follows each paragraph's semantic primary/secondary role.
 *
 * Direction is supplied by the host; auto rotation and growth direction remain
 * algorithm inputs for geometry, not bodyPr attributes to be guessed here.
 */
export const resolveDiagramTextFormatting = (
  parameters: DiagramTextParameters,
  paragraphs: readonly DiagramTextParagraph[],
  rtl: boolean,
) => {
  const children = paragraphs.some((p) => p.font === "secondary");
  const vertical = children
    ? parameters.txAnchorVertCh
    : parameters.txAnchorVert;
  const horizontal = children
    ? parameters.txAnchorHorzCh
    : parameters.txAnchorHorz;
  const alignment = children
    ? rtl
      ? parameters.shpTxRTLAlignCh
      : parameters.shpTxLTRAlignCh
    : rtl
      ? parameters.parTxRTLAlign
      : parameters.parTxLTRAlign;
  const spacing = (line: number, after: number) => ({
    alignment,
    lineSpacing: Math.round(line * 1000),
    spaceAfter: Math.round(after * 1000),
  });
  return {
    anchor: vertical === "mid" ? ("ctr" as const) : vertical,
    anchorCenter: horizontal === "ctr",
    vertical: parameters.txBlDir,
    primary: spacing(parameters.lnSpPar, parameters.lnSpAfParP),
    secondary: spacing(parameters.lnSpCh, parameters.lnSpAfChP),
  };
};
