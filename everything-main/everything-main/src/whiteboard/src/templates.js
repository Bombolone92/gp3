import { board } from "./model.js";
import { searchIndex, searchWords, matchesWord } from "./libraries.js";
import { inferParents, updateConnectors } from "./scene.js";
import { newTask, statusFromTitle } from "./planning/task.js";
import { CATEGORIES, PALETTE, createKit } from "./template-library/kit.js";
import agile from "./template-library/agile.js";
import product from "./template-library/product.js";
import project from "./template-library/project.js";
import ux from "./template-library/ux.js";
import service from "./template-library/service.js";
import diagramming from "./template-library/diagramming.js";
import strategy from "./template-library/strategy.js";
import analysis from "./template-library/analysis.js";
import workshops from "./template-library/workshops.js";
import presentations from "./template-library/presentations.js";
export { CATEGORIES as TEMPLATE_CATEGORIES };
const definitions = [
  ...agile,
  ...product,
  ...project,
  ...ux,
  ...service,
  ...diagramming,
  ...strategy,
  ...analysis,
  ...workshops,
  ...presentations,
];
const categoryNames = new Map(CATEGORIES.map((c) => [c.id, c.name]));
// Catalog metadata stays cheap to search; boards are built only when used.
export const TEMPLATE_CATALOG = definitions.map(
  ({ id, category, name, description, keywords = [], playbook = false }) => ({
    id,
    categoryId: category,
    category: categoryNames.get(category),
    name,
    description,
    keywords,
    playbook,
  }),
);
const builders = new Map(definitions.map((d) => [d.id, d.build]));
const taskBoards = new Set(
  definitions.filter((d) => d.statusSync).map((d) => d.id),
);
const searchText = new Map(
  TEMPLATE_CATALOG.map((def) => [
    def.id,
    searchIndex(
      [
        ...def.name,
        ...def.description,
        ...def.category,
        ...def.keywords,
        def.playbook ? "playbook facilitation guide animation" : "",
      ].join(" "),
    ),
  ]),
);
const nameText = new Map(
  TEMPLATE_CATALOG.map((def) => [def.id, searchIndex(def.name.join(" "))]),
);
// Matches every word of the query in either language, ignoring accents.
// Templates whose name holds every word come first.
export function searchTemplates(query = "", category = "") {
  const words = searchWords(query);
  const found = TEMPLATE_CATALOG.filter(
    (def) =>
      (!category || def.categoryId === category) &&
      words.every((word) => matchesWord(searchText.get(def.id), word)),
  );
  if (!words.length) return found;
  const named = (def) =>
    words.every((word) => matchesWord(nameText.get(def.id), word));
  return [...found.filter(named), ...found.filter((def) => !named(def))];
}
const languageIndex = (lang) => (lang === "fr" ? 1 : 0);
// Text without its own color follows the theme and turns light in dark
// mode; on a light shape, note, or table it keeps dark ink instead.
const lightFill = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (
    (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 >
    0.6
  );
};
function inkOnLightFills(items) {
  const fills = [];
  for (const i of items) {
    if (
      ["rect", "ellipse", "note", "table"].includes(i.type) &&
      /^#[\da-f]{6}$/i.test(i.color || "") &&
      lightFill(i.color)
    )
      fills.push(i);
    else if (i.type === "text" && i.text && !i.textColor) {
      const x = i.x + Math.min(i.w, 40) / 2,
        y = i.y + i.h / 2;
      if (
        fills.some(
          (f) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h,
        )
      )
        i.textColor = PALETTE.ink;
    }
  }
}
export function fromTemplate(id, lang = "en") {
  const definition = TEMPLATE_CATALOG.find((t) => t.id === id);
  if (!definition)
    return board(lang === "fr" ? "Tableau sans titre" : "Untitled board");
  const kit = createKit(lang);
  builders.get(id)(kit);
  const b = board(definition.name[languageIndex(lang)]);
  b.items = kit.items;
  for (const i of b.items)
    if (
      i.lang === undefined &&
      (i.text || i.alt || i.cells?.some((row) => row.some(Boolean)))
    )
      i.lang = lang === "fr" ? "fr-CA" : "en";
  inferParents(b.items);
  updateConnectors(b.items);
  inkOnLightFills(b.items);
  // A Kanban-style template is a working board: its cards are tasks with
  // the status of their column, and moving one to another column changes
  // its status.
  if (taskBoards.has(id)) {
    b.planning = { statusSync: true };
    const columns = new Map(
      b.items.filter((i) => i.type === "frame").map((f) => [f.id, f.text]),
    );
    for (const i of b.items) {
      const status =
        i.type === "note" && statusFromTitle(columns.get(i.parentId) || "");
      if (status) i.task = newTask({ status, ...i.task });
    }
  }
  return b;
}
