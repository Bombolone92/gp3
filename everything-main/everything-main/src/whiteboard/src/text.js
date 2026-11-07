import { setObjectHeight } from "./geometry.js";
import { tagFooter } from "./tags.js";
import { listRows } from "./text-blocks.js";
import { fontFamily, fontStack } from "./fonts.js";
import { linkColor } from "./text-link-data.js";
import { textSegments, sliceTextRuns } from "./rich-text.js";
import { shapeTextBox } from "./shapes.js";
export const canEditText = (i) =>
  ["note", "text", "rect", "ellipse", "frame", "arrow"].includes(i.type);
// Tables take a size, family, weight, slant and alignment for all their
// cells, not the other text styles.
export const TABLE_TEXT_KEYS = [
  "fontSize",
  "fontFamily",
  "bold",
  "italic",
  "textAlign",
];
export const formatsText = (i) => canEditText(i) || i.type === "table";
export const canAutoFitText = (i) =>
  ["note", "rect", "ellipse"].includes(i.type);

// Sticky notes and shapes hold their text at the top, middle or bottom.
// Library shapes and auto-fitted ellipses have always centred theirs, and
// other notes, rectangles and ellipses began at the top, which is what an
// unset value keeps.
export const VERTICAL_ALIGNMENTS = ["top", "middle", "bottom"];
export const textValign = (i) =>
  i.textValign ||
  ((i.type === "ellipse" && i.autoFontSize) || (i.type === "rect" && i.shape)
    ? "middle"
    : "top");
// Where the first line starts in a box `h` high holding `height` of text.
export function textTop(i, h, height, padding) {
  const valign = canAutoFitText(i) ? textValign(i) : "top";
  return valign === "middle"
    ? Math.max(padding, (h - height) / 2)
    : valign === "bottom"
      ? Math.max(padding, h - height - padding)
      : padding;
}
// Whether the text is laid out in the object's text box with that start,
// rather than simply from the top.
export const boxedText = (i) =>
  (i.type === "rect" && !!i.shape) ||
  (canAutoFitText(i) && textValign(i) !== "top");
// Text boxes have no padding, so an accent on a capital (É, À, Â) on the
// first line rises above the box; their clip leaves room for it.
export function textClip(i, area, size) {
  if (i.type !== "text") return area;
  const room = Math.ceil(size * 0.4);
  return { ...area, y: area.y - room, h: area.h + room };
}

let fittedLayouts = new WeakMap();
let heightLayouts = new WeakMap();
let richLayouts = new WeakMap();
// Counts the times the layouts were cleared, for pictures drawn from them.
let layoutVersion = 0;
export const textLayoutVersion = () => layoutVersion;
export function clearTextLayoutCache() {
  layoutVersion++;
  fittedLayouts = new WeakMap();
  heightLayouts = new WeakMap();
  richLayouts = new WeakMap();
  listLayouts = new WeakMap();
  wrappedLines.clear();
}
// Plain wrapping for table cells, cards and shapes is keyed by font, width and
// text so repaints reuse measurements. Font loads clear it with the layouts.
// Each repaint asks for the visible strings in the same order, so the cache
// holds as many as a zoomed-out board of tables shows, and the least
// recently drawn go first: evicting the oldest of more strings than fit
// would miss on every lookup.
const wrappedLines = new Map(),
  WRAPPED_LINES = 20000;
export function cachedWrapText(ctx, text, width) {
  const key = `${ctx.font}\n${width}\n${text}`;
  let lines = wrappedLines.get(key);
  if (lines) wrappedLines.delete(key);
  else {
    lines = wrapText(ctx, text, width);
    if (wrappedLines.size >= WRAPPED_LINES)
      wrappedLines.delete(wrappedLines.keys().next().value);
  }
  wrappedLines.set(key, lines);
  return lines;
}

export const growsWithText = (i) => i.type === "text" && i.autoHeight === true;

