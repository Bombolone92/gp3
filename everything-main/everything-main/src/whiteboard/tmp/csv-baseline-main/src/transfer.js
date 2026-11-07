import { referencedTags, importTags } from "./tags.js";
import { trimMindMap } from "./mind-map.js";
import { assertUnlocked } from "./locking.js";
import {
  clone,
  item,
  bounds,
  validateBoard,
  escape,
  assertImagePixels,
} from "./model.js";
import {
  descendants,
  completeGroups,
  duplicateItems,
  safeURL,
  removeItems,
  inferParents,
} from "./scene.js";
import { autoHeightLayout } from "./text.js";
import { cellsText, readTableContent } from "./bulk-content.js";
import { listPlainText } from "./text-blocks.js";
import { externalizeObjectLinks } from "./object-link-data.js";
import { unlinkCopiedJira } from "./planning/task.js";

export const CLIPBOARD_TYPE = "application/x-whiteboard+json";
const MAX_TRANSFER = 100 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const editable = (target) =>
  target?.closest?.("input,textarea,select,[contenteditable]");

export function selectionFragment(items, selection, address, options) {
  const ids = descendants(items, selection, options);
  // Keep connections between copied nodes even when only the nodes were selected.
  for (const i of items)
    if (i.startId && ids.has(i.startId) && ids.has(i.endId)) ids.add(i.id);
  const chosen = clone(items.filter((i) => ids.has(i.id))),
    wholeGroups = completeGroups(items, ids);
  for (const i of chosen) {
    trimMindMap(i, ids);
    if (i.groupId && !wholeGroups.has(i.groupId)) delete i.groupId;
    if (!ids.has(i.parentId)) delete i.parentId;
    if (!ids.has(i.startId)) delete i.startId;
    if (!ids.has(i.endId)) delete i.endId;
  }
  return externalizeObjectLinks(chosen, address);
}

export function clipboardFormats(items, catalog = []) {
  const tags = referencedTags(items, catalog);
  const json = JSON.stringify({
    format: "whiteboard/clipboard",
    version: 1,
    items,
    ...(tags.length ? { tags } : {}),
  });
  if (json.length > MAX_TRANSFER)
    throw Error(
      "This selection is too large to copy. Export a board file instead.",
    );
  const text = items
    .map((i) =>
      i.type === "table"
        ? cellsText(i.cells)
        : i.textBlocks?.length
          ? listPlainText(i.text || "", i.textBlocks)
          : i.text || i.url || i.fileName || "",
    )
    .filter(Boolean)
    .join("\n");
  return {
    [CLIPBOARD_TYPE]: json,
    "text/html": `<div data-whiteboard-fragment="${encodeURIComponent(json)}">${escape(text).replaceAll("\n", "<br>")}</div>`,
    "text/plain": text,
  };
}

export function readFragment(data) {
  let json = data.getData(CLIPBOARD_TYPE);
  if (!json) {
    const html = data.getData("text/html");
    if (html.length > MAX_TRANSFER * 3)
      throw Error("This selection is too large to paste.");
    const match = html.match(/data-whiteboard-fragment="([^"]+)"/);
    if (match) {
      try {
        json = decodeURIComponent(match[1]);
      } catch {
        throw Error("This clipboard content is not supported.");
      }
    }
  }
  if (!json) return null;
  if (json.length > MAX_TRANSFER)
    throw Error("This selection is too large to paste.");
  let fragment;
  try {
    fragment = JSON.parse(json);
  } catch {
    throw Error("This clipboard content is not supported.");
  }
  if (
    !fragment ||
    fragment.format !== "whiteboard/clipboard" ||
    fragment.version !== 1
  )
    throw Error("This clipboard content is not supported.");
  validateBoard({
    version: 1,
    title: "Clipboard",
    items: fragment.items,
    tags: fragment.tags,
  });
  // Fragments can come from any web page; apply the upload pixel limit.
  assertImagePixels(fragment.items);
  Object.defineProperty(fragment.items, "tags", { value: fragment.tags || [] });
  return fragment.items;
}

