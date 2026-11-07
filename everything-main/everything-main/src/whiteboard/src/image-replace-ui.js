import { fold } from "./libraries.js";
import { keepPageFocus } from "./paging.js";
import {
  replacementContent,
  replacementSignature,
  imageFromURL,
} from "./image-replace.js";
import { imageFor, drawObject } from "./render.js";
import { fileObjects, IMAGE_ACCEPT } from "./transfer.js";
import { objectBounds } from "./geometry.js";
import { escape } from "./model.js";
import { t } from "./i18n.js";
import { authoredTextHTML } from "./accessibility/object-content.js";

function replacementLabel(text) {
  let end = Math.min(text.length, 100);
  const last = text.charCodeAt(end - 1),
    next = text.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
    end--;
  return text.slice(0, end);
}

export function createImageReplacement(api) {
  let active;
  const valid = (s) => {
    const board = api.board(),
      target = board?.items.find((i) => i.id === s.id);
    return (
      active === s &&
      s.dialog.open &&
      board === s.board &&
      api.selection().size === 1 &&
      api.selection().has(s.id) &&
      target &&
      target.src === s.src &&
      replacementSignature(target) === s.signature &&
      api.canEdit(s.id)
    );
  };
  function close() {
    const s = active;
    if (!s) return;
    active = null;
    s.request++;
    s.abort?.abort();
    clearTimeout(s.timer);
    s.dialog.close();
  }
  function refresh() {
    if (active && !valid(active)) {
      close();
      api.toast(
        "Replacement closed because the image changed or is no longer editable.",
      );
    }
  }
  function open() {
    close();
    const board = api.board(),
      chosen = board?.items.filter((i) => api.selection().has(i.id)) || [];
    if (chosen.length !== 1 || chosen[0].type !== "image")
      return api.toast("Select one image.");
    const target = chosen[0];
    if (!api.canEdit(target.id))
      return api.toast(
        api.readOnly()
          ? "This board is read-only."
          : "Unlock protected objects before changing this selection.",
      );
    const s = {
      board,
      id: target.id,
      src: target.src,
      signature: replacementSignature(target),
      request: 0,
      page: 0,
    };
    const d = api.modal(
      "Replace image",
      `<p class="dialog-copy">Keep the image’s size, position, rotation, mask, links, and comments. The replacement fills its current area; use Crop image to adjust it.</p>
      <div class="replacement-sources"><button type="button" class="secondary" id="replacement-upload">Upload from device</button><button type="button" class="secondary" id="replacement-board">Replace from board</button></div>
      <form id="replacement-url-form"><label for="replacement-url">Image URL</label><div class="replacement-url-row"><input type="url" id="replacement-url" placeholder="https://…" required maxlength="8192"><button class="secondary">Load image</button></div></form>
      <section id="replacement-choices" hidden aria-label="Images on this board"><label for="replacement-search">Find an image</label><input id="replacement-search" type="search" maxlength="200"><div class="replacement-grid"></div><div class="replacement-pages"><button type="button" class="text-btn" id="replacement-prev">Previous images</button><span role="status"></span><button type="button" class="text-btn" id="replacement-next">Next images</button></div></section>
      <div class="replacement-preview" hidden><canvas width="400" height="240" role="img" aria-label="Replacement preview"></canvas></div>
      <p class="dialog-copy" role="status" id="replacement-status">Choose a replacement image.</p><div class="dialog-footer"><button type="button" class="secondary" id="replacement-cancel">Cancel</button><button type="button" class="primary" id="replacement-apply" disabled>Replace image</button></div>`,
      (dialog) => {
        s.dialog = dialog;
        active = s;
        dialog.classList.add("image-replacement-dialog");
        const status = dialog.querySelector("#replacement-status"),
          apply = dialog.querySelector("#replacement-apply");
        dialog.addEventListener("close", () => {
          s.request++;
          s.abort?.abort();
          clearTimeout(s.timer);
          if (active === s) active = null;
        });
        async function choose(load) {
          const request = ++s.request;
          s.abort?.abort();
          clearTimeout(s.timer);
          s.abort = new AbortController();
          s.timer = setTimeout(() => {
            if (request !== s.request || !valid(s)) return;
            s.abort.abort();
            s.request++;
            status.textContent = t(
              "Loading timed out. Try again or upload from device.",
            );
          }, 15000);
          s.next = undefined;
          apply.disabled = true;
          dialog.querySelector(".replacement-preview").hidden = true;
          status.textContent = t("Loading image…");
          try {
            const source = await load(s.abort.signal);
            const image = await imageFor(source.src).ready;
            if (request !== s.request || !valid(s)) return refresh();
            s.next = replacementContent(
              target,
              source,
              image.naturalWidth,
              image.naturalHeight,
            );
            const canvas = dialog.querySelector("canvas"),
              ctx = canvas.getContext("2d");
            const preview = {
                ...target,
                ...s.next,
                x: -Math.abs(target.w) / 2,
                y: -Math.abs(target.h) / 2,
                w: Math.abs(target.w),
                h: Math.abs(target.h),
              },
              box = objectBounds(preview);
            const scale = Math.min(360 / box.w, 200 / box.h);
            ctx.clearRect(0, 0, 400, 240);
            ctx.save();
            ctx.translate(200, 120);
            ctx.scale(scale, scale);
            drawObject(ctx, preview, "#1f2937", () => {});
            ctx.restore();
            dialog.querySelector(".replacement-preview").hidden = false;
            status.textContent = t(
              s.next
                ? "Ready to replace. Undo restores the previous image."
                : "This image is already in place.",
            );
            apply.disabled = !s.next;
          } catch (e) {
            if (request === s.request && valid(s))
              status.textContent = t(
                s.abort.signal.aborted
                  ? "Loading timed out. Try again or upload from device."
                  : e.message || "Could not decode an image.",
              );
          } finally {
            if (request === s.request) clearTimeout(s.timer);
          }
        }
        dialog.querySelector("#replacement-upload").onclick = () =>
          api.fileInput(IMAGE_ACCEPT, (file) => {
            if (valid(s))
              choose(
                async () =>
                  (
                    await fileObjects(
                      [file],
                      { x: 0, y: 0 },
                      { imagesOnly: true },
                    )
                  )[0],
              );
          });
        dialog.querySelector("#replacement-url-form").onsubmit = (e) => {
          e.preventDefault();
          choose((signal) =>
            imageFromURL(dialog.querySelector("#replacement-url").value, {
              signal,
            }),
          );
        };
        function renderChoices() {
          if (!valid(s)) return refresh();
          const query = fold(dialog.querySelector("#replacement-search").value);
          // Images the workshop hides from this person are not offered,
          // as they are not copied either.
          const hidden = api.concealed?.() || new Set();
          const sources = board.items.filter(
            (i) =>
              i.type === "image" &&
              i.id !== s.id &&
              !hidden.has(i.id) &&
              (!query || fold(i.text || "").includes(query)),
          );
          s.page = Math.max(
            0,
            Math.min(s.page, Math.ceil(sources.length / 4) - 1),
          );
          const shown = sources.slice(s.page * 4, s.page * 4 + 4),
            grid = dialog.querySelector(".replacement-grid");
          grid.innerHTML = shown
            .map(
              (i, n) =>
                `<button type="button" class="secondary" data-replacement-source="${escape(i.id)}"><img alt="" loading="lazy" decoding="async">${i.text ? authoredTextHTML(i, replacementLabel(i.text)) : `<span>${t("Image")} ${s.page * 4 + n + 1}</span>`}</button>`,
            )
            .join("");
          for (const [n, button] of [...grid.children].entries()) {
            button.querySelector("img").src = shown[n].src;
            button.onclick = () => {
              const source = board.items.find(
                (i) =>
                  i.id === button.dataset.replacementSource &&
                  i.type === "image" &&
                  !api.concealed?.().has(i.id),
              );
              if (!source) return renderChoices();
              const snapshot = {
                type: "image",
                src: source.src,
                crop: source.crop && { ...source.crop },
              };
              choose(async () => snapshot);
            };
          }
          dialog.querySelector(".replacement-pages span").textContent =
            sources.length
              ? `${s.page + 1} / ${Math.ceil(sources.length / 4)}`
              : t("No other images on this board.");
          dialog.querySelector("#replacement-prev").disabled = s.page === 0;
          dialog.querySelector("#replacement-next").disabled =
            (s.page + 1) * 4 >= sources.length;
        }
        dialog.querySelector("#replacement-board").onclick = () => {
          dialog.querySelector("#replacement-choices").hidden = false;
          renderChoices();
          dialog.querySelector("#replacement-search").focus();
        };
        dialog.querySelector("#replacement-search").oninput = () => {
          s.page = 0;
          renderChoices();
        };
        const previous = dialog.querySelector("#replacement-prev"),
          next = dialog.querySelector("#replacement-next");
        previous.onclick = () => {
          s.page--;
          renderChoices();
          keepPageFocus(previous, next);
        };
        next.onclick = () => {
          s.page++;
          renderChoices();
          keepPageFocus(next, previous);
        };
        dialog.querySelector("#replacement-cancel").onclick = close;
        apply.onclick = () => {
          if (!valid(s)) return refresh();
          if (!s.next) return;
          const next = s.next;
          close();
          api.commit(s.id, next);
          api.toast("Image replaced. Undo restores it.");
        };
      },
    );
    return d;
  }
  return { open, close, refresh };
}
