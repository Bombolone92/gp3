// A deck can reference built-in table styles by GUID without embedding a
// definition. Construct the supported definitions from their formatting rules.
import {
  NS,
  type XmlElement,
  attr,
  elem,
  qname,
} from "../../internal/xml/index.ts";

const node = (
  name: string,
  children: XmlElement[] = [],
  attrs: Record<string, string> = {},
): XmlElement =>
  elem(qname("a", name, NS.dml), {
    attrs: Object.entries(attrs).map(([name, value]) =>
      attr(qname("", name, ""), value),
    ),
    children,
  });
const color = (slot: string, tint?: number): XmlElement =>
  node(
    "schemeClr",
    tint === undefined ? [] : [node("tint", [], { val: String(tint) })],
    { val: slot },
  );
const fill = (slot: string, tint?: number): XmlElement =>
  node("fill", [node("solidFill", [color(slot, tint)])]);
const border = (side: string, slot: string, width = 12700): XmlElement =>
  node(side, [
    node("ln", [node("solidFill", [color(slot)])], {
      w: String(width),
      cmpd: "sng",
    }),
  ]);
const text = (slot: string, bold = false): XmlElement =>
  node(
    "tcTxStyle",
    [
      node("fontRef", [node("prstClr", [], { val: "black" })], {
        idx: "minor",
      }),
      color(slot),
    ],
    bold ? { b: "on" } : {},
  );
const grid = (slot: string): XmlElement =>
  node(
    "tcBdr",
    ["left", "right", "top", "bottom", "insideH", "insideV"].map((side) =>
      border(side, slot),
    ),
  );
const mediumId = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";
const gridId = "{5940675A-B579-460E-94D1-54222C63F5DA}";
const medium = node(
  "tableStyle",
  [
    node("wholeTbl", [
      text("dk1"),
      node("tcStyle", [grid("lt1"), fill("accent1", 20000)]),
    ]),
    ...["band1H", "band1V"].map((name) =>
      node(name, [node("tcStyle", [fill("accent1", 40000)])]),
    ),
    ...["lastCol", "firstCol", "lastRow", "firstRow"].map((name) =>
      node(name, [
        text("lt1", true),
        node("tcStyle", [
          node(
            "tcBdr",
            name.endsWith("Row")
              ? [border(name === "firstRow" ? "bottom" : "top", "lt1", 38100)]
              : [],
          ),
          fill("accent1"),
        ]),
      ]),
    ),
  ],
  { styleId: mediumId, styleName: "Medium Style 2 - Accent 1" },
);
const tableGrid = node(
  "tableStyle",
  [
    node("wholeTbl", [
      text("tx1"),
      node("tcStyle", [grid("tx1"), node("fill", [node("noFill")])]),
    ]),
  ],
  { styleId: gridId, styleName: "No Style, Table Grid" },
);

// An unresolved GUID has no style; it must not acquire an accent header or
// striped rows merely because the corresponding table flags are enabled.
export const emptyTableStyle = node("tableStyle", [], {
  styleId: "{00000000-0000-0000-0000-000000000000}",
  styleName: "Unstyled table",
});
export const builtInTableStyle = (id: string): XmlElement | null =>
  id === mediumId ? medium : id === gridId ? tableGrid : null;
