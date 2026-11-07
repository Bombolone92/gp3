import { shortcutLetter } from "./shortcut-keys.js";
import {
  minimapScene,
  visibleWorld,
  minimapLayout,
  mapPoint,
  mapRect,
  centerView,
  paintMinimapScene,
  paintMinimapViewport,
} from "./minimap.js";
import { zoomAt } from "./model.js";
import { wheelZoom, pointerFocus } from "./navigation.js";
import { t } from "./i18n.js";

export function createMinimap(api) {
  let enabled = false;
  try {
    enabled = localStorage.getItem("whiteboard-minimap") === "true";
  } catch {}
  let root,
    canvas,
    backdrop,
    scene,
    sceneBoard,
    sceneItems,
    layout,
    paintedLayout,
    paintedScene,
    colors,
    colorTheme,
    viewport,
    gesture,
    previousTransient = false,
    dirty = true;
  const size = () => {
    const r = api.canvas().getBoundingClientRect();
    return { width: r.width || 300, height: r.height || 150 };
  };
  const hide = (focus = false) => {
    if (gesture) cancel();
    enabled = false;
    try {
      localStorage.setItem("whiteboard-minimap", "false");
    } catch {}
    if (root) root.hidden = true;
    syncTrigger();
    if (focus)
      document
        .querySelector('[data-action="minimap"]')
        ?.focus({ preventScroll: true });
  };
  function syncTrigger() {
    const trigger = document.querySelector('[data-action="minimap"]');
    trigger?.setAttribute("aria-expanded", String(!!root && !root.hidden));
    trigger?.setAttribute("aria-pressed", String(enabled));
  }
  function navigate(next) {
    api.navigate(next);
  }
  function cancel() {
    const g = gesture;
    gesture = null;
    if (g && api.state().board === g.board) navigate(g.view);
  }
  function point(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          layout.width,
          ((e.clientX - r.left) * layout.width) / (r.width || layout.width),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          layout.height,
          ((e.clientY - r.top) * layout.height) / (r.height || layout.height),
        ),
      ),
    };
  }
  function move(e) {
    const g = gesture;
    if (!g || e.pointerId !== g.pointer || api.state().board !== g.board)
      return;
    const p = mapPoint(g.layout, point(e));
    navigate(
      centerView(g.view, g.size, { x: p.x - g.offset.x, y: p.y - g.offset.y }),
    );
  }
  function bind(element) {
    // Navigation to another board must not restore a previous board's camera.
    gesture = null;
    root = element;
    scene =
      sceneBoard =
      sceneItems =
      layout =
      paintedLayout =
      paintedScene =
        null;
    dirty = true;
    previousTransient = false;
    colors = null;
    root.innerHTML = `<div class="minimap-heading"><strong>${t("Minimap")}</strong><button type="button" id="minimap-fit" class="text-btn">${t("Fit board")}</button><button type="button" id="minimap-close" class="icon-btn" aria-label="${t("Close minimap")}">×</button></div><canvas id="minimap-canvas" tabindex="0" role="application" aria-roledescription="${t("minimap")}" aria-label="${t("Navigate board")}" aria-describedby="minimap-hint"></canvas><span id="minimap-hint" class="sr-only">${t("Click to jump or drag the visible area. Arrow keys pan; plus and minus zoom; Home fits the board; Escape closes the minimap.")}</span>`;
    root.setAttribute("aria-label", t("Minimap"));
    canvas = root.querySelector("canvas");
    backdrop = document.createElement("canvas");
    root.querySelector("#minimap-close").onclick = () => hide(true);
    root.querySelector("#minimap-fit").onclick = () => {
      api.prepare();
      api.fit();
      canvas.focus({ preventScroll: true });
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || gesture || root.hidden) return;
      e.preventDefault();
      api.prepare();
      pointerFocus(canvas);
      const state = api.state(),
        s = size(),
        p = point(e),
        world = mapPoint(layout, p),
        box = visibleWorld(state.view, s);
      const inside =
        viewport &&
        p.x >= viewport.x &&
        p.x <= viewport.x + viewport.w &&
        p.y >= viewport.y &&
        p.y <= viewport.y + viewport.h;
      gesture = {
        board: state.board,
        pointer: e.pointerId,
        view: { ...state.view },
        size: s,
        layout: { ...layout },
        offset: inside
          ? { x: world.x - box.x - box.w / 2, y: world.y - box.y - box.h / 2 }
          : { x: 0, y: 0 },
      };
      canvas.setPointerCapture?.(e.pointerId);
      if (!inside) move(e);
    });
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", (e) => {
      if (!gesture || e.pointerId !== gesture.pointer) return;
      move(e);
      gesture = null;
      api.draw();
    });
    canvas.addEventListener("pointercancel", (e) => {
      if (gesture?.pointer === e.pointerId) cancel();
    });
    canvas.addEventListener("lostpointercapture", (e) => {
      if (gesture?.pointer === e.pointerId) cancel();
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (gesture) return;
        api.prepare();
        const { view } = api.state(),
          s = size();
        navigate(
          wheelZoom(view, e, { x: s.width / 2, y: s.height / 2 }, s.height),
        );
      },
      { passive: false },
    );
    // Only the keys the minimap answers stop here; undo, delete, the
    // tools' letters and everything else still reach the board while the
    // minimap has the focus.
    root.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        shortcutLetter(e) === "m"
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) hide(true);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (gesture) cancel();
        else hide(true);
        return;
      }
      if (e.target !== canvas || e.altKey) return;
      const { view } = api.state(),
        s = size();
      const step = e.shiftKey ? 160 : 40;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (gesture) return;
        api.prepare();
        navigate({
          ...view,
          x:
            view.x +
            (e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0),
          y:
            view.y +
            (e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0),
        });
      } else if (["+", "=", "-", "_", "0", "Home", "Enter"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (gesture) return;
        api.prepare();
        if (e.key === "Home" || e.key === "Enter") api.fit();
        else
          navigate(
            zoomAt(
              view,
              { x: s.width / 2, y: s.height / 2 },
              e.key === "0"
                ? 1
                : view.z * (["+", "="].includes(e.key) ? 1.2 : 1 / 1.2),
            ),
          );
      }
    });
    root.hidden = !enabled;
    syncTrigger();
  }
  function render(items, transient = false) {
    if (!root?.isConnected) return;
    if (!enabled) return;
    const state = api.state();
    const suspended = state.narrowSearch;
    root.hidden = !enabled || suspended;
    syncTrigger();
    if (root.hidden) return;
    const s = size(),
      r = canvas.getBoundingClientRect(),
      width = r.width || 220,
      height = r.height || 148;
    if (
      gesture &&
      (gesture.board !== state.board ||
        gesture.size.width !== s.width ||
        gesture.size.height !== s.height)
    ) {
      gesture = null;
    }
    if (
      dirty ||
      state.board !== sceneBoard ||
      state.board.items !== sceneItems ||
      transient ||
      previousTransient
    ) {
      scene = minimapScene(items);
      sceneBoard = state.board;
      sceneItems = state.board.items;
      dirty = false;
    }
    previousTransient = transient;
    const visible = visibleWorld(state.view, s);
    const previousBox = layout && mapRect(layout, visible);
    if (gesture) layout = gesture.layout;
    else if (
      !layout ||
      scene !== paintedScene ||
      width !== layout.width ||
      height !== layout.height ||
      previousBox.x < 4 ||
      previousBox.y < 4 ||
      previousBox.x + previousBox.w > width - 4 ||
      previousBox.y + previousBox.h > height - 4
    )
      layout = minimapLayout(scene.box, visible, width, height);
    const theme = document.documentElement.dataset.theme;
    if (!colors || colorTheme !== theme) {
      const css = getComputedStyle(document.documentElement),
        color = (name, fallback) =>
          css.getPropertyValue(name).trim() || fallback;
      colors = {
        background: color("--surface", "#ffffff"),
        object: color("--soft", "#dce5f7"),
        media: color("--minimap-media", "#8caed9"),
        outline: color("--muted", "#626f80"),
        viewport: color("--accent", "#0869d6"),
        viewportFill: color("--minimap-viewport", "#0869d61a"),
      };
      colorTheme = theme;
      paintedLayout = null;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2),
      pw = Math.ceil(width * dpr),
      ph = Math.ceil(height * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      backdrop.width = pw;
      backdrop.height = ph;
      paintedLayout = null;
    }
    if (scene !== paintedScene || layout !== paintedLayout) {
      const ctx = backdrop.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintMinimapScene(ctx, scene, layout, colors);
      paintedScene = scene;
      paintedLayout = layout;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(backdrop, 0, 0, width, height);
    viewport = paintMinimapViewport(ctx, mapRect(layout, visible), colors);
  }
  return {
    bind,
    render,
    cancel,
    invalidate() {
      dirty = true;
    },
    detach() {
      gesture = null;
      root = null;
      canvas =
        backdrop =
        scene =
        sceneItems =
        sceneBoard =
        layout =
        paintedScene =
        paintedLayout =
          null;
    },
    toggle() {
      if (!api.state().board || !root) return;
      // Closing from the canvas, as with M, leaves the keyboard there.
      if (enabled && root && !root.hidden)
        return hide(root.contains(document.activeElement));
      api.prepare(true);
      enabled = true;
      try {
        localStorage.setItem("whiteboard-minimap", "true");
      } catch {}
      api.draw();
      canvas?.focus({ preventScroll: true });
    },
  };
}