// Keep four layouts per object/context, the most recently used first: each
// keystroke lays out the draft, the draft up to the caret and the saved text
// the board still draws, so a shorter list remeasured all three.
// Height is derived from width and typography; movement never remeasures it.
export function autoHeightLayout(
  i,
  ctx,
  text = i.text || "",
  runs = i.textRuns,
  blocks = i.textBlocks,
) {
  const style = textStyle(i),
    width = Math.max(1, Math.abs(i.w));
  let contexts = heightLayouts.get(i);
  const cached = contexts?.get(ctx) || [];
  const hit = heightHit(cached, i, style, width, text, runs, blocks);
  if (hit) {
    if (hit !== cached[0])
      contexts.set(ctx, [hit, ...cached.filter((c) => c !== hit)]);
    return hit.layout;
  }
  ctx.font = style.font;
  const richLines = blocks?.length
    ? listTextLayout(i, ctx, width, text, runs, blocks)
    : runs?.length
      ? richTextLayout(i, ctx, width, text, runs)
      : null;
  const lines = richLines ? richLines.map((line) => line.text) : [];
  for (const paragraph of richLines
    ? []
    : text
        .replace(/\r\n?/g, "\n")
        .replace(/\t/g, "    ")
        .split(/[\n\u2028]/)) {
    let line = "";
    for (const token of paragraph.match(/ +|[^ ]+/g) || []) {
      // pre-wrap spaces at the end of a line hang outside its wrapping width.
      if (/^ +$/.test(token)) {
        line += token;
        continue;
      }
      if (line && ctx.measureText(line + token).width > width) {
        lines.push(line);
        line = "";
      }
      if (ctx.measureText(token).width > width) {
        const chunks = wrapText(ctx, token, width);
        lines.push(...chunks.slice(0, -1));
        line += chunks.at(-1);
      } else line += token;
    }
    lines.push(line);
  }
  const height = Math.ceil(lines.length * style.size * 1.35) + tagFooter(i);
  const layout = {
    lines,
    richLines,
    height: Math.min(1e6, height),
    overflow: height > 1e6,
  };
  if (!contexts) heightLayouts.set(i, (contexts = new WeakMap()));
  contexts.set(ctx, [
    {
      width,
      font: style.font,
      text,
      runs,
      blocks,
      color: style.color,
      decoration: style.decoration,
      highlight: i.highlight,
      lang: i.lang,
      footer: tagFooter(i),
      layout,
    },
    ...cached.slice(0, 3),
  ]);
  return layout;
}

// The cached height layout made for the same text, width and style.
function heightHit(cached, i, style, width, text, runs, blocks) {
  return cached.find(
    (c) =>
      c.width === width &&
      c.font === style.font &&
      c.text === text &&
      c.runs === runs &&
      c.blocks === blocks &&
      c.color === style.color &&
      c.decoration === style.decoration &&
      c.highlight === i.highlight &&
      c.lang === i.lang &&
      c.footer === tagFooter(i),
  );
}
// The height layout already made for the object with this text, if any,
// without making one.
export function cachedAutoHeightLayout(
  i,
  ctx,
  text = i.text || "",
  runs = i.textRuns,
  blocks = i.textBlocks,
) {
  const hit = heightHit(
    heightLayouts.get(i)?.get(ctx) || [],
    i,
    textStyle(i),
    Math.max(1, Math.abs(i.w)),
    text,
    runs,
    blocks,
  );
  return hit?.layout || null;
}

export function reflowTextItems(items, ctx) {
  let changed = false;
  for (const i of items) {
    if (!growsWithText(i)) continue;
    const height = autoHeightLayout(i, ctx).height;
    if (i.h !== height) {
      setObjectHeight(i, height);
      changed = true;
    }
  }
  return changed;
}

