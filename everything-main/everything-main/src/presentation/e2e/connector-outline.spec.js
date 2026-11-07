import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { connectorDeck } from "../tests/connector-fixture.js";
import { P, parseDeck } from "../src/model.js";

test("connectors with no outline remain editable and invisible through clipboard and download", async ({
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
    name: "Connector.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await connectorDeck("bentConnector3")),
  });
  const objects = page.locator(".object-hit");
  await expect(objects).toHaveCount(1);
  const paints = () =>
    page.locator(".slide-image").evaluate(async (im) => {
      await im.decode();
      const canvas = document.createElement("canvas");
      const xml = new DOMParser().parseFromString(
        decodeURIComponent(im.src.split(",")[1]),
        "image/svg+xml",
      );
      const [, , width, height] = xml.documentElement
        .getAttribute("viewBox")
        .split(/\s+/)
        .map(Number);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(im, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let changed = 0;
      for (let i = 0; i < data.length; i += 4)
        if (
          data[i] !== 255 ||
          data[i + 1] !== 255 ||
          data[i + 2] !== 255 ||
          data[i + 3] !== 255
        )
          changed++;
      return changed;
    });
  expect(await paints()).toBe(0);
  await objects.click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(2);
  expect(await paints()).toBe(0);
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const bytes = await readFile(await (await downloaded).path()),
    p = await parseDeck(bytes),
    s = P.getSlides(p)[0];
  expect(P.getSlideShapes(s)).toHaveLength(2);
  for (const sh of P.getSlideShapes(s)) {
    expect(P.getShapeKind(sh)).toBe("connector");
    expect(P.getShapeStroke(sh)).toEqual({ kind: "none" });
  }
});
