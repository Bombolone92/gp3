import { test, expect } from "@playwright/test";
import {
  duotoneDeck,
  colorXml,
  duotoneSamples,
} from "../tests/duotone-fixture.js";
const pairs = [
  ["204080", "E0A030"],
  ["FF8000", "0040C0"],
  ["604020", "604020"],
  ["000000", "FFFFFF"],
];
test("duotone pixels use sRGB luminance and preserve image transparency in pictures, shape fills and layouts", async ({
  page,
}) => {
  await page.route("https://js.puter.com/v2/", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/");
  const cases = [];
  for (const [first, second] of pairs)
    for (const kind of ["picture", "shape"])
      for (const level of ["slide", "layout"])
        cases.push({
          first,
          second,
          kind,
          level,
          bytes: Buffer.from(
            await duotoneDeck({
              first: colorXml(first),
              second: colorXml(second),
              kind,
              level,
              background: "#203040",
            }),
          ).toString("base64"),
        });
  const pixels = await page.evaluate(async (cases) => {
    const { P, parseDeck, preview } = await import("/src/model.js"),
      canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }),
      results = [];
    for (const c of cases) {
      const p = await parseDeck(
          Uint8Array.from(atob(c.bytes), (x) => x.charCodeAt(0)),
        ),
        im = new Image();
      im.src = preview(p, P.getSlides(p)[0]);
      await im.decode();
      ctx.clearRect(0, 0, 1280, 720);
      ctx.drawImage(im, 0, 0, 1280, 720);
      results.push(
        Array.from({ length: 8 }, (_, i) => [
          ...ctx.getImageData(48 + 32 * i, 48, 1, 1).data,
        ]),
      );
    }
    return results;
  }, cases);
  const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (const [n, c] of cases.entries())
    for (const [i, source] of duotoneSamples.entries()) {
      const l =
          (source[0] * 0.2126 + source[1] * 0.7152 + source[2] * 0.0722) / 255,
        alpha = source[3] / 255,
        first = rgb(c.first),
        second = rgb(c.second),
        background = [32, 48, 64];
      const expected = first.map(
        (v, j) =>
          (v + (second[j] - v) * l) * alpha + background[j] * (1 - alpha),
      );
      for (let j = 0; j < 3; j++)
        expect(
          Math.abs(pixels[n][i][j] - expected[j]),
          JSON.stringify({
            first: c.first,
            second: c.second,
            kind: c.kind,
            level: c.level,
            source,
            actual: pixels[n][i],
            expected,
          }),
        ).toBeLessThanOrEqual(2);
      expect(pixels[n][i][3]).toBe(255);
    }
});

test("duotone pictures retain colors and effects through clipboard and .pptx download", async ({
  page,
}) => {
  await page.route("https://js.puter.com/v2/", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "Duotone.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await duotoneDeck()),
  });
  const objects = page.locator(".object-hit");
  await expect(objects).toHaveCount(1);
  const firstPixel = () =>
    page.locator(".slide-image").evaluate(async (im) => {
      await im.decode();
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = 720;
      const ctx = c.getContext("2d");
      ctx.drawImage(im, 0, 0, 1280, 720);
      return [...ctx.getImageData(48, 48, 1, 1).data];
    });
  expect(await firstPixel()).toEqual([32, 64, 128, 255]);
  await objects.click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(2);
  expect(await firstPixel()).toEqual([32, 64, 128, 255]);
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const { readFile } = await import("node:fs/promises"),
    { P, parseDeck } = await import("../src/model.js"),
    p = await parseDeck(await readFile(await (await downloaded).path()));
  const shapes = P.getSlideShapes(P.getSlides(p)[0]);
  expect(shapes).toHaveLength(2);
  for (const sh of shapes)
    expect(P.getShapeImageDuotone(p, sh)).toEqual({
      firstColor: "#204080",
      secondColor: "#E0A030",
    });
});
