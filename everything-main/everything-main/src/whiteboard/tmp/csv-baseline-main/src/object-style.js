import { canEditText, canAutoFitText, textStyle } from "./text.js";
import { appendRun } from "./rich-text.js";
import { fontFamily, validFontFamily } from "./fonts.js";

export const STYLE_STORAGE_KEY = "whiteboard-copied-style";
const colored = new Set([
  "note",
  "rect",
  "ellipse",
  "arrow",
  "pen",
  "table",
  "link",
  "file",
]);
const sized = new Set(["table", "link", "file"]);
const emphasis = ["bold", "italic", "underline", "strike"];
const lineDefaults = {
  lineType: "straight",
  lineStyle: "solid",
  lineWidth: 2.5,
  startCap: "none",
  endCap: "arrow",
};
const color = (value) =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
const size = (value) => Number.isFinite(value) && value >= 8 && value <= 100;
const keysOnly = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((k) => keys.includes(k));

export const canCopyStyle = (i) =>
  !!i && (colored.has(i.type) || canEditText(i));
export function canPasteStyle(i, style) {
  return !!(
    i &&
    style &&
    ((style.color !== undefined && colored.has(i.type)) ||
      (style.text && (canEditText(i) || sized.has(i.type))) ||
      (style.line && i.type === "arrow"))
  );
}

// A small, content-free snapshot can be reused across boards and tabs. Mixed
// text uses the first character's formatting; hyperlinks are never copied.
export function copyObjectStyle(i) {
  if (!canCopyStyle(i)) return null;
  const result = { version: 1 };
  if (colored.has(i.type))
    result.color =
      i.color ||
      (["table", "link", "file"].includes(i.type) ? "#ffffff" : "#f6e7a4");
  if (canEditText(i)) {
    const first = i.textRuns?.[0],
      range = first?.start === 0 ? first.style : {},
      source = { ...i, ...range, link: undefined },
      style = textStyle(source);
    result.text = {
      fontSize: style.size,
      fontFamily: fontFamily(i),
      textAlign: style.align,
      ...Object.fromEntries(emphasis.map((k) => [k, style[k]])),
      textColor: source.textColor || null,
      highlight: source.highlight || null,
    };
    if (canAutoFitText(i)) result.autoFontSize = !!i.autoFontSize;
  } else if (sized.has(i.type))
    result.text = {
      fontSize: i.fontSize || (i.type === "table" ? 15 : 18),
      fontFamily: fontFamily(i),
    };
  if (i.type === "arrow")
    result.line = Object.fromEntries(
      Object.entries(lineDefaults).map(([k, fallback]) => [
        k,
        i[k] ?? fallback,
      ]),
    );
  return result;
}

export function readObjectStyle(value) {
  try {
    if (typeof value !== "string" || value.length > 2048) return null;
    const s = JSON.parse(value);
    if (
      !keysOnly(s, ["version", "color", "text", "line", "autoFontSize"]) ||
      s.version !== 1 ||
      (!s.color && !s.text && !s.line)
    )
      return null;
    if (s.color !== undefined && !color(s.color)) return null;
    if (s.autoFontSize !== undefined && typeof s.autoFontSize !== "boolean")
      return null;
    if (s.text !== undefined) {
      if (
        !keysOnly(s.text, [
          "fontSize",
          "fontFamily",
          "textAlign",
          ...emphasis,
          "textColor",
          "highlight",
        ]) ||
        !size(s.text.fontSize)
      )
        return null;
      if (
        s.text.fontFamily !== undefined &&
        !validFontFamily(s.text.fontFamily)
      )
        return null;
      for (const key of emphasis)
        if (s.text[key] !== undefined && typeof s.text[key] !== "boolean")
          return null;
      for (const key of ["textColor", "highlight"])
        if (
          s.text[key] !== undefined &&
          s.text[key] !== null &&
          !color(s.text[key])
        )
          return null;
      if (
        s.text.textAlign !== undefined &&
        !["left", "center", "right"].includes(s.text.textAlign)
      )
        return null;
    }
    if (s.line !== undefined) {
      if (
        !keysOnly(s.line, Object.keys(lineDefaults)) ||
        !Number.isFinite(s.line.lineWidth) ||
        s.line.lineWidth < 1 ||
        s.line.lineWidth > 12
      )
        return null;
      for (const [key, values] of [
        ["lineType", ["straight", "elbow", "curved"]],
        ["lineStyle", ["solid", "dashed", "dotted"]],
        ["startCap", ["none", "arrow", "circle"]],
        ["endCap", ["none", "arrow", "circle"]],
      ])
        if (!values.includes(s.line[key])) return null;
    }
    return s;
  } catch {
    return null;
  }
}

// Return only actual changes so reapplying an identical style preserves redo.
// Target text, links, lists, geometry, grouping and connection IDs stay intact.
export function objectStylePatch(i, copied) {
  if (!canPasteStyle(i, copied)) return null;
  const patch = {};
  const put = (key, value, before = i[key]) => {
    if (before !== value) patch[key] = value;
  };
  if (copied.color !== undefined && colored.has(i.type))
    put(
      "color",
      copied.color,
      copyObjectStyle({ ...i, textRuns: undefined }).color,
    );
  if (copied.text && (canEditText(i) || sized.has(i.type))) {
    const style = textStyle(i);
    put(
      "fontSize",
      copied.text.fontSize,
      canEditText(i)
        ? style.size
        : i.fontSize || (i.type === "table" ? 15 : 18),
    );
    if (copied.text.fontFamily !== undefined)
      put("fontFamily", copied.text.fontFamily, fontFamily(i));
    if (canEditText(i)) {
      for (const [key, value] of Object.entries(copied.text)) {
        if (["fontSize", "fontFamily"].includes(key)) continue;
        put(
          key,
          value,
          key === "textAlign"
            ? style.align
            : emphasis.includes(key)
              ? style[key]
              : i[key] || null,
        );
      }
      const cleared = new Set(Object.keys(copied.text));
      if (
        i.textRuns?.some((r) =>
          Object.keys(r.style).some((k) => cleared.has(k)),
        )
      ) {
        const runs = [];
        for (const r of i.textRuns)
          appendRun(
            runs,
            r.start,
            r.end,
            Object.fromEntries(
              Object.entries(r.style).filter(([k]) => !cleared.has(k)),
            ),
          );
        patch.textRuns = runs.length ? runs : null;
      }
    }
  }
  if (copied.autoFontSize !== undefined && canAutoFitText(i))
    put("autoFontSize", copied.autoFontSize, !!i.autoFontSize);
  if (copied.line && i.type === "arrow")
    for (const [key, value] of Object.entries(copied.line))
      put(key, value, i[key] ?? lineDefaults[key]);
  return Object.keys(patch).length ? patch : null;
}
export function applyObjectStyle(i, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete i[key];
    else i[key] = value;
  }
}
