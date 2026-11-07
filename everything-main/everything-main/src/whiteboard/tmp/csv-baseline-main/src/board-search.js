import { tableTextContent } from "./table-language.js";
import { bounds, escape } from "./model.js";
import { t, objectName } from "./i18n.js";
import { authoredTextHTML } from "./accessibility/object-content.js";
import { keepPageFocus } from "./paging.js";

export const SEARCH_TYPES = [
  ["", "All content"],
  ["note", "Sticky note"],
  ["text", "Text"],
  ["shape", "Shapes"],
  ["rect", "Rectangle"],
  ["ellipse", "Ellipse"],
  ["frame", "Frame"],
  ["table", "Table"],
  ["link", "Link"],
  ["file", "Attachment"],
  ["embed", "Embedded content"],
  ["image", "Image"],
  ["arrow", "Arrow"],
  ["pen", "Drawing"],
];
const normalize = (value) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
export function createSearchIndex(items, tags = []) {
  const names = new Map(tags.map((t) => [t.id, t.name]));
  return items.map((item) => {
    const text = [
      item.text,
      item.fileName,
      item.url,
      item.objectLink?.url,
      ...new Set(
        (item.textRuns || []).map((r) => r.style.link).filter(Boolean),
      ),
      ...(item.cells?.flat() || []),
      ...(item.tagIds || []).map((id) => names.get(id)),
    ]
      .filter(Boolean)
      .join("\n");
    let content;
    if (item.cells) {
      const combined = tableTextContent(item, { separator: "\n" });
      const prefix = [
        item.text,
        item.fileName,
        item.url,
        item.objectLink?.url,
        ...new Set(
          (item.textRuns || []).map((r) => r.style.link).filter(Boolean),
        ),
      ]
        .filter(Boolean)
        .join("\n");
      const start = prefix.length + (prefix && combined.text ? 1 : 0),
        runs = [...(item.textRuns || [])];
      for (const run of combined.textRuns || [])
        runs.push({ ...run, start: start + run.start, end: start + run.end });
      content = { lang: item.lang, textRuns: runs };
    }
    return {
      item,
      text,
      normalized: normalize(text),
      ...(content ? { content } : {}),
    };
  });
}
export function searchIndex(index, query, type = "", tagId = "") {
  const needle = normalize(query.trim());
  if (!needle && !type && !tagId) return [];
  return index.filter(
    (entry) =>
      (!tagId || entry.item.tagIds?.includes(tagId)) &&
      (!type ||
        (type === "shape"
          ? ["rect", "ellipse"].includes(entry.item.type)
          : entry.item.type === type &&
            (type !== "rect" || !entry.item.shape))) &&
      (!needle || entry.normalized.includes(needle)),
  );
}
function excerptStart(entry, query) {
  const position = entry.normalized.indexOf(normalize(query.trim()));
  // Normalization can remove accents or expand ligatures. Map the match back
  // to the original text so excerpts still include the authored search hit.
  let offset = Math.max(0, position);
  for (const match of entry.text.matchAll(/[^\x00-\x7f]/gu)) {
    if (match.index >= offset) break;
    offset += match[0].length - normalize(match[0]).length;
  }
  return Math.max(0, offset - 50);
}
export function searchExcerpt(entry, query) {
  const start = excerptStart(entry, query);
  return `${start ? "…" : ""}${entry.text.slice(start, start + 180).replace(/\s+/g, " ")}${entry.text.length > start + 180 ? "…" : ""}`;
}

