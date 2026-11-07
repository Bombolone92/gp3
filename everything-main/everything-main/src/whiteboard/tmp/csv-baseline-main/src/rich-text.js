import { validListStyle } from "./text-blocks.js";
import { textLinkURL } from "./text-link-data.js";
import { canonicalLanguage } from "./accessibility/language-tag.js";
// UTF-16 offsets match DOM selections and Y.Text. Styles are sparse overrides
// of the object's typography; explicit false can turn off an inherited style.
export const TEXT_STYLE_KEYS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "textColor",
  "highlight",
  "link",
  "lang",
];
const colors = new Set(["textColor", "highlight"]);
const same = (a, b) => TEXT_STYLE_KEYS.every((k) => a[k] === b[k]);
export function equalTextRuns(a = [], b = []) {
  return (
    a.length === b.length &&
    a.every(
      (run, n) =>
        run.start === b[n].start &&
        run.end === b[n].end &&
        same(run.style, b[n].style),
    )
  );
}
export function validTextStyle(style) {
  return (
    style &&
    typeof style === "object" &&
    !Array.isArray(style) &&
    Object.entries(style).every(
      ([key, value]) =>
        TEXT_STYLE_KEYS.includes(key) &&
        (key === "lang"
          ? !!canonicalLanguage(value)
          : key === "link"
            ? typeof value === "string" && !!textLinkURL(value)
            : colors.has(key)
              ? value === false ||
                (/^#[\da-f]{6}$/i.test(value) && typeof value === "string")
              : typeof value === "boolean"),
    )
  );
}
function boundary(text, n) {
  return !(
    n > 0 &&
    n < text.length &&
    /[\uD800-\uDBFF]/.test(text[n - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[n])
  );
}
export function validateTextRuns(text, runs) {
  if (runs === undefined) return;
  if (!Array.isArray(runs) || runs.length > text.length)
    throw Error("Invalid text formatting.");
  let end = 0;
  for (const run of runs) {
    if (
      !run ||
      Object.keys(run).some((k) => !["start", "end", "style"].includes(k)) ||
      !Number.isInteger(run.start) ||
      !Number.isInteger(run.end) ||
      run.start < end ||
      run.end <= run.start ||
      run.end > text.length ||
      !boundary(text, run.start) ||
      !boundary(text, run.end) ||
      !validTextStyle(run.style)
    )
      throw Error("Invalid text formatting.");
    end = run.end;
  }
}
export function appendRun(runs, start, end, style) {
  if (end <= start || !Object.keys(style).length) return;
  const last = runs.at(-1);
  if (last?.end === start && same(last.style, style)) last.end = end;
  else runs.push({ start, end, style: { ...style } });
}
export function textSegments(text, runs = []) {
  const result = [];
  let at = 0;
  for (const { start, end, style } of runs) {
    if (start >= text.length) break;
    if (start > at)
      result.push({
        start: at,
        end: start,
        text: text.slice(at, start),
        style: {},
      });
    result.push({
      start,
      end: Math.min(end, text.length),
      text: text.slice(start, end),
      style,
    });
    at = end;
  }
  if (at < text.length)
    result.push({
      start: at,
      end: text.length,
      text: text.slice(at),
      style: {},
    });
  return result;
}
export function styleAt(runs = [], at, before = true) {
  return (
    runs.find((r) =>
      before && at > 0
        ? r.start < at && r.end >= at
        : r.start <= at && r.end > at,
    )?.style || {}
  );
}
export function formatTextRuns(text, runs, start, end, patch) {
  const result = [];
  for (const segment of textSegments(text, runs)) {
    const a = Math.max(start, segment.start),
      b = Math.min(end, segment.end);
    if (a >= b) appendRun(result, segment.start, segment.end, segment.style);
    else {
      appendRun(result, segment.start, a, segment.style);
      const style = { ...segment.style };
      for (const [key, value] of Object.entries(patch)) {
        if (value == null) delete style[key];
        else style[key] = value;
      }
      appendRun(result, a, b, style);
      appendRun(result, b, segment.end, segment.style);
    }
  }
  return result;
}
export function textDifference(prev, next) {
  let start = 0,
    suffix = 0;
  while (
    start < prev.length &&
    start < next.length &&
    prev[start] === next[start]
  )
    start++;
  if (!boundary(prev, start) || !boundary(next, start)) start--;
  while (
    suffix < prev.length - start &&
    suffix < next.length - start &&
    prev.at(-suffix - 1) === next.at(-suffix - 1)
  )
    suffix++;
  if (
    !boundary(prev, prev.length - suffix) ||
    !boundary(next, next.length - suffix)
  )
    suffix--;
  return {
    start,
    end: prev.length - suffix,
    insert: next.slice(start, next.length - suffix),
  };
}
export function spliceTextRuns(
  runs = [],
  start,
  end,
  insert,
  style = styleAt(runs, start),
  formatting,
) {
  const result = [],
    shift = insert.length - (end - start);
  for (const r of runs)
    appendRun(result, r.start, Math.min(start, r.end), r.style);
  if (formatting) {
    for (const r of formatting) {
      if (r.start >= insert.length) break;
      appendRun(
        result,
        start + r.start,
        start + Math.min(insert.length, r.end),
        r.style,
      );
    }
  } else appendRun(result, start, start + insert.length, style);
  for (const r of runs)
    appendRun(result, Math.max(end, r.start) + shift, r.end + shift, r.style);
  return result;
}
export function replaceTextRuns(prev, next, runs) {
  const { start, end, insert } = textDifference(prev, next);
  return spliceTextRuns(runs, start, end, insert);
}
export function runsFromDelta(delta) {
  const runs = [];
  let at = 0;
  for (const op of delta) {
    const { block, ...attributes } = op.attributes || {};
    if (block !== undefined && !validListStyle(block))
      throw Error("Invalid shared text list.");
    if (typeof op.insert !== "string" || !validTextStyle(attributes))
      throw Error("Invalid shared text formatting.");
    appendRun(runs, at, at + op.insert.length, attributes);
    at += op.insert.length;
  }
  return runs;
}

export function sliceTextRuns(runs = [], start, end) {
  const result = [];
  let low = 0,
    high = runs.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (runs[mid].end <= start) low = mid + 1;
    else high = mid;
  }
  for (let n = low; n < runs.length && runs[n].start < end; n++) {
    const r = runs[n];
    appendRun(
      result,
      Math.max(start, r.start) - start,
      Math.min(end, r.end) - start,
      r.style,
    );
  }
  return result;
}
