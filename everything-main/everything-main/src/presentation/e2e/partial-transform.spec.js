import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { P, parseDeck } from "../src/model.js";
import {
  partialTransformFixture,
  transformExtent,
} from "../tests/partial-transform-fixture.js";

for (const kind of ["picture", "shape"])
  for (const level of ["local", "layout"])
    test(`${kind} with ${level} partial bounds uses native defaults through clipboard, undo and download`, async ({
      page,
    }) => {
      await page.route("https://js.puter.com/v2/", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
        }),
      );
      await page.goto("/#/home");
      const extent = transformExtent(P.inches(2.75), P.inches(1.25));
      const bytes = await partialTransformFixture({ kind, [level]: extent });
      const chooser = page.waitForEvent("filechooser");
      await page
        .getByRole("button", { name: "Import PPTX", exact: true })
        .click();
      await (
        await chooser
      ).setFiles({
        name: "Partial transform.pptx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: Buffer.from(bytes),
      });
      const objects = page.locator(".object-hit");
      await expect(objects).toHaveCount(1);
      await expect(objects.first()).toHaveCSS("left", "0px");
      await expect(objects.first()).toHaveCSS("top", "0px");
      await objects.first().click();
      await page.keyboard.press("Control+c");
      await page.keyboard.press("Control+v");
      await expect(objects).toHaveCount(2);
      await page.keyboard.press("Control+z");
      await expect(objects).toHaveCount(1);
      await page.keyboard.press("Control+y");
      await expect(objects).toHaveCount(2);
      await page
        .getByRole("menuitem", { name: "File", exact: true })
        .or(page.getByRole("button", { name: "File options" }))
        .filter({ visible: true })
        .click();
      const download = page.waitForEvent("download");
      await page
        .getByRole("menuitem", {
          name: "Download PowerPoint (.pptx)",
          exact: true,
        })
        .click();
      const restored = await parseDeck(
        await readFile(await (await download).path()),
      );
      const slide = P.getSlides(restored)[0],
        shapes = P.getSlideShapes(slide);
      expect(shapes).toHaveLength(2);
      expect(P.getShapeBoundsResolved(restored, shapes[0])).toEqual({
        x: 0,
        y: 0,
        w: P.inches(2.75),
        h: P.inches(1.25),
      });
      expect(P.getShapePosition(shapes[0])).toBeNull();
      expect(P.getShapeBoundsResolved(restored, shapes[1])).toEqual({
        x: P.inches(0.15),
        y: P.inches(0.15),
        w: P.inches(2.75),
        h: P.inches(1.25),
      });
      expect(
        P.validatePresentation(restored).filter(
          (issue) => issue.severity === "error",
        ),
      ).toEqual([]);
    });