// Index only on opening or a committed board edit, never during canvas paints.
// Keep the result DOM bounded even when all 5,000 supported objects match.
export function createBoardSearch({
  board,
  draw,
  select,
  focus,
  icon,
  reveal,
}) {
  const pageSize = 50;
  let panel = null,
    index = [],
    results = [],
    matches = null,
    active = -1,
    page = 0;
  const query = () => panel.querySelector("#board-search-input").value;
  function close(restoreFocus = true) {
    if (!panel) return;
    panel.remove();
    panel = null;
    index = [];
    results = [];
    matches = null;
    active = -1;
    page = 0;
    const trigger = document.querySelector('[data-action="board-search"]');
    trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) document.querySelector("#canvas")?.focus();
    draw();
  }
  function render() {
    const list = panel.querySelector("#board-search-results");
    const focusedResult =
      document.activeElement?.closest("[data-result]")?.dataset.result;
    const start = page * pageSize;
    list.innerHTML = results
      .slice(start, start + pageSize)
      .map((entry, n) => {
        const label = objectName({
          ...entry.item,
          text: "",
          cells: undefined,
          fileName: "",
        }).split(":")[0];
        const offset = excerptStart(entry, query());
        const content = entry.text.slice(offset, offset + 180);
        const excerpt = content
          ? `${offset ? "…" : ""}${authoredTextHTML(entry.content || entry.item, content, offset, true)}${entry.text.length > offset + 180 ? "…" : ""}`
          : escape(t("Untitled object"));
        return `<button type="button" data-result="${start + n}" aria-current="${active === start + n}"><small data-user-content>${escape(label)}</small><span data-user-content>${excerpt}</span></button>`;
      })
      .join("");
    panel.querySelector("#board-search-count").textContent = t(
      `${results.length} ${results.length === 1 ? "result" : "results"}`,
    );
    panel.querySelector("#board-search-empty").textContent =
      !query().trim() &&
      !panel.querySelector("select").value &&
      !panel.querySelector("#board-search-tag").value
        ? t("Search text, links, file names, and table cells.")
        : results.length
          ? ""
          : t("No matching objects.");
    panel.querySelector("#board-search-position").textContent =
      active < 0 ? "" : `${active + 1} / ${results.length}`;
    panel
      .querySelectorAll("[data-step]")
      .forEach((b) => (b.disabled = !results.length));
    panel.querySelector("[data-page='-1']").disabled = page === 0;
    panel.querySelector("[data-page='1']").disabled =
      start + pageSize >= results.length;
    panel.querySelector(".search-pages").hidden = results.length <= pageSize;
    panel.querySelector("#board-search-page").textContent =
      `${start + 1}–${Math.min(start + pageSize, results.length)} / ${results.length}`;
    panel.querySelector("#search-select").disabled = active < 0;
    if (focusedResult !== undefined) {
      const result = panel.querySelector(`[data-result="${focusedResult}"]`);
      (result || panel.querySelector("input")).focus({ preventScroll: true });
    }
  }
  function update(preserve = false) {
    if (!panel) return;
    const id = preserve && results[active]?.item.id;
    results = searchIndex(
      index,
      query(),
      panel.querySelector("select").value,
      panel.querySelector("#board-search-tag").value,
    );
    matches =
      query().trim() ||
      panel.querySelector("select").value ||
      panel.querySelector("#board-search-tag").value
        ? new Set(results.map((entry) => entry.item.id))
        : null;
    active = id ? results.findIndex((entry) => entry.item.id === id) : -1;
    page = active < 0 ? 0 : Math.floor(active / pageSize);
    render();
    if (!preserve) panel.querySelector("#board-search-results").scrollTop = 0;
    draw();
  }
  function navigate(n) {
    if (!results.length) return;
    active = (n + results.length) % results.length;
    page = Math.floor(active / pageSize);
    render();
    panel
      .querySelector(`[data-result="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
    // Navigate to the individual match, even if it belongs to a very large group.
    reveal?.(results[active].item.id);
    focus(bounds([results[active].item]), panel.getBoundingClientRect());
  }
  function keydown(e) {
    if (!panel || e.isComposing || e.keyCode === 229) return false;
    const inPanel = e.target.closest("#board-search");
    if (!inPanel && e.target.closest("input,textarea,select,[contenteditable]"))
      return false;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return true;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      panel.querySelector("input").focus();
      panel.querySelector("input").select();
      return true;
    }
    if (inPanel) {
      if (
        e.target.id === "board-search-input" &&
        ["Enter", "ArrowDown", "ArrowUp"].includes(e.key)
      ) {
        e.preventDefault();
        const backwards =
          e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey);
        navigate(
          active < 0
            ? backwards
              ? results.length - 1
              : 0
            : active + (backwards ? -1 : 1),
        );
      }
      return true;
    }
    return false;
  }
  function tagOptions(value = "") {
    const select = panel.querySelector("#board-search-tag");
    select.innerHTML =
      `<option value="">${t("All tags")}</option>` +
      (board().tags || [])
        .map(
          (tag) =>
            `<option value="${escape(tag.id)}">${escape(tag.name)}</option>`,
        )
        .join("");
    select.value = (board().tags || []).some((tag) => tag.id === value)
      ? value
      : "";
  }
  function open({ tagId } = {}) {
    if (panel) {
      if (tagId) {
        tagOptions(tagId);
        update();
      }
      panel.querySelector("input").focus();
      panel.querySelector("input").select();
      return;
    }
    panel = document.createElement("section");
    panel.id = "board-search";
    panel.className = "board-search panel";
    panel.setAttribute("role", "search");
    panel.setAttribute("aria-label", t("Find on board"));
    panel.innerHTML = `<div class="search-heading"><strong>${t("Find on board")}</strong><button type="button" class="text-btn" id="search-close">${t("Close search")}</button></div>
      <label class="search"><input id="board-search-input" type="search" maxlength="500" aria-label="${t("Find on board")}" placeholder="${t("Search this board")}" aria-controls="board-search-results" autocomplete="off"></label>
      <label class="search-filter">${t("Content type")}<select aria-label="${t("Content type")}">${SEARCH_TYPES.map(([value, label]) => `<option value="${value}">${t(label)}</option>`).join("")}</select></label><label class="search-filter">${t("Tag")}<select id="board-search-tag" aria-label="${t("Tag")}"></select></label>
      <div class="search-navigation"><span id="board-search-count" role="status" aria-live="polite"></span><button type="button" data-step="-1" aria-label="${t("Previous result")}">${icon("arrow-up")}</button><span id="board-search-position" role="status" aria-live="polite" aria-atomic="true"></span><button type="button" data-step="1" aria-label="${t("Next result")}">${icon("arrow-down")}</button></div>
      <p id="board-search-empty" class="dialog-copy"></p><div id="board-search-results" class="search-results"></div>
      <div class="search-pages"><button type="button" data-page="-1">${t("Previous page")}</button><span id="board-search-page"></span><button type="button" data-page="1">${t("Next page")}</button></div>
      <button type="button" class="primary" id="search-select">${t("Select on board")}</button><p class="search-hint">${t("Enter: next result · Shift+Enter: previous · Escape: close")}</p>`;
    document.querySelector(".canvas-wrap").append(panel);
    document
      .querySelector('[data-action="board-search"]')
      ?.setAttribute("aria-expanded", "true");
    // Search has its own focus context; clipboard shortcuts must never act on
    // an unrelated canvas selection while a result button is focused.
    for (const event of ["copy", "cut", "paste"])
      panel.addEventListener(event, (e) => e.stopPropagation());
    panel.querySelector("#search-close").onclick = () => close();
    panel.querySelector("input").oninput = (e) => {
      if (!e.isComposing) update();
    };
    panel
      .querySelector("input")
      .addEventListener("compositionend", () => update());
    panel.querySelector("select").onchange = () => update();
    panel.querySelector("#board-search-results").onclick = (e) => {
      const button = e.target.closest("[data-result]");
      if (!button) return;
      navigate(+button.dataset.result);
      panel.querySelector(`[data-result="${active}"]`)?.focus();
    };
    panel
      .querySelectorAll("[data-step]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            navigate(
              active < 0
                ? +b.dataset.step < 0
                  ? results.length - 1
                  : 0
                : active + +b.dataset.step,
            )),
      );
    panel.querySelectorAll("[data-page]").forEach(
      (b) =>
        (b.onclick = () => {
          page += +b.dataset.page;
          render();
          panel.querySelector("#board-search-results").scrollTop = 0;
          keepPageFocus(
            b,
            panel.querySelector(`[data-page='${-b.dataset.page}']`),
          );
        }),
    );
    panel.querySelector("#search-select").onclick = () => {
      if (active < 0) return;
      const id = results[active].item.id;
      select(new Set([id]));
      close();
    };
    tagOptions(tagId);
    panel.querySelector("#board-search-tag").onchange = () => update();
    index = createSearchIndex(board().items, board().tags);
    update();
    panel.querySelector("input").focus();
  }
  return {
    open,
    close,
    keydown,
    refresh: () => {
      if (panel) {
        tagOptions(panel.querySelector("#board-search-tag").value);
        index = createSearchIndex(board().items, board().tags);
        update(true);
      }
    },
    isOpen: () => !!panel,
    highlights: () => ({
      searchMatches: matches,
      searchActive: results[active]?.item.id,
    }),
  };
}
