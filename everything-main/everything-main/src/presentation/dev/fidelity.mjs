// Renders every slide of a .pptx with the app and saves PNGs beside a
// reference PDF export of the same deck (rasterized with pdftoppm), with a side-by-side image and a difference score per
// slide. Usage:
//   node dev/fidelity.mjs <deck.pptx> <reference.pdf> <out dir> [port]
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";

const [deck, pdf, out, port = "5401"] = process.argv.slice(2);
const WIDTH = 1280;
await mkdir(out, { recursive: true });
execFileSync("pdftoppm", [
  "-png",
  "-scale-to-x",
  String(WIDTH),
  "-scale-to-y",
  "-1",
  pdf,
  join(out, "ppt"),
]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
await page.route("https://js.puter.com/v2/", (r) =>
  r.fulfill({
    contentType: "application/javascript",
    body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
  }),
);
await page.goto(`http://127.0.0.1:${port}/#/home`);
const chooser = page.waitForEvent("filechooser");
await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
await (
  await chooser
).setFiles({
  name: basename(deck),
  mimeType:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  buffer: await readFile(deck),
});
await page.locator(".slide-image").waitFor();
await page.waitForTimeout(1500);
const count = await page.locator("#slide-list .slide-item").count();
const scores = [];
for (let i = 0; i < count; i++) {
  await page.locator("#slide-list .slide-thumb").nth(i).click();
  await page.waitForTimeout(400);
  const data = await page
    .locator(".slide-image")
    .evaluate(async (img, width) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = width;
      c.height = Math.round((width * img.naturalHeight) / img.naturalWidth);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    }, WIDTH);
  await writeFile(
    join(out, `app-${String(i + 1).padStart(2, "0")}.png`),
    Buffer.from(data.split(",")[1], "base64"),
  );
}
await browser.close();
// Pair and score with Python (Pillow), which is at hand.
const report = execFileSync("python3", [
  "-c",
  `
import glob, os, sys
from PIL import Image, ImageChops, ImageStat
out = sys.argv[1]
ppt = sorted(glob.glob(os.path.join(out, "ppt-*.png")))
app = sorted(glob.glob(os.path.join(out, "app-*.png")))
for i, (a, b) in enumerate(zip(ppt, app), 1):
    A = Image.open(a).convert("RGB"); B = Image.open(b).convert("RGB").resize(A.size)
    diff = ImageChops.difference(A, B)
    score = sum(ImageStat.Stat(diff).mean) / 3
    side = Image.new("RGB", (A.width * 2 + 10, A.height), "white")
    side.paste(A, (0, 0)); side.paste(B, (A.width + 10, 0))
    side.save(os.path.join(out, f"side-{i:02d}.png"))
    print(f"slide {i}: mean difference {score:.2f}")
`,
  out,
]).toString();
console.log(report);