export function placeFragment(items, point, tags = items.tags) {
  const source = clone(items),
    count = source.length;
  if (!count) return [];
  duplicateItems(source, new Set(source.map((i) => i.id)), 0);
  const copies = source.slice(count),
    box = bounds(copies);
  for (const i of copies) {
    i.x += point.x - box.x;
    i.y += point.y - box.y;
  }
  validateBoard({ version: 1, title: "Clipboard", items: copies, tags });
  return copies;
}

export function textObject(text, point, ctx) {
  text = text.replace(/\r\n?/g, "\n");
  if (!text.trim()) return null;
  if (text.length > 20000)
    throw Error("Paste up to 20,000 characters at a time.");
  const url = safeURL(text.trim());
  if (url && !/\s/.test(text.trim()))
    return item("link", point.x, point.y, {
      w: 320,
      h: 115,
      url,
      text: new URL(url).hostname,
      color: "#dce5f7",
    });
  const object = item("text", point.x, point.y, {
    w: 420,
    text,
    fontSize: 22,
    autoHeight: true,
  });
  object.h = autoHeightLayout(object, ctx).height;
  return object;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error("Could not read this file."));
    reader.readAsDataURL(file);
  });
}
export async function decodeImage(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}
function imageType(base64) {
  const bytes = atob(base64.slice(0, 24));
  if (bytes.startsWith("\x89PNG\r\n\x1a\n")) return "image/png";
  if (bytes.startsWith("\xff\xd8\xff")) return "image/jpeg";
  if (bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP")
    return "image/webp";
  return null;
}

export async function fileObjects(
  files,
  point,
  { imagesOnly = false, read = readFile, decode = decodeImage } = {},
) {
  if (!files.length) return [];
  if (
    files.length > 20 ||
    files.reduce((sum, f) => sum + f.size, 0) > 50 * 1024 * 1024
  )
    throw Error("Add up to 20 files and 50 MB at a time.");
  // Validate the whole batch before reading; one failed file leaves the board unchanged.
  for (const file of files) {
    const image =
      IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
    if (imagesOnly && !image) throw Error("Choose a PNG, JPEG, or WebP image.");
    if (file.size > (image ? 5 : 10) * 1024 * 1024)
      throw Error(
        image
          ? "Choose an image smaller than 5 MB."
          : "Choose a file smaller than 10 MB.",
      );
  }
  const objects = [];
  let x = point.x,
    y = point.y,
    rowHeight = 0;
  for (const [index, file] of files.entries()) {
    const raw = await read(file),
      base64 = raw.slice(raw.indexOf(",") + 1);
    const mime = imageType(base64);
    const wantsImage =
      IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
    let object;
    if (wantsImage && !mime) throw Error("Could not decode an image.");
    if (mime) {
      if (file.size > 5 * 1024 * 1024)
        throw Error("Choose an image smaller than 5 MB.");
      const src = `data:${mime};base64,${base64}`;
      const { width, height } = await decode(src);
      if (!width || !height || width * height > 40_000_000)
        throw Error("Choose an image with fewer than 40 million pixels.");
      const scale = Math.min(1, 500 / Math.max(width, height));
      object = item("image", 0, 0, {
        src,
        w: width * scale,
        h: height * scale,
      });
    } else {
      object = item("file", 0, 0, {
        w: 280,
        h: 110,
        text: file.name.slice(0, 255),
        fileName: file.name.slice(0, 255),
        data: `data:application/octet-stream;base64,${base64}`,
        color: "#eadcf0",
      });
    }
    if (index && index % 3 === 0) {
      x = point.x;
      y += rowHeight + 24;
      rowHeight = 0;
    }
    object.x = x;
    object.y = y;
    x += object.w + 24;
    rowHeight = Math.max(rowHeight, object.h);
    objects.push(object);
  }
  validateBoard({ version: 1, title: "Files", items: objects });
  return objects;
}

function transferFiles(data) {
  const files = Array.from(data.files || []);
  return files.length
    ? files
    : Array.from(data.items || [])
        .filter((i) => i.kind === "file")
        .map((i) => i.getAsFile())
        .filter(Boolean);
}

export function createTransfer(api) {
  let fileQueue = Promise.resolve();
  let lastPaste = null;
  const eligible = (event) =>
    api.board() &&
    !document.querySelector("dialog[open]") &&
    !editable(event.target);
  function insert(items, target, incomingTags = []) {
    if (!items.length || api.board() !== target) return;
    if (api.canAdd && !api.canAdd()) return;
    if (target.items.length + items.length > 5000)
      throw Error("A board can contain up to 5,000 objects.");
    const tags = importTags(target, items, incomingTags);
    api.placeItems?.(items);
    api.finishEditing();
    api.mutate(() => {
      if (tags.length || target.tags) target.tags = tags;
      target.items.push(...items);
      inferParents(
        target.items,
        new Set(items.filter((i) => !i.parentId).map((i) => i.id)),
        { skip: api.concealed?.() },
      );
      api.select(new Set(items.map((i) => i.id)));
    });
    document.querySelector("#canvas")?.focus({ preventScroll: true });
    // A save the board refused, as on a board the facilitator locked, put
    // it back as it was; the caller reports nothing added.
    return items.every((i) => api.board()?.items.includes(i));
  }
  // Where pasted content goes: centred in the view when it can be, as a
  // large paste placed by its corner would reach past the screen. `offset`
  // keeps repeated pastes from landing exactly on each other.
  function pasteAt(box, point, pasted) {
    if (!pasted || !api.pastePoint) return point;
    const at = api.pastePoint(box);
    return { x: at.x + pasted.offset, y: at.y + pasted.offset };
  }
  function addFiles(files, point, options, pasted) {
    const target = api.board(),
      canvas = document.querySelector("#canvas");
    if (!target) return Promise.resolve();
    // Serialize decoding to bound memory and keep batches in the user's order.
    fileQueue = fileQueue
      .catch(() => {})
      .then(async () => {
        if (api.board() !== target || !canvas.isConnected) return;
        if (target.items.length + files.length > 5000)
          throw Error("A board can contain up to 5,000 objects.");
        api.toast("Adding files…");
        const objects = await fileObjects(files, point, options);
        if (pasted && objects.length) {
          const box = bounds(objects),
            at = pasteAt(box, point, pasted);
          for (const i of objects) {
            i.x += at.x - box.x;
            i.y += at.y - box.y;
          }
        }
        if (
          api.board() === target &&
          canvas.isConnected &&
          insert(objects, target)
        )
          api.toast("Files added.");
      })
      .catch((error) =>
        api.toast(error.message || "Could not add these files."),
      );
    return fileQueue;
  }
  function copy(event) {
    if (!eligible(event) || !api.selection().size || !event.clipboardData)
      return;
    try {
      if (event.type === "cut") {
        if (api.canCut) {
          if (!api.canCut(api.selection())) return event.preventDefault();
        } else
          assertUnlocked(api.board().items, api.selection(), {
            deleting: true,
          });
      }
      // Hidden objects never reach the clipboard, including the hidden
      // contents of a visible frame or group.
      const hidden = api.concealed?.() || new Set();
      const ids = hidden.size
        ? new Set([...api.selection()].filter((id) => !hidden.has(id)))
        : api.selection();
      if (!ids.size) throw Error("Hidden objects cannot be copied.");
      const fragment = selectionFragment(
        hidden.size
          ? api.board().items.filter((i) => !hidden.has(i.id))
          : api.board().items,
        ids,
        api.objectURL,
        api.selectionOptions?.(),
      );
      const formats = clipboardFormats(fragment, api.board().tags);
      let structured = false;
      for (const type of [CLIPBOARD_TYPE, "text/html"]) {
        try {
          event.clipboardData.setData(type, formats[type]);
          structured = true;
        } catch {}
      }
      if (!structured)
        throw Error("Could not copy these objects. Your board is unchanged.");
      event.clipboardData.setData("text/plain", formats["text/plain"]);
      event.preventDefault();
      if (event.type === "cut")
        api.mutate(() => {
          api.board().items = removeItems(
            api.board().items,
            api.selection(),
            api.selectionOptions?.(),
          );
          api.select(new Set());
        });
    } catch (error) {
      event.preventDefault();
      api.toast(error.message);
    }
  }
  function receive(data, point, target, pasted) {
    const fragment = readFragment(data);
    if (fragment) {
      insert(
        unlinkCopiedJira(
          placeFragment(fragment, pasteAt(bounds(fragment), point, pasted)),
          target?.items,
        ),
        target,
        fragment.tags,
      );
      return;
    }
    const content = readTableContent(data),
      cells = content?.cells;
    if (cells) {
      api.pasteCells(cells, point, target, content.cellLanguages);
      return;
    }
    const dropped = transferFiles(data);
    // Documents such as PDFs can be imported instead of attached.
    const files =
      dropped.length && api.receiveFiles
        ? api.receiveFiles(dropped, point)
        : dropped;
    if (files.length) {
      addFiles(files, point, undefined, pasted);
      return;
    }
    if (dropped.length) return;
    const text =
      data.getData("text/plain") ||
      data
        .getData("text/uri-list")
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#"))
        .join("\n");
    // Links to embeddable services offer an embed or a link card.
    if (text && api.receiveText?.(text, point, target)) return;
    if (text) {
      const object = textObject(
        text,
        point,
        document.createElement("canvas").getContext("2d"),
      );
      if (object) insert([object], target);
    }
  }
  document.addEventListener("copy", copy);
  document.addEventListener("cut", copy);
  document.addEventListener("paste", (event) => {
    if (!eligible(event) || !event.clipboardData) return;
    event.preventDefault();
    try {
      const point = api.center(),
        target = api.board();
      // Repeated pastes stay visible rather than hiding under the previous copy.
      const signature = `${target.id}:${point.x}:${point.y}`;
      const offset =
        lastPaste?.signature === signature ? lastPaste.offset + 24 : 0;
      lastPaste = { signature, offset: offset % 192 };
      receive(
        event.clipboardData,
        { x: point.x + lastPaste.offset, y: point.y + lastPaste.offset },
        target,
        { offset: lastPaste.offset },
      );
    } catch (error) {
      api.toast(error.message || "Could not paste this content.");
    }
  });
  document.addEventListener("drop", (event) => {
    if (
      api.board() &&
      !event.defaultPrevented &&
      Array.from(event.dataTransfer?.types || []).includes("Files")
    )
      event.preventDefault();
  });
  return {
    addFiles,
    insert,
    bindCanvas(wrap) {
      let depth = 0;
      const clear = () => {
        depth = 0;
        wrap.classList.remove("drop-target");
      };
      const accepts = (event) =>
        !document.querySelector("dialog[open]") &&
        Array.from(event.dataTransfer?.types || []).some((type) =>
          ["Files", "text/plain", "text/uri-list", CLIPBOARD_TYPE].includes(
            type,
          ),
        );
      // Someone who cannot add content, such as a viewer, sees no drop
      // target; the drop is refused rather than opening the file instead.
      // Text fields they can still type in take text as usual.
      const refused = (event) =>
        !(api.canDrop?.() ?? true) && !editable(event.target);
      wrap.addEventListener("dragenter", (event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        if (refused(event)) return;
        depth++;
        wrap.classList.add("drop-target");
      });
      wrap.addEventListener("dragover", (event) => {
        if (!accepts(event)) return;
        if (!(api.canDrop?.() ?? true) && editable(event.target)) return;
        event.preventDefault();
        if (refused(event)) {
          event.dataTransfer.dropEffect = "none";
          clear();
        } else event.dataTransfer.dropEffect = "copy";
      });
      wrap.addEventListener("dragleave", () => {
        if (--depth <= 0) clear();
      });
      wrap.addEventListener("dragend", clear);
      wrap.addEventListener("drop", (event) => {
        clear();
        if (!accepts(event)) return;
        if (editable(event.target) && !transferFiles(event.dataTransfer).length)
          return;
        event.preventDefault();
        try {
          receive(event.dataTransfer, api.point(event), api.board());
        } catch (error) {
          api.toast(error.message || "Could not paste this content.");
        }
      });
    },
  };
}
