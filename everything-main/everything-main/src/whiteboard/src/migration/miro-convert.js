import {
  item,
  uid,
  imageSize,
  validateBoard,
  bounds,
  MAX_OBJECTS,
} from "../model.js";
import { TAG_LIMIT, TAG_COLORS, tagKey } from "../tags.js";
import { canRotateItem, normalizeRotation } from "../geometry.js";
import { appendRun } from "../rich-text.js";
import { MAX_LIST_INDENT } from "../text-blocks.js";
import { inkOn, textLinkURL } from "../text-link-data.js";
import { updateConnectors, safeURL, orderedFrames } from "../scene.js";
import { normalizeEmbed, providerName } from "../content/providers.js";
import { parseText } from "../content/text-import.js";
import { applyMindLayout, repairMindTrees, trimMindMap } from "../mind-map.js";

// Converts Miro REST API v2 board content into this app's board model. The
// functions are pure apart from the injected downloaders, so a dry run and a
// real migration produce the same board and report.

export const MIRO_LIMITS = {
  objects: MAX_OBJECTS,
  // A larger board becomes several, up to this many: Miro's own limit of
  // 100,000 objects.
  parts: 20,
  text: 20000,
  title: 200,
  tags: 1000,
  tagName: 64,
  imageBytes: 5 * 1024 * 1024,
  imagePixels: 40_000_000,
  fileBytes: 10 * 1024 * 1024,
  importBytes: 100 * 1024 * 1024,
  coordinate: 1e6,
};

// Miro's named sticky, shape and frame colors, as shown in its palette.
// This and the other lookup tables below have no prototype, so values such
// as "constructor" from Miro are unknown names rather than functions.
export const MIRO_COLORS = {
  __proto__: null,
  gray: "#e6e6e6",
  light_yellow: "#fff9b1",
  yellow: "#f5d128",
  orange: "#ff9d48",
  light_green: "#d5f692",
  green: "#c9df56",
  dark_green: "#93d275",
  cyan: "#67c6c0",
  light_pink: "#ffcee0",
  pink: "#ea94bb",
  violet: "#c6a2d2",
  red: "#f0939d",
  light_blue: "#a6ccf5",
  blue: "#6cd8fa",
  dark_blue: "#9ea9ff",
  black: "#1a1a1a",
  white: "#ffffff",
  magenta: "#ea94bb",
};
// Miro tag colors map onto the app's readable tag palette in the same order.
const TAG_COLOR_NAMES = [
  "red",
  "light_green",
  "cyan",
  "yellow",
  "magenta",
  "green",
  "blue",
  "gray",
  "violet",
  "dark_green",
  "dark_blue",
  "black",
];

// Shapes this app draws exactly, then close approximations. Anything else
// becomes a rectangle with a warning.
const SHAPE_MAP = {
  __proto__: null,
  rectangle: "rect",
  square: "rect",
  round_rectangle: "rect",
  flow_chart_process: "rect",
  circle: "ellipse",
  ellipse: "ellipse",
  oval: "ellipse",
  flow_chart_connector: "ellipse",
  triangle: "triangle",
  rhombus: "diamond",
  diamond: "diamond",
  flow_chart_decision: "diamond",
  parallelogram: "parallelogram",
  flow_chart_input_output: "parallelogram",
  hexagon: "hexagon",
  flow_chart_preparation: "hexagon",
  star: "star",
  can: "cylinder",
  cylinder: "cylinder",
  flow_chart_magnetic_disk: "cylinder",
  flow_chart_terminator: "terminator",
  pill: "terminator",
  // Flowchart and diagram shapes from the shape library.
  flow_chart_document: "document",
  flow_chart_multidocuments: "multi-document",
  flow_chart_multidocument: "multi-document",
  flow_chart_predefined_process: "predefined-process",
  flow_chart_predefined_process_2: "predefined-process",
  flow_chart_manual_input: "manual-input",
  flow_chart_manual_operation: "manual-operation",
  flow_chart_delay: "delay",
  flow_chart_display: "display",
  flow_chart_off_page_connector: "off-page",
  flow_chart_offpage_connector: "off-page",
  flow_chart_or: "or",
  flow_chart_summing_junction: "summing-junction",
  flow_chart_internal_storage: "internal-storage",
  flow_chart_merge: "merge",
  cloud: "cloud",
};
const SHAPE_APPROXIMATIONS = {
  __proto__: null,
  wedge_round_rectangle_callout: "rect",
  trapezoid: "parallelogram",
  flow_chart_data: "parallelogram",
  pentagon: "hexagon",
  octagon: "hexagon",
  flow_chart_online_storage: "cylinder",
  flow_chart_magnetic_drum: "cylinder",
};
const FONT_MAP = {
  __proto__: null,
  eb_garamond: "eb-garamond",
  georgia: "eb-garamond",
  times_new_roman: "eb-garamond",
  pt_serif: "eb-garamond",
  roboto_slab: "eb-garamond",
  plex_serif: "eb-garamond",
  tiempos_text: "eb-garamond",
  roboto_mono: "roboto-mono",
  plex_mono: "roboto-mono",
  caveat: "caveat",
  permanent_marker: "caveat",
  lemon_tuesday: "caveat",
  noto_sans: "noto-sans",
  open_sans: "noto-sans",
};
const LINE_TYPES = {
  __proto__: null,
  straight: "straight",
  elbowed: "elbow",
  curved: "curved",
};
const LINE_STYLES = {
  __proto__: null,
  normal: "solid",
  dashed: "dashed",
  dotted: "dotted",
};
// Miro's connector ends and the ones drawn here; an end with no match is
// drawn as an arrowhead and reported.
const CAPS = {
  __proto__: null,
  none: "none",
  oval: "circle-open",
  filled_oval: "circle",
  arrow: "arrow",
  stealth: "arrow",
  rounded_stealth: "arrow",
  triangle: "triangle-open",
  filled_triangle: "triangle",
  diamond: "diamond-open",
  filled_diamond: "diamond",
  erd_one: "bar",
  erd_only_one: "bar",
  erd_many: "crowfoot",
  erd_one_or_many: "crowfoot",
  erd_zero_or_many: "crowfoot",
};
const DEFAULT_SIZES = {
  __proto__: null,
  sticky_note: [199, 228],
  text: [280, 60],
  shape: [200, 120],
  frame: [800, 600],
  image: [300, 200],
  card: [320, 94],
  app_card: [320, 94],
  document: [280, 115],
  embed: [280, 115],
  preview: [280, 115],
  doc_format: [600, 400],
  mindmap_node: [200, 76],
};
export const SUPPORTED_ITEM_TYPES = Object.keys(DEFAULT_SIZES);

