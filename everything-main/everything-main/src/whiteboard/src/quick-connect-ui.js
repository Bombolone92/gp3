import {
  QUICK_DIRECTIONS,
  quickConnectPlan,
  quickPortPositions,
} from "./quick-connect.js";
import { t } from "./i18n.js";
import { escape } from "./model.js";
import { objectNameHTML } from "./accessibility/object-content.js";

export function createQuickConnectUI(api) {
  let root,
    hover = null,
    focus = null,
    pressed = null,
    cache = null,
    suppressUntil = 0;
  const redraw = () => api.draw();
  const hideTooltips = (except) => {
    for (const tip of root?.querySelectorAll('[role="tooltip"]') || [])
      if (tip.id !== `quick-connect-preview-${except}`) tip.hidden = true;
  };
  const cancel = () => {
    const wasDragging = pressed?.started;
    pressed = null;
    hover = focus = null;
    cache = null;
    hideTooltips();
    suppressUntil = performance.now() + 300;
    if (wasDragging) api.cancel();
    else redraw();
  };
  const dismiss = (event) => {
    if (
      event.key !== "Escape" ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.defaultPrevented ||
      !root?.isConnected ||
      pressed?.started ||
      event.target.closest?.('dialog,[role="dialog"]') ||
      !root?.querySelector('[role="tooltip"]:not([hidden])')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (pressed) cancel();
    else {
      hover = focus = null;
      cache = null;
      hideTooltips();
      redraw();
    }
  };
  return {
    cancel,
    resetGesture() {
      if (!pressed) return;
      pressed = null;
      hover = focus = null;
      cache = null;
      suppressUntil = performance.now() + 300;
    },
    bind(element) {
      root?.ownerDocument.removeEventListener("keydown", dismiss);
      root = element;
      hover = focus = pressed = cache = null;
      suppressUntil = 0;
      root.innerHTML = `<span id="quick-connect-hint" class="sr-only">${t("Click to add a connected object or connect a nearby one. Drag to choose another target. Escape cancels.")}</span>${QUICK_DIRECTIONS.map((direction) => `<button type="button" class="quick-port" data-quick-direction="${direction}" aria-label="${t(`Quick connect ${direction}`)}" aria-describedby="quick-connect-preview-${direction} quick-connect-hint"><span aria-hidden="true">+</span><span id="quick-connect-preview-${direction}" class="quick-connect-tooltip panel" role="tooltip" hidden></span></button>`).join("")}`;
      root.ownerDocument.addEventListener("keydown", dismiss);
      root.setAttribute("aria-label", t("Quick diagram creation"));
      for (const button of root.querySelectorAll("button")) {
        const direction = button.dataset.quickDirection;
        button.addEventListener("pointerenter", () => {
          hover = direction;
          redraw();
        });
        button.addEventListener("pointerleave", () => {
          hover = null;
          if (!pressed) redraw();
        });
        button.addEventListener("focus", () => {
          focus = direction;
          redraw();
        });
        button.addEventListener("blur", () => {
          focus = null;
          if (!pressed) redraw();
        });
        button.addEventListener("click", (event) => {
          if (event.target.closest(".quick-connect-tooltip")) return;
          if (pressed) return;
          if (event.detail && performance.now() < suppressUntil) return;
          const state = api.state();
          if (!state.source) return;
          hover = focus = null;
          cache = null;
          api.activate(state.source.id, direction);
        });
        button.addEventListener("pointerdown", (event) => {
          if (event.target.closest(".quick-connect-tooltip")) return;
          if (event.button !== 0 || pressed) return;
          const state = api.state();
          if (!state.source) return;
          event.preventDefault();
          event.stopPropagation();
          pressed = {
            board: state.board,
            id: state.source.id,
            x: event.clientX,
            y: event.clientY,
            event,
            started: false,
          };
          button.setPointerCapture?.(event.pointerId);
        });
        button.addEventListener("pointermove", (event) => {
          if (!pressed || event.pointerId !== pressed.event.pointerId) return;
          if (api.state().board !== pressed.board) return cancel();
          if (
            !pressed.started &&
            Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 4
          ) {
            const gesture = pressed;
            // Set first: starting the connector redraws and changes selection.
            gesture.started = true;
            if (!api.start(gesture.id, gesture.event)) return cancel();
          }
          if (pressed?.started) api.move(event);
        });
        button.addEventListener("pointerup", (event) => {
          if (!pressed || event.pointerId !== pressed.event.pointerId) return;
          const started = pressed.started;
          pressed = null;
          if (started) {
            suppressUntil = performance.now() + 300;
            hover = focus = null;
            api.move(event);
            api.end();
          }
        });
        for (const type of ["pointercancel", "lostpointercapture"])
          button.addEventListener(type, (event) => {
            if (pressed && event.pointerId === pressed.event.pointerId)
              cancel();
          });
        button.addEventListener("keydown", (event) => {
          dismiss(event);
          if (event.defaultPrevented) return;
          if (
            event.target === button &&
            !event.isComposing &&
            event.keyCode !== 229 &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            [
              "ArrowUp",
              "ArrowDown",
              "PageUp",
              "PageDown",
              "Home",
              "End",
            ].includes(event.key)
          ) {
            const tip = button.querySelector('[role="tooltip"]');
            const maximum = tip.scrollHeight - tip.clientHeight;
            if (!tip.hidden && maximum > 0) {
              event.preventDefault();
              event.stopPropagation();
              let next;
              if (event.key === "Home") next = 0;
              else if (event.key === "End") next = maximum;
              else {
                const step = event.key.startsWith("Page")
                  ? tip.clientHeight
                  : 40;
                next =
                  tip.scrollTop +
                  (["ArrowDown", "PageDown"].includes(event.key)
                    ? step
                    : -step);
              }
              tip.scrollTop = Math.max(0, Math.min(maximum, next));
              return;
            }
          }
          if (
            event.key !== "Escape" ||
            event.isComposing ||
            event.keyCode === 229
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          cancel();
          api.focusCanvas();
        });
      }
    },
    render() {
      if (!root?.isConnected) return null;
      // Keep the capture element alive until the drag ends or is cancelled.
      if (pressed?.started) {
        hideTooltips();
        return null;
      }
      const {
        board,
        source,
        view,
        skip: skipped = () => new Set(),
      } = api.state();
      root.hidden = !source;
      if (!source) {
        hideTooltips();
        hover = focus = null;
        cache = null;
        return null;
      }
      const positions = quickPortPositions(source, view);
      for (const button of root.querySelectorAll("button")) {
        const [x, y] = positions[button.dataset.quickDirection];
        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
      }
      const direction = hover || focus;
      hideTooltips(direction);
      if (!direction) {
        cache = null;
        return null;
      }
      const signature = JSON.stringify(source);
      // The preview names and outlines only what activating it would use,
      // never content hidden from this person.
      const skip = skipped();
      if (
        !cache ||
        cache.items !== board.items ||
        cache.updated !== board.updated ||
        cache.source !== signature ||
        cache.direction !== direction ||
        cache.skip.size !== skip.size ||
        [...skip].some((id) => !cache.skip.has(id))
      ) {
        let plan, error;
        try {
          plan = quickConnectPlan(board.items, source.id, direction, skip);
        } catch (e) {
          error = e.message;
        }
        cache = {
          items: board.items,
          updated: board.updated,
          source: signature,
          direction,
          skip: new Set(skip),
          plan,
          error,
        };
      }
      const button = root.querySelector(
        `[data-quick-direction="${direction}"]`,
      );
      const tip = button.querySelector('[role="tooltip"]');
      const markup = cache.error
        ? escape(t(cache.error))
        : cache.plan.node
          ? escape(t("Add connected object"))
          : `${escape(t("Connect to"))} ${objectNameHTML(cache.plan.target, 160)}`;
      if (tip.innerHTML !== markup) tip.innerHTML = markup;
      tip.hidden = false;
      // Touch the trigger's edge so the pointer can enter the tooltip
      // without leaving the button and dismissing it in the gap.
      const rect = root.getBoundingClientRect(),
        [x, y] = positions[direction],
        width = Math.min(260, Math.max(44, rect.width - 16)),
        below = Math.max(0, rect.height - y - 30),
        above = Math.max(0, y - 30),
        down = below >= above;
      tip.style.width = `${width}px`;
      tip.style.maxHeight = `${Math.max(0, down ? below : above)}px`;
      tip.style.left = `${Math.max(8, Math.min(rect.width - width - 8, x - 22)) - (x - 22)}px`;
      tip.style.top = down ? "44px" : `${-(tip.offsetHeight || above)}px`;
      return cache.plan || null;
    },
  };
}
