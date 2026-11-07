import { escape, uid } from "./model.js";
import { plural, t, translateUI, labelled } from "./i18n.js";
import { TAG_LIMIT, TAG_COLORS, tagKey, validateTags } from "./tags.js";
import { keepPageFocus, keepPaginationFocus } from "./paging.js";
import { compareNames } from "./libraries.js";
import { opener, returnFocus } from "./accessibility/focus-return.js";
const normalize = (value) =>
  tagKey(value).normalize("NFKD").replace(/\p{M}/gu, "");
export const taggable = (i) => i.type === "note" || !!i.tagIds?.length;
export function createTagsUI(api) {
  let panel,
    board,
    ids,
    signature,
    page = 0,
    editing,
    origin = null;
  const selected = () => board.items.filter((i) => ids.has(i.id));
  const writable = () => api.canEdit(ids);
  function close(focus = false) {
    const shown = !!panel;
    panel?.remove();
    panel = null;
    editing = null;
    signature = null;
    if (focus) returnFocus(origin, api.canvas());
    origin = null;
    if (shown) api.layout?.();
  }
  function error(message) {
    const out = panel?.querySelector("#tag-error");
    if (out) {
      out.hidden = false;
      out.textContent = t(message);
    } else api.toast(message);
  }
  function commit(fn) {
    if (api.board() !== board || !writable())
      return error("This selection is protected.");
    try {
      fn();
      const output = panel?.querySelector("#tag-error");
      if (output) output.hidden = true;
      signature = null;
      render();
    } catch (e) {
      error(e.message);
    }
  }
  function toggle(id) {
    commit(() => {
      if (!board.tags?.some((t) => t.id === id))
        throw Error("This tag changed. Reopen its settings.");
      const notes = selected(),
        remove = notes.every((i) => i.tagIds?.includes(id));
      if (!notes.length) return;
      if (
        !remove &&
        notes.some(
          (i) =>
            !i.tagIds?.includes(id) && (i.tagIds?.length || 0) >= TAG_LIMIT,
        )
      )
        throw Error("A sticky note can have up to 8 tags.");
      api.mutate(() => {
        for (const i of notes) {
          i.tagIds = remove
            ? (i.tagIds || []).filter((value) => value !== id)
            : [...new Set([...(i.tagIds || []), id])].sort();
          if (!i.tagIds.length) delete i.tagIds;
        }
      });
    });
  }
  function edit(tag) {
    editing = tag ? { ...tag } : null;
    markName(false);
    panel.querySelector("#tag-name").value = tag?.name || "";
    // Imported or shared tags can use any hex color; keep it selectable.
    const select = panel.querySelector("#tag-color"),
      color = tag?.color.toLowerCase() || TAG_COLORS[0];
    select.querySelector("[data-custom-color]")?.remove();
    if (!TAG_COLORS.includes(color)) {
      const option = panel.ownerDocument.createElement("option");
      option.value = color;
      option.dataset.customColor = "";
      option.textContent = t("Current color");
      select.append(option);
    }
    select.value = color;
    panel.querySelector("#tag-save").textContent = t(
      tag ? "Save tag" : "Create tag",
    );
    panel.querySelector("#tag-cancel").hidden = !tag;
    panel.querySelector("#tag-name").focus();
  }
  // A name of spaces passes the field's required check; its error is tied
  // to the field until the name changes.
  function markName(invalid) {
    const field = panel?.querySelector("#tag-name");
    if (!field) return;
    if (invalid) {
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", "tag-error");
    } else {
      field.removeAttribute("aria-invalid");
      field.removeAttribute("aria-describedby");
    }
  }
  function save(e) {
    e.preventDefault();
    if (e.isComposing) return;
    let blank = false;
    commit(() => {
      const name = panel.querySelector("#tag-name").value.trim(),
        color = panel.querySelector("#tag-color").value;
      if (!name) {
        blank = true;
        throw Error("Enter a tag name.");
      }
      const original = editing && board.tags?.find((t) => t.id === editing.id);
      if (editing && JSON.stringify(original) !== JSON.stringify(editing))
        throw Error("This tag changed. Reopen its settings.");
      const same = board.tags?.find(
        (t) => t.id !== editing?.id && tagKey(t.name) === tagKey(name),
      );
      if (editing && same) throw Error("A tag with this name already exists.");
      const next = {
        id: editing?.id || same?.id || uid(),
        name,
        color: same?.color || color,
      };
      const tags = editing
        ? board.tags.map((t) => (t.id === next.id ? next : t))
        : same
          ? board.tags
          : [...(board.tags || []), next];
      validateTags(tags);
      const notes = selected();
      if (
        !editing &&
        notes.some(
          (i) =>
            !i.tagIds?.includes(next.id) &&
            (i.tagIds?.length || 0) >= TAG_LIMIT,
        )
      )
        throw Error("A sticky note can have up to 8 tags.");
      const affected = editing
        ? new Set(
            board.items
              .filter((i) => i.tagIds?.includes(next.id))
              .map((i) => i.id),
          )
        : ids;
      if (!api.canEdit(affected))
        throw Error("Unlock tagged objects before changing this tag.");
      const change =
        JSON.stringify(tags) !== JSON.stringify(board.tags || []) ||
        (!editing && notes.some((i) => !i.tagIds?.includes(next.id)));
      if (change)
        api.mutate(() => {
          board.tags = tags;
          if (!editing)
            for (const i of notes)
              i.tagIds = [...new Set([...(i.tagIds || []), next.id])].sort();
        });
      edit(null);
    });
    markName(blank);
    if (blank) panel?.querySelector("#tag-name").focus();
  }
  function remove(id) {
    commit(() => {
      const affected = board.items.filter((i) => i.tagIds?.includes(id));
      const concealed = api.concealed?.() || new Set();
      if (affected.some((i) => concealed.has(i.id)))
        throw Error("This tag is also used on content hidden from you.");
      if (!api.canEdit(new Set(affected.map((i) => i.id))))
        throw Error("Unlock tagged objects before changing this tag.");
      api.mutate(() => {
        board.tags = (board.tags || []).filter((t) => t.id !== id);
        for (const i of affected) {
          i.tagIds = i.tagIds.filter((value) => value !== id);
          if (!i.tagIds.length) delete i.tagIds;
        }
      });
      if (editing?.id === id) edit(null);
    });
  }
  function render() {
    if (!panel) return;
    const selection = api.selection();
    if (
      api.board() !== board ||
      board.items
        .filter((i) => selection.has(i.id) && taggable(i))
        .map((i) => i.id)
        .sort()
        .join() !== [...ids].sort().join()
    )
      // The selection changed, as another person deleted an object: keyboard
      // focus in the panel returns to the board rather than the page.
      return close(panel.contains(panel.ownerDocument.activeElement));
    const notes = selected(),
      canWrite = writable(),
      query = panel.querySelector("#tag-search").value;
    const concealed = api.concealed?.() || new Set();
    const key = JSON.stringify([
      board.tags,
      notes.map((i) => [i.id, i.tagIds]),
      canWrite,
      query,
      page,
      concealed.size ? [...concealed].sort() : 0,
    ]);
    if (key === signature) return;
    signature = key;
    // A tag used only on content hidden from this person is not listed.
    const used = new Set(),
      seen = new Set();
    if (concealed.size)
      for (const i of board.items)
        for (const id of i.tagIds || []) {
          used.add(id);
          if (!concealed.has(i.id)) seen.add(id);
        }
    const shown = (tag) => !used.has(tag.id) || seen.has(tag.id);
    const tags = (board.tags || [])
      .filter(
        (tag) => normalize(tag.name).includes(normalize(query)) && shown(tag),
      )
      .sort((a, b) => compareNames(a.name, b.name) || a.id.localeCompare(b.id));
    page = Math.min(page, Math.max(0, Math.ceil(tags.length / 50) - 1));
    const list = panel.querySelector("#tag-list"),
      focused = document.activeElement,
      focus = focused?.closest("[data-tag]"),
      focusId = focus?.dataset.tag,
      focusAction = focus?.dataset.tagAction,
      focusRow = focus
        ? [...list.children].indexOf(focus.closest(".tag-row"))
        : -1;
    list.innerHTML = tags
      .slice(page * 50, page * 50 + 50)
      .map((tag) => {
        const count = notes.filter((i) => i.tagIds?.includes(tag.id)).length,
          checked =
            count === notes.length && count > 0
              ? "true"
              : count
                ? "mixed"
                : "false";
        return `<div class="tag-row"><button type="button" role="checkbox" aria-checked="${checked}" data-tag="${escape(tag.id)}" data-tag-action="toggle" ${!canWrite || !notes.length ? "disabled" : ""}><span class="tag-swatch" style="background:${tag.color}" aria-hidden="true"></span><span data-user-content>${escape(tag.name)}</span><span aria-hidden="true">${checked === "true" ? "✓" : checked === "mixed" ? "−" : ""}</span></button><button type="button" class="text-btn" data-tag="${escape(tag.id)}" data-tag-action="find" aria-label="${labelled(t("Find tagged notes"), "")}${escape(tag.name)}">${t("Find")}</button><button type="button" class="text-btn" data-tag="${escape(tag.id)}" data-tag-action="edit" ${!canWrite ? "disabled" : ""} aria-label="${labelled(t("Edit tag"), "")}${escape(tag.name)}">${t("Edit")}</button><button type="button" class="text-btn" data-tag="${escape(tag.id)}" data-tag-action="delete" ${!canWrite ? "disabled" : ""} aria-label="${labelled(t("Delete tag from board"), "")}${escape(tag.name)}">${t("Delete")}</button></div>`;
      })
      .join("");
    panel.querySelector("#tag-summary").textContent =
      `${plural(notes.length, "{count} selected note", "{count} selected notes")} · ${plural(tags.length, "{count} tag", "{count} tags")}`;
    const empty = panel.querySelector("#tag-empty");
    empty.hidden = !!tags.length;
    // A name nobody has used yet can be created from the search, as in Miro.
    empty.textContent =
      query.trim() && canWrite && notes.length && !editing
        ? t("No matching tags. Press Enter to create “{name}”.").replace(
            "{name}",
            query.trim(),
          )
        : t("No matching tags.");
    panel.querySelector("#tag-prev").disabled = page === 0;
    panel.querySelector("#tag-next").disabled = (page + 1) * 50 >= tags.length;
    panel.querySelector(".tag-pages").hidden = tags.length <= 50;
    keepPaginationFocus(
      focused,
      panel.querySelector("#tag-prev"),
      panel.querySelector("#tag-next"),
      panel.querySelector("#tag-search"),
    );
    panel
      .querySelectorAll("#tag-form input,#tag-form select,#tag-save")
      .forEach((el) => (el.disabled = !canWrite));
    if (
      panel.contains(focused) &&
      focused.disabled &&
      (document.activeElement === focused ||
        document.activeElement === document.body)
    )
      panel.querySelector("#tag-search").focus({ preventScroll: true });
    if (focusId) {
      const rows = [...list.children],
        same = (row) =>
          row?.querySelector(`[data-tag-action="${focusAction}"]`);
      // A deleted tag hands focus to the row taking its place, or the search.
      const target =
        [...list.querySelectorAll("[data-tag]")].find(
          (el) =>
            el.dataset.tag === focusId && el.dataset.tagAction === focusAction,
        ) ||
        same(rows[focusRow]) ||
        same(rows[focusRow - 1]) ||
        panel.querySelector("#tag-search");
      (target.disabled ? panel.querySelector("#tag-search") : target).focus({
        preventScroll: true,
      });
    }
  }
  function open() {
    // Closing returns focus to what opened the panel, as the Tags button;
    // opening it again while open keeps that.
    const kept = panel && origin;
    close();
    origin = kept || opener(`[data-action="tags"]`);
    api.prepare();
    board = api.board();
    if (!board) return;
    ids = new Set(
      board.items
        .filter((i) => api.selection().has(i.id) && taggable(i))
        .map((i) => i.id),
    );
    page = 0;
    panel = document.createElement("section");
    panel.id = "tags-panel";
    panel.className = "tags-panel panel";
    panel.setAttribute("aria-label", t("Tags"));
    panel.innerHTML = `<div class="search-heading"><strong>${t("Tags")}</strong><button type="button" class="text-btn" id="tag-close">${t("Close")}</button></div><p id="tag-summary" role="status"></p><label class="search"><input id="tag-search" type="search" maxlength="64" aria-label="${t("Search tags")}" placeholder="${t("Search tags")}"></label><div id="tag-list"></div><p id="tag-empty">${t("No matching tags.")}</p><div class="tag-pages"><button type="button" class="text-btn" id="tag-prev">${t("Previous")}</button><button type="button" class="text-btn" id="tag-next">${t("Next")}</button></div><form id="tag-form"><label class="field">${t("Tag name")}<input id="tag-name" maxlength="64" required></label><label class="field">${t("Tag color")}<select id="tag-color">${TAG_COLORS.map((color, n) => `<option value="${color}">${t(["Red", "Lime", "Cyan", "Yellow", "Pink", "Green", "Blue", "Gray", "Violet", "Dark green", "Dark blue", "Dark gray", "Black"][n])}</option>`).join("")}</select></label><div class="tag-actions"><button type="button" id="tag-cancel" class="text-btn" hidden>${t("Cancel")}</button><button id="tag-save" class="primary">${t("Create tag")}</button></div></form><p id="tag-error" role="alert" hidden></p><p class="tag-help">${t("Tags apply to selected sticky notes. Renaming, recoloring, or deleting a tag affects the whole board. Up to 8 tags per note.")}</p>`;
    api.canvas().parentElement.append(panel);
    translateUI(panel);
    api.layout?.();
    panel.querySelector("#tag-close").onclick = () => close(true);
    panel.querySelector("#tag-search").oninput = () => {
      page = 0;
      render();
    };
    // Enter applies the tag the search names to the selected notes, creating
    // it first when the board has no tag by that name.
    panel.querySelector("#tag-search").onkeydown = (e) => {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229 || editing)
        return;
      const search = e.currentTarget,
        name = search.value.trim();
      if (!name) return;
      e.preventDefault();
      const same = board.tags?.find((t) => tagKey(t.name) === tagKey(name));
      if (same) {
        if (!selected().every((i) => i.tagIds?.includes(same.id)))
          toggle(same.id);
      } else {
        // Each new tag takes the next color, so tags made one after another
        // can be told apart.
        panel.querySelector("#tag-name").value = name;
        panel.querySelector("#tag-color").value =
          TAG_COLORS[(board.tags?.length || 0) % TAG_COLORS.length];
        save(e);
        if (!panel || panel.querySelector("#tag-name").value) return;
      }
      search.value = "";
      page = 0;
      signature = null;
      render();
      search.focus();
    };
    panel.querySelector("#tag-form").onsubmit = save;
    panel.querySelector("#tag-name").oninput = () => markName(false);
    panel.querySelector("#tag-cancel").onclick = () => edit(null);
    const previous = panel.querySelector("#tag-prev"),
      next = panel.querySelector("#tag-next");
    previous.onclick = () => {
      page--;
      render();
      keepPageFocus(previous, next);
    };
    next.onclick = () => {
      page++;
      render();
      keepPageFocus(next, previous);
    };
    panel.querySelector("#tag-list").onclick = (e) => {
      const button = e.target.closest("[data-tag]");
      if (!button || button.disabled) return;
      const tag = board.tags?.find((t) => t.id === button.dataset.tag);
      if (!tag) return;
      if (button.dataset.tagAction === "toggle") toggle(tag.id);
      if (button.dataset.tagAction === "edit") edit(tag);
      if (button.dataset.tagAction === "delete") remove(tag.id);
      if (button.dataset.tagAction === "find") {
        close();
        api.find(tag.id);
      }
    };
    for (const event of ["copy", "cut", "paste"])
      panel.addEventListener(event, (e) => e.stopPropagation());
    panel.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    });
    render();
    panel.querySelector("#tag-search").focus();
  }
  return { open, close, render, isOpen: () => !!panel };
}
