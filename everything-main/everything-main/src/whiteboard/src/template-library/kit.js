import { item, uid, COLORS } from "../model.js";
// Template layouts are written once in board coordinates and built in the
// requested language. Every object is an ordinary editable board object.
export const PALETTE = {
  yellow: COLORS[0],
  green: COLORS[1],
  blue: COLORS[2],
  purple: COLORS[3],
  orange: COLORS[4],
  white: COLORS[5],
  grey: "#e6ebdf",
  ink: "#30342f",
  muted: "#687169",
  line: "#a2aaa0",
  navy: "#26374a",
  // Lines that stand out, readable on the light and the dark theme's board.
  emphasis: "#337ab7",
  red: "#f4c7c3",
};
export const CATEGORIES = [
  { id: "agile", name: ["Agile", "Agile"] },
  {
    id: "product",
    name: ["Product planning", "Planification de produit"],
  },
  { id: "ux", name: ["UX/UI design", "Conception UX/UI"] },
  {
    id: "service",
    name: ["Service design", "Conception de services"],
  },
  { id: "strategy", name: ["Strategy", "Stratégie"] },
  {
    id: "workshops",
    name: ["Workshops and facilitation", "Ateliers et animation"],
  },
  { id: "analysis", name: ["Analysis", "Analyse"] },
  {
    id: "project",
    name: ["Project management", "Gestion de projet"],
  },
  { id: "diagramming", name: ["Diagramming", "Diagrammes"] },
];
// French keeps guillemets and the space before a colon with their words,
// so « or : never wraps onto a line of its own.
const frenchSpacing = (text) =>
  typeof text === "string"
    ? text.replace(/« /g, "«\u00a0").replace(/ (»|:)/g, "\u00a0$1")
    : text;
export function createKit(lang = "en") {
  const fr = lang === "fr",
    items = [];
  let order = 0;
  const push = (i) => {
    items.push(i);
    return i;
  };
  const kit = {
    fr,
    items,
    // Picks the string for the board language.
    t: (en, french) => (fr ? frenchSpacing(french) : en),
    // Frames receive increasing presentation order in creation order.
    frame: (x, y, w, h, text, extra = {}) =>
      push(item("frame", x, y, { w, h, text, order: order++, ...extra })),
    heading: (x, y, w, text, extra = {}) =>
      push(
        item("text", x, y, {
          w,
          h: 50,
          text,
          fontSize: 34,
          bold: true,
          autoHeight: true,
          ...extra,
        }),
      ),
    text: (x, y, w, text, extra = {}) =>
      push(
        item("text", x, y, {
          w,
          h: 30,
          text,
          fontSize: 18,
          autoHeight: true,
          ...extra,
        }),
      ),
    note: (x, y, text, extra = {}) =>
      push(
        item("note", x, y, {
          w: 180,
          h: 140,
          text,
          color: PALETTE.yellow,
          ...extra,
        }),
      ),
    card: (x, y, w, h, text, extra = {}) =>
      push(
        item("rect", x, y, {
          w,
          h,
          text,
          color: PALETTE.white,
          fontSize: 16,
          autoFontSize: true,
          ...extra,
        }),
      ),
    // key is "rectangle", "ellipse", or any custom shape key in shapes.js.
    shape: (key, x, y, w, h, text = "", extra = {}) =>
      push(
        item(key === "ellipse" ? "ellipse" : "rect", x, y, {
          w,
          h,
          text,
          color: PALETTE.white,
          fontSize: 16,
          autoFontSize: true,
          ...(key !== "ellipse" && key !== "rectangle" ? { shape: key } : {}),
          ...extra,
        }),
      ),
    // Rows are 40px each unless rowHeights are given.
    table: (x, y, w, cells, extra = {}) =>
      push(
        item("table", x, y, {
          w,
          h: extra.rowHeights
            ? extra.rowHeights.reduce((sum, n) => sum + n, 0)
            : cells.length * 40,
          cells,
          color: PALETTE.white,
          fontSize: 14,
          ...extra,
        }),
      ),
    // Attached connector; positions are resolved after the layout is built.
    connect: (from, to, extra = {}) =>
      push(
        item("arrow", from.x, from.y, {
          w: 1,
          h: 1,
          startId: from.id,
          endId: to.id,
          ...extra,
        }),
      ),
    // Free line between two points, without an arrowhead by default.
    line: (x1, y1, x2, y2, extra = {}) =>
      push(
        item("arrow", x1, y1, {
          w: x2 - x1,
          h: y2 - y1,
          endCap: "none",
          ...extra,
        }),
      ),
    group: (members) => {
      const id = uid();
      for (const i of members) i.groupId = id;
      return members;
    },
  };
  return kit;
}
