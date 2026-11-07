import { quickPortPositions } from "./quick-connect.js";
import { t } from "./i18n.js";

const sides = { up: "top", right: "right", down: "bottom", left: "left" };
const labels = {
  up: "Add child above",
  right: "Add child to the right",
  down: "Add child below",
  left: "Add child to the left",
};

// Four persistent buttons, regardless of map size. Pointer gestures retain the
// original node so a remote edit or selection change cannot redirect a click.
export function createMindMapHandles(api) {
  let root,
    pressed = null,
    blocked = false;
  function cancel() {
    pressed = null;
    blocked = true;
  }
  const allowed = (source, direction) =>
    source?.mindMap &&
    (!source.mindMap.parent || source.mindMap.direction === direction);
  const matches = (state) =>
    pressed &&
    state.board === pressed.board &&
    state.source?.id === pressed.id &&
    JSON.stringify(state.source.mindMap) === pressed.metadata;
  return {
    cancel,
    bind(element) {
      root = element;
      pressed = null;
      blocked = false;
      root.setAttribute("aria-label", t("Create mind map branches"));
      root.innerHTML = Object.keys(sides)
        .map(
          (direction) =>
            `<button type="button" class="quick-port mind-port" data-mind-direction="${direction}" aria-label="${t(labels[direction])}" title="${t(labels[direction])}"><span aria-hidden="true">+</span></button>`,
        )
        .join("");
      for (const button of root.querySelectorAll("button")) {
        const direction = button.dataset.mindDirection;
        button.addEventListener("pointerdown", (e) => {
          if (e.button !== 0 || pressed) return cancel();
          const state = api.state();
          if (!allowed(state.source, direction)) return cancel();
          e.preventDefault();
          e.stopPropagation();
          blocked = false;
          pressed = {
            board: state.board,
            id: state.source.id,
            metadata: JSON.stringify(state.source.mindMap),
            direction,
            pointerId: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            ready: false,
          };
          try {
            button.setPointerCapture?.(e.pointerId);
          } catch {}
        });
        button.addEventListener("pointermove", (e) => {
          if (
            pressed &&
            e.pointerId === pressed.pointerId &&
            Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 8
          )
            cancel();
        });
        button.addEventListener("pointerup", (e) => {
          if (!pressed || pressed.pointerId !== e.pointerId) return;
          if (
            !matches(api.state()) ||
            Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 8
          )
            return cancel();
          pressed.ready = true;
        });
        button.addEventListener("pointercancel", cancel);
        button.addEventListener("lostpointercapture", () => {
          if (pressed && !pressed.ready) cancel();
        });
        button.addEventListener("click", (e) => {
          const state = api.state();
          if (!allowed(state.source, direction) || button.hidden) return;
          if (
            e.detail &&
            (blocked ||
              !pressed?.ready ||
              pressed.direction !== direction ||
              !matches(state))
          )
            return;
          pressed = null;
          api.add(direction);
        });
        button.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancel();
            api.focus();
          } else if (["Enter", " "].includes(e.key)) {
            e.stopPropagation();
            if (e.repeat) e.preventDefault();
          } else if (e.key.startsWith("Arrow")) {
            e.preventDefault();
            e.stopPropagation();
            const next = root.querySelector(
              `[data-mind-direction="${e.key.slice(5).toLowerCase()}"]`,
            );
            if (next && !next.hidden) next.focus();
          }
        });
      }
    },
    render() {
      if (!root?.isConnected) return;
      const state = api.state(),
        { source, view, size } = state;
      if (pressed && !matches(state)) cancel();
      root.hidden = !source?.mindMap;
      if (root.hidden) return;
      const positions = quickPortPositions(source, view);
      for (const button of root.querySelectorAll("button")) {
        const direction = button.dataset.mindDirection;
        const [x, y] = positions[sides[direction]];
        button.hidden =
          !allowed(source, direction) ||
          !!(
            size?.width &&
            size?.height &&
            (x < 22 || y < 22 || x > size.width - 22 || y > size.height - 22)
          );
        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
      }
    },
  };
}
