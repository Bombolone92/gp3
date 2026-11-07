import {
  cropOf,
  FULL_CROP,
  imageLayout,
  cropBox,
  cropResult,
  aspectCrop,
  dragCrop,
} from "./image-crop.js";
import { imageFor } from "./render.js";
import { createSnapIndex, snapMove, snapPoint } from "./snapping.js";
import { t } from "./i18n.js";
import { escape } from "./model.js";
import { languageAttribute } from "./accessibility/object-content.js";
import { rotationOf, centerOf, rotatePoint, objectBounds } from "./geometry.js";

const handles = {
  nw: "Crop top left",
  n: "Crop top",
  ne: "Crop top right",
  e: "Crop right",
  se: "Crop bottom right",
  s: "Crop bottom",
  sw: "Crop bottom left",
  w: "Crop left",
};
const signature = (i) =>
  JSON.stringify([i.type, i.x, i.y, i.w, i.h, i.crop, i.groupId, i.rotation]);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function createImageCropUI(api) {
  let active = null,
    generation = 0;
  function close(focus = true) {
    generation++;
    const s = active;
    if (!s) return;
    active = null;
    s.dialog.close();
    s.dialog.remove();
    api.draw();
    if (focus && !document.querySelector("dialog[open]"))
      api.canvas()?.focus({ preventScroll: true });
  }
  function valid(s) {
    const state = api.state();
    const i = state.board?.items.find((i) => i.id === s.id);
    return (
      state.board === s.board &&
      state.selection.has(s.id) &&
      i &&
      i.src === s.src &&
      signature(i) === s.signature &&
      api.canEdit(s.id)
    );
  }
  function apply() {
    const s = active;
    if (!s) return;
    if (!valid(s)) return close();
    try {
      const i = s.board.items.find((i) => i.id === s.id);
      const next = cropResult(i, s.full, s.crop);
      close();
      if (next) api.commit(s.id, next);
    } catch (e) {
      s.status.textContent = t(e.message);
    }
  }
  function fields(s) {
    for (const [key, size] of [
      ["x", s.width],
      ["y", s.height],
      ["w", s.width],
      ["h", s.height],
    ]) {
      const input = s.dialog.querySelector(`[name="${key}"]`);
      if (document.activeElement !== input)
        input.value = String(Math.round(s.crop[key] * size * 1000) / 1000);
    }
    // The size is announced, so it is written only when it changes, not on
    // every repaint while the dialog is open.
    const status = `${Math.round(s.crop.w * s.width)} × ${Math.round(s.crop.h * s.height)} ${t("pixels")}`;
    if (s.status.textContent !== status) s.status.textContent = status;
  }
  function render() {
    const s = active;
    if (!s) return;
    if (!valid(s)) {
      close(false);
      api.toast(
        "Cropping closed because the image changed or is no longer editable.",
      );
      return;
    }
    const canvas = api.canvas(),
      r = canvas.getBoundingClientRect(),
      { view } = api.state();
    Object.assign(s.dialog.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    const b = cropBox(s.full, s.crop),
      fw = s.full.w * view.z,
      fh = s.full.h * view.z;
    Object.assign(s.original.style, {
      left: `${s.full.x * view.z + view.x}px`,
      top: `${s.full.y * view.z + view.y}px`,
      width: `${fw}px`,
      height: `${fh}px`,
    });
    Object.assign(s.box.style, {
      left: `${b.x * view.z + view.x}px`,
      top: `${b.y * view.z + view.y}px`,
      width: `${b.w * view.z}px`,
      height: `${b.h * view.z}px`,
    });
    for (const [element, box] of [
      [s.original, s.full],
      [s.box, b],
    ]) {
      element.style.transformOrigin = `${(s.center.x - box.x) * view.z}px ${(s.center.y - box.y) * view.z}px`;
      element.style.transform = `rotate(${s.rotation}deg)`;
    }
    Object.assign(s.preview.style, {
      width: `${fw}px`,
      height: `${fh}px`,
      left: `${-s.crop.x * fw}px`,
      top: `${-s.crop.y * fh}px`,
    });
    s.box.classList.toggle("crop-ellipse", s.crop.mask === "ellipse");
    fields(s);
  }
  function adjust(s, handle, dx, dy, start = s.crop, event) {
    const ratio = s.ratio || (event?.shiftKey ? start.w / start.h : 0);
    const minW = Math.min(1, Math.max(1 / s.width, 0.001 / s.full.w));
    const minH = Math.min(1, Math.max(1 / s.height, 0.001 / s.full.h));
    let crop = dragCrop(start, handle, dx, dy, ratio, minW, minH);
    s.guides = [];
    const state = api.state();
    if (
      event &&
      state.snapping &&
      !s.rotation &&
      !event.altKey &&
      s.gesture?.index
    ) {
      // A zero-area box snaps the dragged edge/corner without imposing a
      // minimum object size. Re-clamping keeps every boundary in the source.
      const b = cropBox(s.full, crop);
      const point =
        handle === "move"
          ? b
          : {
              x: handle.includes("w") ? b.x : b.x + b.w,
              y: handle.includes("n") ? b.y : b.y + b.h,
              w: 0,
              h: 0,
            };
      const snap =
        handle === "move"
          ? snapMove(s.gesture.index, point, 0, 0, state.view.z)
          : snapPoint(s.gesture.index, point, state.view.z);
      const sx =
        handle === "move" || /[we]/.test(handle) ? snap.dx / s.full.w : 0;
      const sy =
        handle === "move" || /[ns]/.test(handle) ? snap.dy / s.full.h : 0;
      crop = dragCrop(start, handle, dx + sx, dy + sy, ratio, minW, minH);
      const final = cropBox(s.full, crop);
      s.guides = snap.guides.filter((g) => {
        if (g.kind) return false;
        const axis = g.axis;
        if (handle !== "move" && !(axis === "x" ? /[we]/ : /[ns]/).test(handle))
          return false;
        const start = final[axis],
          size = final[axis === "x" ? "w" : "h"];
        const edges =
          handle === "move"
            ? [start, start + size / 2, start + size]
            : [
                start +
                  ((axis === "x" ? handle.includes("w") : handle.includes("n"))
                    ? 0
                    : size),
              ];
        return edges.some((edge) => Math.abs(edge - g.position) < 1e-8);
      });
    }
    s.crop = crop;
    api.draw();
  }
  async function open(i) {
    close(false);
    if (!i || i.type !== "image" || !api.canEdit(i.id)) return;
    const token = generation,
      state = api.state();
    const pending = {
      id: i.id,
      src: i.src,
      board: state.board,
      signature: signature(i),
    };
    try {
      const image = await imageFor(i.src).ready;
      if (
        token !== generation ||
        !valid(pending) ||
        document.querySelector("dialog[open]")
      )
        return;
      const full = imageLayout(i, image.naturalWidth, image.naturalHeight).full;
      if (
        !Object.values(full).every(Number.isFinite) ||
        full.w <= 0 ||
        full.h <= 0
      )
        throw Error("This image has no editable area.");
      const d = document.createElement("dialog");
      d.className = "image-crop-dialog";
      d.setAttribute("aria-label", t("Crop image"));
      d.setAttribute("aria-describedby", "image-crop-hint");
      d.innerHTML = `<div class="crop-stage"><img class="crop-original" alt="${escape(i.alt || "")}"${i.alt ? languageAttribute(i.lang) : ""} draggable="false"><div class="crop-box"><div class="crop-window"><img alt="" draggable="false"></div><button type="button" class="crop-move" data-crop-handle="move" aria-label="${t("Move crop area")}" aria-describedby="image-crop-hint"></button>${Object.entries(
        handles,
      )
        .map(
          ([key, label]) =>
            `<button type="button" class="crop-handle crop-${key}" data-crop-handle="${key}" aria-label="${t(label)}" aria-describedby="image-crop-hint"></button>`,
        )
        .join("")}</div></div>
      <form class="crop-panel panel"><div class="crop-heading"><strong>${t("Crop image")}</strong><button type="button" class="secondary" id="crop-reset">${t("Reset original")}</button></div>
      <div class="crop-settings"><label>${t("Aspect ratio")}<select id="crop-ratio"><option value="0">${t("Freeform")}</option><option value="original">${t("Original")}</option><option value="1">1:1</option><option value="1.3333333333333333">4:3</option><option value="1.7777777777777777">16:9</option></select></label><label>${t("Shape")}<select id="crop-mask"><option value="">${t("Rectangle")}</option><option value="ellipse">${t("Oval")}</option></select></label></div>
      <details><summary>${t("Exact crop (pixels)")}</summary><div class="crop-dimensions">${[
        ["x", "Left"],
        ["y", "Top"],
        ["w", "Width"],
        ["h", "Height"],
      ]
        .map(
          ([key, label]) =>
            `<label>${t(label)}<input name="${key}" aria-label="${t(label)}" type="number" step="any" min="${key === "w" || key === "h" ? 0.001 : 0}" required></label>`,
        )
        .join("")}</div></details>
      <p id="image-crop-hint">${t("Drag the area or its handles. Arrow keys adjust by a pixel; Shift adjusts by ten. Alt/Option bypasses snapping.")}</p><p id="crop-status" role="status" aria-live="polite"></p><div class="crop-actions"><button type="button" class="secondary" id="crop-cancel">${t("Cancel")}</button><button type="submit" class="primary">${t("Apply crop")}</button></div></form>`;
      const fullCenter = rotatePoint(
        centerOf(full),
        centerOf(i),
        rotationOf(i),
      );
      const s = (active = {
        ...pending,
        dialog: d,
        crop: { ...cropOf(i) },
        full,
        center: centerOf(i),
        rotation: rotationOf(i),
        focusBox: objectBounds(
          {
            ...full,
            x: fullCenter.x - full.w / 2,
            y: fullCenter.y - full.h / 2,
          },
          rotationOf(i),
        ),
        width: image.naturalWidth,
        height: image.naturalHeight,
        ratio: 0,
        original: d.querySelector(".crop-original"),
        box: d.querySelector(".crop-box"),
        preview: d.querySelector(".crop-window img"),
        status: d.querySelector("#crop-status"),
      });
      s.original.src = s.preview.src = i.src;
      document.body.append(d);
      d.querySelector("#crop-mask").value = s.crop.mask || "";
      d.querySelector("#crop-mask").onchange = (e) => {
        if (e.target.value) s.crop.mask = e.target.value;
        else delete s.crop.mask;
        render();
      };
      d.querySelector("#crop-ratio").onchange = (e) => {
        s.ratio =
          e.target.value === "original"
            ? 1
            : (+e.target.value * s.height) / s.width;
        s.crop = aspectCrop(s.crop, s.ratio);
        render();
      };
      d.querySelector("#crop-reset").onclick = () => {
        s.crop = { ...FULL_CROP };
        s.ratio = 0;
        d.querySelector("#crop-mask").value = "";
        d.querySelector("#crop-ratio").value = "0";
        api.focus(s.focusBox);
        render();
      };
      d.querySelector("#crop-cancel").onclick = () => close();
      d.querySelector("form").onsubmit = (e) => {
        e.preventDefault();
        apply();
      };
      for (const input of d.querySelectorAll("input"))
        input.onchange = () => {
          if (!Number.isFinite(input.valueAsNumber)) return;
          const key = input.name,
            size = key === "x" || key === "w" ? s.width : s.height;
          if (key === "x" || key === "y") {
            const c = {
              ...s.crop,
              [key]: clamp(
                input.valueAsNumber / size,
                0,
                1 - s.crop[key === "x" ? "w" : "h"],
              ),
            };
            s.crop = c;
          } else {
            adjust(
              s,
              key === "w" ? "e" : "s",
              key === "w" ? input.valueAsNumber / size - s.crop.w : 0,
              key === "h" ? input.valueAsNumber / size - s.crop.h : 0,
            );
          }
          input.value = String(Math.round(s.crop[key] * size * 1000) / 1000);
          render();
        };
      d.addEventListener("cancel", (e) => {
        e.preventDefault();
        close();
      });
      d.addEventListener("close", () => {
        if (active === s) close();
      });
      d.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Escape") {
          e.preventDefault();
          close();
          return;
        }
        const handle = e.target.dataset.cropHandle;
        if (handle && e.key === "Enter") {
          e.preventDefault();
          apply();
          return;
        }
        if (
          handle &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
        ) {
          e.preventDefault();
          const n = e.shiftKey ? 10 : 1;
          adjust(
            s,
            handle,
            (e.key === "ArrowRight" ? n : e.key === "ArrowLeft" ? -n : 0) /
              s.width,
            (e.key === "ArrowDown" ? n : e.key === "ArrowUp" ? -n : 0) /
              s.height,
          );
        } else if (
          e.key === "Enter" &&
          !e.target.closest("input,select,button,summary")
        ) {
          e.preventDefault();
          apply();
        }
      });
      const stage = d.querySelector(".crop-stage");
      const ownsPointer = (e) => {
        const press = s.gesture || s.outside;
        return press && press.pointer === e.pointerId;
      };
      stage.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || s.gesture || s.outside) return;
        const handle = e.target.dataset.cropHandle;
        if (!handle) {
          s.outside = { x: e.clientX, y: e.clientY, pointer: e.pointerId };
          // Retain the release even if this press moves beyond the stage.
          try {
            stage.setPointerCapture?.(e.pointerId);
          } catch {}
          return;
        }
        e.preventDefault();
        e.target.focus({ preventScroll: true });
        const state = api.state();
        s.gesture = {
          pointer: e.pointerId,
          handle,
          x: e.clientX,
          y: e.clientY,
          crop: { ...s.crop },
          zoom: state.view.z,
          // Guides come from what is drawn, as on the canvas: objects hidden
          // from this person give their positions away otherwise.
          index: createSnapIndex(
            api.visibleItems?.() ?? s.board.items,
            new Set([s.id]),
          ),
        };
        e.target.setPointerCapture?.(e.pointerId);
      });
      const movePointer = (e) => {
        const g = s.gesture;
        const delta =
          g &&
          rotatePoint(
            { x: e.clientX - g.x, y: e.clientY - g.y },
            { x: 0, y: 0 },
            -s.rotation,
          );
        if (g && g.pointer === e.pointerId)
          adjust(
            s,
            g.handle,
            delta.x / (s.full.w * g.zoom),
            delta.y / (s.full.h * g.zoom),
            g.crop,
            e,
          );
      };
      stage.addEventListener("pointermove", movePointer);
      stage.addEventListener("pointerup", (e) => {
        if (!ownsPointer(e)) return;
        if (s.gesture && s.gesture.pointer === e.pointerId) {
          movePointer(e);
          s.gesture = null;
          s.guides = [];
          api.draw();
        } else if (
          s.outside &&
          s.outside.pointer === e.pointerId &&
          Math.hypot(e.clientX - s.outside.x, e.clientY - s.outside.y) < 4
        )
          apply();
        s.outside = null;
      });
      const cancelGesture = (e) => {
        if (!ownsPointer(e)) return;
        if (s.gesture) s.crop = s.gesture.crop;
        s.gesture = null;
        s.guides = [];
        s.outside = null;
        api.draw();
      };
      stage.addEventListener("pointercancel", cancelGesture);
      stage.addEventListener("lostpointercapture", cancelGesture);
      stage.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          if (!s.gesture) api.wheel(e);
        },
        { passive: false },
      );
      d.showModal();
      api.focus(s.focusBox);
      render();
      d.querySelector(".crop-move").focus({ preventScroll: true });
    } catch (e) {
      if (token === generation) api.toast(e.message);
    }
  }
  return {
    open,
    close,
    render,
    id: () => active?.id,
    guides: () => active?.guides,
  };
}