// What an object's fitted layout depends on.
const fitSignature = (i, base, text, runs, blocks) => [
  i.w,
  i.h,
  i.type,
  i.shape,
  i.textValign,
  tagFooter(i),
  base.font,
  base.color,
  base.align,
  base.decoration,
  i.highlight,
  i.lang,
  runs,
  blocks,
  text,
];
// The fitted layout already made for the object with this text, if any,
// without making one.
export function cachedFitTextLayout(
  i,
  ctx,
  text = i.text || "",
  defaultColor,
  runs = i.textRuns,
  blocks = i.textBlocks,
) {
  const signature = fitSignature(
      i,
      textStyle(i, defaultColor),
      text,
      runs,
      blocks,
    ),
    cached = fittedLayouts.get(i)?.get(ctx);
  return cached && signature.every((value, n) => value === cached.signature[n])
    ? cached.layout
    : null;
}
// Font size is derived, never written to the object. Each context caches the
// latest layout per object, so panning and repainting do not remeasure text.
// Fitting shrinks text to keep a word whole only down to this size.
const READABLE = 12;
const NO_SPACES =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
export function fitTextLayout(
  i,
  ctx,
  text = i.text || "",
  defaultColor,
  runs = i.textRuns,
  blocks = i.textBlocks,
) {
  const base = textStyle(i, defaultColor);
  const signature = fitSignature(i, base, text, runs, blocks);
  let contexts = fittedLayouts.get(i);
  const cached = contexts?.get(ctx);
  if (cached && signature.every((value, n) => value === cached.signature[n]))
    return cached.layout;
  const box =
    i.type === "ellipse"
      ? {
          x: (i.w * (1 - Math.SQRT1_2)) / 2,
          y: (i.h * (1 - Math.SQRT1_2)) / 2,
          w: i.w * Math.SQRT1_2,
          h: i.h * Math.SQRT1_2,
        }
      : shapeTextBox(i);
  box.h = Math.max(0, box.h - tagFooter(i));
  const padding = Math.max(0, Math.min(base.padding, box.w / 10, box.h / 10));
  const width = Math.max(1, box.w - padding * 2);
  const height = Math.max(0, box.h - padding * 2);
  // Words that would fit whole at a readable size also count as overflow
  // when they have to be split, so fitting shrinks text instead of breaking
  // words. Widths scale with the size, so they are measured once at 8px.
  // Longer words, such as an email address or a link, would shrink the
  // whole note to the minimum; they wrap as before, as do scripts written
  // without spaces.
  let words = null;
  const splitsWords = (size) => {
    if (!words) {
      const font = ctx.font;
      ctx.font = textStyle({ ...i, fontSize: 8 }, defaultColor).font;
      words = [];
      for (const word of text.split(/[^\S\u00a0\u2007\u202f\ufeff]+/))
        if (word.length > 1 && !NO_SPACES.test(word)) {
          const at8 = ctx.measureText(word).width;
          if ((at8 * READABLE) / 8 <= width) words.push(at8);
        }
      ctx.font = font;
    }
    return words.some((at8) => (at8 * size) / 8 > width + 1e-6);
  };
  const measure = (size) => {
    const style = {
      ...textStyle({ ...i, fontSize: size }, defaultColor),
      padding,
    };
    ctx.font = style.font;
    const richLines = blocks?.length
      ? listTextLayout(
          { ...i, fontSize: size },
          ctx,
          width,
          text,
          runs,
          blocks,
          defaultColor,
        )
      : runs?.length
        ? richTextLayout(
            { ...i, fontSize: size },
            ctx,
            width,
            text,
            runs,
            defaultColor,
          )
        : null;
    const lines = richLines
      ? richLines.map((line) => line.text)
      : wrapText(ctx, text, width);
    // Empty text fits anywhere: a small shape with no label is not
    // reported as too small for one.
    const overflow =
      !!text &&
      (lines.length * size * 1.35 > height + 1e-6 ||
        splitsWords(size) ||
        (richLines
          ? richLines.some(
              (line) => line.width + (line.indent || 0) > width + 1e-6,
            )
          : lines.some((line) => ctx.measureText(line).width > width + 1e-6)));
    return { style, lines, richLines, overflow };
  };
  let layout = measure(base.size);
  if (layout.overflow && base.size > 8) {
    layout = measure(8);
    if (!layout.overflow) {
      let low = 32,
        high = Math.floor(base.size * 4);
      // Quarter-pixel steps bound the search to nine measurements, even at 100px.
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = measure(middle / 4);
        if (candidate.overflow) high = middle - 1;
        else {
          low = middle;
          layout = candidate;
        }
      }
    }
  }
  layout.box = box;
  layout.top = textTop(
    i,
    box.h,
    layout.lines.length * layout.style.size * 1.35,
    padding,
  );
  if (!contexts) fittedLayouts.set(i, (contexts = new WeakMap()));
  contexts.set(ctx, { signature, layout });
  return layout;
}

