import { selectionFragment } from "./transfer.js";
import { rasterRegion } from "./render.js";
import { mindVisibility } from "./mind-visibility.js";
import { t } from "./i18n.js";

const supported = () =>
  typeof navigator.clipboard?.write === "function" &&
  typeof ClipboardItem === "function" &&
  (!ClipboardItem.supports || ClipboardItem.supports("image/png"));
const write = (png) =>
  navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);

function filenameTitle(title) {
  const text = title.replace(/[\\/:*?"<>|]/g, "-");
  let end = Math.min(120, text.length);
  const previous = text.charCodeAt(end - 1),
    next = text.charCodeAt(end);
  if (
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  )
    end--;
  return text.slice(0, end) || "Whiteboard";
}

export function createImageClipboard(api) {
  let pending = false;
  function fallback(blob, title, current) {
    if (!current()) return;
    if (document.querySelector("dialog[open]")) {
      api.toast("Could not copy the image. Use Copy as image to try again.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const message = supported()
      ? "Clipboard access is unavailable. Download the PNG or try copying again."
      : "Your browser cannot copy images here. Download the PNG instead.";
    const dialog = api.modal(
      "Copy as image",
      `<p class="dialog-copy" id="image-copy-status" role="status">${t(message)}</p><div class="image-copy-preview"><img alt="${t("Image of selected objects")}"></div><div class="dialog-footer"><button class="secondary" id="download-selection-image">Download PNG</button>${supported() ? '<button class="primary" id="retry-image-copy">Copy image</button>' : ""}</div>`,
      (d) => {
        d.querySelector("img").src = url;
        d.querySelector("#download-selection-image").onclick = () => {
          const filename = filenameTitle(title);
          api.download(blob, `${filename}-selection.png`, "image/png");
          d.close();
        };
        const retry = d.querySelector("#retry-image-copy");
        if (retry)
          retry.onclick = async () => {
            retry.disabled = true;
            try {
              // The prepared Blob can be written directly in this new user gesture.
              await write(blob);
              if (current())
                api.toast("Image copied. Paste it into another app or board.");
              d.close();
            } catch {
              d.querySelector("#image-copy-status").textContent = t(
                "Clipboard access is unavailable. Download the PNG or try copying again.",
              );
            } finally {
              retry.disabled = false;
            }
          };
      },
    );
    dialog.addEventListener("close", () => URL.revokeObjectURL(url), {
      once: true,
    });
  }
  return {
    async copy() {
      if (pending) return api.toast("An image copy is already in progress.");
      const source = api.board();
      if (!source) return;
      const visual = api.visualBoard?.() || source;
      const scene = mindVisibility(visual.items, visual.comments);
      const items = selectionFragment(
        scene.visible,
        api.selection(),
        undefined,
        api.selectionOptions?.(),
      );
      if (!items.length)
        return api.toast("Select objects to copy as an image.");
      // Freeze the selection now. Later edits must not change the promised PNG.
      const snapshot = {
        title: source.title,
        items,
        tags: source.tags && structuredClone(source.tags),
      };
      const canvas = document.querySelector("#canvas");
      const current = () => api.board() === source && canvas?.isConnected;
      pending = true;
      api.toast("Copying selection as an image…");
      const png = rasterRegion(snapshot, null, {
        maxSize: 4096,
        padding: 20,
        mindCounts: scene.counts,
      }).then(
        (rendered) =>
          new Promise((resolve, reject) => {
            if (!current()) return reject(new Error("cancelled"));
            rendered.toBlob((blob) => {
              if (!current()) reject(new Error("cancelled"));
              else if (blob) resolve(blob);
              else
                reject(
                  new Error("Could not prepare the image. Please try again."),
                );
            }, "image/png");
          }),
      );
      // Attach a rejection handler even if the browser rejects write immediately.
      png.catch(() => {});
      try {
        if (!supported()) throw new Error("Clipboard unavailable");
        // Start write before any await: Safari requires the original user activation.
        // ClipboardItem accepts a promise while fonts and embedded images load.
        await write(png);
        if (current())
          api.toast("Image copied. Paste it into another app or board.");
      } catch {
        try {
          const blob = await png;
          fallback(blob, snapshot.title, current);
        } catch {
          if (current())
            api.toast("Could not prepare the image. Please try again.");
        }
      } finally {
        pending = false;
      }
    },
  };
}
