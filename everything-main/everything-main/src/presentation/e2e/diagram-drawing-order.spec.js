import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { diagramDrawingOrderDeck } from "../tests/diagram-drawing-order-fixture.js";
import { P } from "../src/model.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { reflowShapeDiagram } from "../lib/pptx/src/api/fn/diagram-reflow.ts";
import { buildDiagramDrawing } from "../lib/pptx/src/api/fn/diagram-build.ts";

for (const row of [
  {
    name: "positive",
    offsets: [2, 0, 0],
    color: [255, 0, 0, 255],
    order: ["Central", "East", "West"],
  },
  {
    name: "negative",
    offsets: [0, 0, -2],
    color: [0, 255, 0, 255],
    order: ["East", "West", "Central"],
  },
])
  test(`SmartArt ${row.name} drawing offsets paint through two-way clipboard and export`, async ({
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
    const { p, diagram } = await diagramDrawingOrderDeck(row.offsets),
      layout = diagram.layout.part.data.slice(),
      bytes = Buffer.from(await P.savePresentation(p)),
      objects = page.locator(".object-hit"),
      image = page.locator(".slide-image");
    const importControl = async () => {
      const chooser = page.waitForEvent("filechooser");
      await page
        .getByRole("button", { name: "Import PPTX", exact: true })
        .click();
      await (
        await chooser
      ).setFiles({
        name: "Drawing order.pptx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: bytes,
      });
      await expect(objects).toHaveCount(1);
    };
    const checkPaint = async () => {
      const rendered = await image.evaluate(async (img) => {
        await img.decode();
        const svg = await (await fetch(img.src)).text(),
          canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 1280, 720);
        const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
        return {
          svg,
          overlap: pixel(140, 90),
          outside: pixel(300, 260),
          background: pixel(1200, 650),
        };
      });
      expect(rendered.svg).toContain('data-pptx-diagram="semantic-layout"');
      expect(rendered.svg).not.toContain("data-pptx-diagram-issues");
      expect(rendered.overlap).toEqual(row.color);
      expect(rendered.outside).toEqual(rendered.background);
    };
    const downloadAndCheck = async (count) => {
      await page
        .getByRole("menuitem", { name: "File", exact: true })
        .or(page.getByRole("button", { name: "File options" }))
        .filter({ visible: true })
        .click();
      const downloading = page.waitForEvent("download");
      await page
        .getByRole("menuitem", {
          name: "Download PowerPoint (.pptx)",
          exact: true,
        })
        .click();
      const exported = await readFile(await (await downloading).path()),
        reopened = await P.loadPresentation(exported);
      expect(P.validatePresentation(reopened)).toEqual([]);
      const diagrams = P.getSlideShapes(P.getSlides(reopened)[0]).filter((s) =>
        readShapeDiagram(s),
      );
      expect(diagrams).toHaveLength(count);
      for (const frame of diagrams) {
        const result = reflowShapeDiagram(frame, { textFits: () => true }),
          drawing = buildDiagramDrawing(frame, result);
        expect(P.getGroupChildren(drawing.root).map(P.getShapeText)).toEqual(
          row.order,
        );
        expect(readShapeDiagram(frame).layout.part.data).toEqual(layout);
        expect(readShapeDiagram(frame).drawing).toBeNull();
      }
      return exported;
    };
    await importControl();
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
    const forward = await downloadAndCheck(1);
    // Reopen the exported destination before copying it back to the source.
    await page.getByRole("button", { name: "Back to presentations" }).click();
    const choosing = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "Import PPTX", exact: true })
      .click();
    await (
      await choosing
    ).setFiles({
      name: "Exported drawing order.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: forward,
    });
    await expect(objects).toHaveCount(1);
    await checkPaint();
    await objects.click();
    await page.keyboard.press("Control+c");
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await importControl();
    await page.keyboard.press("Control+v");
    await expect(objects).toHaveCount(2);
    await checkPaint();
    await downloadAndCheck(2);
    expect(errors).toEqual([]);
  });
