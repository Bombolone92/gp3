import { objectBounds } from "./geometry.js";
import { escape } from "./model.js";
import { t, translateUI, objectName } from "./i18n.js";
import { objectNameHTML } from "./accessibility/object-content.js";
import { linkTo } from "./object-link-data.js";
import { keepPageFocus } from "./paging.js";

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalized = (value) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
export function createObjectLinks(api) {
  let layer,
    panel,
    sourceId,
    original,
    board,
    signature,
    page = 0;
  const badges = new Map();
  const badgeSignatures = new WeakMap();
  const source = () => api.state().board?.items.find((i) => i.id === sourceId);
  function close(focus = false) {
    panel?.remove();
    panel = null;
    sourceId = null;
    signature = null;
    if (focus) api.canvas()?.focus({ preventScroll: true });
  }
  function dismiss() {
    close(true);
    api.draw();
  }
  function error(message) {
    const output = panel?.querySelector("#object-link-error");
    if (output) {
      output.textContent = t(message);
      output.hidden = false;
    } else api.toast(message);
  }
  function valid() {
    const i = source();
    return (
      api.state().board === board &&
      i &&
      equal(i.objectLink, original) &&
      api.writable(i)
    );
  }
  function apply(remove = false) {
    if (!valid())
      return error(
        "This object changed or is protected. Reopen its link settings.",
      );
    const i = source(),
      next = remove
        ? undefined
        : linkTo(
            panel.querySelector("#object-link-url").value,
            board,
            api.base(),
          );
    if (!remove && !next) return error("Enter a valid http or https link.");
    if (next?.objectId === i.id) return error("Choose a different object.");
    if (next?.objectId && !board.items.some((i) => i.id === next.objectId))
      return error("The linked object is no longer on this board.");
    if (!equal(next, original)) api.change(i, next);
    close(true);
    api.draw();
  }
  async function copy(i = api.selected()) {
    if (!i) return api.toast("Select one object first.");
    const current = api.state().board,
      url = api.address(i.id);
    if (!url) return api.toast("Unable to create a link to this object.");
    try {
      await navigator.clipboard.writeText(url);
      api.toast("Object link copied.");
    } catch {
      if (api.state().board !== current) return;
      api.modal(
        "Copy link to object",
        `<p class="dialog-copy">${t(current.shared ? "Only people with board access can open this link." : "This link opens a board saved on this device.")}</p><label class="field">${t("Object link")}<input id="copy-object-url" readonly value="${escape(url)}"></label>`,
        (d) => {
          const field = d.querySelector("input");
          field.focus();
          field.select();
        },
      );
    }
  }
  function show(i = api.selected()) {
    if (!i || api.state().concealed?.has(i.id))
      return api.toast("Select one object first.");
    close();
    api.prepare();
    board = api.state().board;
    sourceId = i.id;
    original = i.objectLink ? structuredClone(i.objectLink) : undefined;
    page = 0;
    panel = document.createElement("section");
    panel.id = "object-links-panel";
    panel.className = "object-links-panel panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t("Object link"));
    panel.innerHTML = `<header><h2>${t("Object link")}</h2><button type="button" class="icon-btn" id="object-link-close" aria-label="${t("Close")}">${api.icon("x")}</button></header><div id="object-link-current"></div><button class="text-btn" id="object-link-copy">${t("Copy link to this object")}</button><p class="dialog-copy" id="object-link-context"></p><form id="object-link-form"><p class="dialog-copy">${t("Click a destination object on the canvas, choose one below, or enter a website URL.")}</p><label class="field">${t("Link destination")}<input id="object-link-url" type="text" inputmode="url" maxlength="2048" autocomplete="off" spellcheck="false" placeholder="https://example.com" aria-describedby="object-link-error"></label><label class="field">${t("Find destination object")}<input id="object-link-search" type="search" autocomplete="off"></label><div id="object-link-targets"></div><div class="object-link-pages"><button type="button" class="text-btn" id="object-link-previous">${t("Previous")}</button><span id="object-link-count" role="status"></span><button type="button" class="text-btn" id="object-link-next">${t("Next")}</button></div><p id="object-link-error" role="alert" hidden></p><div class="object-link-actions"><button class="text-btn" type="button" id="object-link-remove">${t("Remove link")}</button><button class="secondary" type="button" id="object-link-cancel">${t("Cancel")}</button><button class="primary" type="submit">${t("Apply link")}</button></div></form>`;
    api.canvas().parentElement.append(panel);
    panel.querySelector("#object-link-url").value =
      i.objectLink?.url ||
      (i.objectLink?.objectId ? api.address(i.objectLink.objectId) : "");
    panel.querySelector("#object-link-close").onclick = dismiss;
    panel.querySelector("#object-link-cancel").onclick = dismiss;
    panel.querySelector("#object-link-copy").onclick = () => copy(source());
    panel.querySelector("#object-link-remove").onclick = () => apply(true);
    panel.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      apply();
    };
    panel.querySelector("#object-link-search").oninput = () => {
      page = 0;
      signature = null;
      renderPanel();
    };
    panel.querySelector("#object-link-url").oninput = () => {
      signature = null;
      renderPanel();
    };
    for (const [id, step] of [
      ["previous", -1],
      ["next", 1],
    ])
      panel.querySelector(`#object-link-${id}`).onclick = () => {
        page += step;
        signature = null;
        renderPanel();
        keepPageFocus(
          panel.querySelector(`#object-link-${id}`),
          panel.querySelector(`#object-link-${step < 0 ? "next" : "previous"}`),
        );
      };
    panel.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        dismiss();
      }
    };
    renderPanel();
    translateUI(panel);
    panel
      .querySelector(api.writable(i) ? "#object-link-url" : "#object-link-copy")
      .focus();
    api.draw();
  }
  function pick(i) {
    if (!panel || !api.writable(source())) return false;
    if (!valid()) {
      error("This object changed or is protected. Reopen its link settings.");
      return true;
    }
    if (!i) return true;
    if (i.id === sourceId) {
      error("Choose a different object.");
      return true;
    }
    panel.querySelector("#object-link-url").value = api.address(i.id);
    panel.querySelector("#object-link-error").hidden = true;
    signature = null;
    renderPanel();
    panel.querySelector('[type="submit"]').focus();
    return true;
  }
  function renderPanel() {
    if (!panel) return;
    const state = api.state(),
      i = source();
    if (state.board !== board || !i || state.concealed?.has(i.id)) {
      close();
      return;
    }
    const writable = api.writable(i),
      query = normalized(panel.querySelector("#object-link-search").value),
      field = panel.querySelector("#object-link-url").value;
    const next = [
      board.items,
      board.updated,
      query,
      field,
      writable,
      i.objectLink,
      page,
      JSON.stringify([...(state.hidden || [])]),
      !!state.concealed?.has(i.objectLink?.objectId),
    ];
    if (signature && next.every((v, n) => v === signature[n])) return;
    signature = next;
    const focused = panel.contains(document.activeElement)
        ? document.activeElement
        : null,
      targetId = focused?.dataset.linkTarget,
      targetIndex = targetId
        ? [...panel.querySelectorAll("[data-link-target]")].indexOf(focused)
        : -1,
      currentFocused = focused?.matches("#object-link-current a"),
      form = panel.querySelector("#object-link-form"),
      copyButton = panel.querySelector("#object-link-copy");
    form.hidden = !writable;
    panel.querySelector("#object-link-remove").hidden = !original;
    panel.querySelector("#object-link-context").textContent = t(
      board.shared
        ? "Only people with board access can open this link."
        : "This link opens a board saved on this device.",
    );
    const current = panel.querySelector("#object-link-current");
    current.replaceChildren();
    if (i.objectLink) {
      const a = document.createElement("a");
      a.className = "object-link-destination";
      a.dataset.userContent = "";
      destination(a, i);
      current.append(a);
    } else {
      current.textContent = t("No object link.");
    }
    if (currentFocused)
      (current.querySelector("a") || copyButton).focus({ preventScroll: true });
    if (!writable) {
      if (form.contains(focused)) copyButton.focus({ preventScroll: true });
      return;
    }
    if (!valid())
      error("This object changed or is protected. Reopen its link settings.");
    // Objects hidden from this person are never offered as destinations.
    const hidden = state.hidden;
    const results = board.items.filter(
      (v) =>
        v.id !== i.id &&
        !hidden?.has(v.id) &&
        (!query || normalized(objectName(v)).includes(query)),
    );
    page = Math.max(0, Math.min(page, Math.ceil(results.length / 50) - 1));
    const chosen = linkTo(field, board, api.base())?.objectId;
    panel.querySelector("#object-link-targets").innerHTML =
      results
        .slice(page * 50, page * 50 + 50)
        .map(
          (v) =>
            `<button type="button" data-link-target="${escape(v.id)}" aria-pressed="${v.id === chosen}" data-user-content>${objectNameHTML(v, 120)}</button>`,
        )
        .join("") || `<p class="dialog-copy">${t("No objects found.")}</p>`;
    panel.querySelector(".object-link-pages").hidden = results.length <= 50;
    panel.querySelector("#object-link-count").textContent = String(
      results.length,
    );
    panel.querySelector("#object-link-previous").disabled = page === 0;
    panel.querySelector("#object-link-next").disabled =
      (page + 1) * 50 >= results.length;
    for (const b of panel.querySelectorAll("[data-link-target]"))
      b.onclick = () =>
        pick(board.items.find((i) => i.id === b.dataset.linkTarget));
    if (targetId) {
      const targets = [...panel.querySelectorAll("[data-link-target]")];
      (
        targets.find((b) => b.dataset.linkTarget === targetId) ||
        targets[Math.min(targetIndex, targets.length - 1)] ||
        panel.querySelector("#object-link-search")
      ).focus({ preventScroll: true });
    }
  }
  function destination(a, i) {
    const link = i.objectLink;
    const target =
      link.objectId &&
      api.state().board.items.find((v) => v.id === link.objectId);
    a.href = link.url || api.address(link.objectId);
    a.target = link.url ? "_blank" : "_self";
    a.rel = "noopener noreferrer";
    a.textContent =
      link.url ||
      (target
        ? api.state().concealed?.has(target.id)
          ? t("Go to linked object")
          : objectName(target)
        : t("The linked object is no longer on this board."));
    a.title = a.href;
    a.onclick = (e) => {
      const live = api.state().board?.items.find((v) => v.id === i.id);
      if (!live || !equal(live.objectLink, link)) {
        e.preventDefault();
        return;
      }
      if (
        link.objectId &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        close();
        api.navigate(link.objectId);
      }
    };
  }
  function render() {
    renderPanel();
    const state = api.state();
    if (!layer || !state.board) return;
    const rect = api.canvas().getBoundingClientRect(),
      keep = new Set();
    let count = 0;
    const selectedId = api.selected()?.id,
      addressContext = [
        state.board.id,
        state.board.shared?.server,
        state.board.shared?.room,
        api.base().split(/[?#]/)[0],
      ].join("\n");
    // Small silhouettes do not need a screen-sized badge. Bound dense/overlapping
    // scenes; every object's destination remains available through Object link.
    for (let n = state.board.items.length - 1; n >= 0; n--) {
      const i = state.board.items[n];
      if (!i.objectLink || state.hidden?.has(i.id)) continue;
      const selected = selectedId === i.id;
      if (
        !selected &&
        (count >= 400 ||
          Math.max(Math.abs(i.w), Math.abs(i.h)) * state.view.z < 24)
      )
        continue;
      const box = objectBounds(i);
      const x = state.view.x + (box.x + box.w) * state.view.z + 15,
        y = state.view.y + box.y * state.view.z + 15;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) continue;
      count++;
      keep.add(i.id);
      let badge = badges.get(i.id);
      if (!badge) {
        badge = document.createElement("a");
        badge.className = "object-link-badge";
        badge.dataset.objectLink = i.id;
        layer.append(badge);
        badges.set(i.id, badge);
      }
      // Avoid scanning target names or replacing icon DOM on camera-only paints.
      const label = i.objectLink.url || t("Go to linked object");
      const labelText = `${t("Open object link")}: ${label}`,
        key = `${addressContext}\n${i.objectLink.objectId || ""}\n${labelText}`;
      if (badgeSignatures.get(badge) !== key) {
        badgeSignatures.set(badge, key);
        badge.setAttribute("aria-label", labelText);
        badge.title = label;
        badge.href = i.objectLink.url || api.address(i.objectLink.objectId);
        badge.target = i.objectLink.url ? "_blank" : "_self";
        badge.rel = "noopener noreferrer";
        if (!badge.firstChild) badge.innerHTML = api.icon("link");
        const link = { ...i.objectLink };
        badge.onclick = (e) => {
          const live = api.state().board?.items.find((v) => v.id === i.id);
          if (
            api.state().board !== state.board ||
            !live ||
            !equal(live.objectLink, link)
          ) {
            e.preventDefault();
            return;
          }
          if (
            link.objectId &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.shiftKey &&
            !e.altKey
          ) {
            e.preventDefault();
            close();
            api.navigate(link.objectId);
          }
        };
      }
      badge.style.left = `${x}px`;
      badge.style.top = `${y}px`;
    }
    for (const [id, el] of badges)
      if (!keep.has(id)) {
        el.remove();
        badges.delete(id);
      }
  }
  return {
    show,
    close,
    copy,
    pick,
    render,
    isOpen: () => !!panel,
    bind(next) {
      close();
      layer = next;
      badges.clear();
    },
  };
}
