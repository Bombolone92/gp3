import { cropOf, aspectCrop, sameCrop, validCrop } from "./image-crop.js";
import { fileObjects } from "./transfer.js";

export function replacementContent(target, source, width, height) {
  if (target?.type !== "image" || source?.type !== "image")
    throw Error("Select one image.");
  if (
    ![width, height].every((n) => Number.isFinite(n) && n > 0) ||
    width * height > 40_000_000
  )
    throw Error("Choose an image with fewer than 40 million pixels.");
  // Reuse the visible area of a board source, then center-crop to fill the
  // destination. Its geometry, identity, label and relationships stay intact.
  const ratio = Math.abs(target.w / target.h) / (width / height);
  if (!Number.isFinite(ratio) || ratio <= 0)
    throw Error("This image has no editable area.");
  const crop = aspectCrop(cropOf(source), ratio);
  delete crop.mask;
  if (target.crop?.mask) crop.mask = target.crop.mask;
  crop.sourceAspect = width / height;
  if (!validCrop(crop))
    throw Error("Image proportions are too extreme to replace.");
  if (source.src === target.src && sameCrop(cropOf(target), crop)) return null;
  return { src: source.src, crop };
}

export const replacementSignature = (i) =>
  JSON.stringify([
    i.type,
    i.x,
    i.y,
    i.w,
    i.h,
    i.rotation,
    i.crop,
    i.groupId,
    i.parentId,
  ]);

// Fetch in the browser with CORS and without credentials; never proxy a URL
// through the collaboration server. Bound the stream before decoding it.
export async function imageFromURL(
  value,
  { signal, fetchImage = fetch, load = fileObjects } = {},
) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error("Enter an HTTP or HTTPS image URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("Enter an HTTP or HTTPS image URL.");
  let response;
  try {
    response = await fetchImage(url.href, {
      signal,
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw Error(
      "This image could not be loaded. Download it and choose Upload from device.",
    );
  }
  if (!response.ok)
    throw Error(
      "This image could not be loaded. Download it and choose Upload from device.",
    );
  const limit = 5 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw Error("Choose an image smaller than 5 MB.");
  }
  const parts = [];
  let size = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw Error("Choose an image smaller than 5 MB.");
        }
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    const blob = await response.blob();
    if (blob.size > limit) throw Error("Choose an image smaller than 5 MB.");
    parts.push(blob);
  }
  const type =
    response.headers.get("content-type")?.split(";")[0] ||
    "application/octet-stream";
  // A recognized extension only admits the file to the existing decoder;
  // fileObjects still verifies actual bytes and decoded pixel dimensions.
  const file = new File(parts, "replacement.png", { type });
  return (await load([file], { x: 0, y: 0 }, { imagesOnly: true }))[0];
}