// Report issue templates. Codes stay stable for logs; the UI translates the
// English template before substituting the named values.
export const ISSUE_TEXT = {
  "unsupported-type":
    "Miro item type {type} could not be copied. A placeholder linking to it on the Miro board was added in its place.",
  "table-unavailable":
    "Miro's API does not provide the cells of tables, so a table was not copied. A placeholder linking to it on the Miro board was added in its place.",
  "comments-unavailable":
    "Miro's API does not provide comments, so comments on this board were not copied. Review them in Miro.",
  "groups-unavailable":
    "Miro did not list this board's groups, so its objects were copied ungrouped.",
  "mindmaps-unavailable":
    "Miro did not list this board's mind maps, so they were not copied.",
  "tags-unavailable":
    "Miro did not list which objects carry some tags, so those tags may be missing from objects.",
  "group-partial":
    "Part of a group was not copied; the objects that were copied stay grouped.",
  "group-overlap":
    "An object belonged to more than one group and was kept in the first.",
  "mindmap-parent-missing":
    "A mind map node's parent was not found, so the node starts its own mind map.",
  "mindmap-placed":
    "Miro gave no position for a mind map, so it was laid out automatically.",
  "out-of-range": "The object is outside the supported board area.",
  "invalid-object": "The object could not be converted: {reason}",
  "shape-approximated": "Shape {shape} was approximated as {target}.",
  "shape-unknown": "Unknown shape {shape} became a rectangle.",
  "text-truncated": "Text was shortened to 20,000 characters.",
  "rotation-dropped": "Rotation is not supported for this object type.",
  "fill-transparent":
    "A shape without a fill became white and was placed behind other objects.",
  "image-failed":
    "Image {title} could not be copied ({reason}). A placeholder was added.",
  "document-link":
    "Document {title} was added as a link; its file was not copied.",
  "document-failed":
    "Document {title} could not be copied ({reason}). A link was added instead.",
  "link-invalid": "Link {url} is not a web address. A text card was added.",
  "tags-truncated": "Only the first 8 tags were kept on an object.",
  "tags-as-text":
    "Tags are kept only on sticky notes, so this object's tags were added to its text.",
  "tag-unknown": "An object referenced a tag that is not on the board.",
  "tag-catalog-truncated": "Only the first 1,000 board tags were kept.",
  "tag-merged": "Tag {name} duplicated another tag and was merged.",
  "tag-invalid": "A tag without a usable name was skipped.",
  "nested-frame":
    "A frame inside another frame kept its position but is no longer nested.",
  "frame-fill":
    "Frames here have no background color, so this frame's background ({color}) is not shown.",
  "parent-missing":
    "An object's parent was not found; its position may be approximate.",
  "connector-frame-endpoint":
    "A connector attached to a frame now has a free endpoint.",
  "connector-endpoint-missing":
    "A connector endpoint was not migrated and is now free.",
  "connector-self": "Connectors from an object to itself are not supported.",
  "connector-endpoints": "Neither connector endpoint could be placed.",
  "connector-captions": "Several connector captions were combined into one.",
  "cap-approximated": "Line end {cap} was approximated.",
  "over-limit":
    "This board has {count} objects after conversion, more than 20 boards of 5,000 objects hold. Split it in Miro (for example by frame) and migrate the parts.",
  "board-split":
    "This board has {count} objects, more than the 5,000 a board holds, so it was migrated as {parts} boards. Each frame, group and mind map is kept whole on one of them.",
  "connector-split":
    "{count} connectors joined objects now on different boards; each stays on the board of its start, with a free end.",
  "board-large":
    "The converted board is about {size} MB; boards over 100 MB may not open or export.",
  "board-invalid": "The converted board failed validation: {reason}",
};
// Reasons are short messages from the migration itself, so they are
// translated too; names and titles stay as written.
export function formatIssue(issue, translate = (s) => s) {
  const template = ISSUE_TEXT[issue.code] || issue.code;
  return translate(template).replace(/\{(\w+)\}/g, (_, key) => {
    const value = issue.params?.[key];
    if (value == null) return "";
    return key === "reason" ? translate(String(value)) : String(value);
  });
}

export const DEFAULT_LABELS = {
  untitled: "Untitled board",
  part: "{title} ({n} of {total})",
  assignee: "Assignee",
  due: "Due",
  status: "Status",
  imageUnavailable: "Image not migrated",
  document: "Document",
  tags: "Tags",
  table: "Table",
  notCopied: "Not copied from Miro. Open the link to see it on the Miro board.",
};
// Miro items whose content its API does not provide.
const TABLE_TYPES = new Set(["table", "data_table_format"]);

const num = (value, fallback = 0) => {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Returns #rrggbb for a Miro named or hex color, the fallback for
// unrecognized values, and clear (the fallback unless given) for
// transparent ones.
export function miroColor(value, fallback = null, clear = fallback) {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase().replace(/-/g, "_");
  if (!v) return fallback;
  if (v === "transparent") return clear;
  if (MIRO_COLORS[v]) return MIRO_COLORS[v];
  let m = v.match(/^#?([\da-f])([\da-f])([\da-f])$/);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  m = v.match(/^#?([\da-f]{6})([\da-f]{2})?$/);
  if (m) return m[2] === "00" ? clear : `#${m[1]}`;
  m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (m) {
    if (m[4] !== undefined && +m[4] === 0) return clear;
    return `#${m
      .slice(1, 4)
      .map((c) => clamp(+c, 0, 255).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return fallback;
}
// A color drawn at this opacity over white, as an opaque color.
function onWhite(hex, opacity) {
  if (opacity >= 1) return hex;
  return `#${[1, 3, 5]
    .map((n) =>
      Math.round(255 - (255 - parseInt(hex.slice(n, n + 2), 16)) * opacity)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
export function miroTagColor(value) {
  const n = TAG_COLOR_NAMES.indexOf(String(value || "").toLowerCase());
  return TAG_COLORS[n >= 0 ? n : 7];
}
// Mixes a strong accent color with white so card text stays readable.
function tint(hex, amount = 0.78) {
  const c = [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16));
  return `#${c
    .map((v) =>
      Math.round(v + (255 - v) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
export function miroShape(name) {
  const key = String(name || "rectangle").toLowerCase();
  const exact = SHAPE_MAP[key],
    value = exact || SHAPE_APPROXIMATIONS[key];
  if (!value) return { type: "rect", unknown: true };
  const result =
    value === "rect" || value === "ellipse"
      ? { type: value }
      : { type: "rect", shape: value };
  if (!exact) result.approximate = true;
  return result;
}
export const miroFontSize = (value, fallback) => {
  const n = num(value, NaN);
  return Number.isFinite(n) ? clamp(Math.round(n), 8, 100) : fallback;
};
const alignment = (value) =>
  ["left", "center", "right"].includes(value) ? value : undefined;
const verticalAlignment = (value) =>
  ["top", "middle", "bottom"].includes(value) ? value : undefined;

// Without a prototype, names such as &constructor; stay as written.
const ENTITIES = {
  __proto__: null,
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  bull: "\u2022",
  middot: "\u00b7",
  laquo: "\u00ab",
  raquo: "\u00bb",
  oelig: "\u0153",
  OElig: "\u0152",
  aelig: "\u00e6",
  AElig: "\u00c6",
  szlig: "\u00df",
  oslash: "\u00f8",
  Oslash: "\u00d8",
  thinsp: "\u2009",
  ensp: "\u2002",
  emsp: "\u2003",
  shy: "\u00ad",
  sbquo: "\u201a",
  bdquo: "\u201e",
  lsaquo: "\u2039",
  rsaquo: "\u203a",
  prime: "\u2032",
  Prime: "\u2033",
  dagger: "\u2020",
  Dagger: "\u2021",
  sect: "\u00a7",
  para: "\u00b6",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  euro: "\u20ac",
  pound: "\u00a3",
  yen: "\u00a5",
  cent: "\u00a2",
  deg: "\u00b0",
  micro: "\u00b5",
  plusmn: "\u00b1",
  times: "\u00d7",
  divide: "\u00f7",
  minus: "\u2212",
  permil: "\u2030",
  ne: "\u2260",
  le: "\u2264",
  ge: "\u2265",
  asymp: "\u2248",
  infin: "\u221e",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  sup1: "\u00b9",
  sup2: "\u00b2",
  sup3: "\u00b3",
  larr: "\u2190",
  uarr: "\u2191",
  rarr: "\u2192",
  darr: "\u2193",
  harr: "\u2194",
  lArr: "\u21d0",
  rArr: "\u21d2",
  hArr: "\u21d4",
  check: "\u2713",
  iexcl: "\u00a1",
  iquest: "\u00bf",
};
// Accented letters such as &eacute; and &Eacute; keep the letter's case.
const ACCENTS = {
  acute: "\u0301",
  grave: "\u0300",
  circ: "\u0302",
  uml: "\u0308",
  cedil: "\u0327",
  tilde: "\u0303",
  ring: "\u030a",
};
function accented(name) {
  const m = /^([a-zA-Z])(acute|grave|circ|uml|cedil|tilde|ring)$/.exec(name);
  const letter = m && (m[1] + ACCENTS[m[2]]).normalize("NFC");
  return letter?.length === 1 ? letter : undefined;
}
export function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "";
    }
    return (
      ENTITIES[name] ?? accented(name) ?? ENTITIES[name.toLowerCase()] ?? whole
    );
  });
}
// The attribute itself, not one whose name ends in it, as data-href does.
const attribute = (attrs, name) => {
  const m = attrs.match(
    new RegExp(
      `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i",
    ),
  );
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : null;
};
const BLOCKS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "li",
  "tr",
]);
const INLINE = {
  __proto__: null,
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  u: "underline",
  s: "strike",
  strike: "strike",
  del: "strike",
};
// Real markup nests a few levels deep. Deeper inline tags are ignored, so a
// run of unclosed ones cannot make every piece of text or closing tag scan a
// long stack, which would take quadratic time.
const MAX_NESTING = 100;

// Comments and script, style, and template elements, which show nothing.
// Searched with indexOf, and each kind of closing tag is looked for past a
// point once, so unclosed ones cannot take quadratic time.
function withoutHidden(html) {
  let out = "",
    at = 0;
  for (let n; (n = html.indexOf("<!--", at)) >= 0;) {
    const end = html.indexOf("-->", n + 4);
    if (end < 0) break;
    out += html.slice(at, n);
    at = end + 3;
  }
  html = out + html.slice(at);
  const open = /<(script|style|template)\b/gi,
    unclosed = new Set();
  out = "";
  at = 0;
  for (let m; (m = open.exec(html));) {
    const tag = m[1].toLowerCase();
    if (unclosed.has(tag)) continue;
    const close = new RegExp(`</${tag}\\s*>`, "gi");
    close.lastIndex = open.lastIndex;
    const end = close.exec(html);
    if (!end) {
      unclosed.add(tag);
      continue;
    }
    out += html.slice(at, m.index);
    at = open.lastIndex = close.lastIndex;
  }
  return out + html.slice(at);
}

