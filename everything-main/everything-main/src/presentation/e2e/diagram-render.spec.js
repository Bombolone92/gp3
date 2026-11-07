import heightSearch from "../tests/data/diagram-height-search-native.json" with { type: "json" };
import spaceRetry from "../tests/data/diagram-space-retry-native.json" with { type: "json" };
import canvasFit from "../tests/data/diagram-canvas-fit-native.json" with { type: "json" };
import linearDrawing from "../tests/data/diagram-linear-drawing-native.json" with { type: "json" };
import rootComposite from "../tests/data/diagram-root-composite-native.json" with { type: "json" };
import lifecycle from "../tests/data/diagram-linear-lifecycle-native.json" with { type: "json" };
import { parseXml, textContent } from "../lib/pptx/src/internal/xml/index.ts";
import pointText from "../tests/data/diagram-point-text-native.json" with { type: "json" };
import zeroText from "../tests/data/diagram-zero-text-native.json" with { type: "json" };
import aspect from "../tests/data/diagram-text-aspect-native.json" with { type: "json" };
import binding from "../tests/data/diagram-height-binding-native.json" with { type: "json" };
import ancestor from "../tests/data/diagram-equality-ancestor-native.json" with { type: "json" };
import association from "../tests/data/diagram-drawing-text-native.json" with { type: "json" };
import composite from "../tests/data/diagram-composite-drawing-native.json" with { type: "json" };
import retry from "../tests/data/diagram-sibling-height-retry-native.json" with { type: "json" };
import custom from "../tests/data/diagram-custom-font-fitting-native.json" with { type: "json" };
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { renderedDiagramDeck } from "../tests/diagram-render-fixture.js";
import { semanticTextGroupDeck } from "../tests/diagram-text-group-fixture.js";
import { semanticPaintDeck } from "../tests/diagram-build-fixture.js";
import { P, preview } from "../src/model.js";
import { isDiagramShape } from "../lib/pptx/src/api/fn/diagram-read.ts";

