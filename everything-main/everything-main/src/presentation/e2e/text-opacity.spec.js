import { test, expect } from "@playwright/test";
import { textOpacityDeck } from "../tests/text-opacity-fixture.js";
const stub = async (page) =>
  page.route("https://js.puter.com/v2/", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );

test("text alpha composites glyph coverage over the slide in both rendering paths", async ({
  page,
}) => {
  await stub(page);
  await page.goto("/");
  const cases = await Promise.all(
    [0, 0.4, 1].map(async (opacity) =>
      Buffer.from(await textOpacityDeck(opacity)).toString("base64"),
    ),
  );
  const result = await page.evaluate(async (cases) => {
    const M = await import("/src/model.js"),
      R = await import("/lib/pptx-preview/src/index.ts"),
      result = [];
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 540;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    for (const mode of ["svg", "foreignObject"]) {
      const pixels = [];
      for (const encoded of cases) {
        const p = await M.parseDeck(
            Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
          ),
          s = M.P.getSlides(p)[0];
        const svg = R.renderSlideToSvg(p, s, {
            textLayout: mode,
            stableDefinitionIds: true,
          }),
          im = new Image();
        im.src = "data:image/svg+xml," + encodeURIComponent(svg);
        await im.decode();
        ctx.clearRect(0, 0, 960, 540);
        ctx.drawImage(im, 0, 0, 960, 540);
        pixels.push(ctx.getImageData(0, 0, 960, 540).data);
      }
      let changed = 0,
        maxError = 0;
      for (let i = 0; i < pixels[0].length; i++) {
        if (i % 4 === 3) continue;
        if (pixels[0][i] !== pixels[2][i]) changed++;
        maxError = Math.max(
          maxError,
          Math.abs(pixels[1][i] - (pixels[0][i] * 0.6 + pixels[2][i] * 0.4)),
        );
      }
      result.push({ mode, changed, maxError });
    }
    return result;
  }, cases);
  for (const row of result) {
    expect(row.changed, JSON.stringify(row)).toBeGreaterThan(500);
    expect(row.maxError, JSON.stringify(row)).toBeLessThanOrEqual(2);
  }
});

test("text transparency survives app clipboard and downloaded PPTX", async ({
  page,
}) => {
  await stub(page);
  await page.goto("/#/home");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "Text opacity.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await textOpacityDeck()),
  });
  const objects = page.locator(".object-hit");
  await expect(objects).toHaveCount(1);
  await objects.dblclick();
  const editor = page.getByRole("textbox", { name: "Edit text", exact: true });
  await editor.fill("Edited transparent text");
  await editor.press("Control+Enter");
  await objects.click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(2);
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const dl = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const { readFile } = await import("node:fs/promises"),
    { P, parseDeck } = await import("../src/model.js");
  const p = await parseDeck(await readFile(await (await dl).path()));
  const shapes = P.getSlideShapes(P.getSlides(p)[0]);
  expect(shapes).toHaveLength(2);
  for (const shape of shapes) {
    expect(P.getShapeText(shape)).toBe("Edited transparent text");
    expect(P.getShapeRunFormatEffective(p, shape, 0, 0)).toMatchObject({
      color: "#CC2244",
      colorOpacity: 0.4,
    });
  }
});