// Shared by the canvas renderer and the native text editor.
export function textStyle(i, defaultColor = "#30342f") {
  const size =
    i.fontSize || (i.type === "text" ? 28 : i.type === "arrow" ? 16 : 19);
  const bold = i.bold ?? i.type === "frame";
  return {
    size,
    bold,
    italic: !!i.italic,
    underline: !!i.underline || !!i.link,
    strike: !!i.strike,
    highlight: i.highlight,
    lang: i.lang,
    family: fontFamily(i),
    font: `${i.italic ? "italic " : ""}${bold ? 600 : 400} ${size}px ${fontStack(fontFamily(i))}`,
    link: i.link,
    autoLinkColor:
      !!i.link && !i.textColor && ["text", "frame"].includes(i.type),
    autoColor: !i.link && !i.textColor && ["text", "frame"].includes(i.type),
    color:
      i.textColor ||
      (i.link &&
        linkColor(
          ["text", "frame"].includes(i.type) ? defaultColor : undefined,
        )) ||
      (["text", "frame"].includes(i.type) ? defaultColor : "#30342f"),
    align:
      i.textAlign ||
      (i.type === "arrow" || (i.type === "rect" && i.shape)
        ? "center"
        : "left"),
    padding:
      i.type === "text"
        ? 0
        : i.type === "rect" && i.shape
          ? Math.min(8, i.w * 0.05, i.h * 0.05)
          : ["arrow", "connector-label"].includes(i.type)
            ? 8
            : 16,
    decoration:
      [(i.underline || i.link) && "underline", i.strike && "line-through"]
        .filter(Boolean)
        .join(" ") || "none",
  };
}

export function shapeTextLayout(
  i,
  ctx,
  text = i.text || "",
  runs = i.textRuns,
  blocks = i.textBlocks,
) {
  const box = shapeTextBox(i),
    style = textStyle(i);
  // Text ends above a task's footer row, which is drawn inside the shape.
  const footer = tagFooter(i);
  if (footer)
    box.h = Math.max(0, Math.min(box.h, Math.abs(i.h) - footer - box.y));
  ctx.font = style.font;
  const width = Math.max(1, box.w - style.padding * 2);
  const richLines = blocks?.length
    ? listTextLayout(i, ctx, width, text, runs, blocks)
    : runs?.length
      ? richTextLayout(i, ctx, width, text, runs)
      : null;
  // Shapes are laid out on every repaint, so their wrapping is reused.
  const lines = richLines
    ? richLines.map((line) => line.text)
    : cachedWrapText(ctx, text, width);
  return {
    box,
    lines,
    richLines,
    top: textTop(i, box.h, lines.length * style.size * 1.35, style.padding),
  };
}
// Centered, right-aligned and decorated plain lines need their widths on
// every repaint. Cached wrappings keep their lines, so the widths measured
// for them are kept alongside until the font changes.
const lineWidths = new WeakMap();
export function wrappedLineWidths(ctx, lines, trimEnd = false) {
  let entry = lineWidths.get(lines);
  if (!entry || entry.font !== ctx.font || entry.trimEnd !== trimEnd) {
    entry = {
      font: ctx.font,
      trimEnd,
      widths: lines.map(
        (line) =>
          ctx.measureText(trimEnd ? line.replace(/ +$/, "") : line).width,
      ),
    };
    lineWidths.set(lines, entry);
  }
  return entry.widths;
}

