import { item, uid, imageSize, validateBoard } from "../model.js";
import { TAG_LIMIT, TAG_COLORS, tagKey } from "../tags.js";
import { canRotateItem, normalizeRotation } from "../geometry.js";
import { appendRun } from "../rich-text.js";
import { MAX_LIST_INDENT } from "../text-blocks.js";
import { textLinkURL } from "../text-link-data.js";
import { updateConnectors, safeURL } from "../scene.js";
import { normalizeEmbed, providerName } from "../content/providers.js";

// Converts Miro REST API v2 board content into this app's board model. The
// functions are pure apart from the injected downloaders, so a dry run and a
// real migration produce the same board and report.

export const MIRO_LIMITS = {
  objects: 5000,
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
  flow_chart_predefined_process: "predefined-process",
  flow_chart_manual_input: "manual-input",
  flow_chart_manual_operation: "manual-operation",
  flow_chart_delay: "delay",
  flow_chart_display: "display",
  flow_chart_off_page_connector: "off-page",
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
const CAPS = {
  __proto__: null,
  none: "none",
  oval: "circle",
  filled_oval: "circle",
  arrow: "arrow",
  stealth: "arrow",
  rounded_stealth: "arrow",
  triangle: "arrow",
  filled_triangle: "arrow",
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
};
export const SUPPORTED_ITEM_TYPES = Object.keys(DEFAULT_SIZES);

// Report issue templates. Codes stay stable for logs; the UI translates the
// English template before substituting the named values.
export const ISSUE_TEXT = {
  "unsupported-type": "Unsupported Miro item type: {type}.",
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
  "tags-dropped": "Tags are kept only on sticky notes.",
  "tag-unknown": "An object referenced a tag that is not on the board.",
  "tag-catalog-truncated": "Only the first 1,000 board tags were kept.",
  "tag-merged": "Tag {name} duplicated another tag and was merged.",
  "tag-invalid": "A tag without a usable name was skipped.",
  "nested-frame":
    "A frame inside another frame kept its position but is no longer nested.",
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
    "This board has {count} objects after conversion; boards support up to 5,000. Split it in Miro (for example by frame) and migrate the parts.",
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
  assignee: "Assignee",
  due: "Due",
  status: "Status",
  imageUnavailable: "Image not migrated",
  document: "Document",
};

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
};
// Accented letters such as &eacute; and &Eacute; keep the letter's case.
const ACCENTS = {
  acute: "\u0301",
  grave: "\u0300",
  circ: "\u0302",
  uml: "\u0308",
  cedil: "\u0327",
  tilde: "\u0303",
};
function accented(name) {
  const m = /^([a-zA-Z])(acute|grave|circ|uml|cedil|tilde)$/.exec(name);
  const letter = m && (m[1] + ACCENTS[m[2]]).normalize("NFC");
  return letter?.length === 1 ? letter : undefined;
}
export function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
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

