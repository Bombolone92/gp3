import {
  textStyle,
  richTextLayout,
  listTextLayout,
  autoHeightLayout,
  fitTextLayout,
  shapeTextLayout,
  boxedText,
  growsWithText,
  canAutoFitText,
  graphemes,
} from "./text.js";
import { connectorLabel } from "./connectors.js";
import { textLinkURL, textLinks } from "./text-link-data.js";
import { t, labelled } from "./i18n.js";
import { authoredTextHTML } from "./accessibility/object-content.js";
import { localPoint } from "./geometry.js";
import { tagFooter } from "./tags.js";

// Hit areas use the same measured segments, hanging indents, fitting and clips
// as drawObject: each drawn line with the board point where it starts.
function placedLines(item, ctx) {
  // A connector's label is drawn in the connector's own size and alignment.
  const i =
    item.type === "arrow"
      ? {
          ...item,
          ...connectorLabel(item),
          type: "connector-label",
          fontSize: textStyle(item).size,
          textAlign: textStyle(item).align,
        }
      : item;
  const flowing = growsWithText(i) ? autoHeightLayout(i, ctx) : null;
  const fitted =
    i.autoFontSize && canAutoFitText(i) ? fitTextLayout(i, ctx) : null;
  const style = fitted?.style || textStyle(i);
  const layout = fitted || (boxedText(i) ? shapeTextLayout(i, ctx) : null);
  // Tagged notes clip their text above the tag footer, as drawObject does.
  const area = layout?.box || {
    x: 0,
    y: 0,
    w: i.w,
    h: (flowing?.height ?? Math.abs(i.h)) - tagFooter(i),
  };
  // Text without formatting is laid out as drawn: as wide as the object
  // when it grows with its text, or as its shape's text box, at the size it
  // was fitted to.
  const width = flowing
      ? Math.max(1, Math.abs(i.w))
      : layout?.box
        ? Math.max(1, layout.box.w - style.padding * 2)
        : Math.max(20, i.w - style.padding * 2),
    sized = fitted ? { ...i, fontSize: style.size } : i;
  const lines =
    flowing?.richLines ||
    layout?.richLines ||
    (i.textBlocks?.length
      ? listTextLayout(sized, ctx, width)
      : richTextLayout(sized, ctx, width));
  const height = style.size * 1.35;
  return {
    i,
    area,
    height,
    lines: lines.map((line, n) => {
      const indent = line.indent || 0;
      return {
        line,
        x:
          i.x +
          area.x +
          (style.align === "center"
            ? indent + (area.w - indent - line.width) / 2
            : style.align === "right"
              ? area.w - style.padding - line.width
              : style.padding + indent),
        y: i.y + area.y + (layout?.top ?? style.padding) + n * height,
      };
    }),
  };
}
export function textLinkRects(item, ctx) {
  if (!item.textRuns?.some((r) => r.style.link)) return [];
  const { i, area, height, lines } = placedLines(item, ctx);
  const links = textLinks(i.text, i.textRuns),
    rects = [];
  let linkIndex = 0;
  for (const { line, x: left0, y } of lines) {
    let x = left0;
    for (const part of line.segments) {
      while (linkIndex < links.length && links[linkIndex].end <= part.start)
        linkIndex++;
      const link = links[linkIndex];
      if (part.style.link && link && link.start <= part.start) {
        const left = Math.max(x, i.x + area.x),
          top = Math.max(y, i.y + area.y);
        const right = Math.min(x + part.width, i.x + area.x + area.w),
          bottom = Math.min(y + height, i.y + area.y + area.h);
        if (right > left && bottom > top)
          rects.push({
            x: left,
            y: top,
            w: right - left,
            h: bottom - top,
            ...link,
          });
      }
      x += part.width;
    }
  }
  return rects;
}
// The text offset nearest a board point on an object's drawn text, and
// whether the point is on the text itself rather than beside or below it.
export function textOffsetAt(item, ctx, point) {
  const text = item.text || "";
  const { lines, height } = placedLines(item, ctx);
  if (!text || !lines.length) return { offset: text.length, onText: false };
  point = localPoint(item, point);
  const row = Math.max(
    0,
    Math.min(lines.length - 1, Math.floor((point.y - lines[0].y) / height)),
  );
  const { line, x: left, y } = lines[row];
  const onLine =
    point.y >= y &&
    point.y < y + height &&
    point.x >= left &&
    point.x <= left + line.width;
  let x = left;
  for (const part of line.segments) {
    if (point.x < x + part.width) {
      // Within a segment, the boundary between characters nearest the point.
      ctx.font = part.style.font;
      let offset = part.start;
      for (const char of graphemes(text.slice(part.start, part.end))) {
        const width = ctx.measureText(
          char.replace(/\t/g, "    ").replace(/\r/g, ""),
        ).width;
        if (point.x < x + width / 2) break;
        x += width;
        offset += char.length;
      }
      return { offset, onText: onLine };
    }
    x += part.width;
  }
  // Past the end of a line, or on an empty one: each empty line is one more
  // line break after the last text above it.
  let above = row;
  while (above >= 0 && !lines[above].line.segments.length) above--;
  const end = above < 0 ? 0 : lines[above].line.segments.at(-1).end;
  return {
    offset: Math.min(text.length, end + row - Math.max(above, 0)),
    onText: false,
  };
}
// The word at a text offset, as a double click selects it: letters, digits
// and joiners such as an apostrophe, or a run of other non-space marks.
export function wordAt(text, offset) {
  const word = /[\p{L}\p{N}\p{M}_'’-]/u,
    mark = /[^\s\p{L}\p{N}\p{M}_'’-]/u;
  const kind = (char) =>
    char && (word.test(char) ? word : mark.test(char) ? mark : null);
  const of = kind(text[offset]) || kind(text[offset - 1]);
  if (!of) return { start: offset, end: offset };
  let start = offset,
    end = offset;
  while (start > 0 && of.test(text[start - 1])) start--;
  while (end < text.length && of.test(text[end])) end++;
  return { start, end };
}
export function textLinkHit(item, ctx, point) {
  point = localPoint(item, point);
  return textLinkRects(item, ctx).find(
    (r) =>
      point.x >= r.x &&
      point.x <= r.x + r.w &&
      point.y >= r.y &&
      point.y <= r.y + r.h,
  );
}

export function createTextLinkPreview(api) {
  let panel,
    snapshot,
    page = 0,
    links = [];
  const close = (focus = false) => {
    panel?.remove();
    panel = snapshot = undefined;
    if (focus) api.canvas()?.focus({ preventScroll: true });
  };
  const render = () => {
    panel.replaceChildren();
    const doc = panel.ownerDocument;
    const heading = doc.createElement("strong");
    heading.textContent = t("Text links");
    const dismiss = doc.createElement("button");
    dismiss.type = "button";
    dismiss.className = "text-btn";
    dismiss.textContent = t("Close");
    dismiss.onclick = () => close(true);
    const header = doc.createElement("div");
    header.className = "text-link-preview-header";
    header.append(heading, dismiss);
    panel.append(header);
    for (const link of links.slice(page * 50, (page + 1) * 50)) {
      const row = doc.createElement("div");
      row.className = "text-link-preview-row";
      const anchor = doc.createElement("a");
      anchor.href = textLinkURL(link.url);
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.className = "text-link-destination";
      anchor.setAttribute(
        "aria-label",
        `${labelled(t("Open link in new tab"), "")}${link.text || link.url}`,
      );
      const label = doc.createElement("span");
      label.innerHTML = authoredTextHTML(
        snapshot.item,
        link.text || link.url,
        link.start || 0,
      );
      const url = doc.createElement("small");
      url.textContent = link.url;
      anchor.title = link.url;
      anchor.append(label, url);
      row.append(anchor);
      if (snapshot.writable) {
        const edit = doc.createElement("button");
        edit.type = "button";
        edit.className = "text-btn";
        edit.textContent = t("Edit link");
        edit.onclick = () => {
          const item = snapshot?.item;
          if (!item || !valid()) return close(true);
          close();
          api.edit(item, link);
        };
        row.append(edit);
      }
      panel.append(row);
    }
    if (links.length > 50) {
      const nav = doc.createElement("div");
      nav.className = "text-link-preview-header";
      for (const [label, offset] of [
        ["Previous", -1],
        ["Next", 1],
      ]) {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = "text-btn";
        b.textContent = t(label);
        b.disabled = offset < 0 ? page === 0 : (page + 1) * 50 >= links.length;
        b.onclick = () => {
          page += offset;
          render();
          panel.focus();
        };
        nav.append(b);
      }
      panel.append(nav);
    }
  };
  const valid = () => {
    const state = api.state();
    return (
      snapshot &&
      state.board === snapshot.board &&
      state.board?.items.includes(snapshot.item) &&
      !state.concealed?.has(snapshot.item.id) &&
      snapshot.item.text === snapshot.text &&
      snapshot.item.textRuns === snapshot.runs &&
      snapshot.item.lang === snapshot.lang &&
      api.writable(snapshot.item) === snapshot.writable &&
      !state.editing &&
      !state.drag &&
      `${state.view.x},${state.view.y},${state.view.z}` === snapshot.view
    );
  };
  return {
    close,
    update() {
      if (panel && !valid())
        close(panel.contains(panel.ownerDocument.activeElement));
    },
    show(item, selectedLink, point) {
      close();
      const state = api.state(),
        canvas = api.canvas();
      if (state.concealed?.has(item.id)) return;
      links = selectedLink
        ? [selectedLink]
        : textLinks(item.text, item.textRuns);
      if (!canvas || !links.length) return;
      snapshot = {
        board: state.board,
        item,
        text: item.text,
        runs: item.textRuns,
        lang: item.lang,
        writable: api.writable(item),
        view: `${state.view.x},${state.view.y},${state.view.z}`,
      };
      page = 0;
      const doc = canvas.ownerDocument;
      panel = doc.createElement("section");
      panel.id = "text-link-preview";
      panel.className = "text-link-preview panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", t("Text links"));
      panel.tabIndex = -1;
      const rect = canvas.getBoundingClientRect(),
        width = Math.min(380, Math.max(200, rect.width - 32));
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(16, Math.min(rect.width - width - 16, point?.x ?? rect.width - width - 16))}px`;
      panel.style.top = `${Math.max(60, Math.min(rect.height - 190, point?.y ?? 64))}px`;
      panel.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          close(true);
        }
      };
      canvas.parentElement.append(panel);
      render();
      panel.querySelector("a").focus({ preventScroll: true });
    },
    outside(target) {
      if (panel && !panel.contains(target)) close();
    },
  };
}