// Long words break between grapheme clusters, so an emoji sequence, a flag
// or a letter with its combining marks never splits across two lines.
const segmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
export const graphemes = (text) =>
  segmenter
    ? Array.from(segmenter.segment(text), (part) => part.segment)
    : Array.from(text);
export function wrapText(ctx, text, width) {
  const lines = [],
    trimmed = (line) => line.replace(/ +$/, "");
  for (const paragraph of text.split(/[\n\u2028]/)) {
    let line = "";
    for (const word of paragraph.match(/ +|[^ ]+/g) || []) {
      // Spaces at the end of a line hang past its width, as they do in the
      // editor, so a space typed after a full line starts no empty line.
      if (word[0] === " ") {
        line += word;
        continue;
      }
      if (line && ctx.measureText(line + word).width > width) {
        lines.push(trimmed(line));
        line = "";
      }
      if (ctx.measureText(word).width > width && word.length > 1) {
        if (line) {
          lines.push(trimmed(line));
          line = "";
        }
        // Exponential search avoids measuring nearly the entire remaining word
        // for every glyph. Split at Unicode code points, never surrogate halves.
        const chars = graphemes(word);
        let offset = 0;
        while (offset < chars.length) {
          const remaining = chars.length - offset;
          const fits = (length) =>
            ctx.measureText(chars.slice(offset, offset + length).join(""))
              .width <= width;
          let low = 1,
            high = 2;
          while (high < remaining && fits(high)) {
            low = high;
            high *= 2;
          }
          high = Math.min(high, remaining);
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (fits(middle)) low = middle;
            else high = middle - 1;
          }
          const chunk = chars.slice(offset, offset + low).join("");
          offset += low;
          if (offset < chars.length) lines.push(chunk);
          else line = chunk;
        }
      } else line += word;
    }
    lines.push(trimmed(line));
  }
  return lines;
}