// Converts Miro's HTML text into plain text with the app's rich text runs
// (bold, italic, underline, strike, links) and list blocks. Paragraphs and
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
  let space = false;
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
    if (tag === "br") {
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
        styles.push({ tag, style: value });
        merged = null;
      }
      continue;
    }
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
  const size = imageSize(src);
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
  const miroItems = (content?.items || []).filter((i) => i && i.id != null);
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
  for (const c of miroConnectors) count(report.source, "connector");

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
  const tagIds = (i, target) => {
    const ids = [
      ...new Set(
        (i.tagIds || i.data?.tagIds || []).map((id) => {
          const mapped = tagMap.get(String(id));
          if (!mapped) issue("tag-unknown", i);
          return mapped;
        }),
      ),
    ].filter(Boolean);
    if (!ids.length) return;
    if (target.type !== "note") return issue("tags-dropped", i);
    if (ids.length > TAG_LIMIT) issue("tags-truncated", i);
    target.tagIds = ids.slice(0, TAG_LIMIT);
  };

  const geo = positions(miroItems, issue);
  const out = [],
    behind = new Set(),
    idMap = new Map(),
    outputOf = new Map(),
    pendingMedia = [];
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

  for (const i of miroItems) {
    const data = i.data || {},
      style = i.style || {};
    let object = null;
    switch (i.type) {
      case "sticky_note":
        object = place(i, "note", {
          color: miroColor(style.fillColor, MIRO_COLORS.light_yellow),
          textAlign: alignment(style.textAlign) || "center",
        });
        applyText(object, htmlToRichText(data.content), issue, i);
        break;
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
        applyText(object, htmlToRichText(data.content), issue, i);
        break;
      }
      case "frame":
        object = place(i, "frame", {
          color: miroColor(style.fillColor, "#ffffff"),
          order: frameOrder++,
        });
        applyText(object, plain(htmlToText(data.title)), issue, i);
        break;
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
      default:
        skip(i, "unsupported-type", { type: i.type || "unknown" });
        continue;
    }
    if (!object) {
      skip(i, "unsupported-type", { type: i.type });
      continue;
    }
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

  // Frame membership. The app does not nest frames.
  const byOutId = new Map(out.map((o) => [o.id, o]));
  for (const o of out) {
    const parentMiro = outputOf.get(o.id).parent?.id;
    if (parentMiro == null) continue;
    const parent = byOutId.get(idMap.get(String(parentMiro)));
    if (!parent || parent.type !== "frame") continue;
    if (o.type === "frame") issue("nested-frame", outputOf.get(o.id));
    else o.parentId = parent.id;
  }

  // Connectors attach by ID; unattached ends use the Miro item's center.
  const arrows = [];
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
  }
  let items = [
    ...out.filter((o) => behind.has(o.id)),
    ...out.filter((o) => !behind.has(o.id)),
    ...arrows,
  ];

  report.objectCount = items.length;
  if (items.length > MIRO_LIMITS.objects) {
    // Report the overflow instead of dropping content; nothing is downloaded.
    report.overLimit = true;
    const error = { code: "over-limit", params: { count: items.length } };
    error.message = formatIssue(error);
    report.errors.push(error);
    for (const o of items) count(report.output, o.type);
    return { board: null, report };
  }

  // Media downloads run with bounded concurrency. Failures keep a placeholder.
  const placeholders = new Set();
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
          for (const key of ["shape", "textAlign", "textRuns", "textBlocks"])
            delete rect[key];
          Object.assign(rect, { type: "image", src: image.src, text: title });
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
  }
  updateConnectors(items);

  const board = {
    version: 1,
    id: makeId(),
    title:
      String(source.name || "")
        .trim()
        .slice(0, MIRO_LIMITS.title) || labels.untitled,
    updated: Date.parse(source.modifiedAt) || now(),
    favorite: false,
    items,
    ...(tags.length ? { tags } : {}),
  };
  try {
    validateBoard(board);
  } catch (e) {
    const error = { code: "board-invalid", params: { reason: e.message } };
    error.message = formatIssue(error);
    report.errors.push(error);
    return { board: null, report };
  }
  for (const o of items) {
    count(report.output, o.type);
    const miro = outputOf.get(o.id);
    if (miro && !placeholders.has(o.id)) count(report.converted, miro.type);
  }
  report.objectCount = items.length;
  // Measured object by object: one string of a whole board with a lot of
  // image data can pass the longest string JavaScript allows.
  report.bytes = items.reduce(
    (n, o) => n + JSON.stringify(o).length + 1,
    JSON.stringify({ ...board, items: [] }).length - (items.length ? 1 : 0),
  );
  if (report.bytes > MIRO_LIMITS.importBytes)
    issue("board-large", null, {
      size: Math.round(report.bytes / 1024 / 1024),
    });
  return { board, report };
}

// Short counts for logs and summaries.
export function reportTotals(report) {
  const sum = (bucket) =>
    Object.entries(bucket || {})
      .filter(([type]) => type !== "tag")
      .reduce((n, [, v]) => n + v, 0);
  return {
    source: sum(report.source),
    converted: sum(report.converted),
    skipped: report.skipped.length,
    warnings: report.warnings.length,
  };
}
