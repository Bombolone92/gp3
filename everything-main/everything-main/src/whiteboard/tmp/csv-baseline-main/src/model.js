import { validateTimer } from "./timer.js";
import { validatePlanning, validatePlanningFields } from "./planning/task.js";
import { validateTags, validateTagIds } from "./tags.js";
import { validateMindTrees, validMindMap } from "./mind-map.js";
import { visibleMindItems } from "./mind-visibility.js";
import { validTableSizes } from "./table-layout.js";
import { validateTableLanguages } from "./table-language.js";
import { validateTextBlocks } from "./text-blocks.js";
import { validateComments } from "./comments.js";
import { validateWorkshop } from "./facilitation/model.js";
import { validObjectLink } from "./object-link-data.js";
import { validFontFamily } from "./fonts.js";
import { validateTextRuns } from "./rich-text.js";
import { canonicalLanguage } from "./accessibility/language-tag.js";
import { connectorSegments, connectorLabel } from "./connectors.js";
import { hasLocked } from "./locking.js";
import { CUSTOM_SHAPES, shapeContains } from "./shapes.js";
import { validCrop, imageContentBox } from "./image-crop.js";
import { validEmbed, validSheetSource } from "./content/providers.js";
import {
  canRotateItem,
  rotationOf,
  objectBounds,
  localPoint,
  rotatePoint,
  centerOf,
} from "./geometry.js";
export const COLORS = [
  "#f6e7a4",
  "#d9e9d2",
  "#dce5f7",
  "#eadcf0",
  "#f3d6c8",
  "#ffffff",
];
export const uid = () => crypto.randomUUID();
export const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const clone = (value) => structuredClone(value);
// The most points one drawing may have.
export const PEN_POINTS = 20000;
// Adds a point to a drawing in progress. One under half a screen pixel from
// the last adds nothing visible, and a drawing stops at PEN_POINTS, as a
// longer one would leave its board unable to load. Says whether there was
// room for it.
export function extendDrawing(points, x, y, zoom) {
  if (points.length >= PEN_POINTS) return false;
  const [px, py] = points.at(-1);
  if (Math.hypot(x - px, y - py) * zoom >= 0.5) points.push([x, y]);
  return true;
}
export function item(type, x, y, extra = {}) {
  return {
    id: uid(),
    type,
    x,
    y,
    w: type === "text" ? 280 : 190,
    h: type === "text" ? 60 : 160,
    text: "",
    color: ["arrow", "pen"].includes(type) ? "#687169" : COLORS[0],
    ...(type === "note" ? { autoFontSize: true } : {}),
    ...extra,
  };
}
export function board(title = "Untitled board", template = "blank") {
  const b = {
    version: 1,
    id: uid(),
    title,
    updated: Date.now(),
    favorite: false,
    items: [],
  };
  if (template === "brainstorm")
    b.items = [
      item("text", 80, 55, {
        text: "Room for a great idea",
        w: 680,
        h: 65,
        fontSize: 36,
      }),
      item("text", 80, 130, {
        text: "Start with a question. Follow your curiosity.",
        w: 650,
        fontSize: 18,
      }),
      ...[
        "What if we…",
        "Something worth exploring",
        "A different perspective",
      ].map((text, i) =>
        item("note", 80 + i * 245, 240, {
          text,
          color: COLORS[i],
          w: 210,
          h: 190,
        }),
      ),
    ];
  if (template === "kanban")
    b.items = ["To do", "In progress", "Done"].flatMap((text, i) => [
      item("frame", 70 + i * 290, 60, {
        w: 270,
        h: 500,
        text,
        color: COLORS[i],
      }),
      item("note", 90 + i * 290, 140, {
        text: [
          "Your next step",
          "Make a little progress",
          "Celebrate the small wins",
        ][i],
        w: 230,
        h: 160,
        color: COLORS[i],
      }),
    ]);
  if (template === "mindmap") {
    const root = item("rect", 340, 180, {
      text: "The big idea",
      color: COLORS[1],
      w: 220,
      h: 90,
      fontSize: 24,
      textAlign: "center",
      autoFontSize: true,
      mindMap: { parent: null, direction: "right", auto: true, line: "curved" },
    });
    b.items = [
      root,
      ...["Explore", "Connect", "Build on it"].map((text, n) =>
        item("rect", 640, 78 + n * 104, {
          text,
          w: 200,
          h: 76,
          color: COLORS[n],
          fontSize: 20,
          textAlign: "center",
          autoFontSize: true,
          order: n + 1,
          mindMap: {
            parent: root.id,
            direction: "right",
            auto: true,
            line: "curved",
          },
        }),
      ),
    ];
  }
  return b;
}
// The EXIF orientation of a JPEG APP1 segment starting at `n`, and where its
// value is stored, or null. `at` reads one byte.
function exifOrientation(at, n, end) {
  const t = n + 10;
  if (
    String.fromCharCode(at(n + 4), at(n + 5), at(n + 6), at(n + 7)) !==
      "Exif" ||
    t + 8 > end
  )
    return null;
  const little = at(t) === 0x49 && at(t + 1) === 0x49;
  if (!little && !(at(t) === 0x4d && at(t + 1) === 0x4d)) return null;
  const u16 = (k) =>
    little ? at(k) | (at(k + 1) << 8) : (at(k) << 8) | at(k + 1);
  const u32 = (k) =>
    little
      ? (u16(k) + u16(k + 2) * 65536) >>> 0
      : (u16(k) * 65536 + u16(k + 2)) >>> 0;
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return null;
  for (let k = 0, count = u16(ifd); k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? { value, at: entry + 8, little } : null;
    }
  }
  return null;
}
// Where a JPEG's EXIF orientation is stored, so a copy can be drawn without
// it, or null when it has none.
export function jpegOrientation(bytes) {
  const at = (n) => bytes[n],
    be = (n) => (at(n) << 8) | at(n + 1);
  if (at(0) !== 0xff || at(1) !== 0xd8) return null;
  for (let n = 2; n + 9 < bytes.length;) {
    if (at(n) !== 0xff) return null;
    const marker = at(n + 1);
    if (marker === 0xff) {
      n++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      n += 2;
      continue;
    }
    if (marker === 0xe1) {
      const found = exifOrientation(
        at,
        n,
        Math.min(bytes.length, n + 2 + be(n + 2)),
      );
      if (found) return found;
    }
    // Metadata comes before the image data.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    )
      return null;
    n += 2 + be(n + 2);
  }
  return null;
}
// Declared image dimensions from PNG, JPEG or WebP headers, or null when they
// cannot be read. Imported files are checked without decoding the images.
// A JPEG's EXIF orientation is applied, as browsers do, so the size is the
// image as shown; `orientation` says how its stored pixels turn (1 to 8).
// Reads an image's size from the start of its data: the first 256 KB unless
// `limit` (in base64 characters) asks for more.
export function imageSize(src, limit = 349524) {
  const comma = typeof src === "string" ? src.indexOf(",") : -1;
  if (comma < 0) return null;
  let bytes;
  try {
    bytes = atob(src.slice(comma + 1, comma + 1 + limit));
  } catch {
    return null;
  }
  const at = (n) => bytes.charCodeAt(n),
    be = (n) => (at(n) << 8) | at(n + 1);
  if (bytes.startsWith("\x89PNG\r\n\x1a\n") && bytes.slice(12, 16) === "IHDR")
    return {
      width: be(16) * 65536 + be(18),
      height: be(20) * 65536 + be(22),
    };
  if (bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP") {
    const chunk = bytes.slice(12, 16);
    if (chunk === "VP8X")
      return {
        width: 1 + at(24) + (at(25) << 8) + at(26) * 65536,
        height: 1 + at(27) + (at(28) << 8) + at(29) * 65536,
      };
    if (chunk === "VP8 ")
      return {
        width: (at(26) | (at(27) << 8)) & 0x3fff,
        height: (at(28) | (at(29) << 8)) & 0x3fff,
      };
    if (chunk === "VP8L")
      return {
        width: 1 + (((at(22) & 0x3f) << 8) | at(21)),
        height: 1 + (((at(24) & 0xf) << 10) | (at(23) << 2) | (at(22) >> 6)),
      };
    return null;
  }
  if (!bytes.startsWith("\xff\xd8")) return null;
  let orientation = 1;
  for (let n = 2; n + 9 < bytes.length;) {
    if (at(n) !== 0xff) return null;
    const marker = at(n + 1);
    if (marker === 0xff) {
      n++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      n += 2;
      continue;
    }
    if (marker === 0xe1 && orientation === 1)
      orientation =
        exifOrientation(at, n, Math.min(bytes.length, n + 2 + be(n + 2)))
          ?.value || 1;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      const width = be(n + 7),
        height = be(n + 5);
      return orientation >= 5
        ? { width: height, height: width, orientation }
        : { width, height, orientation };
    }
    n += 2 + be(n + 2);
  }
  return null;
}
export function assertImagePixels(items) {
  for (const i of items) {
    const size = i.type === "image" && imageSize(i.src);
    if (size && size.width * size.height > 40_000_000)
      throw Error("Choose an image with fewer than 40 million pixels.");
  }
}
export function validateBoard(value) {
  if (
    !value ||
    value.version !== 1 ||
    typeof value.title !== "string" ||
    value.title.length > 200 ||
    !Array.isArray(value.items) ||
    value.items.length > 5000
  )
    throw Error("This is not a supported Whiteboard file.");
  validateComments(value.comments);
  validateTimer(value.timer);
  validateWorkshop(value.workshop);
  validateTags(value.tags);
  validatePlanning(value.planning);
  const tagIds = new Set((value.tags || []).map((t) => t.id));
  const ids = new Set();
  for (const i of value.items) {
    validateTagIds(i, tagIds);
    validatePlanningFields(i);
    if (
      ![
        "note",
        "text",
        "rect",
        "ellipse",
        "arrow",
        "pen",
        "frame",
        "image",
        "link",
        "table",
        "file",
        "embed",
      ].includes(i.type) ||
      typeof i.id !== "string" ||
      ids.has(i.id) ||
      !["x", "y", "w", "h"].every(
        (k) => Number.isFinite(i[k]) && Math.abs(i[k]) <= 1e6,
      ) ||
      (i.text != null &&
        (typeof i.text !== "string" || i.text.length > 20000)) ||
      (i.color != null && !/^#[\da-f]{6}$/i.test(i.color))
    )
      throw Error("The board contains an invalid object.");
    if (
      i.rotation !== undefined &&
      (!canRotateItem(i) ||
        !Number.isFinite(i.rotation) ||
        i.rotation < -180 ||
        i.rotation >= 180)
    )
      throw Error("Invalid object rotation.");
    if (
      i.type === "image" &&
      (typeof i.src !== "string" ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(i.src))
    )
      throw Error("Unsupported image format.");
    if (i.crop !== undefined && (i.type !== "image" || !validCrop(i.crop)))
      throw Error("Invalid image crop.");
    // Alternative text describes an image or drawing for screen readers and exports.
    if (
      i.alt !== undefined &&
      (!["image", "pen"].includes(i.type) ||
        typeof i.alt !== "string" ||
        i.alt.length > 1000)
    )
      throw Error("Invalid alternative text.");
    if (
      i.type === "pen" &&
      (!Array.isArray(i.points) ||
        i.points.length > PEN_POINTS ||
        !i.points.every(
          (p) =>
            Array.isArray(p) &&
            p.length === 2 &&
            p.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6),
        ))
    )
      throw Error("Invalid drawing.");
    if (i.lang !== undefined && !canonicalLanguage(i.lang))
      throw Error("Invalid content language.");
    validateTextRuns(i.text || "", i.textRuns);
    validateTextBlocks(i.text || "", i.textBlocks);
    if (
      i.highlight != null &&
      (typeof i.highlight !== "string" || !/^#[\da-f]{6}$/i.test(i.highlight))
    )
      throw Error("Invalid text highlight.");
    if (i.fontFamily !== undefined && !validFontFamily(i.fontFamily))
      throw Error("Invalid font family.");
    if (
      i.fontSize != null &&
      (!Number.isFinite(i.fontSize) || i.fontSize < 8 || i.fontSize > 100)
    )
      throw Error("Invalid font size.");
    if (i.shape != null && (i.type !== "rect" || !CUSTOM_SHAPES.has(i.shape)))
      throw Error("Invalid shape.");
    if (
      i.autoFontSize != null &&
      (typeof i.autoFontSize !== "boolean" ||
        !["note", "rect", "ellipse"].includes(i.type))
    )
      throw Error("Invalid text style.");
    if (
      i.autoHeight != null &&
      (typeof i.autoHeight !== "boolean" || i.type !== "text")
    )
      throw Error("Invalid text style.");
    if (
      i.textColor != null &&
      (typeof i.textColor !== "string" || !/^#[\da-f]{6}$/i.test(i.textColor))
    )
      throw Error("Invalid text color.");
    if (
      i.textAlign != null &&
      !["left", "center", "right"].includes(i.textAlign)
    )
      throw Error("Invalid text alignment.");
    for (const key of ["bold", "italic", "underline", "strike"])
      if (i[key] != null && typeof i[key] !== "boolean")
        throw Error("Invalid text style.");
    for (const [key, allowed] of [
      ["lineType", ["straight", "elbow", "curved"]],
      ["routeAxis", ["x", "y"]],
      ["lineStyle", ["solid", "dashed", "dotted"]],
      ["startCap", ["none", "arrow", "circle"]],
      ["endCap", ["none", "arrow", "circle"]],
    ])
      if (i[key] != null && !allowed.includes(i[key]))
        throw Error("Invalid line style.");
    if (
      i.lineWidth != null &&
      (!Number.isFinite(i.lineWidth) || i.lineWidth < 1 || i.lineWidth > 12)
    )
      throw Error("Invalid line thickness.");
    if (i.type === "link") {
      try {
        if (!["https:", "http:"].includes(new URL(i.url).protocol))
          throw Error();
      } catch {
        throw Error("Enter a valid http or https link.");
      }
    }
    // Embeds derive their iframe address from a canonical provider URL.
    if (i.type === "embed" ? !validEmbed(i) : i.provider !== undefined)
      throw Error("Invalid embed.");
    if (
      i.sourceUrl !== undefined &&
      (i.type !== "table" || !validSheetSource(i.sourceUrl))
    )
      throw Error("Invalid table source.");
    if (i.objectLink !== undefined && !validObjectLink(i.objectLink))
      throw Error("Invalid object link.");
    if (
      i.type === "table" &&
      (!Array.isArray(i.cells) ||
        i.cells.length < 1 ||
        i.cells.length > 20 ||
        !i.cells.every(
          (row) =>
            Array.isArray(row) &&
            row.length >= 1 &&
            row.length <= 12 &&
            row.length === i.cells[0].length &&
            row.every(
              (cell) => typeof cell === "string" && cell.length <= 2000,
            ),
        ))
    )
      throw Error("Invalid table.");
    if (!validTableSizes(i)) throw Error("Invalid table dimensions.");
    validateTableLanguages(i);
    // Object names, search, and export read cells from any object that has them.
    if (i.cells != null && i.type !== "table") throw Error("Invalid table.");
    if (
      i.type === "file" &&
      (typeof i.fileName !== "string" ||
        i.fileName.length > 255 ||
        typeof i.data !== "string" ||
        i.data.length > 15 * 1024 * 1024 ||
        !/^data:application\/octet-stream;base64,[A-Za-z0-9+/=]*$/.test(i.data))
    )
      throw Error("Invalid attachment.");
    // Labels fall back to the file name and address on any object, so these
    // must be text wherever they appear.
    for (const key of ["fileName", "url", "mimeType"])
      if (i[key] !== undefined && typeof i[key] !== "string")
        throw Error("The board contains an invalid object.");
    if (i.size !== undefined && !(Number.isFinite(i.size) && i.size >= 0))
      throw Error("The board contains an invalid object.");
    if (!["arrow", "pen"].includes(i.type) && (i.w <= 0 || i.h <= 0))
      throw Error("Object dimensions must be positive.");
    for (const key of ["groupId", "parentId", "startId", "endId"])
      if (i[key] != null && (typeof i[key] !== "string" || i[key].length > 100))
        throw Error("Invalid object relationship.");
    if (i.locked != null && typeof i.locked !== "boolean")
      throw Error("Invalid object lock.");
    if (i.order != null && !Number.isFinite(i.order))
      throw Error("Invalid frame order.");
    if (i.mindMap !== undefined && !validMindMap(i))
      throw Error("Invalid mind map node.");
    if (
      i.mindCollapsed !== undefined &&
      (!i.mindMap || typeof i.mindCollapsed !== "boolean")
    )
      throw Error("Invalid mind map collapse state.");
    ids.add(i.id);
  }
  validateMindTrees(value.items);
  const byId = new Map(value.items.map((i) => [i.id, i]));
  for (const i of value.items) {
    if (
      i.parentId &&
      (!byId.has(i.parentId) ||
        byId.get(i.parentId).type !== "frame" ||
        i.type === "frame")
    )
      throw Error("Invalid frame membership.");
    if (i.startId || i.endId) {
      if (
        i.type !== "arrow" ||
        (i.startId && i.startId === i.endId) ||
        [i.startId, i.endId]
          .filter(Boolean)
          .some(
            (id) =>
              !byId.has(id) ||
              ["arrow", "pen", "frame"].includes(byId.get(id).type),
          )
      )
        throw Error("Invalid connector.");
    }
  }
  return value;
}
// Board data is JSON-compatible. Copy objects and arrays but share strings,
// which are immutable: structuredClone duplicated embedded image data in each
// of the 80 undo steps.
const snapshot = (value) =>
  Array.isArray(value)
    ? value.map(snapshot)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).map(([key, v]) => [key, snapshot(v)]),
        )
      : value;
