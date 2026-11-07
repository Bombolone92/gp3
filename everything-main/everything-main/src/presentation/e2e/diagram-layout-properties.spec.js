import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { P } from "../src/model.js";
import { diagramLayoutPropertiesDeck } from "../tests/diagram-layout-properties-fixture.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { reflowShapeDiagram } from "../lib/pptx/src/api/fn/diagram-reflow.ts";
import { buildDiagramDrawing } from "../lib/pptx/src/api/fn/diagram-build.ts";

test("SmartArt layout arrowheads, dashes and source colors survive clipboard both ways and exported reimport", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://js.puter.com/v2/", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
  const { p } = await diagramLayoutPropertiesDeck(),
    bytes = Buffer.from(await P.savePresentation(p)),
    objects = page.locator(".object-hit"),
    image = page.locator(".slide-image");
  const importDeck = async (buffer = bytes) => {
    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "Import PPTX", exact: true })
      .click();
    await (
      await chooser
    ).setFiles({
      name: "Layout paint.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer,
    });
    await expect(objects).toHaveCount(1);
  };
  const checkPaint = async () => {
    const result = await image.evaluate(async (img) => {
      await img.decode();
      const svg = await (await fetch(img.src)).text(),
        canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const context = canvas.getContext("2d");
      context.drawImage(img, 0, 0, 1280, 720);
      const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];
      return {
        svg,
        arrow: pixel(400, 80),
        vertical: pixel(94, 240),
        fill: pixel(200, 140),
        dash: Array.from({ length: 46 }, (_, i) => pixel(330 + i, 94)),
        background: pixel(1200, 650),
      };
    });
    expect(result.svg).toContain('data-pptx-diagram="semantic-layout"');
    expect(result.svg).not.toContain("data-pptx-diagram-issues");
    expect(result.svg).toContain('stroke-dasharray="30.24 22.68"');
    expect(result.svg).toContain('marker-end="');
    expect(result.svg).toContain('marker-start="');
    expect(result.arrow).toEqual([208, 38, 62, 255]);
    expect(result.vertical).toEqual([36, 117, 189, 255]);
    expect(result.fill).toEqual([242, 190, 71, 255]);
    expect(result.dash).toContainEqual([208, 38, 62, 255]);
    expect(result.dash).toContainEqual(result.background);
  };
  const download = async (count) => {
    await page
      .getByRole("menuitem", { name: "File", exact: true })
      .or(page.getByRole("button", { name: "File options" }))
      .filter({ visible: true })
      .click();
    const getting = page.waitForEvent("download");
    await page
      .getByRole("menuitem", {
        name: "Download PowerPoint (.pptx)",
        exact: true,
      })
      .click();
    const exported = await readFile(await (await getting).path()),
      reopened = await P.loadPresentation(exported),
      frames = P.getSlideShapes(P.getSlides(reopened)[0]).filter((s) =>
        readShapeDiagram(s),
      );
    expect(frames).toHaveLength(count);
    expect(P.validatePresentation(reopened)).toEqual([]);
    for (const frame of frames) {
      const drawing = buildDiagramDrawing(
          frame,
          reflowShapeDiagram(frame, { textFits: () => true }),
        ),
        painted = P.getGroupChildren(drawing.root);
      expect(painted).toHaveLength(3);
      expect(P.getShapeStrokeDash(painted[0])).toBe("dash");
      expect(P.getShapeStrokeWidth(painted[0])).toBe(72000);
      expect(P.getShapeStrokeColorResolved(reopened, painted[0])).toBe(
        "#D0263E",
      );
      expect(readShapeDiagram(frame).drawing).toBeNull();
    }
    return exported;
  };
  await importDeck();
  await checkPaint();
  await objects.click();
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await page
    .getByRole("button", { name: "New presentation", exact: true })
    .click();
  await expect(objects).toHaveCount(0);
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(1);
  await checkPaint();
  const forward = await download(1);
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await importDeck(forward);
  await checkPaint();
  await objects.click();
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await importDeck();
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(2);
  await checkPaint();
  await download(2);
  expect(errors).toEqual([]);
});