// A text or highlight color written as hex or rgb() in a style attribute.
// Color names are left out: Miro's palette names other colors than CSS's.
const spanColor = (value) =>
  /^\s*(#|rgba?\()/.test(value || "") ? miroColor(value, null, null) : null;
// Converts Miro's HTML text into plain text with the app's rich text runs
// (bold, italic, underline, strike, colors, highlights, links) and list
// blocks. Paragraphs and
// <br> become line breaks; unknown markup is dropped, never interpreted.
export function htmlToRichText(html) {
  html = typeof html === "string" ? html : "";
  if (!/[<&]/.test(html))
    return finishRich(html.replace(/\r\n?/g, "\n"), [], []);
  html = withoutHidden(html);
  let text = "";
  const runs = [],
    blocks = [],
    styles = [],
    lists = [],
    openBlocks = [],
    openCounts = new Map();
  let space = false,
    cells = 0,
    rowCells = 0;
  const atLineStart = () => !text || text.endsWith("\n");
  const newline = () => {
    space = false;
    if (!atLineStart()) text += "\n";
  };
  // The merged style is kept until an inline tag opens or closes.
  let merged = null;
  const style = () =>
    (merged ??= Object.assign({}, ...styles.map((s) => s.style)));
  const addBlock = (list, indent) => {
    newline();
    const block = {
      start: text.length,
      list,
      indent: clamp(indent, 0, MAX_LIST_INDENT),
    };
    if (blocks.at(-1)?.start === block.start) blocks[blocks.length - 1] = block;
    else blocks.push(block);
  };
  // After the last ">" no tag can end, so the rest is read as text without
  // looking for one; a run of unclosed tags would otherwise take quadratic
  // time.
  const lastTag = html.lastIndexOf(">");
  const token = /<(\/?)([a-z][\w-]*)([^>]*?)(\/?)>|([^<]+)|</gi,
    plain = /()()()()([^<]+)|</g;
  let m,
    at = 0;
  while (true) {
    const next = at > lastTag ? plain : token;
    next.lastIndex = at;
    if (!(m = next.exec(html))) break;
    at = next.lastIndex;
    if ((m[5] !== undefined || m[0] === "<") && openCounts.get("pre")) {
      // Preformatted text, such as code, keeps its spacing and lines; a
      // line break just after the opening tag is not part of it.
      let chunk = decodeEntities(m[5] ?? "<").replace(/\r\n?/g, "\n");
      if (text.length === openBlocks.at(-1)?.start && chunk[0] === "\n")
        chunk = chunk.slice(1);
      chunk = chunk.replace(/\u00a0/g, " ");
      if (!chunk) continue;
      if (space && !atLineStart()) text += " ";
      space = false;
      const start = text.length;
      text += chunk;
      appendRun(runs, start, text.length, style());
      continue;
    }
    if (m[5] !== undefined || m[0] === "<") {
      // Collapse source whitespace like a browser, but keep &nbsp; spacing.
      const collapsed = (m[5] ?? "<").replace(/[\t\r\n ]+/g, " ");
      const chunk = decodeEntities(collapsed.replace(/^ +| +$/g, "")).replace(
        /\u00a0/g,
        " ",
      );
      if (collapsed.startsWith(" ") && !space) space = style();
      if (!chunk) continue;
      if (space && !atLineStart()) {
        text += " ";
        appendRun(runs, text.length - 1, text.length, space);
      }
      const start = text.length;
      text += chunk;
      appendRun(runs, start, text.length, style());
      space = collapsed.endsWith(" ") && style();
      continue;
    }
    const closing = !!m[1],
      tag = m[2].toLowerCase(),
      attrs = m[3] || "";
    if (tag === "br" && !cells) {
      text += "\n";
      space = false;
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      // Text after a list starts its own line, not the last item's.
      newline();
      if (closing) lists.pop();
      else lists.push(tag === "ol" ? "number" : "bullet");
      continue;
    }
    if (INLINE[tag] || tag === "a" || tag === "span") {
      if (closing) {
        const n = styles.findLastIndex((s) => s.tag === tag);
        if (n >= 0) {
          styles.splice(n, 1);
          merged = null;
        }
      } else if (!m[4] && styles.length < MAX_NESTING) {
        const value = {};
        if (INLINE[tag]) value[INLINE[tag]] = true;
        if (tag === "a") {
          const url = textLinkURL(attribute(attrs, "href"));
          if (url) value.link = url;
        }
        const css = (attribute(attrs, "style") || "").toLowerCase();
        if (/font-weight\s*:\s*(bold|[6-9]00)/.test(css)) value.bold = true;
        if (/font-style\s*:\s*italic/.test(css)) value.italic = true;
        if (/text-decoration[^;]*underline/.test(css)) value.underline = true;
        if (/text-decoration[^;]*line-through/.test(css)) value.strike = true;
        const ink = spanColor(/(?:^|;)\s*color\s*:([^;]*)/.exec(css)?.[1]),
          mark = spanColor(
            /(?:^|;)\s*background(?:-color)?\s*:([^;]*)/.exec(css)?.[1],
          );
        if (ink) value.textColor = ink;
        if (mark) value.highlight = mark;
        styles.push({ tag, style: value });
        merged = null;
      }
      continue;
    }
    // A table row is one line with its cells separated, as in Markdown
    // Docs; paragraphs and breaks inside a cell become spaces.
    if (tag === "td" || tag === "th") {
      if (closing) cells = Math.max(0, cells - 1);
      else {
        if (rowCells++) text += " | ";
        cells++;
      }
      space = false;
      continue;
    }
    if (cells && tag !== "tr" && (BLOCKS.has(tag) || tag === "br")) {
      if (!atLineStart() && !text.endsWith(" | ")) space ||= {};
      continue;
    }
    // Cells may be left unclosed; a row or table boundary ends them.
    if (tag === "tr" || tag === "table") cells = rowCells = 0;
    if (!BLOCKS.has(tag)) continue;
    if (!closing) {
      if (tag === "li") {
        // Quill-based markup keeps list kinds and indents on each item.
        const kind = attribute(attrs, "data-list"),
          indent = (attribute(attrs, "class") || "").match(/ql-indent-(\d+)/);
        const list =
          kind === "bullet"
            ? "bullet"
            : kind === "ordered"
              ? "number"
              : lists.at(-1) || "bullet";
        addBlock(
          list,
          Math.max(0, lists.length - 1) + (indent ? +indent[1] : 0),
        );
      } else newline();
      openBlocks.push({ tag, start: text.length });
      openCounts.set(tag, (openCounts.get(tag) || 0) + 1);
    } else {
      // Closing tags that match nothing open are skipped without a scan.
      if (!openCounts.get(tag)) continue;
      const n = openBlocks.findLastIndex((b) => b.tag === tag);
      const closed = openBlocks.splice(n),
        [block] = closed;
      for (const b of closed) openCounts.set(b.tag, openCounts.get(b.tag) - 1);
      // An empty paragraph is a deliberate blank line.
      if (text.length === block.start && ["p", "div"].includes(tag) && text)
        text += "\n";
      else if (tag !== "li") newline();
    }
  }
  return finishRich(text, runs, blocks);
}
function finishRich(text, runs, blocks) {
  text = text.replace(/[ \n]+$/, "");
  return limitRich({ text, runs, blocks }, Infinity);
}
// Shortens rich text to a limit without splitting a surrogate pair, and keeps
// only runs and list blocks that remain valid for the shortened text.
export function limitRich(rich, max = MIRO_LIMITS.text) {
  let text = rich.text;
  let truncated = false;
  if (text.length > max) {
    let cut = max;
    if (/[\uD800-\uDBFF]/.test(text[cut - 1])) cut--;
    text = text.slice(0, cut);
    truncated = true;
  }
  const runs = [];
  for (const r of rich.runs || []) {
    const end = Math.min(r.end, text.length);
    if (end > r.start && Object.keys(r.style).length)
      runs.push({ start: r.start, end, style: { ...r.style } });
  }
  const blocks = text
    ? (rich.blocks || []).filter(
        (b) =>
          b.start < text.length &&
          (b.start === 0 || text[b.start - 1] === "\n"),
      )
    : [];
  return { text, runs, blocks, truncated };
}
export const htmlToText = (html) => htmlToRichText(html).text;

// Joins rich parts with line breaks, offsetting their runs and list blocks.
function joinRich(parts) {
  let text = "";
  const runs = [],
    blocks = [];
  for (const part of parts.filter((p) => p && p.text)) {
    if (text) text += "\n";
    const offset = text.length;
    text += part.text;
    for (const r of part.runs || [])
      runs.push({
        start: r.start + offset,
        end: r.end + offset,
        style: r.style,
      });
    for (const b of part.blocks || [])
      blocks.push({ ...b, start: b.start + offset });
  }
  return { text, runs, blocks };
}
const plain = (text, style) => ({
  text,
  runs: text && style ? [{ start: 0, end: text.length, style }] : [],
  blocks: [],
});

// A Miro Doc's content, which Miro gives as HTML or as Markdown. Markdown
// headings become bold lines, list items list blocks, and table rows lines
// with their cells separated by bars.
export function docToRichText(data = {}) {
  const content = typeof data.content === "string" ? data.content : "";
  if (data.contentType !== "markdown") return htmlToRichText(content);
  let blocks;
  try {
    ({ blocks } = parseText(content, { markdown: true }));
  } catch {
    return plain(content.replace(/\r\n?/g, "\n").trim());
  }
  return joinRich(
    blocks.flatMap((b) =>
      b.type === "heading"
        ? [plain(b.text, { bold: true })]
        : b.type === "table"
          ? b.rows.map((row) => plain(row.join(" | ")))
          : [
              {
                text: b.text,
                runs: [],
                blocks: b.list ? [{ start: 0, list: "bullet", indent: 0 }] : [],
              },
            ],
    ),
  );
}

// Applies converted text, truncating to the object text limit.
function applyText(target, rich, issue, source) {
  const limited = limitRich(rich);
  if (limited.truncated) issue("text-truncated", source);
  target.text = limited.text;
  if (limited.runs.length) target.textRuns = limited.runs;
  if (limited.blocks.length) target.textBlocks = limited.blocks;
}

const toBytes = (value) =>
  value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : null;
export function base64(bytes) {
  let binary = "";
  for (let n = 0; n < bytes.length; n += 0x8000)
    binary += String.fromCharCode.apply(null, bytes.subarray(n, n + 0x8000));
  return btoa(binary);
}
export function imageMime(bytes) {
  const b = (n) => bytes[n];
  if (
    bytes.length > 8 &&
    b(0) === 0x89 &&
    b(1) === 0x50 &&
    b(2) === 0x4e &&
    b(3) === 0x47
  )
    return "image/png";
  if (bytes.length > 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff)
    return "image/jpeg";
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}
// Returns an embeddable PNG/JPEG/WebP data URL within the app's image limits,
// or throws a short reason used in the placeholder warning.
export function embedImage(data) {
  const bytes = toBytes(data?.bytes ?? data);
  if (!bytes?.length) throw Error("empty download");
  if (bytes.length > MIRO_LIMITS.imageBytes) throw Error("larger than 5 MB");
  const mime = imageMime(bytes);
  if (!mime) throw Error("unsupported format");
  const src = `data:${mime};base64,${base64(bytes)}`;
  // Metadata such as a colour profile can fill the start of a photo.
  const size = imageSize(src) || imageSize(src, Infinity);
  if (!size?.width || !size?.height) throw Error("unreadable image");
  if (size.width * size.height > MIRO_LIMITS.imagePixels)
    throw Error("more than 40 million pixels");
  return { src, ...size };
}

// Resolves Miro item centers to absolute board coordinates. Children of a
// frame are positioned from the parent's top-left corner.
function positions(items, issue) {
  const byId = new Map(items.map((i) => [String(i.id), i])),
    cache = new Map();
  const size = (i) => {
    const [dw, dh] = DEFAULT_SIZES[i.type] || [200, 120];
    const w = num(i.geometry?.width, NaN),
      h = num(i.geometry?.height, NaN);
    if (Number.isFinite(w) && Number.isFinite(h)) return { w, h };
    if (Number.isFinite(w)) return { w, h: (w * dh) / dw };
    if (Number.isFinite(h)) return { w: (h * dw) / dh, h };
    return { w: dw, h: dh };
  };
  const center = (i, seen = new Set()) => {
    const id = String(i.id);
    if (cache.has(id)) return cache.get(id);
    const p = i.position || {};
    let x = num(p.x),
      y = num(p.y);
    if (p.origin && p.origin !== "center") {
      const s = size(i);
      x += s.w / 2;
      y += s.h / 2;
    }
    if (p.relativeTo === "parent_top_left") {
      const parent = i.parent?.id != null && byId.get(String(i.parent.id));
      if (parent && !seen.has(id)) {
        seen.add(id);
        const c = center(parent, seen),
          s = size(parent);
        x += c.x - s.w / 2;
        y += c.y - s.h / 2;
      } else issue("parent-missing", i);
    }
    const result = { x, y };
    cache.set(id, result);
    return result;
  };
  return { byId, size, center };
}

// Converts one Miro board. `content` is { board, items, connectors, tags }
// as returned by the Miro client. Options:
//   fetchImage(url, { signal }) and fetchFile(url, { signal }) resolve to
//   bytes or { bytes, contentType }; users maps Miro user IDs to { name };
//   cardsAs is "note" (default) or "rect"; labels localizes generated text.
// Returns { board, report }. board is null when the result cannot be saved,
// for example above the 5,000-object limit; report.errors explains why.
export async function convertMiroBoard(content, options = {}) {
  const {
    fetchImage,
    fetchFile,
    users = {},
    cardsAs = "note",
    signal,
    makeId = uid,
    concurrency = 4,
    now = Date.now,
  } = options;
  const labels = { ...DEFAULT_LABELS, ...options.labels };
  const source = content?.board || {};
  // A document's address on Miro's API needs the migrating person's token,
  // so links to it point at the Miro board, where it can be opened.
  const documentLink = (value) => {
    const href = safeURL(value);
    return href && new URL(href).host === "api.miro.com"
      ? safeURL(source.viewLink)
      : href;
  };
  // A link that opens the Miro board at one of its items, for content that
  // could not be copied.
  const miroLink = (id) => {
    const href = safeURL(source.viewLink);
    if (!href) return null;
    const url = new URL(href);
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    url.searchParams.set("moveToWidget", String(id));
    return url.href;
  };
  // Mind map nodes come from their own endpoint. Should the item list carry
  // them too, the two are merged, keeping whichever has a position.
  const mindSource = new Map(),
    miroItems = [];
  const mergeNode = (node) => {
    const id = String(node.id),
      known = mindSource.get(id) || {};
    mindSource.set(id, {
      ...known,
      ...node,
      type: "mindmap_node",
      data: { ...known.data, ...node.data },
      position: node.position || known.position,
      geometry: node.geometry || known.geometry,
      parent: known.parent || node.parent,
      // Either list may name the parent node, or a frame holding the node.
      parentIds: [
        ...new Set([
          ...(known.parentIds || []),
          ...(node.parent?.id != null ? [String(node.parent.id)] : []),
        ]),
      ],
    });
  };
  for (const i of content?.items || []) {
    if (!i || i.id == null) continue;
    if (i.type === "mindmap_node") mergeNode(i);
    else miroItems.push(i);
  }
  for (const node of content?.mindmapNodes || [])
    if (node && node.id != null) mergeNode(node);
  const mindNodes = [...mindSource.values()];
  const miroConnectors = (content?.connectors || []).filter(
    (c) => c && c.id != null,
  );
  const report = {
    boardId: source.id ?? null,
    boardName: source.name ?? "",
    source: {},
    converted: {},
    output: {},
    skipped: [],
    warnings: [],
    // What no board's report can avoid, such as comments Miro's API does
    // not provide: shown and logged, but not counted as warnings.
    notices: [],
    errors: [],
    objectCount: 0,
    limit: MIRO_LIMITS.objects,
    overLimit: false,
    images: { embedded: 0, failed: 0 },
    bytes: 0,
  };
  const count = (bucket, type) => (bucket[type] = (bucket[type] || 0) + 1);
  const issue = (code, i, params = {}) => {
    const entry = {
      code,
      id: i?.id != null ? String(i.id) : undefined,
      type: i?.type,
      params,
    };
    entry.message = formatIssue(entry);
    report.warnings.push(entry);
  };
  const skip = (i, code, params = {}) => {
    const entry = { code, id: String(i.id), type: i.type, params };
    entry.message = formatIssue(entry);
    report.skipped.push(entry);
  };
  for (const i of miroItems) count(report.source, i.type || "unknown");
  for (const i of mindNodes) count(report.source, "mindmap_node");
  for (const c of miroConnectors) count(report.source, "connector");
  // Nothing in Miro's API lists comments, so every report says they stay
  // behind, as it does for anything else Miro would not list.
  const notice = { code: "comments-unavailable", params: {} };
  notice.message = formatIssue(notice);
  report.notices.push(notice);
  for (const name of new Set(content?.unavailable || []))
    if (ISSUE_TEXT[`${name}-unavailable`]) issue(`${name}-unavailable`);

  // Tags: dedupe by name, keep the catalog within the board limit.
  const tags = [],
    tagMap = new Map(),
    byName = new Map();
  let catalogFull = false;
  for (const tag of content?.tags || []) {
    count(report.source, "tag");
    const name = String(tag?.title ?? tag?.name ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .trim()
      .slice(0, MIRO_LIMITS.tagName)
      .trim();
    if (!name || tag?.id == null) {
      issue("tag-invalid", tag);
      continue;
    }
    const key = tagKey(name);
    if (byName.has(key)) {
      tagMap.set(String(tag.id), byName.get(key));
      issue("tag-merged", tag, { name });
      count(report.converted, "tag");
      continue;
    }
    if (tags.length >= MIRO_LIMITS.tags) {
      if (!catalogFull) issue("tag-catalog-truncated");
      catalogFull = true;
      continue;
    }
    const id = makeId();
    tags.push({ id, name, color: miroTagColor(tag.fillColor) });
    tagMap.set(String(tag.id), id);
    byName.set(key, id);
    count(report.converted, "tag");
  }
  // Miro tags items it lists under each tag; any tag IDs an item carries
  // itself are kept as well.
  const taggedBy = new Map();
  for (const [tag, ids] of Object.entries(content?.taggedItems || {}))
    for (const id of Array.isArray(ids) ? ids : []) {
      const key = String(id);
      if (!taggedBy.has(key)) taggedBy.set(key, []);
      taggedBy.get(key).push(tag);
    }
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const tagIds = (i, target) => {
    const ids = [
      ...new Set(
        [
          ...(i.tagIds || i.data?.tagIds || []),
          ...(taggedBy.get(String(i.id)) || []),
        ].map((id) => {
          const mapped = tagMap.get(String(id));
          if (!mapped) issue("tag-unknown", i);
          return mapped;
        }),
      ),
    ].filter(Boolean);
    if (!ids.length) return;
    // Only sticky notes hold tags, so other objects keep them as text.
    if (target.type !== "note") {
      issue("tags-as-text", i);
      const rich = {
        text: target.text || "",
        runs: target.textRuns || [],
        blocks: target.textBlocks || [],
      };
      const line = `${labels.tags}: ${ids.map((id) => tagName.get(id)).join(", ")}`;
      delete target.textRuns;
      delete target.textBlocks;
      return applyText(target, joinRich([rich, plain(line)]), issue, i);
    }
    if (ids.length > TAG_LIMIT) issue("tags-truncated", i);
    target.tagIds = ids.slice(0, TAG_LIMIT);
  };

  const geo = positions([...miroItems, ...mindNodes], issue);
  const out = [],
    behind = new Set(),
    idMap = new Map(),
    outputOf = new Map(),
    pendingMedia = [],
    placeholders = new Set();
  let frameOrder = 0;
  const place = (i, type, extra = {}) => {
    const { w, h } = geo.size(i),
      c = geo.center(i);
    const object = item(type, c.x - w / 2, c.y - h / 2, {
      id: makeId(),
      w: Math.max(1, w),
      h: Math.max(1, h),
      ...extra,
    });
    const rotation = normalizeRotation(num(i.geometry?.rotation));
    if (Math.abs(rotation) > 1e-9) {
      if (canRotateItem(object)) object.rotation = rotation;
      else issue("rotation-dropped", i);
    }
    return object;
  };
  const textStyle = (i, target, defaults = {}) => {
    const s = i.style || {};
    const size = miroFontSize(s.fontSize, defaults.fontSize);
    if (size) target.fontSize = size;
    const align = alignment(s.textAlign) || defaults.textAlign;
    if (align) target.textAlign = align;
    const color = miroColor(s.color);
    if (color && color !== "#1a1a1a" && color !== "#000000")
      target.textColor = color;
    const family = FONT_MAP[String(s.fontFamily || "").toLowerCase()];
    if (family) target.fontFamily = family;
  };
  const linkCard = (i, url, title, extra = {}) => {
    const href = safeURL(url);
    if (!href) return null;
    const object = place(i, "link", {
      url: href,
      color: "#dce5f7",
      ...extra,
    });
    applyText(object, plain(title || new URL(href).hostname), issue, i);
    return object;
  };
  // Content Miro's API does not provide keeps its place on the board as a
  // placeholder that opens the item on the Miro board, and the report lists
  // it as skipped.
  const unavailable = (i) => {
    const type = String(i.type || "unknown");
    const table = TABLE_TYPES.has(type);
    const href = miroLink(i.id),
      color = "#fff4c2";
    const object = href
      ? place(i, "link", { url: href, color })
      : place(i, "rect", { color });
    applyText(
      object,
      joinRich([
        plain(table ? labels.table : type, { bold: true }),
        plain(labels.notCopied),
      ]),
      issue,
      i,
    );
    skip(i, table ? "table-unavailable" : "unsupported-type", { type });
    placeholders.add(object.id);
    return object;
  };

  for (const i of miroItems) {
    const data = i.data || {},
      style = i.style || {};
    let object = null;
    switch (i.type) {
      case "sticky_note": {
        const color = miroColor(style.fillColor, MIRO_COLORS.light_yellow),
          ink = inkOn(color);
        object = place(i, "note", {
          color,
          // Miro gives sticky notes no text color and writes on dark ones in
          // light ink; notes here keep dark ink unless told otherwise.
          ...(ink === inkOn("#ffffff") ? {} : { textColor: ink }),
          textAlign: alignment(style.textAlign) || "center",
          textValign: verticalAlignment(style.textAlignVertical) || "middle",
        });
        applyText(object, htmlToRichText(data.content), issue, i);
        break;
      }
      case "text":
        object = place(i, "text", { autoHeight: true });
        textStyle(i, object, { fontSize: 14 });
        applyText(object, htmlToRichText(data.content), issue, i);
        break;
      case "shape": {
        const mapped = miroShape(data.shape);
        if (mapped.approximate)
          issue("shape-approximated", i, {
            shape: data.shape,
            target: mapped.shape || mapped.type,
          });
        if (mapped.unknown) issue("shape-unknown", i, { shape: data.shape });
        // Fills are opaque on the board: a partly transparent fill is
        // blended with the white canvas, and a clear one goes behind
        // everything else so it covers nothing.
        const opacity = clamp(num(style.fillOpacity, 1), 0, 1);
        const fill = miroColor(style.fillColor, "#ffffff", null);
        const clear = opacity === 0 || !fill;
        object = place(i, mapped.type, {
          color: clear ? "#ffffff" : onWhite(fill, opacity),
          ...(mapped.shape ? { shape: mapped.shape } : {}),
        });
        if (clear) {
          issue("fill-transparent", i);
          behind.add(object.id);
        }
        textStyle(i, object, { fontSize: 14, textAlign: "center" });
        // Miro's shapes hold their text in the middle unless set otherwise.
        if (["rect", "ellipse"].includes(object.type))
          object.textValign =
            verticalAlignment(style.textAlignVertical) || "middle";
        applyText(object, htmlToRichText(data.content), issue, i);
        break;
      }
      case "frame": {
        const fill = miroColor(style.fillColor, "#ffffff");
        object = place(i, "frame", { color: fill, order: frameOrder++ });
        // The color is kept with the frame, but frames are drawn as an
        // outline only, so a colored background is reported.
        if (fill !== "#ffffff") issue("frame-fill", i, { color: fill });
        applyText(object, plain(htmlToText(data.title)), issue, i);
        break;
      }
      case "image":
        object = place(i, "rect", { color: "#ffffff", textAlign: "center" });
        pendingMedia.push({ kind: "image", source: i, object });
        break;
      case "card":
      case "app_card": {
        const parts = [
          plain(htmlToText(data.title), { bold: true }),
          htmlToRichText(data.description),
        ];
        if (i.type === "card" && data.assigneeId != null) {
          const user = users[String(data.assigneeId)];
          parts.push(
            plain(
              `${labels.assignee}: ${user?.name || user?.email || data.assigneeId}`,
            ),
          );
        }
        if (data.dueDate)
          parts.push(
            plain(`${labels.due}: ${String(data.dueDate).slice(0, 10)}`),
          );
        for (const field of data.fields || []) {
          const value = htmlToText(String(field?.value ?? ""));
          if (!value) continue;
          const tip = htmlToText(String(field?.tooltip ?? ""));
          parts.push(plain(tip ? `${tip}: ${value}` : value));
        }
        if (i.type === "app_card" && data.status && data.status !== "connected")
          parts.push(plain(`${labels.status}: ${data.status}`));
        const accent = miroColor(style.cardTheme || style.fillColor);
        object = place(i, cardsAs === "rect" ? "rect" : "note", {
          color: accent ? tint(accent) : "#ffffff",
          textAlign: "left",
          ...(cardsAs === "rect" ? { fontSize: 14 } : {}),
        });
        applyText(object, joinRich(parts), issue, i);
        break;
      }
      case "document": {
        const title = htmlToText(data.title) || labels.document;
        if (fetchFile && data.documentUrl) {
          object = place(i, "file", {
            color: "#eadcf0",
            text: title.slice(0, 255),
            fileName: title.slice(0, 255),
            data: "data:application/octet-stream;base64,",
          });
          pendingMedia.push({ kind: "file", source: i, object, title });
        } else {
          object = linkCard(i, documentLink(data.documentUrl), title);
          if (!object) {
            object = place(i, "rect", { color: "#eadcf0" });
            applyText(object, plain(title), issue, i);
          }
          issue("document-link", i, { title });
        }
        break;
      }
      case "embed":
      case "preview": {
        const url = data.url || data.previewUrl;
        const title = htmlToText(data.title || data.providerName || "");
        // Content the board can embed, such as a YouTube video or a Google
        // document, stays embedded; anything else becomes a link card.
        const embed =
          i.type === "embed" && normalizeEmbed(url, { generic: false });
        if (embed) {
          object = place(i, "embed", {
            url: embed.url,
            provider: embed.provider,
            color: "#ffffff",
          });
          object.text = (title || providerName(embed.provider)).slice(0, 500);
          break;
        }
        object = linkCard(i, url, title);
        if (!object && url) {
          issue("link-invalid", i, { url });
          object = place(i, "rect", { color: "#dce5f7" });
          applyText(object, plain(String(url)), issue, i);
        }
        break;
      }
      case "doc_format":
        object = place(i, "text", { autoHeight: true });
        textStyle(i, object, { fontSize: 14 });
        applyText(object, docToRichText(data), issue, i);
        break;
      default:
        object = unavailable(i);
        break;
    }
    object ||= unavailable(i);
    if (
      ![object.x, object.y, object.w, object.h].every(
        (n) => Number.isFinite(n) && Math.abs(n) <= MIRO_LIMITS.coordinate,
      )
    ) {
      skip(i, "out-of-range");
      continue;
    }
    tagIds(i, object);
    out.push(object);
    idMap.set(String(i.id), object.id);
    outputOf.set(object.id, i);
  }

  // Mind map nodes become the app's mind map nodes. Their branches are
  // linked once every node exists.
  const mindIds = new Set(mindNodes.map((n) => String(n.id))),
    mindObjects = new Map();
  for (const n of mindNodes) {
    const view = n.data?.nodeView || {},
      style = n.style || {},
      viewStyle = view.style || {};
    const shape = String(style.shape || "").toLowerCase();
    const type = shape === "none" ? "text" : "rect";
    // The node's color is its outline; its fill is that color at the fill
    // opacity, over the white canvas.
    const outline = miroColor(style.nodeColor);
    const opacity = clamp(num(viewStyle.fillOpacity, 1), 0, 1);
    const object = place(n, type, {
      textAlign: "center",
      ...(type === "rect"
        ? {
            color:
              outline && opacity > 0 ? onWhite(outline, opacity) : "#ffffff",
            autoFontSize: true,
            ...(shape === "pill" ? { shape: "terminator" } : {}),
          }
        : {}),
      mindMap: { parent: null, direction: "right", auto: true, line: "curved" },
    });
    const size = miroFontSize(viewStyle.fontSize ?? style.fontSize);
    if (size) object.fontSize = size;
    const color = miroColor(viewStyle.color);
    if (color && color !== "#1a1a1a" && color !== "#000000")
      object.textColor = color;
    applyText(
      object,
      htmlToRichText(view.data?.content ?? n.data?.content),
      issue,
      n,
    );
    if (
      ![object.x, object.y, object.w, object.h].every(
        (v) => Number.isFinite(v) && Math.abs(v) <= MIRO_LIMITS.coordinate,
      )
    ) {
      skip(n, "out-of-range");
      continue;
    }
    out.push(object);
    idMap.set(String(n.id), object.id);
    outputOf.set(object.id, n);
    mindObjects.set(String(n.id), object);
  }

  // Frame membership. The app does not nest frames.
  const byOutId = new Map(out.map((o) => [o.id, o]));
  const frameOf = (miro) =>
    (miro.parentIds || [miro.parent?.id])
      .filter((id) => id != null)
      .map((id) => byOutId.get(idMap.get(String(id))))
      .find((parent) => parent?.type === "frame");
  for (const o of out) {
    const parent = frameOf(outputOf.get(o.id));
    if (!parent) continue;
    if (o.type === "frame") issue("nested-frame", outputOf.get(o.id));
    else o.parentId = parent.id;
  }

  // Mind map branches. Miro has named a frame, or an item that is not a
  // node, as a node's parent; a node whose parent node is not found starts
  // its own mind map rather than joining the wrong branch.
  const mindChildren = new Map();
  for (const n of mindNodes) {
    const object = mindObjects.get(String(n.id));
    if (!object) continue;
    const parentId = (n.parentIds || []).find(
      (id) => mindIds.has(id) && id !== String(n.id),
    );
    const parent = parentId && mindObjects.get(parentId);
    if (parent) object.mindMap.parent = parent.id;
    else if (n.data?.isRoot !== true) issue("mindmap-parent-missing", n);
    // Miro puts a first-level branch at the start (left) or end (right).
    if (n.data?.direction === "start") object.mindMap.direction = "left";
  }
  const mindList = [...mindObjects.values()];
  repairMindTrees(mindList);
  for (const o of mindList) {
    const parent = o.mindMap.parent;
    if (!mindChildren.has(parent)) mindChildren.set(parent, []);
    mindChildren.get(parent).push(o);
  }
  // A map Miro placed keeps its layout; one it gave no positions for is
  // laid out from its root.
  const placed = (o) => {
    const p = outputOf.get(o.id).position;
    return (
      p && Number.isFinite(num(p.x, NaN)) && Number.isFinite(num(p.y, NaN))
    );
  };
  // A first-level branch Miro gives no side for, but placed left of its
  // root, is on the left, so its line leaves the root's left edge.
  for (const o of mindList) {
    const root = byOutId.get(o.mindMap.parent);
    if (
      !root ||
      root.mindMap.parent != null ||
      outputOf.get(o.id).data?.direction !== undefined ||
      !placed(o) ||
      !placed(root)
    )
      continue;
    if (o.x + o.w / 2 < root.x + root.w / 2) o.mindMap.direction = "left";
  }
  // Siblings keep Miro's order, and deeper branches their first-level
  // branch's side.
  const trees = (mindChildren.get(null) || []).map((root) => {
    const tree = [root];
    for (let n = 0; n < tree.length; n++) {
      const node = tree[n];
      (mindChildren.get(node.id) || []).forEach((child, order) => {
        child.order = order;
        if (node !== root) child.mindMap.direction = node.mindMap.direction;
        tree.push(child);
      });
    }
    return tree;
  });
  // Content placed by Miro, which mind maps without a position go below.
  const unplaced = new Set(trees.filter((tree) => !tree.every(placed)).flat());
  const others = out.filter((o) => !unplaced.has(o));
  const area = others.length ? bounds(others) : { x: 0, y: 0, w: 0, h: 0 };
  let nextY = others.length ? area.y + area.h + 200 : 0;
  for (const tree of trees) {
    const [root] = tree;
    if (tree.every(placed)) {
      for (const o of tree) o.mindMap.auto = false;
      continue;
    }
    // Inside its frame when it has one, otherwise below the board.
    const frame = !placed(root) && byOutId.get(root.parentId);
    if (!placed(root)) {
      issue("mindmap-placed", outputOf.get(root.id));
      root.x = frame ? frame.x + 40 : area.x;
      root.y = frame ? frame.y + 80 : nextY;
    }
    try {
      applyMindLayout(tree, root.id);
    } catch {
      for (const o of tree) o.mindMap.auto = false;
    }
    if (!placed(root)) {
      // Branches to the left or above the root would reach out of its
      // frame or into the board.
      const box = bounds(tree);
      const dx = (frame ? frame.x + 40 : area.x) - box.x,
        dy = (frame ? frame.y + 80 : nextY) - box.y;
      for (const o of tree) {
        o.x += dx;
        o.y += dy;
      }
      if (!frame) nextY += box.h + 200;
    }
    // Branches belong to the frame their root is in.
    for (const o of tree)
      if (root.parentId) o.parentId = root.parentId;
      else delete o.parentId;
  }

  // Connectors attach by ID; unattached ends use the Miro item's center.
  const arrows = [],
    arrowIds = new Map();
  for (const c of miroConnectors) {
    const ends = [c.startItem, c.endItem].map((end) => {
      const miroId = end?.id != null ? String(end.id) : null;
      const target = miroId && byOutId.get(idMap.get(miroId));
      const miro = miroId && geo.byId.get(miroId);
      if (target && target.type !== "frame") return { id: target.id, target };
      if (target) issue("connector-frame-endpoint", c);
      else if (miroId) issue("connector-endpoint-missing", c);
      return miro
        ? { point: geo.center(miro) }
        : target
          ? {
              point: { x: target.x + target.w / 2, y: target.y + target.h / 2 },
            }
          : null;
    });
    if (ends[0]?.id && ends[0].id === ends[1]?.id) {
      skip({ id: c.id, type: "connector" }, "connector-self");
      continue;
    }
    // An end whose item Miro did not list is free, beside the other end,
    // as its warning says.
    for (const [n, end] of ends.entries())
      if (!end && ends[1 - n]) {
        const other = ends[1 - n],
          at = other.target
            ? {
                x: other.target.x + other.target.w / 2,
                y: other.target.y + other.target.h / 2,
              }
            : other.point;
        ends[n] = { point: { x: at.x + (n ? 200 : -200), y: at.y } };
      }
    if (!ends[0] || !ends[1]) {
      skip({ id: c.id, type: "connector" }, "connector-endpoints");
      continue;
    }
    const s = c.style || {};
    const at = (end) =>
      end.target
        ? {
            x: end.target.x + end.target.w / 2,
            y: end.target.y + end.target.h / 2,
          }
        : end.point;
    const a = at(ends[0]),
      b = at(ends[1]);
    const arrow = item("arrow", a.x, a.y, {
      id: makeId(),
      w: b.x - a.x,
      h: b.y - a.y,
      color: miroColor(s.strokeColor, "#687169"),
      lineWidth: clamp(num(s.strokeWidth, 2.5), 1, 12),
    });
    if (ends[0].id) arrow.startId = ends[0].id;
    if (ends[1].id) arrow.endId = ends[1].id;
    const lineType = LINE_TYPES[c.shape];
    if (lineType && lineType !== "straight") arrow.lineType = lineType;
    else if (!c.shape) arrow.lineType = "curved";
    const lineStyle = LINE_STYLES[s.strokeStyle];
    if (lineStyle && lineStyle !== "solid") arrow.lineStyle = lineStyle;
    for (const [key, value, fallback] of [
      ["startCap", s.startStrokeCap, "none"],
      ["endCap", s.endStrokeCap, "stealth"],
    ]) {
      const name = value || fallback;
      const cap = CAPS[name] || "arrow";
      if (!CAPS[name]) issue("cap-approximated", c, { cap: name });
      arrow[key] = cap;
    }
    const captions = (c.captions || []).filter((cap) =>
      htmlToText(cap?.content),
    );
    if (captions.length > 1) issue("connector-captions", c);
    if (captions.length) {
      applyText(
        arrow,
        joinRich(captions.map((cap) => htmlToRichText(cap.content))),
        issue,
        c,
      );
      const size = miroFontSize(s.fontSize);
      if (size) arrow.fontSize = size;
    }
    if (
      ![arrow.x, arrow.y, arrow.w, arrow.h].every(
        (n) => Number.isFinite(n) && Math.abs(n) <= MIRO_LIMITS.coordinate,
      )
    ) {
      skip({ id: c.id, type: "connector" }, "out-of-range");
      continue;
    }
    arrows.push(arrow);
    outputOf.set(arrow.id, { ...c, type: "connector" });
    arrowIds.set(String(c.id), arrow.id);
  }
  let items = [
    ...out.filter((o) => behind.has(o.id)),
    ...out.filter((o) => !behind.has(o.id)),
    ...arrows,
  ];

  report.objectCount = items.length;
  if (items.length > MIRO_LIMITS.objects * MIRO_LIMITS.parts) {
    // Report the overflow instead of dropping content; nothing is downloaded.
    report.overLimit = true;
    const error = { code: "over-limit", params: { count: items.length } };
    error.message = formatIssue(error);
    report.errors.push(error);
    for (const o of items) count(report.output, o.type);
    return { board: null, report };
  }

  // Media downloads run with bounded concurrency. Failures keep a placeholder.
  // Embedded images and files share the import size budget. Once it is
  // spent, the rest keep placeholders and are not downloaded, so a board with
  // a lot of image data still converts instead of running out of memory.
  let mediaBytes = 0;
  const budget = (length = 0) => {
    mediaBytes += length;
    if (mediaBytes > MIRO_LIMITS.importBytes) throw Error("board over 100 MB");
  };
  let next = 0;
  const worker = async () => {
    while (next < pendingMedia.length) {
      signal?.throwIfAborted?.();
      const job = pendingMedia[next++];
      const i = job.source,
        data = i.data || {};
      if (job.kind === "image") {
        const title = htmlToText(data.title || "").slice(0, 200);
        try {
          if (!fetchImage) throw Error("no downloader");
          if (!data.imageUrl) throw Error("missing image URL");
          budget();
          // The downloader may try Miro's preview when the original is
          // refused, so it checks each download the same way.
          const fetched = await fetchImage(data.imageUrl, {
            signal,
            accept: embedImage,
          });
          const image = fetched?.src ? fetched : embedImage(fetched);
          budget(image.src.length);
          const rect = job.object;
          // Tags kept as text on the placeholder stay with the image.
          const tagged = rect.text;
          for (const key of ["shape", "textAlign", "textRuns", "textBlocks"])
            delete rect[key];
          Object.assign(rect, {
            type: "image",
            src: image.src,
            text: [title, tagged]
              .filter(Boolean)
              .join("\n")
              .slice(0, MIRO_LIMITS.text),
          });
          report.images.embedded++;
        } catch (e) {
          if (signal?.aborted) throw e;
          report.images.failed++;
          placeholders.add(job.object.id);
          issue("image-failed", i, {
            title: title || String(i.id),
            reason: e.message,
          });
          applyText(
            job.object,
            plain(`${labels.imageUnavailable}${title ? `: ${title}` : ""}`),
            issue,
            i,
          );
        }
      } else {
        try {
          budget();
          const file = await fetchFile(data.documentUrl, { signal });
          const bytes = toBytes(file?.bytes ?? file);
          if (!bytes?.length) throw Error("empty download");
          if (bytes.length > MIRO_LIMITS.fileBytes)
            throw Error("larger than 10 MB");
          const url = `data:application/octet-stream;base64,${base64(bytes)}`;
          budget(url.length);
          job.object.data = url;
        } catch (e) {
          if (signal?.aborted) throw e;
          issue("document-failed", i, { title: job.title, reason: e.message });
          const href = documentLink(data.documentUrl);
          const o = job.object;
          for (const key of ["fileName", "data"]) delete o[key];
          if (href)
            Object.assign(o, { type: "link", url: href, color: "#dce5f7" });
          else Object.assign(o, { type: "rect", color: "#eadcf0" });
        }
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, pendingMedia.length)) },
      worker,
    ),
  );

  // Validate objects individually so one bad object is skipped, not the board.
  // Each is checked with only the tags it uses rather than the whole
  // catalog, which the board as a whole is checked with below.
  const known = new Map(tags.map((t) => [t.id, t]));
  items = items.filter((o) => {
    const probe = { ...o };
    for (const key of ["parentId", "startId", "endId"]) delete probe[key];
    if (probe.mindMap) probe.mindMap = { ...probe.mindMap, parent: null };
    if (probe.tagIds) probe.tagIds = probe.tagIds.filter((id) => known.has(id));
    try {
      validateBoard({
        version: 1,
        title: "",
        items: [probe],
        tags: [...new Set(probe.tagIds)].map((id) => known.get(id)),
      });
      return true;
    } catch (e) {
      const miro = outputOf.get(o.id);
      skip(miro, "invalid-object", { reason: e.message });
      return false;
    }
  });
  const kept = new Set(items.map((o) => o.id));
  for (const o of items) {
    if (o.parentId && !kept.has(o.parentId)) delete o.parentId;
    for (const key of ["startId", "endId"])
      if (o[key] && !kept.has(o[key])) delete o[key];
    trimMindMap(o, kept);
  }
  updateConnectors(items);

  // Groups. Miro lists a large group over several pages under one ID, and
  // gives each group's members by item or connector ID.
  const groupMembers = new Map();
  for (const g of content?.groups || []) {
    if (g?.id == null) continue;
    const key = String(g.id);
    if (!groupMembers.has(key)) {
      groupMembers.set(key, new Set());
      count(report.source, "group");
    }
    const listed = g.data?.items ?? g.items;
    for (const m of Array.isArray(listed) ? listed : []) {
      const id = m && typeof m === "object" ? m.id : m;
      if (id != null) groupMembers.get(key).add(String(id));
    }
  }
  const byKeptId = new Map(items.map((o) => [o.id, o]));
  for (const [key, members] of groupMembers) {
    const objects = [];
    for (const id of members) {
      const o = byKeptId.get(idMap.get(id) ?? arrowIds.get(id));
      if (!o) continue;
      if (o.groupId) issue("group-overlap", outputOf.get(o.id));
      else objects.push(o);
    }
    if (objects.length < members.size)
      issue("group-partial", { id: key, type: "group" });
    if (objects.length < 2) continue;
    const id = makeId();
    for (const o of objects) o.groupId = id;
    count(report.converted, "group");
  }

  const title =
    String(source.name || "")
      .trim()
      .slice(0, MIRO_LIMITS.title) || labels.untitled;
  // A board with more objects than one holds is migrated as several, each
  // keeping the board's place and size for what it holds.
  const { parts, cut } =
    items.length > MIRO_LIMITS.objects
      ? splitItems(items, MIRO_LIMITS.objects)
      : { parts: [items], cut: 0 };
  if (parts.length > MIRO_LIMITS.parts) {
    report.overLimit = true;
    const error = { code: "over-limit", params: { count: items.length } };
    error.message = formatIssue(error);
    report.errors.push(error);
    return { board: null, report };
  }
  const partTitle = (n) => {
    const suffix = labels.part
      .replace("{title}", "")
      .replace("{n}", n + 1)
      .replace("{total}", parts.length);
    return labels.part
      .replace("{title}", title.slice(0, MIRO_LIMITS.title - suffix.length))
      .replace("{n}", n + 1)
      .replace("{total}", parts.length);
  };
  const boards = parts.map((partItems, n) => {
    // A part carries the tags its objects use; a whole board, its catalog.
    const used = new Set(partItems.flatMap((o) => o.tagIds || []));
    const partTags =
      parts.length > 1 ? tags.filter((t) => used.has(t.id)) : tags;
    return {
      version: 1,
      id: makeId(),
      title: parts.length > 1 ? partTitle(n) : title,
      updated: Date.parse(source.modifiedAt) || now(),
      favorite: false,
      items: partItems,
      ...(partTags.length ? { tags: partTags } : {}),
    };
  });
  const board = boards[0];
  try {
    for (const b of boards) validateBoard(b);
  } catch (e) {
    const error = { code: "board-invalid", params: { reason: e.message } };
    error.message = formatIssue(error);
    report.errors.push(error);
    return { board: null, report };
  }
  if (boards.length > 1) {
    report.parts = boards.length;
    issue("board-split", null, { count: items.length, parts: boards.length });
    if (cut) issue("connector-split", null, { count: cut });
    // Listed first, before any per-object warning: it says what the
    // library will hold.
    report.warnings.unshift(...report.warnings.splice(cut ? -2 : -1));
  }
  for (const o of items) {
    count(report.output, o.type);
    const miro = outputOf.get(o.id);
    if (miro && !placeholders.has(o.id)) count(report.converted, miro.type);
  }
  report.objectCount = items.length;
  // Measured object by object: one string of a whole board with a lot of
  // image data can pass the longest string JavaScript allows.
  const sizes = boards.map((b) =>
    b.items.reduce(
      (n, o) => n + JSON.stringify(o).length + 1,
      JSON.stringify({ ...b, items: [] }).length - (b.items.length ? 1 : 0),
    ),
  );
  report.bytes = sizes.reduce((a, b) => a + b, 0);
  const largest = Math.max(...sizes);
  if (largest > MIRO_LIMITS.importBytes)
    issue("board-large", null, {
      size: Math.round(largest / 1024 / 1024),
    });
  return { board, boards, report };
}

