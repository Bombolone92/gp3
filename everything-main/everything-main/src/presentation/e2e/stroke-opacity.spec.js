import { test, expect } from "@playwright/test";
import { strokeOpacityDeck } from "../tests/stroke-opacity-fixture.js";

test("outline alpha preserves the fill and composites arrowhead overlaps once", async ({
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
  for (const kind of ["shape", "picture", "connector"])
    for (const alpha of [0, 0.25, 0.5, 0.75, 1])
      cases.push({
        kind,
        alpha,
        bytes: Buffer.from(
          await strokeOpacityDeck({
            kind,
            arrows: kind === "connector",
            transforms: `<a:alpha val="${alpha * 100000}"/>`,
          }),
        ).toString("base64"),
      });
  for (const level of ["layout", "master"])
    cases.push({
      kind: "shape",
      alpha: 0.5,
      level,
      bytes: Buffer.from(await strokeOpacityDeck({ level })).toString("base64"),
    });
  const results = await page.evaluate(async (cases) => {
    const M = await import("/src/model.js"),
      results = [];
    for (const c of cases) {
      const p = await M.parseDeck(
          Uint8Array.from(atob(c.bytes), (x) => x.charCodeAt(0)),
        ),
        im = new Image();
      im.src = M.preview(p, M.P.getSlides(p)[0]);
      await im.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(im, 0, 0, 1280, 720);
      const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
      results.push({
        stroke: pixel(200, c.kind === "connector" ? 96 : 93),
        inside: pixel(200, 140),
        overlap: pixel(110, 96),
      });
    }
    return results;
  }, cases);
  // SVG opacity may round twice through eight-bit premultiplied surfaces.
  for (const [i, c] of cases.entries()) {
    const expected = [18, 103, 178].map(
      (v) => v * c.alpha + 255 * (1 - c.alpha),
    );
    for (let j = 0; j < 3; j++) {
      expect(
        Math.abs(results[i].stroke[j] - expected[j]),
        JSON.stringify({
          kind: c.kind,
          alpha: c.alpha,
          level: c.level,
          actual: results[i],
          expected,
        }),
      ).toBeLessThanOrEqual(2);
      if (c.kind === "connector")
        expect(
          Math.abs(results[i].overlap[j] - expected[j]),
        ).toBeLessThanOrEqual(2);
    }
    expect(results[i].inside).toEqual(
      c.kind === "shape" ? [255, 255, 0, 255] : [255, 255, 255, 255],
    );
  }
});

test("transparent outlines survive clipboard and .pptx download", async ({
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
    name: "Outline.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await strokeOpacityDeck()),
  });
  const objects = page.locator(".object-hit");
  await expect(objects).toHaveCount(1);
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
    { P, parseDeck } = await import("../src/model.js"),
    p = await parseDeck(await readFile(await (await dl).path()));
  const shapes = P.getSlideShapes(P.getSlides(p)[0]);
  expect(shapes).toHaveLength(2);
  for (const shape of shapes) expect(P.getShapeStroke(shape).opacity).toBe(0.5);
});

test("outline alpha composes independently across geometry and text", async ({
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
  for (const [kind, preset] of [
    ["shape", "roundRect"],
    ["shape", "ellipse"],
    ["shape", "triangle"],
    ["shape", "custom"],
    ["shape", "customSingle"],
    ["picture", "ellipse"],
    ["connector", "bentConnector3"],
    ["connector", "curvedConnector3"],
  ]) {
    const variants = [];
    for (const alpha of [0, 0.5, 1])
      variants.push(
        Buffer.from(
          await strokeOpacityDeck({
            kind,
            preset,
            text: "Independent text",
            arrows: kind === "connector",
            transforms: `<a:alpha val="${alpha * 100000}"/>`,
          }),
        ).toString("base64"),
      );
    cases.push({ kind, preset, variants });
  }
  const results = await page.evaluate(async (cases) => {
    const M = await import("/src/model.js"),
      results = [];
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    for (const c of cases) {
      const pixels = [];
      for (const bytes of c.variants) {
        const p = await M.parseDeck(
            Uint8Array.from(atob(bytes), (x) => x.charCodeAt(0)),
          ),
          im = new Image();
        im.src = M.preview(p, M.P.getSlides(p)[0]);
        await im.decode();
        ctx.clearRect(0, 0, 640, 360);
        ctx.drawImage(im, 0, 0, 640, 360);
        pixels.push(ctx.getImageData(0, 0, 640, 360).data);
      }
      let changed = 0,
        maxError = 0;
      for (let i = 0; i < pixels[0].length; i++) {
        if (i % 4 === 3) continue;
        if (pixels[0][i] !== pixels[2][i]) changed++;
        maxError = Math.max(
          maxError,
          Math.abs(pixels[1][i] - (pixels[0][i] + pixels[2][i]) / 2),
        );
      }
      results.push({ kind: c.kind, preset: c.preset, changed, maxError });
    }
    return results;
  }, cases);
  for (const row of results) {
    expect(row.changed, JSON.stringify(row)).toBeGreaterThan(100);
    expect(row.maxError, JSON.stringify(row)).toBeLessThanOrEqual(2);
  }
});