export class History {
  constructor() {
    this.past = [];
    this.future = [];
  }
  push(items) {
    this.past.push(snapshot(items));
    if (this.past.length > 80) this.past.shift();
    this.future = [];
  }
  undo(items) {
    if (!this.past.length) return items;
    this.future.push(snapshot(items));
    return this.past.pop();
  }
  redo(items) {
    if (!this.future.length) return items;
    this.past.push(snapshot(items));
    return this.future.pop();
  }
}
export function bounds(items) {
  if (!items.length) return { x: 0, y: 0, w: 900, h: 600 };
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  const include = (i) => {
    left = Math.min(left, i.x, i.x + i.w);
    top = Math.min(top, i.y, i.y + i.h);
    right = Math.max(right, i.x, i.x + i.w);
    bottom = Math.max(bottom, i.y, i.y + i.h);
  };
  for (const i of items) {
    include(rotationOf(i) ? objectBounds(i) : i);
    if (i.type === "arrow" && i.text) include(connectorLabel(i));
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
export function zoomAt(view, point, next) {
  next = Math.max(0.15, Math.min(3, next));
  return {
    x: point.x - ((point.x - view.x) * next) / view.z,
    y: point.y - ((point.y - view.y) * next) / view.z,
    z: next,
  };
}

export function segmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
// Frames stay behind content, regardless of creation or imported array order.
// Iterate without sorting or allocating a second scene on every repaint.
export function* stackedItems(items, reverse = false) {
  for (const frames of reverse ? [false, true] : [true, false]) {
    for (
      let n = reverse ? items.length - 1 : 0;
      reverse ? n >= 0 : n < items.length;
      n += reverse ? -1 : 1
    ) {
      if ((items[n].type === "frame") === frames) yield items[n];
    }
  }
}
// The topmost selected object whose box holds `p`. Pressing the empty
// parts of a selected drawing, connector or shape moves it, as pressing its
// visible parts does, rather than clearing the selection.
export function selectedAt(items, selection, p, tolerance = 0) {
  if (!selection.size) return null;
  for (const i of stackedItems(visibleMindItems(items), true)) {
    if (!selection.has(i.id)) continue;
    const { x, y } = localPoint(i, p);
    if (
      x >= Math.min(i.x, i.x + i.w) - tolerance &&
      x <= Math.max(i.x, i.x + i.w) + tolerance &&
      y >= Math.min(i.y, i.y + i.h) - tolerance &&
      y <= Math.max(i.y, i.y + i.h) + tolerance
    )
      return i;
  }
  return null;
}
export function hitTest(items, p, tolerance = 8, accept = null) {
  for (const i of stackedItems(visibleMindItems(items), true)) {
    if (accept && !accept(i)) continue;
    const point = localPoint(i, p),
      x = point.x - i.x,
      y = point.y - i.y;
    if (i.type === "arrow") {
      const label = i.text && connectorLabel(i);
      if (
        label &&
        p.x >= label.x &&
        p.x <= label.x + label.w &&
        p.y >= label.y &&
        p.y <= label.y + label.h
      )
        return i;
      const margin = tolerance + (i.lineWidth || 2.5) / 2;
      if (
        x < Math.min(0, i.w) - margin ||
        x > Math.max(0, i.w) + margin ||
        y < Math.min(0, i.h) - margin ||
        y > Math.max(0, i.h) + margin
      )
        continue;
      const points = connectorSegments(i, tolerance / 4);
      for (let n = 1; n < points.length; n++)
        if (segmentDistance(p, points[n - 1], points[n]) <= margin) return i;
    } else if (i.type === "pen") {
      if (
        i.points.length === 1 &&
        Math.hypot(x - i.points[0][0], y - i.points[0][1]) <= tolerance
      )
        return i;
      for (let j = 1; j < i.points.length; j++)
        if (
          segmentDistance(
            { x, y },
            { x: i.points[j - 1][0], y: i.points[j - 1][1] },
            { x: i.points[j][0], y: i.points[j][1] },
          ) <= tolerance
        )
          return i;
    } else if (i.type === "rect" && i.shape) {
      if (shapeContains(i, x, y)) return i;
    } else if (i.type === "image" && i.crop?.sourceAspect) {
      const b = imageContentBox(i),
        u = (point.x - b.x) / b.w,
        v = (point.y - b.y) / b.h;
      if (
        i.crop.mask === "ellipse"
          ? (u * 2 - 1) ** 2 + (v * 2 - 1) ** 2 <= 1
          : u >= 0 && u <= 1 && v >= 0 && v <= 1
      )
        return i;
    } else if (
      i.type === "ellipse" ||
      (i.type === "image" && i.crop?.mask === "ellipse")
    ) {
      if (
        ((x - i.w / 2) / (i.w / 2)) ** 2 + ((y - i.h / 2) / (i.h / 2)) ** 2 <=
        1
      )
        return i;
    } else if (i.type === "frame") {
      if (
        x >= -tolerance &&
        y >= -tolerance &&
        x <= i.w + tolerance &&
        y <= i.h + tolerance &&
        (y < 45 || x < tolerance || x > i.w - tolerance || y > i.h - tolerance)
      )
        return i;
    } else if (x >= 0 && y >= 0 && x <= i.w && y <= i.h) return i;
  }
  return null;
}
// Selection is already expanded for group/frame membership by the editor.
export function resizeBounds(items, selection, frameId = null) {
  let chosen = visibleMindItems(items).filter(
    (i) =>
      selection.has(i.id) && !(i.type === "arrow" && (i.startId || i.endId)),
  );
  const frame = chosen.find(
    (i) => i.id === frameId && i.type === "frame" && !i.groupId,
  );
  if (frame) chosen = [frame];
  if (
    !chosen.length ||
    (chosen.length === 1 && ["pen", "arrow"].includes(chosen[0].type))
  )
    return null;
  const single =
    chosen.length === 1 && rotationOf(chosen[0]) ? chosen[0] : null;
  const box = single
    ? {
        x: single.x,
        y: single.y,
        w: single.w,
        h: single.h,
        rotation: rotationOf(single),
      }
    : bounds(chosen);
  return box.w > 0 && box.h > 0 ? box : null;
}
export function resizeHit(items, selection, p, zoom, frameId = null) {
  if (hasLocked(items, selection)) return null;
  const box = resizeBounds(items, selection, frameId);
  if (box?.rotation) p = rotatePoint(p, centerOf(box), -box.rotation);
  return box &&
    Math.abs(p.x - box.x - box.w) < 12 / zoom &&
    Math.abs(p.y - box.y - box.h) < 12 / zoom
    ? selection.size === 1
      ? [...selection][0]
      : "selection"
    : null;
}
