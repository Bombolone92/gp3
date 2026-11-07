import type { PartName } from "../../internal/opc/index.ts";
import {
  NS,
  type XmlElement,
  elem,
  firstChildElement,
  qname,
  qnameEquals,
} from "../../internal/xml/index.ts";
import { cloneShapeSource } from "./shape-source.ts";
const child = (element: XmlElement | null, name: string) =>
  element && firstChildElement(element, qname("", name, NS.dml));

// CT_TextParagraphProperties / CT_TextCharacterProperties. Members of one
// choice occupy one inheritance slot: e.g. buNone cancels an inherited buChar.
const PARAGRAPH_SLOTS = [
  ["lnSpc"],
  ["spcBef"],
  ["spcAft"],
  ["buClrTx", "buClr"],
  ["buSzTx", "buSzPct", "buSzPts"],
  ["buFontTx", "buFont"],
  ["buNone", "buAutoNum", "buChar", "buBlip"],
  ["tabLst"],
  ["defRPr"],
  ["extLst"],
];
const RUN_SLOTS = [
  ["ln"],
  ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"],
  ["effectLst", "effectDag"],
  ["highlight"],
  ["uLnTx", "uLn"],
  ["uFillTx", "uFill"],
  ["latin"],
  ["ea"],
  ["cs"],
  ["sym"],
  ["hlinkClick"],
  ["hlinkMouseOver"],
  ["rtl"],
  ["extLst"],
];
export interface DiagramTextPropertyLayer {
  element: XmlElement | null;
  owner: PartName;
}

/** Merge properties, not whole paragraph styles, retaining resource owners. */
export const mergeDiagramTextProperties = (
  layers: readonly DiagramTextPropertyLayer[],
  name: "pPr" | "defRPr" | "rPr" | "endParaRPr",
  sources: WeakMap<XmlElement, PartName>,
): XmlElement => {
  const result = elem(qname("a", name, NS.dml));
  const slots = name === "pPr" ? PARAGRAPH_SLOTS : RUN_SLOTS;
  const rank = (el: XmlElement) =>
    el.name.namespaceURI === NS.dml
      ? slots.findIndex((slot) => slot.includes(el.name.localName))
      : -1;
  const propertyKey = (el: XmlElement) => {
    const index = rank(el);
    return index < 0
      ? `{${el.name.namespaceURI}}${el.name.localName}`
      : `slot:${index}`;
  };
  const properties = new Map<string, XmlElement>();
  const runDefaults: DiagramTextPropertyLayer[] = [];
  for (const { element, owner } of layers) {
    if (!element) continue;
    for (const a of element.attrs) {
      const index = result.attrs.findIndex((b) => qnameEquals(a.name, b.name));
      if (index < 0) result.attrs.push({ ...a });
      else result.attrs[index] = { ...a };
    }
    for (const [prefix, uri] of element.prefixDecls)
      result.prefixDecls.set(prefix, uri);
    for (const node of element.children) {
      if (node.kind !== "element") continue;
      if (
        name === "pPr" &&
        node.name.namespaceURI === NS.dml &&
        node.name.localName === "defRPr"
      )
        runDefaults.push({ element: node, owner });
      else
        properties.set(
          propertyKey(node),
          cloneShapeSource(node, owner, sources),
        );
    }
  }
  if (runDefaults.length) {
    const defaults = mergeDiagramTextProperties(runDefaults, "defRPr", sources);
    properties.set(propertyKey(defaults), defaults);
  }
  result.children = [...properties.values()].sort(
    (a, b) =>
      (rank(a) < 0 ? slots.length : rank(a)) -
      (rank(b) < 0 ? slots.length : rank(b)),
  );
  return result;
};

export const diagramTextListLayers = (
  list: XmlElement | null,
  level: number | null,
  owner: PartName,
): DiagramTextPropertyLayer[] => [
  { element: child(list, "defPPr"), owner },
  {
    element:
      level !== null && Number.isInteger(level) && level >= 0 && level <= 8
        ? child(list, `lvl${level + 1}pPr`)
        : null,
    owner,
  },
];
