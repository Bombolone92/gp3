import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

// Keep icon.png as the original artwork; all distributed sizes derive from it.
const root = new URL("../", import.meta.url);
const source = await loadImage(fileURLToPath(new URL("icon.png", root)));
await mkdir(new URL("public/icons/", root), { recursive: true });
function png(size, { background, inset = 0 } = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const scale = (size - inset * 2) / Math.max(source.width, source.height);
  const w = source.width * scale,
    h = source.height * scale;
  ctx.drawImage(source, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toBuffer("image/png");
}
for (const size of [64, 128, 192, 512])
  await writeFile(new URL(`public/icons/icon-${size}.png`, root), png(size));
for (const size of [16, 32])
  await writeFile(
    new URL(`public/favicon-${size}x${size}.png`, root),
    png(size),
  );
await writeFile(
  new URL("public/apple-touch-icon.png", root),
  png(180, { background: "#f4f7fb" }),
);
// The complete artwork fits inside the central 80%-diameter safe circle.
await writeFile(
  new URL("public/icons/icon-maskable-512.png", root),
  png(512, { background: "#f4f7fb", inset: 112 }),
);
const sizes = [16, 32, 48];
const images = sizes.map((size) => png(size));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((data, n) => {
  const entry = 6 + n * 16;
  header[entry] = header[entry + 1] = sizes[n];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});
await writeFile(
  new URL("public/favicon.ico", root),
  Buffer.concat([header, ...images]),
);
console.log(
  "Generated UI, favicon, Apple touch, and manifest icons from icon.png.",
);
