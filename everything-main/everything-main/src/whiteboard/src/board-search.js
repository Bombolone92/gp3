import { shortcutLetter } from "./shortcut-keys.js";
import { tableTextContent } from "./table-language.js";
import { bounds, escape } from "./model.js";
import { t, kindLabel } from "./i18n.js";
import { authoredTextHTML } from "./accessibility/object-content.js";
import { opener, returnFocus } from "./accessibility/focus-return.js";
import { keepPageFocus, keepPaginationFocus } from "./paging.js";
import { fold, searchTerms } from "./search-fold.js";

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
const normalize = fold;
// The text search finds in an object: what it says, its description,
// file name, addresses, table cells, tag names (`names`, by tag id), and
// what its task badge shows: the assignee and the Jira issue.
export function itemSearchText(item, names) {
  return [
    item.text,
    item.alt,
    item.fileName,
    item.url,
    item.objectLink?.url,
    ...new Set((item.textRuns || []).map((r) => r.style?.link).filter(Boolean)),
    ...(item.cells?.flat() || []),
    ...(item.tagIds || []).map((id) => names.get(id)),
    item.task?.assignee?.name,
    item.task?.jira?.key,
  ]
    .filter(Boolean)
    .join("\n");
}
export function createSearchIndex(items, tags = []) {
  const names = new Map(tags.map((t) => [t.id, t.name]));
  return items.map((item) => {
    const text = itemSearchText(item, names);
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
// Each word of the query is found somewhere in the object, in any order
// and across line breaks, as the library's search does.
const queryWords = searchTerms;
export function searchIndex(index, query, type = "", tagId = "") {
  const words = queryWords(query);
  if (!words.length && !type && !tagId) return [];
  return index.filter(
    (entry) =>
      (!tagId || entry.item.tagIds?.includes(tagId)) &&
      (!type ||
        (type === "shape"
          ? ["rect", "ellipse"].includes(entry.item.type)
          : entry.item.type === type &&
            (type !== "rect" || !entry.item.shape))) &&
      words.every((word) => entry.normalized.includes(word)),
  );
}
function excerptStart(entry, query) {
  // The excerpt starts at the query as typed, or else at whichever of its
  // words comes first.
  const words = queryWords(query),
    found = entry.normalized.indexOf(words.join(" ")),
    starts = words
      .map((word) => entry.normalized.indexOf(word))
      .filter((at) => at >= 0);
  const position = found >= 0 ? found : starts.length ? Math.min(...starts) : 0;
  // Normalization can remove accents or expand ligatures. Map the match back
  // to the original text so excerpts still include the authored search hit.
  let offset = Math.max(0, position);
  for (const match of entry.text.matchAll(/[^\x00-\x7f]/gu)) {
    if (match.index >= offset) break;
    offset += match[0].length - normalize(match[0]).length;
  }
  return Math.max(0, offset - 50);
}
function excerptRange(entry, query) {
  const text = entry.text;
  const splitsCharacter = (at) => {
    const before = text.charCodeAt(at - 1),
      after = text.charCodeAt(at);
    return (
      before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
    );
  };
  let start = excerptStart(entry, query);
  if (splitsCharacter(start)) start--;
  let end = Math.min(text.length, start + 180);
  if (splitsCharacter(end)) end--;
  return [start, end];
}
export function searchExcerpt(entry, query) {
  const [start, end] = excerptRange(entry, query);
  return `${start ? "…" : ""}${entry.text.slice(start, end).replace(/\s+/g, " ")}${entry.text.length > end ? "…" : ""}`;
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
  hold,
  release,
}) {
  const pageSize = 50;
  let panel = null,
    index = [],
    results = [],
    matches = null,
    active = -1,
    page = 0,
    origin = null,
    // The result selected on the board, if one was.
    chosen = null;
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
    // The selection put aside while searching comes back, unless a result
    // was chosen instead.
    release?.(chosen);
    chosen = null;
    // Focus goes back to what opened Find: its button, or the canvas after
    // Ctrl/Cmd+F there.
    if (restoreFocus) returnFocus(origin, document.querySelector("#canvas"));
    origin = null;
    draw();
  }
  function render(
    focusedResult = document.activeElement?.closest("[data-result]")?.dataset
      .result,
  ) {
    const list = panel.querySelector("#board-search-results");
    const start = page * pageSize,
      focusedControl = document.activeElement;
    list.innerHTML = results
      .slice(start, start + pageSize)
      .map((entry, n) => {
        const label = kindLabel(entry.item);
        const [offset, end] = excerptRange(entry, query());
        const content = entry.text.slice(offset, end);
        const excerpt = content
          ? `${offset ? "…" : ""}${authoredTextHTML(entry.content || entry.item, content, offset, true)}${entry.text.length > end ? "…" : ""}`
          : escape(t("Untitled object"));
        return `<button type="button" data-result="${start + n}" aria-current="${active === start + n}"><small data-user-content>${escape(label)}</small><span data-user-content>${excerpt}</span></button>`;
      })
      .join("");
    // The count is announced, so it is written only when it changes, not
    // as each result is reached.
    const count = panel.querySelector("#board-search-count"),
      counted = t(
        `${results.length} ${results.length === 1 ? "result" : "results"}`,
      );
    if (count.textContent !== counted) count.textContent = counted;
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
    // A control that turns off or hides while focused, as when another
    // person's edit removes results, passes focus on instead of dropping it.
    const previous = panel.querySelector("[data-page='-1']"),
      next = panel.querySelector("[data-page='1']"),
      input = panel.querySelector("input");
    if (focusedControl === previous || focusedControl === next)
      keepPaginationFocus(focusedControl, previous, next, input);
    else if (
      focusedControl !== input &&
      panel.contains(focusedControl) &&
      (focusedControl.disabled || focusedControl.closest("[hidden]"))
    )
      input.focus({ preventScroll: true });
  }
  function update(preserve = false) {
    if (!panel) return;
    const id = preserve && results[active]?.item.id;
    // A result with keyboard focus keeps it wherever the result moves.
    const focused = document.activeElement?.closest("[data-result]");
    const focusedId = focused && results[focused.dataset.result]?.item.id;
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
    if (active < 0)
      panel.querySelector("#board-search-active").textContent = "";
    const focusIndex = focusedId
      ? results.findIndex((entry) => entry.item.id === focusedId)
      : undefined;
    // A refresh after an edit keeps the page being read, or the one the
    // focused result moved to, even when the current result is elsewhere.
    page = preserve
      ? Math.min(
          focusIndex >= 0 ? Math.floor(focusIndex / pageSize) : page,
          Math.max(0, Math.ceil(results.length / pageSize) - 1),
        )
      : 0;
    render(focusIndex);
    if (!preserve) panel.querySelector("#board-search-results").scrollTop = 0;
    draw();
  }
  // `announce` says which object was reached to screen readers, unless
  // the focus is on its result, which reads it already. Whether the panel
  // was made compact.
  function navigate(n, announce = true) {
    if (!results.length) return false;
    active = (n + results.length) % results.length;
    page = Math.floor(active / pageSize);
    render();
    // On a phone the panel would cover the match: going through results
    // shrinks it to the search and its arrows until the list is wanted again.
    const canvas = document.querySelector("#canvas")?.getBoundingClientRect(),
      small = !!canvas?.width && canvas.width <= 760;
    compact(small);
    const entry = results[active],
      said = searchExcerpt(entry, query()).trim(),
      shown =
        said.length > 120
          ? said.slice(0, 120).replace(/[\ud800-\udbff]$/, "") + "…"
          : said;
    panel.querySelector("#board-search-active").textContent =
      announce || small
        ? `${t("Result {n} of {count}")
            .replace("{n}", active + 1)
            .replace(
              "{count}",
              results.length,
            )}: ${kindLabel(entry.item)}${shown ? `, ${shown}` : ""}`
        : "";
    panel
      .querySelector(`[data-result="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
    // Navigate to the individual match, even if it belongs to a very large group.
    reveal?.(entry.item.id);
    focus(bounds([entry.item]), panel.getBoundingClientRect());
    return small;
  }
  function compact(on) {
    panel.classList.toggle("is-compact", on);
    panel.querySelector("#search-expand").hidden = !on;
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
    if ((e.metaKey || e.ctrlKey) && !e.altKey && shortcutLetter(e) === "f") {
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
            `<option value="${escape(tag.id)}" data-user-content>${escape(tag.name)}</option>`,
        )
        .join("");
    select.value = (board().tags || []).some((tag) => tag.id === value)
      ? value
      : "";
  }
  // `query` searches for it at once and goes to the first result, as when
  // a board found by its content in the library opens.
  function open({ tagId, query: searched } = {}) {
    if (panel) {
      if (tagId) {
        tagOptions(tagId);
        update();
      }
      if (searched) search(searched);
      panel.querySelector("input").focus();
      panel.querySelector("input").select();
      return;
    }
    origin = opener(`[data-action="board-search"]`);
    // The selection is not shown while searching, so keys pressed outside
    // the panel must not delete, move or copy it unseen: it is put aside
    // until Find closes.
    hold?.();
    panel = document.createElement("section");
    panel.id = "board-search";
    panel.className = "board-search panel";
    panel.setAttribute("role", "search");
    panel.setAttribute("aria-label", t("Find on board"));
    panel.innerHTML = `<div class="search-heading"><strong>${t("Find on board")}</strong><button type="button" class="text-btn" id="search-close">${t("Close search")}</button></div>
      <label class="search"><input id="board-search-input" type="search" maxlength="500" aria-label="${t("Find on board")}" placeholder="${t("Search this board")}" aria-controls="board-search-results" autocomplete="off"></label>
      <label class="search-filter">${t("Content type")}<select aria-label="${t("Content type")}">${SEARCH_TYPES.map(([value, label]) => `<option value="${value}">${t(label)}</option>`).join("")}</select></label><label class="search-filter">${t("Tag")}<select id="board-search-tag" aria-label="${t("Tag")}"></select></label>
      <div class="search-navigation"><span id="board-search-count" role="status" aria-live="polite"></span><button type="button" data-step="-1" aria-label="${t("Previous result")}">${icon("arrow-up")}</button><span id="board-search-position"></span><button type="button" data-step="1" aria-label="${t("Next result")}">${icon("arrow-down")}</button></div>
      <p id="board-search-active" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p><p id="board-search-empty" class="dialog-copy"></p><div id="board-search-results" class="search-results"></div>
      <div class="search-pages"><button type="button" data-page="-1">${t("Previous page")}</button><span id="board-search-page"></span><button type="button" data-page="1">${t("Next page")}</button></div>
      <button type="button" class="secondary" id="search-expand" hidden>${t("Show results")}</button><button type="button" class="primary" id="search-select">${t("Select on board")}</button><p class="search-hint">${t("Enter: next result · Shift+Enter: previous · Escape: close")}</p>`;
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
      compact(false);
      if (!e.isComposing) update();
    };
    panel.querySelector("#search-expand").onclick = () => {
      compact(false);
      (
        panel.querySelector(`[data-result="${active}"]`) ||
        panel.querySelector("input")
      ).focus();
    };
    panel
      .querySelector("input")
      .addEventListener("compositionend", () => update());
    panel.querySelector("select").onchange = () => update();
    panel.querySelector("#board-search-results").onclick = (e) => {
      const button = e.target.closest("[data-result]");
      if (!button) return;
      // A result hidden as the panel shrinks hands the focus to the button
      // that shows the list again, not to the search field and a keyboard.
      if (navigate(+button.dataset.result, false))
        panel.querySelector("#search-expand").focus();
      else panel.querySelector(`[data-result="${active}"]`)?.focus();
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
      chosen = id;
      close();
    };
    tagOptions(tagId);
    panel.querySelector("#board-search-tag").onchange = () => update();
    index = createSearchIndex(board().items, board().tags);
    update();
    if (searched) search(searched);
    panel.querySelector("input").focus();
  }
  function search(value) {
    panel.querySelector("#board-search-input").value = value.slice(0, 500);
    update();
    if (results.length) navigate(0);
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
