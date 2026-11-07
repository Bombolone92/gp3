import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fillOpacityDeck } from "../tests/fill-opacity-fixture.js";
import { P, parseDeck } from "../src/model.js";

const start = async (page) => {
  await page.route("https://js.puter.com/v2/", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
};

test("solid fill alpha reveals pictures without fading outlines, text or custom geometry holes", async ({
  page,
}) => {
  await start(page);
  const cases = [];
  for (const preset of ["rect", "ellipse", "triangle", "custom"])
    for (const level of [
      "slide",
      "layout",
      "master",
      "layoutDecoration",
      "masterDecoration",
    ]) {
      const variants = [];
      for (const alpha of [0, 0.3, 1])
        variants.push(
          Buffer.from(
            await fillOpacityDeck({
              preset,
              level,
              text: "Independent text",
              transforms: `<a:alpha val="${alpha * 100000}"/>`,
            }),
          ).toString("base64"),
        );
      cases.push({ preset, level, variants });
    }
  const results = await page.evaluate(async (cases) => {
    const M = await import("/src/model.js");
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }),
      results = [];
    for (const c of cases) {
      const pixels = [];
      for (const bytes of c.variants) {
        const p = await M.parseDeck(
            Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)),
          ),
          im = new Image();
        im.src = M.preview(p, M.P.getSlides(p)[0]);
        await im.decode();
        ctx.clearRect(0, 0, 640, 360);
        ctx.drawImage(im, 0, 0, 640, 360);
        pixels.push(ctx.getImageData(0, 0, 640, 360).data);
      }
      let maxError = 0,
        changed = 0,
        unchangedInk = 0;
      for (let i = 0; i < pixels[0].length; i += 4) {
        let same = true;
        for (let k = 0; k < 3; k++) {
          const first = pixels[0][i + k],
            last = pixels[2][i + k];
          maxError = Math.max(
            maxError,
            Math.abs(pixels[1][i + k] - (first * 0.7 + last * 0.3)),
          );
          if (first !== last) same = false;
        }
        if (!same) changed++;
        else if (
          pixels[0][i] !== pixels[0][0] ||
          pixels[0][i + 1] !== pixels[0][1] ||
          pixels[0][i + 2] !== pixels[0][2]
        )
          unchangedInk++;
      }
      results.push({
        preset: c.preset,
        level: c.level,
        maxError,
        changed,
        unchangedInk,
      });
    }
    return results;
  }, cases);
  for (const row of results) {
    expect(row.maxError, JSON.stringify(row)).toBeLessThanOrEqual(2);
    expect(row.changed, JSON.stringify(row)).toBeGreaterThan(1000);
    expect(row.unchangedInk, JSON.stringify(row)).toBeGreaterThan(100);
  }
});

test("transparent overlays survive UI copying and .pptx download", async ({
  page,
}) => {
  await start(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "Transparent overlay.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await fillOpacityDeck()),
  });
  const objects = page.locator(".object-hit");
  await expect(objects).toHaveCount(1);
  const pixel = await page.locator(".slide-image").evaluate(async (im) => {
    await im.decode();
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 720;
    const ctx = c.getContext("2d");
    ctx.drawImage(im, 0, 0, 1280, 720);
    return [...ctx.getImageData(200, 150, 1, 1).data];
  });
  // The authored white overlay has 30% alpha above the fixture's blue image.
  for (const [i, base] of [48, 96, 144].entries())
    expect(Math.abs(pixel[i] - (255 * 0.3 + base * 0.7))).toBeLessThanOrEqual(
      2,
    );
  await objects.click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(2);
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const restored = await parseDeck(
      await readFile(await (await download).path()),
    ),
    shapes = P.getSlideShapes(P.getSlides(restored)[0]);
  expect(shapes).toHaveLength(2);
  for (const shape of shapes) expect(P.getShapeFill(shape).opacity).toBe(0.3);
});
