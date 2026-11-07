import { readFileSync } from "node:fs";
import {
  readEotFont,
  readOpenTypeFont,
  writeEotFont,
} from "../lib/pptx/src/internal/fonts/index.ts";
import { P } from "../src/model.js";

export const mtxFont = (name, extension = "mtx") =>
  new Uint8Array(
    readFileSync(
      new URL(`./data/font-formats/${name}.${extension}`, import.meta.url),
    ),
  );

/** Synthetic native container; compression and masking are independent flags. */
export function mtxEot(name) {
  const original = writeEotFont(mtxFont(name, "ttf"), {
      embeddingAuthorized: true,
    }),
    info = readEotFont(original),
    headerLength = original.length - info.font.data.length,
    encoded = mtxFont(name),
    payload = info.font.encrypted ? encoded.map((b) => b ^ 0x50) : encoded,
    bytes = new Uint8Array(headerLength + payload.length),
    view = new DataView(bytes.buffer);
  bytes.set(original.subarray(0, headerLength));
  bytes.set(payload, headerLength);
  view.setUint32(0, bytes.length, true);
  view.setUint32(4, payload.length, true);
  view.setUint32(12, info.font.flags | 4, true);
  return bytes;
}

export function embedMtxFont(pres, name) {
  const native = mtxFont(name, "ttf"),
    info = readOpenTypeFont(native);
  P.embedFont(pres, native, { embeddingAuthorized: true });
  const style = info.bold
      ? info.italic
        ? "boldItalic"
        : "bold"
      : info.italic
        ? "italic"
        : "regular",
    face = P.getEmbeddedFonts(pres).find(
      (row) => row.typeface === info.englishNames.get(1),
    )?.faces[style];
  if (!face) throw Error("embedded font fixture part not found");
  P._internalPackageOf(pres).getPart(face.partName).data = mtxEot(name);
}