// Measure words across style boundaries before wrapping. Long words use
// exponential/binary searches on code points, avoiding quadratic work.
export function richTextLayout(
  i,
  ctx,
  width,
  text = i.text || "",
  runs = i.textRuns,
  defaultColor,
) {
  const base = textStyle(i, defaultColor);
  const signature = [
    width,
    text,
    runs,
    base.font,
    base.color,
    base.decoration,
    i.highlight,
    i.lang,
  ];
  let contexts = richLayouts.get(i);
  const cached = contexts?.get(ctx);
  if (cached && signature.every((v, n) => v === cached.signature[n]))
    return cached.lines;
  const segments = textSegments(text, runs).map((s) => ({
    ...s,
    appearance: textStyle({ ...i, ...s.style }, defaultColor),
  }));
  const pieces = (start, end) => {
    const out = [];
    let low = 0,
      high = segments.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (segments[mid].end <= start) low = mid + 1;
      else high = mid;
    }
    for (let n = low; n < segments.length && segments[n].start < end; n++) {
      const s = segments[n],
        value = text
          .slice(Math.max(start, s.start), Math.min(end, s.end))
          .replace(/\t/g, "    ")
          .replace(/\r/g, "");
      ctx.font = s.appearance.font;
      out.push({
        start: Math.max(start, s.start),
        end: Math.min(end, s.end),
        text: value,
        style: s.appearance,
        width: ctx.measureText(value).width,
      });
    }
    return out;
  };
  const lines = [];
  let line = { text: "", segments: [], width: 0 };
  const push = () => {
    // CSS pre-wrap allows trailing spaces to hang outside the alignment width.
    let trailing = 0;
    for (let n = line.segments.length - 1; n >= 0; n--) {
      const s = line.segments[n],
        spaces = s.text.match(/ +$/)?.[0] || "";
      ctx.font = s.style.font;
      trailing += ctx.measureText(spaces).width;
      if (spaces.length !== s.text.length) break;
    }
    lines.push({ ...line, width: line.width - trailing });
    line = { text: "", segments: [], width: 0 };
  };
  const add = (parts) => {
    for (const part of parts) {
      line.segments.push(part);
      line.text += part.text;
      line.width += part.width;
    }
  };
  // No-break spaces, as in French "surprise !", join their words, as in
  // the editor and in text without formatting.
  for (const token of text.matchAll(
    /[\n\u2028]|[^\S\n\u2028\u00a0\u2007\u202f\ufeff]+|(?:[^\s]|[\u00a0\u2007\u202f\ufeff])+/g,
  )) {
    if (token[0] === "\n" || token[0] === "\u2028") {
      push();
      continue;
    }
    const start = token.index,
      end = start + token[0].length;
    const parts = pieces(start, end),
      length = parts.reduce((n, p) => n + p.width, 0);
    if (/^[^\S\u00a0\u2007\u202f\ufeff]+$/.test(token[0])) {
      add(parts);
      continue;
    }
    if (line.text && line.width + length > width) push();
    if (length <= width) {
      add(parts);
      continue;
    }
    const offsets = [start];
    for (const char of graphemes(token[0]))
      offsets.push(offsets.at(-1) + char.length);
    let at = 0;
    while (at < offsets.length - 1) {
      const remaining = offsets.length - 1 - at;
      const fits = (n) =>
        pieces(offsets[at], offsets[at + n]).reduce(
          (sum, p) => sum + p.width,
          0,
        ) <= width;
      let lo = 1,
        hi = 2;
      while (hi < remaining && fits(hi)) {
        lo = hi;
        hi *= 2;
      }
      hi = Math.min(hi, remaining);
      while (lo < hi) {
        const middle = Math.ceil((lo + hi) / 2);
        if (fits(middle)) lo = middle;
        else hi = middle - 1;
      }
      add(pieces(offsets[at], offsets[at + lo]));
      at += lo;
      if (at < offsets.length - 1) push();
    }
  }
  push();
  if (!contexts) richLayouts.set(i, (contexts = new WeakMap()));
  contexts.set(ctx, { signature, lines });
  return lines;
}

let listLayouts = new WeakMap();
export function listTextLayout(
  i,
  ctx,
  width,
  text = i.text || "",
  runs = i.textRuns,
  blocks = i.textBlocks,
  defaultColor,
) {
  const style = textStyle(i, defaultColor);
  const signature = [
    width,
    text,
    runs,
    blocks,
    style.font,
    style.color,
    style.decoration,
    i.highlight,
    i.lang,
  ];
  let contexts = listLayouts.get(i);
  const cached = contexts?.get(ctx);
  if (cached && signature.every((v, n) => v === cached.signature[n]))
    return cached.lines;
  const lines = [];
  for (const row of listRows(text, blocks)) {
    ctx.font = style.font;
    const markerWidth = row.marker ? ctx.measureText(row.marker).width : 0;
    const indent = row.list
      ? row.indent * style.size * 1.5 +
        Math.max(style.size * 1.5, markerWidth + style.size * 0.5)
      : 0;
    const rich = richTextLayout(
      i,
      ctx,
      Math.max(1, width - indent),
      row.text,
      sliceTextRuns(runs, row.start, row.end),
      defaultColor,
    );
    rich.forEach((line, n) =>
      lines.push({
        ...line,
        segments: line.segments.map((part) => ({
          ...part,
          start: part.start + row.start,
          end: part.end + row.start,
        })),
        indent,
        marker: n === 0 ? row.marker : undefined,
        markerWidth,
        markerStyle: style,
      }),
    );
  }
  if (!contexts) listLayouts.set(i, (contexts = new WeakMap()));
  contexts.set(ctx, { signature, lines });
  return lines;
}
