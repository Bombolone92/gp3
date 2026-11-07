import {
  textStyle,
  richTextLayout,
  listTextLayout,
  autoHeightLayout,
  fitTextLayout,
  shapeTextLayout,
  growsWithText,
  canAutoFitText,
} from "./text.js";
import { connectorLabel } from "./connectors.js";
import { textLinkURL, textLinks } from "./text-link-data.js";
import { t } from "./i18n.js";
import { authoredTextHTML } from "./accessibility/object-content.js";
import { localPoint } from "./geometry.js";
import { tagFooter } from "./tags.js";

// Hit areas use the same measured segments, hanging indents, fitting and clips
// as drawObject. Only the object under the pointer needs link geometry.
export function textLinkRects(item, ctx) {
  if (!item.textRuns?.some((r) => r.style.link)) return [];
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
  const layout =
    fitted || (i.type === "rect" && i.shape ? shapeTextLayout(i, ctx) : null);
  // Tagged notes clip their text above the tag footer, as drawObject does.
  const area = layout?.box || {
    x: 0,
    y: 0,
    w: i.w,
    h: (flowing?.height ?? Math.abs(i.h)) - tagFooter(i),
  };
  const lines =
    flowing?.richLines ||
    layout?.richLines ||
    (i.textBlocks?.length
      ? listTextLayout(i, ctx, Math.max(20, i.w - style.padding * 2))
      : richTextLayout(i, ctx, Math.max(20, i.w - style.padding * 2)));
  const links = textLinks(i.text, i.textRuns),
    rects = [];
  let linkIndex = 0;
  lines.forEach((line, n) => {
    const indent = line.indent || 0;
    let x =
      i.x +
      area.x +
      (style.align === "center"
        ? indent + (area.w - indent - line.width) / 2
        : style.align === "right"
          ? area.w - style.padding - line.width
          : style.padding + indent);
    const y =
      i.y + area.y + (layout?.top ?? style.padding) + n * style.size * 1.35;
    for (const part of line.segments) {
      while (linkIndex < links.length && links[linkIndex].end <= part.start)
        linkIndex++;
      const link = links[linkIndex];
      if (part.style.link && link && link.start <= part.start) {
        const left = Math.max(x, i.x + area.x),
          top = Math.max(y, i.y + area.y);
        const right = Math.min(x + part.width, i.x + area.x + area.w),
          bottom = Math.min(y + style.size * 1.35, i.y + area.y + area.h);
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
  });
  return rects;
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
        `${t("Open link in new tab")}: ${link.text || link.url}`,
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
      if (panel && !valid()) close();
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
