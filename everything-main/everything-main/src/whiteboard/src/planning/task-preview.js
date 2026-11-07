import { t } from "../i18n.js";

// A selectable, scrollable preview replaces the single-language native title.
// Hover and focus keep it open; Escape dismisses it without closing the dialog.
export function attachTaskPreview(dialog) {
  const doc = dialog.ownerDocument,
    win = doc.defaultView;
  const preview = doc.createElement("div");
  preview.id = "tasks-title-preview";
  preview.className = "task-title-preview";
  preview.setAttribute("role", "region");
  preview.setAttribute("aria-label", t("Task preview"));
  preview.tabIndex = 0;
  preview.hidden = true;
  dialog.append(preview);
  let owner,
    hovered = false,
    dismissed;
  const listeners = [];
  const listen = (element, type, callback, options) => {
    element.addEventListener(type, callback, options);
    listeners.push(() => element.removeEventListener(type, callback, options));
  };
  const inside = (target) =>
    owner?.contains(target) || preview.contains(target);
  function hide(restore = false) {
    const previous = owner,
      focused = preview.contains(doc.activeElement);
    owner = undefined;
    hovered = false;
    preview.hidden = true;
    if (restore && focused)
      (previous?.isConnected
        ? previous
        : dialog.querySelector('[role="tab"][aria-selected="true"]')
      )?.focus();
    // Keep the controlled region in the dialog even when its chart is rebuilt.
    if (preview.parentElement !== dialog) dialog.append(preview);
  }
  function show(bar, refresh = false) {
    if (!bar || (!refresh && bar === dismissed)) return;
    owner = bar;
    // Tab can enter the preview before focus leaves its owner and hides it.
    // Avoid moving an already focused preview during positioning updates.
    if (preview.previousElementSibling !== bar) bar.after(preview);
    const markup = bar.querySelector("[data-task-preview]")?.innerHTML || "";
    const scroll = preview.scrollTop;
    if (preview.innerHTML !== markup) preview.innerHTML = markup;
    preview.scrollTop = scroll;
    preview.setAttribute("aria-label", t("Task preview"));
    preview.hidden = false;
    const rect = bar.getBoundingClientRect(),
      below = Math.max(0, win.innerHeight - rect.bottom - 8),
      above = Math.max(0, rect.top - 8),
      down = below >= above;
    preview.style.maxWidth = `${Math.max(24, Math.min(360, win.innerWidth - 16))}px`;
    preview.style.maxHeight = `${Math.max(24, Math.min(280, down ? below : above))}px`;
    const box = preview.getBoundingClientRect();
    preview.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - box.width - 8))}px`;
    // Touch the bar's edge, allowing the pointer to enter the preview.
    preview.style.top = `${down ? rect.bottom : Math.max(8, rect.top - box.height)}px`;
  }
  const maybeHide = (next, leavingFocus = false) => {
    if (
      !hovered &&
      !inside(next) &&
      !inside(leavingFocus ? next : doc.activeElement)
    )
      hide();
  };
  const dismiss = () => {
    dismissed = owner;
    hide(true);
  };
  listen(dialog, "mouseover", (event) => {
    if (preview.contains(event.target)) {
      hovered = true;
      return;
    }
    const bar = event.target.closest?.(".timeline-bar");
    if (!bar || bar.contains(event.relatedTarget)) return;
    hovered = true;
    show(bar);
  });
  listen(dialog, "mouseout", (event) => {
    const bar = event.target.closest?.(".timeline-bar");
    if (
      bar?.contains(event.relatedTarget) ||
      preview.contains(event.relatedTarget)
    )
      return;
    if (bar === dismissed) dismissed = undefined;
    if (!bar && !preview.contains(event.target)) return;
    hovered = !!owner?.contains(event.relatedTarget);
    maybeHide(event.relatedTarget);
  });
  listen(dialog, "focusin", (event) => {
    if (preview.contains(event.target)) return;
    const bar = event.target.closest?.(".timeline-bar");
    if (bar) show(bar);
    else maybeHide(event.target);
  });
  listen(dialog, "focusout", (event) => {
    if (
      dismissed?.contains(event.target) &&
      !dismissed.contains(event.relatedTarget)
    )
      dismissed = undefined;
    maybeHide(event.relatedTarget, true);
  });
  listen(dialog, "keydown", (event) => {
    if (
      event.key !== "Escape" ||
      event.isComposing ||
      event.keyCode === 229 ||
      preview.hidden
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  });
  listen(
    dialog,
    "scroll",
    (event) => {
      if (preview.contains(event.target)) return;
      // Native focus navigation can scroll the dialog after focusin opens
      // the preview. Keep it available and aligned while that focus remains.
      if (owner && inside(doc.activeElement)) show(owner, true);
      else dismiss();
    },
    true,
  );
  listen(win, "resize", () => {
    if (owner && !preview.hidden) show(owner, true);
  });
  const destroy = () => {
    hide();
    for (const remove of listeners.splice(0)) remove();
  };
  dialog.addEventListener("close", destroy, { once: true });
  return {
    refresh() {
      if (preview.hidden) return;
      const bar = [...dialog.querySelectorAll(".timeline-bar")].find(
        (el) =>
          el.dataset.task === owner?.dataset.task && !el.closest("[hidden]"),
      );
      if (bar) show(bar, true);
      else hide(true);
    },
    destroy,
  };
}
