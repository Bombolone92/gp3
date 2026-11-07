import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { diagramSpacerDeck } from "../tests/diagram-spacer-fixture.js";
import { P } from "../src/model.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { reflowShapeDiagram } from "../lib/pptx/src/api/fn/diagram-reflow.ts";

for (const direction of ["fromL", "fromB"])
  test(`semantic SmartArt signed spacing paints and survives actual clipboard in both directions: ${direction}`, async ({
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
    const { p } = await diagramSpacerDeck({ direction }),
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
        name: "Signed spacing.pptx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: bytes,
      });
      await expect(objects).toHaveCount(1);
    };
    const checkPaint = async () => {
      const rendered = await image.evaluate(async (img, direction) => {
        await img.decode();
        const svg = await (await fetch(img.src)).text(),
          canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        // The preview SVG uses responsive dimensions. Rasterize its 1280x720
        // viewBox explicitly; SVG intrinsic image sizes differ across engines.
        ctx.drawImage(img, 0, 0, 1280, 720);
        const pixel = (advance) => [
          ...ctx.getImageData(
            direction === "fromL" ? advance : 100,
            direction === "fromL" ? 100 : advance,
            1,
            1,
          ).data,
        ];
        return {
          svg,
          first: pixel(45),
          last: pixel(335),
          outside: pixel(340),
          background: [...ctx.getImageData(1200, 650, 1, 1).data],
        };
      }, direction);
      expect(rendered.svg).toContain('data-pptx-diagram="semantic-layout"');
      expect(rendered.svg).not.toContain("data-pptx-diagram-issues");
      for (const label of ["West", "Central", "East"])
        expect(rendered.svg).toContain(label);
      expect(rendered.first).toEqual([27, 82, 193, 255]);
      expect(rendered.last).toEqual([27, 82, 193, 255]);
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
      const reopened = await P.loadPresentation(
        await readFile(await (await downloading).path()),
      );
      expect(P.validatePresentation(reopened)).toEqual([]);
      const diagrams = P.getSlideShapes(P.getSlides(reopened)[0]).filter((s) =>
        readShapeDiagram(s),
      );
      expect(diagrams).toHaveLength(count);
      for (const frame of diagrams) {
        const result = reflowShapeDiagram(frame, { textFits: () => true }),
          main = direction === "fromL" ? "w" : "h",
          axis = direction === "fromL" ? "x" : "y";
        expect(
          result.root.children.map((n) => result.bounds.get(n)[main]),
        ).toEqual([34, -12, 34, -12, 34]);
        const positions = result.root.children
          .filter((n) => n.name.startsWith("box"))
          .map((n) => result.bounds.get(n)[axis]);
        expect(positions).toEqual(
          direction === "fromL" ? [1, 23, 45] : [45, 23, 1],
        );
        expect(readShapeDiagram(frame).drawing).toBeNull();
      }
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
    await downloadAndCheck(1);
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