for (const semantic of [
  false,
  true,
  "group",
  "custom",
  "retry",
  "composite",
  "association",
  "unbounded",
  "ancestor",
  "binding",
  "aspect",
  "zero",
  "point",
  "height",
  "narrow",
  "exhausted",
  "space",
  "space-local",
  "space-root",
  "canvas",
  "linear",
  "linear-cross",
  "root-composite",
])
  test(`SmartArt paints ${["space", "space-local", "space-root", "canvas", "linear", "linear-cross"].includes(semantic) ? `${semantic} fallback` : ["height", "narrow", "exhausted"].includes(semantic) ? `${semantic === "height" ? "finite" : semantic} height fitting` : semantic === "root-composite" ? "root composite" : semantic === "point" ? "point-associated text" : semantic === "zero" ? "zero-height text" : semantic === "aspect" ? "text aspect" : semantic === "binding" ? "dimension binding" : semantic === "ancestor" ? "ancestor references" : semantic === "unbounded" ? "unbounded composite" : semantic === "association" ? "associated text" : semantic === "composite" ? "composite drawing" : semantic === "retry" ? "retained fitting" : semantic === "custom" ? "custom text" : semantic === "group" ? "shared text" : semantic ? "semantic" : "saved"} geometry and styled text through clipboard and download`, async ({
    page,
  }) => {
    await page.route("https://js.puter.com/v2/", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
      }),
    );
    await page.goto("/#/home");
    const heightCase = {
      height: "search-holdout / end h0.1 limit25.9 font32",
      narrow: "exhaustion / width 20 fontRule true",
      exhausted: "expansion / h0.000001 font32 limitINF",
    }[semantic];
    const spaceCase = {
      space: "space-holdout / fromR none height",
      "space-local": "space-local / fromL local3 limit2",
      "space-root": "space-scope / root tx literal h1",
      canvas: "canvas-fit / fromT limit2 font32",
      linear: "linear-drawing / fromL limit50 none",
      "linear-cross": "linear-cross / fromT nestedTrue tightTrue limit50",
      "root-composite": "root-composite / fromL nestedTrue tightFalse limit50",
    }[semantic];
    const pres = spaceCase
      ? (
          await semanticTextGroupDeck(
            [
              ...spaceRetry.cases,
              ...canvasFit.cases,
              ...linearDrawing.cases,
              ...lifecycle.cases,
              ...rootComposite.cases,
            ].find((r) => r.name === spaceCase),
          )
        ).p
      : heightCase
        ? (
            await semanticTextGroupDeck(
              heightSearch.cases.find((r) => r.name === heightCase),
            )
          ).p
        : semantic === "binding" ||
            semantic === "aspect" ||
            semantic === "zero" ||
            semantic === "point"
          ? (
              await semanticTextGroupDeck(
                semantic === "point"
                  ? pointText.cases.find(
                      (r) => r.name === "point-holdout / custom true plain",
                    )
                  : semantic === "zero"
                    ? zeroText.cases.find(
                        (r) =>
                          r.name === "fallback-height / fallback 2 120 30 true",
                      )
                    : semantic === "aspect"
                      ? aspect.cases.find(
                          (r) =>
                            r.name ===
                            "upper-height / composite local height-font Alpha beta gamma",
                        )
                      : binding.cases.find(
                          (r) => r.name === "binding-holdout / factor 0.1",
                        ),
              )
            ).p
          : semantic === "ancestor"
            ? (
                await semanticTextGroupDeck(
                  ancestor.cases.find((r) => r.name === "root w probe none"),
                )
              ).p
            : semantic === "association" || semantic === "unbounded"
              ? (
                  await semanticTextGroupDeck(
                    association.cases.find(
                      (r) =>
                        r.name ===
                        `${semantic === "unbounded" ? "unbounded " : ""}sp sibling hidden text`,
                    ),
                  )
                ).p
              : semantic === "composite"
                ? (
                    await semanticTextGroupDeck(
                      composite.cases.find(
                        (r) => r.name === "composite-offset: visible true sp",
                      ),
                    )
                  ).p
                : semantic === "retry"
                  ? (
                      await semanticTextGroupDeck(
                        retry.cases.find(
                          (r) => r.name === "fallback 3 120 50 true",
                        ),
                      )
                    ).p
                  : semantic === "custom"
                    ? (
                        await semanticTextGroupDeck(
                          custom.cases.find(
                            (r) =>
                              r.name ===
                              "holdout custom01 h6 reversefalse height-font",
                          ),
                        )
                      ).p
                    : semantic === "group"
                      ? (await semanticTextGroupDeck()).p
                      : semantic
                        ? (await semanticPaintDeck()).p
                        : (await renderedDiagramDeck()).pres;
    const choose = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "Import PPTX", exact: true })
      .click();
    await (
      await choose
    ).setFiles({
      name: "Rendered SmartArt.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: Buffer.from(await P.savePresentation(pres)),
    });
    const objects = page.locator(".object-hit"),
      image = page.locator(".slide-image");
    await expect(objects).toHaveCount(1);
    const check = async () => {
      const result = await image.evaluate(async (image, semantic) => {
        await image.decode();
        const svg = await (await fetch(image.src)).text();
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, 1280, 720);
        const whitePixels = (x, y, w, h) =>
          [...ctx.getImageData(x, y, w, h).data].reduce(
            (count, channel, i, pixels) =>
              count +
              (i % 4 === 0 &&
              channel === 255 &&
              pixels[i + 1] === 255 &&
              pixels[i + 2] === 255 &&
              pixels[i + 3] === 255
                ? 1
                : 0),
            0,
          );
        return {
          svg,
          inside: [
            ...ctx.getImageData(
              semantic === "point" ||
                ["linear", "linear-cross", "root-composite"].includes(semantic)
                ? 220
                : semantic === "narrow"
                  ? 35
                  : semantic === "exhausted"
                    ? 230
                    : semantic
                      ? 130
                      : 144,
              ["linear", "linear-cross", "root-composite"].includes(semantic)
                ? 95
                : semantic === "canvas"
                  ? 4
                  : ["space", "space-local", "space-root"].includes(semantic)
                    ? 18 // The native two-millimetre text box begins at four millimetres.
                    : semantic === "point"
                      ? 100
                      : semantic === "narrow" || semantic === "exhausted"
                        ? 4
                        : semantic
                          ? 30
                          : 260,
              1,
              1,
            ).data,
          ],
          outside: [...ctx.getImageData(300, 260, 1, 1).data],
          background: [...ctx.getImageData(1200, 650, 1, 1).data],
          // This region is below the nonzero headers and contains only text
          // overflowing the zero-height body, with no painted body geometry.
          bodyTextPixels:
            semantic === "zero" ? whitePixels(0, 180, 200, 60) : 0,
          // Point text uses its origin rectangle independently of the red
          // receiving shape, which begins farther down and to the right.
          // An exhausted height also retains visible text over the background.
          pointTextPixels:
            semantic === "point"
              ? whitePixels(0, 0, 120, 90)
              : semantic === "exhausted"
                ? whitePixels(0, 0, 200, 100)
                : 0,
        };
      }, semantic);
      expect(result.svg).toContain(
        `data-pptx-diagram="${semantic ? "semantic-layout" : "saved-layout"}"`,
      );
      expect(
        semantic === "point" || heightCase || spaceCase
          ? textContent(parseXml(result.svg).root)
          : result.svg,
      ).toContain(
        spaceCase ||
          heightCase ||
          semantic === "group" ||
          semantic === "custom" ||
          semantic === "retry" ||
          semantic === "composite" ||
          semantic === "association" ||
          semantic === "unbounded" ||
          semantic === "ancestor" ||
          semantic === "binding" ||
          semantic === "aspect" ||
          semantic === "zero" ||
          semantic === "point"
          ? "Alpha"
          : semantic
            ? "Text 1"
            : "Rendered",
      );
      if (semantic === "zero") {
        expect(result.svg).toContain("omega");
        expect(result.bodyTextPixels).toBeGreaterThan(50);
      }
      if (semantic === "point" || semantic === "exhausted")
        expect(result.pointTextPixels).toBeGreaterThan(50);
      if (semantic === "custom") expect(result.svg).toMatch(/>I</);
      expect(result.svg).toContain(semantic ? "#FF0000" : "#A12BCD");
      expect(result.svg).not.toContain("data-pptx-diagram-issues");
      expect(result.svg).not.toContain('data-pptx-fallback="graphicFrame"');
      expect(result.inside).toEqual(
        // The composite background takes the first palette entry (red), so
        // its first header takes the next entry (orange). Exhausted height
        // has no painted text box; sample its blue sibling probe instead.
        // With both containers painted, query is third in the four-node
        // red-to-blue hue span: hue 160 degrees (#00FFAA).
        ["linear", "linear-cross", "root-composite"].includes(semantic)
          ? [0, 255, 170, 255]
          : semantic === "exhausted"
            ? [0, 0, 255, 255]
            : semantic === "composite"
              ? [255, 127, 0, 255]
              : semantic
                ? [255, 0, 0, 255]
                : [18, 52, 86, 255],
      );
      // The saved drawing occupies one inch, even though its frame is wider.
      expect(result.outside).not.toEqual(result.inside);
      if (semantic === "root-composite")
        expect(result.outside).toEqual(result.background);
    };
    await check();
    await objects.click();
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await expect(objects).toHaveCount(2);
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await page
      .getByRole("button", { name: "New presentation", exact: true })
      .click();
    await expect(objects).toHaveCount(0);
    await page.keyboard.press("Control+v");
    await expect(objects).toHaveCount(1);
    await check();
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
    const reopened = await P.loadPresentation(
      await readFile(await (await download).path()),
    );
    const slide = P.getSlides(reopened)[0];
    expect(P.getSlideShapes(slide).filter(isDiagramShape)).toHaveLength(1);
    const svg = decodeURIComponent(
      preview(reopened, slide).replace(/^data:image\/svg\+xml[^,]*,/, ""),
    );
    expect(
      semantic === "point" || heightCase || spaceCase
        ? textContent(parseXml(svg).root)
        : svg,
    ).toContain(
      spaceCase ||
        heightCase ||
        semantic === "group" ||
        semantic === "custom" ||
        semantic === "retry" ||
        semantic === "composite" ||
        semantic === "association" ||
        semantic === "unbounded" ||
        semantic === "ancestor" ||
        semantic === "binding" ||
        semantic === "aspect" ||
        semantic === "zero" ||
        semantic === "point"
        ? "Alpha"
        : semantic
          ? "Text 1"
          : "Rendered",
    );
    expect(svg).toContain(semantic ? "#FF0000" : "#A12BCD");
    expect(svg).not.toContain("data-pptx-diagram-issues");
  });