// Splits a board's objects into parts of at most `limit`. Each frame with
// everything in it, each group and each mind map stays whole, in frame
// order and then by position; one too large for a part is split by
// position. A connector goes with its start, or its end if it has no
// start; one whose other end lands in another part keeps its place with
// that end free. Returns the parts and how many connectors were cut.
export function splitItems(items, limit) {
  const byId = new Map(items.map((o) => [o.id, o]));
  const root = new Map(items.map((o) => [o.id, o.id]));
  const find = (id) => {
    let r = id;
    while (root.get(r) !== r) r = root.get(r);
    for (let n = id; root.get(n) !== r;) {
      const next = root.get(n);
      root.set(n, r);
      n = next;
    }
    return r;
  };
  const join = (a, b) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) root.set(rb, ra);
  };
  const firstInGroup = new Map();
  for (const o of items) {
    if (o.parentId && byId.has(o.parentId)) join(o.parentId, o.id);
    if (o.mindMap?.parent && byId.has(o.mindMap.parent))
      join(o.mindMap.parent, o.id);
    if (o.groupId) {
      if (firstInGroup.has(o.groupId)) join(firstInGroup.get(o.groupId), o.id);
      else firstInGroup.set(o.groupId, o.id);
    }
  }
  // Loose connectors follow what they start (or end) at.
  for (const o of items)
    if (
      o.type === "arrow" &&
      !o.groupId &&
      !(o.parentId && byId.has(o.parentId))
    ) {
      const end = [o.startId, o.endId].find((id) => id && byId.has(id));
      if (end) join(end, o.id);
    }
  const units = new Map();
  for (const o of items) {
    const r = find(o.id);
    if (!units.has(r)) units.set(r, []);
    units.get(r).push(o);
  }
  const frameRank = new Map(orderedFrames(items).map((f, n) => [f.id, n]));
  const placed = [...units.values()].map((objects) => {
    const box = bounds(objects);
    const rank = Math.min(
      ...objects.map((o) => frameRank.get(o.id) ?? Infinity),
    );
    return { objects, rank, x: box.x, y: box.y };
  });
  placed.sort((a, b) => a.rank - b.rank || a.y - b.y || a.x - b.x);
  const parts = [];
  let part = [];
  const close = () => {
    if (part.length) parts.push(part);
    part = [];
  };
  for (const unit of placed) {
    if (unit.objects.length > limit) {
      close();
      const spread = [...unit.objects].sort((a, b) => a.y - b.y || a.x - b.x);
      for (let n = 0; n < spread.length; n += limit)
        parts.push(spread.slice(n, n + limit));
      continue;
    }
    if (part.length + unit.objects.length > limit) close();
    part.push(...unit.objects);
  }
  close();
  // Each part keeps the board's stacking order, and only references to
  // what it holds.
  const order = new Map(items.map((o, n) => [o.id, n]));
  let cut = 0;
  const result = parts.map((objects) => {
    const kept = new Set(objects.map((o) => o.id));
    const members = new Map();
    for (const o of objects)
      if (o.groupId) members.set(o.groupId, (members.get(o.groupId) || 0) + 1);
    return objects
      .sort((a, b) => order.get(a.id) - order.get(b.id))
      .map((o) => {
        const copy = { ...o };
        if (copy.parentId && !kept.has(copy.parentId)) delete copy.parentId;
        let lost = false;
        for (const key of ["startId", "endId"])
          if (copy[key] && !kept.has(copy[key])) {
            delete copy[key];
            lost = true;
          }
        if (lost) cut++;
        if (copy.groupId && members.get(copy.groupId) < 2) delete copy.groupId;
        if (copy.mindMap) {
          copy.mindMap = { ...copy.mindMap };
          trimMindMap(copy, kept);
        }
        return copy;
      });
  });
  return { parts: result, cut };
}

// Short counts for logs and summaries.
export function reportTotals(report) {
  const sum = (bucket) =>
    Object.entries(bucket || {})
      .filter(([type]) => type !== "tag" && type !== "group")
      .reduce((n, [, v]) => n + v, 0);
  return {
    source: sum(report.source),
    converted: sum(report.converted),
    skipped: report.skipped.length,
    warnings: report.warnings.length,
  };
}
