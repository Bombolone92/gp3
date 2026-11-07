import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { P } from "../src/model.js";
import styleFallbackNative from "../tests/data/diagram-style-fallback-native.json" with { type: "json" };
import {
  styleFallbackDeck,
  inspectStyleFallback,
} from "../tests/diagram-style-fallback-fixture.js";
import { diagramAncestorFontDeck } from "../tests/diagram-ancestor-font-fixture.js";
import { diagramSpacerDeck } from "../tests/diagram-spacer-fixture.js";
import { diagramCompositeHeightDeck } from "../tests/diagram-composite-height-fixture.js";
import { diagramAspectReferenceDeck } from "../tests/diagram-text-aspect-reference-fixture.js";
import {
  diagramCompositeCanvasDeck,
  diagramCompositeHeightAllocationDeck,
  diagramCompositeHeightPreferenceDeck,
} from "../tests/diagram-composite-canvas-fixture.js";
import { diagramLinearRuleDeck } from "../tests/diagram-linear-rule-fixture.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { SHAPE_ELEMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import { NS, walkElements } from "../lib/pptx/src/internal/xml/index.ts";
import { commitAndRefresh } from "../lib/pptx/src/api/fn/_helpers.ts";

async function editor(page, p) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://js.puter.com/v2/", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
  const original = Buffer.from(await P.savePresentation(p)),
    objects = page.locator(".object-hit"),
    image = page.locator(".slide-image"),
    modal = page.getByRole("dialog", { name: "Edit diagram text" });
  const importDeck = async (buffer = original, count = 1) => {
    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "Import PPTX", exact: true })
      .click();
    await (
      await chooser
    ).setFiles({
      name: "Diagram editing.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer,
    });
    await expect(objects).toHaveCount(count);
  };
  const download = async () => {
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
    const bytes = await readFile(await (await getting).path()),
      reopened = await P.loadPresentation(bytes),
      frames = P.getSlideShapes(P.getSlides(reopened)[0]).filter(
        P.isDiagramShape,
      );
    expect(P.validatePresentation(reopened)).toEqual([]);
    return { bytes, reopened, frames };
  };
  const svg = () =>
    image.evaluate(async (img) => {
      await img.decode();
      return (await fetch(img.src)).text();
    });
  const check = async (text) => {
    await expect.poll(svg).toContain(text);
    expect(await svg()).toContain('data-pptx-diagram="semantic-layout"');
    expect(await svg()).not.toContain("data-pptx-diagram-issues");
  };
  return { errors, objects, modal, importDeck, download, svg, check };
}

for (const [name, nativeName, color] of [
  [
    "sole quick-style fallback",
    "defaults: unrelated-label / none / base",
    "#326894",
  ],
  [
    "empty sole quick-style fallback",
    "selection: sole unrelated empty",
    "#000000",
  ],
])
  test(`${name} retains native paint through editing, download and independent clipboard return`, async ({
    page,
  }, testInfo) => {
    const row = styleFallbackNative.cases.find((c) => c.name === nativeName);
    const { p } = await styleFallbackDeck(row),
      ui = await editor(page, p);
    const check = async () => {
      await expect
        .poll(ui.svg)
        .toContain('data-pptx-diagram="semantic-layout"');
      expect(await ui.svg()).not.toContain("data-pptx-diagram-issues");
      const paint = await page.evaluate(
        (svg) => {
          const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
          return {
            colors: [...doc.querySelectorAll("tspan")].map((e) =>
              e.getAttribute("fill"),
            ),
            fills: [
              ...doc.querySelectorAll(
                '[data-pptx-shape-name="node1"] rect, [data-pptx-shape-name="node2"] rect',
              ),
            ].map((e) => [e.getAttribute("fill"), e.getAttribute("stroke")]),
          };
        },
        await ui.svg(),
      );
      expect(paint.colors.length).toBeGreaterThan(0);
      expect(new Set(paint.colors)).toEqual(new Set([color]));
      expect(paint.fills.length).toBeGreaterThan(0);
      for (const fill of paint.fills) expect(fill).toEqual(["none", "none"]);
    };
    const inspect = (frame, text) =>
      expect(inspectStyleFallback(frame)).toEqual(
        row.expected.map((s, i) => (i === 0 ? { ...s, text } : s)),
      );
    await ui.importDeck();
    await check();
    await ui.objects.click();
    await ui.objects.press("Enter");
    const first = ui.modal.getByRole("textbox", {
      name: "Item 1 text",
      exact: true,
    });
    await expect(first).toHaveValue("Paint defaults");
    await first.fill("After");
    await first.press("Control+Enter");
    await expect(ui.modal).toHaveCount(0);
    await check();
    const edited = await ui.download();
    inspect(edited.frames[0], "After");
    expect(readShapeDiagram(edited.frames[0]).drawing).toBeNull();
    await ui.objects.click();
    await page.keyboard.press("Control+c");
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await page
      .getByRole("button", { name: "New presentation", exact: true })
      .click();
    await expect(ui.objects).toHaveCount(0);
    await page.keyboard.press("Control+v");
    await expect(ui.objects).toHaveCount(1);
    await check();
    const forward = await ui.download();
    inspect(forward.frames[0], "After");
    await testInfo.attach("forward.pptx", {
      body: forward.bytes,
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    await ui.objects.click();
    await page.keyboard.press("Control+c");
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await ui.importDeck(edited.bytes);
    await page.keyboard.press("Control+v");
    await expect(ui.objects).toHaveCount(2);
    await ui.objects.last().press("Enter");
    await first.fill("Independent");
    await first.press("Control+Enter");
    await expect(ui.modal).toHaveCount(0);
    await check();
    const returned = await ui.download();
    inspect(returned.frames[0], "After");
    inspect(returned.frames[1], "Independent");
    expect(readShapeDiagram(returned.frames[0]).data.part.name).not.toBe(
      readShapeDiagram(returned.frames[1]).data.part.name,
    );
    expect(returned.frames.map((f) => readShapeDiagram(f).drawing)).toEqual([
      null,
      null,
    ]);
    expect(ui.errors).toEqual([]);
  });

for (const [caseIndex, name, preservesFont] of [
  [0, "ancestor font rules"],
  [9, "width-first ancestor font rules"],
  [24, "custom ancestor geometry", true],
  [35, "automatic ancestor font beside custom text"],
  [38, "fractional custom ancestor font", true],
])
  test(`${name} support visible text editing, editable download and independent clipboard return`, async ({
    page,
  }) => {
    const { p, nativeFont, nativeHeight, nodeName, originalText } =
        await diagramAncestorFontDeck(caseIndex),
      ui = await editor(page, p);
    const checkGeometry = async (text = "After") => {
      await expect
        .poll(ui.svg)
        .toContain('data-pptx-diagram="semantic-layout"');
      expect(await ui.svg()).not.toContain("data-pptx-diagram-issues");
      // A retained custom font may wrap a word across multiple SVG text runs.
      // Check the rendered node's complete text, independently of line breaks.
      await expect
        .poll(async () =>
          page.evaluate(
            ({ svg, nodeName }) =>
              Array.from(
                new DOMParser()
                  .parseFromString(svg, "image/svg+xml")
                  .querySelectorAll(`[data-pptx-shape-name="${nodeName}"]`),
                (node) => node.textContent,
              ),
            { svg: await ui.svg(), nodeName },
          ),
        )
        .toContain(text);
    };
    await ui.importDeck();
    await ui.check(originalText.split(" ")[0]);
    const textFont = async () =>
      page.evaluate(
        ({ svg, nodeName }) => {
          const document = new DOMParser().parseFromString(
            svg,
            "image/svg+xml",
          );
          return Number(
            document
              .querySelector(`[data-pptx-shape-name="${nodeName}"] tspan`)
              .getAttribute("font-size"),
          );
        },
        { svg: await ui.svg(), nodeName },
      );
    const originalFont = await textFont();
    expect(originalFont).toBe(Number(((nativeFont * 4) / 3).toFixed(2)));
    const originalHeight = await page.evaluate(
      ({ svg, nodeName }) =>
        Number(
          new DOMParser()
            .parseFromString(svg, "image/svg+xml")
            .querySelector(`[data-pptx-shape-name="${nodeName}"] rect`)
            .getAttribute("height"),
        ),
      { svg: await ui.svg(), nodeName },
    );
    expect(originalHeight).toBe(Number((nativeHeight / 9525).toFixed(2)));
    await ui.objects.click();
    await ui.objects.press("Enter");
    const first = ui.modal.getByRole("textbox", {
      name: "Item 1 text",
      exact: true,
    });
    await expect(first).toHaveValue(originalText);
    await first.fill("After");
    await first.press("Control+Enter");
    await expect(ui.modal).toHaveCount(0);
    await checkGeometry();
    expect(await textFont()).toBeGreaterThan(0);
    if (preservesFont) expect(await textFont()).toBe(originalFont);
    else expect(await textFont()).toBeGreaterThan(originalFont);
    const edited = await ui.download();
    expect(P.getShapeDiagramTextEntries(edited.frames[0])[0].text).toBe(
      "After",
    );
    expect(readShapeDiagram(edited.frames[0]).drawing).toBeNull();
    await ui.objects.click();
    await page.keyboard.press("Control+c");
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await page
      .getByRole("button", { name: "New presentation", exact: true })
      .click();
    await expect(ui.objects).toHaveCount(0);
    await page.keyboard.press("Control+v");
    await expect(ui.objects).toHaveCount(1);
    await checkGeometry();
    const forward = await ui.download();
    expect(P.getShapeDiagramTextEntries(forward.frames[0])[0].text).toBe(
      "After",
    );
    await ui.objects.click();
    await page.keyboard.press("Control+c");
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await ui.importDeck(edited.bytes);
    await page.keyboard.press("Control+v");
    await expect(ui.objects).toHaveCount(2);
    await ui.objects.last().press("Enter");
    await first.fill("Independent");
    await first.press("Control+Enter");
    await expect(ui.modal).toHaveCount(0);
    await checkGeometry("Independent");
    const returned = await ui.download();
    expect(
      returned.frames.map((f) => P.getShapeDiagramTextEntries(f)[0].text),
    ).toEqual(["After", "Independent"]);
    expect(returned.frames.map((f) => readShapeDiagram(f).drawing)).toEqual([
      null,
      null,
    ]);
    expect(readShapeDiagram(returned.frames[0]).data.part.name).not.toBe(
      readShapeDiagram(returned.frames[1]).data.part.name,
    );
    expect(ui.errors).toEqual([]);
  });

for (const [name, fixture, label, originalText, shrinks] of [
  [
    "unbounded composite height",
    diagramCompositeHeightDeck,
    "label",
    "perspective",
    true,
  ],
  [
    "automatic aspect references",
    diagramAspectReferenceDeck,
    "primary",
    "Plan",
    false,
  ],
  [
    "composite height reference canvas",
    diagramCompositeCanvasDeck,
    "query",
    "Go",
    false,
  ],
  [
    "composite width reference canvas",
    () => diagramCompositeCanvasDeck(6),
    "query",
    "Go",
    false,
  ],
  [
    "composite height aspect reservation",
    () => diagramCompositeCanvasDeck(44),
    "query",
    "Go",
    false,
  ],
  [
    "composite width aspect reservation",
    () => diagramCompositeCanvasDeck(46),
    "query",
    "Go",
    false,
  ],
  [
    "composite height live aspect references",
    () => diagramCompositeCanvasDeck(60),
    "query",
    "Go",
    false,
  ],
  [
    "composite width live aspect references",
    () => diagramCompositeCanvasDeck(74),
    "query",
    "Go",
    false,
  ],
  [
    "composite local height allocation in LIN",
    diagramCompositeHeightAllocationDeck,
    "primary",
    "Plan",
    false,
  ],
  [
    "composite local height allocation in COMPOSITE",
    () => diagramCompositeHeightAllocationDeck(8),
    "primary",
    "Plan",
    false,
  ],
  [
    "composite height preference automatic",
    () => diagramCompositeHeightPreferenceDeck(1),
    "primary",
    "Plan",
    false,
  ],
  [
    "composite height preference fixed offset",
    () => diagramCompositeHeightPreferenceDeck(21),
    "primary",
    "Plan",
    false,
  ],
  [
    "composite height preference projected overflow",
    () => diagramCompositeHeightPreferenceDeck(5),
    "primary",
    "Plan",
    false,
  ],
  [
    "composite height preference initial growth",
    () => diagramCompositeHeightPreferenceDeck(32),
    "primary",
    "Plan",
    false,
  ],
  [
    "composite height preference completed growth",
    () => diagramCompositeHeightPreferenceDeck(33),
    "primary",
    "Plan",
    false,
  ],
])
  test(`${name} support visible text editing, editable download and independent clipboard return`, async ({
    page,
  }, testInfo) => {
    const { p, nativeHeight } = await fixture(),
      ui = await editor(page, p);
    const checkGeometry = async (text = "After") => {
      await expect
        .poll(async () => {
          const svg = await ui.svg();
          return {
            semantic: svg.includes('data-pptx-diagram="semantic-layout"'),
            issues: svg.includes("data-pptx-diagram-issues"),
            text: await page.evaluate(
              (source) =>
                new DOMParser().parseFromString(source, "image/svg+xml")
                  .documentElement.textContent,
              svg,
            ),
          };
        })
        .toEqual({
          semantic: true,
          issues: false,
          text: expect.stringContaining(text),
        });
    };
    await ui.importDeck();
    await ui.check(originalText);
    const textHeight = async () =>
      page.evaluate(
        ({ svg, label }) => {
          const document = new DOMParser().parseFromString(
            svg,
            "image/svg+xml",
          );
          return Number(
            document
              .querySelector(`[data-pptx-shape-name="${label}"] rect`)
              .getAttribute("height"),
          );
        },
        { svg: await ui.svg(), label },
      );
    const originalHeight = await textHeight();
    if (!shrinks)
      expect(originalHeight).toBe(Number((nativeHeight / 9525).toFixed(2)));
    await ui.objects.click();
    await ui.objects.press("Enter");
    const first = ui.modal.getByRole("textbox", {
      name: "Item 1 text",
      exact: true,
    });
    await expect(first).toHaveValue(new RegExp(originalText));
    await first.fill("After");
    await first.press("Control+Enter");
    await expect(ui.modal).toHaveCount(0);
    await checkGeometry();
    expect(await textHeight()).toBeGreaterThan(0);
    if (shrinks) expect(await textHeight()).toBeLessThan(originalHeight);
    else {
      expect(await textHeight()).toBe(originalHeight);
      await ui.objects.click();
      await ui.objects.press("Enter");
      await first.fill(originalText);
      await first.press("Control+Enter");
      await expect(ui.modal).toHaveCount(0);
      await checkGeometry(originalText);
      expect(await textHeight()).toBe(originalHeight);
      await ui.objects.click();
      await ui.objects.press("Enter");
      await first.fill("After");
      await first.press("Control+Enter");
      await expect(ui.modal).toHaveCount(0);
      await checkGeometry();
    }
    const edited = await ui.download();
    if (name.startsWith("composite "))
      await testInfo.attach("edited.pptx", {
        body: edited.bytes,
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
    expect(P.getShapeDiagramTextEntries(edited.frames[0])[0].text).toBe(
      "After",
    );
    expect(readShapeDiagram(edited.frames[0]).drawing).toBeNull();
    await ui.objects.click();
    await page.keyboard.press("Control+c");
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await page
      .getByRole("button", { name: "New presentation", exact: true })
      .click();
    await expect(ui.objects).toHaveCount(0);
    await page.keyboard.press("Control+v");
    await expect(ui.objects).toHaveCount(1);
    await checkGeometry();
    const forward = await ui.download();
    if (name.startsWith("composite "))
      await testInfo.attach("forward.pptx", {
        body: forward.bytes,
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
    expect(P.getShapeDiagramTextEntries(forward.frames[0])[0].text).toBe(
      "After",
    );
    await ui.objects.click();
    await page.keyboard.press("Control+c");
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await ui.importDeck(edited.bytes);
    await page.keyboard.press("Control+v");
    await expect(ui.objects).toHaveCount(2);
    await ui.objects.last().press("Enter");
    await first.fill("Independent");
    await first.press("Control+Enter");
    await expect(ui.modal).toHaveCount(0);
    await checkGeometry("Independent");
    const returned = await ui.download();
    if (name.startsWith("composite "))
      await testInfo.attach("returned.pptx", {
        body: returned.bytes,
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
    expect(
      returned.frames.map((f) => P.getShapeDiagramTextEntries(f)[0].text),
    ).toEqual(["After", "Independent"]);
    expect(returned.frames.map((f) => readShapeDiagram(f).drawing)).toEqual([
      null,
      null,
    ]);
    expect(readShapeDiagram(returned.frames[0]).data.part.name).not.toBe(
      readShapeDiagram(returned.frames[1]).data.part.name,
    );
    expect(ui.errors).toEqual([]);
  });

test("linear container rules support semantic editing, editable download and independent clipboard return", async ({
  page,
}) => {
  const { p } = await diagramLinearRuleDeck(),
    ui = await editor(page, p);
  const checkGeometry = async () => {
    await expect.poll(ui.svg).toContain('data-pptx-diagram="semantic-layout"');
    expect(await ui.svg()).not.toContain("data-pptx-diagram-issues");
  };
  await ui.importDeck();
  await checkGeometry();
  await ui.objects.click();
  await ui.objects.press("Enter");
  const first = ui.modal.getByRole("textbox", {
    name: "Item 1 text",
    exact: true,
  });
  await expect(first).toHaveValue("Before");
  await first.fill("After");
  await first.press("Control+Enter");
  await expect(ui.modal).toHaveCount(0);
  await checkGeometry();
  const edited = await ui.download();
  expect(P.getShapeDiagramTextEntries(edited.frames[0])[0].text).toBe("After");
  expect(readShapeDiagram(edited.frames[0]).drawing).toBeNull();
  await ui.objects.click();
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await page
    .getByRole("button", { name: "New presentation", exact: true })
    .click();
  await expect(ui.objects).toHaveCount(0);
  await page.keyboard.press("Control+v");
  await expect(ui.objects).toHaveCount(1);
  await checkGeometry();
  const forward = await ui.download();
  expect(P.getShapeDiagramTextEntries(forward.frames[0])[0].text).toBe("After");
  await ui.objects.click();
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await ui.importDeck(edited.bytes);
  await page.keyboard.press("Control+v");
  await expect(ui.objects).toHaveCount(2);
  await ui.objects.last().press("Enter");
  await first.fill("Independent");
  await first.press("Control+Enter");
  await expect(ui.modal).toHaveCount(0);
  await checkGeometry();
  const returned = await ui.download();
  expect(
    returned.frames.map((f) => P.getShapeDiagramTextEntries(f)[0].text),
  ).toEqual(["After", "Independent"]);
  expect(returned.frames.map((f) => readShapeDiagram(f).drawing)).toEqual([
    null,
    null,
  ]);
  expect(readShapeDiagram(returned.frames[0]).data.part.name).not.toBe(
    readShapeDiagram(returned.frames[1]).data.part.name,
  );
  expect(ui.errors).toEqual([]);
});

test("semantic diagram dialog supports cancellation, keyboard, undo and actual clipboard both ways", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { p } = await diagramSpacerDeck(),
    ui = await editor(page, p),
    { objects, modal } = ui;
  await ui.importDeck();
  await objects.dblclick();
  await expect(modal).toBeVisible();
  const first = modal.getByRole("textbox", {
    name: "Item 1 text",
    exact: true,
  });
  await expect(first).toBeFocused();
  await expect(first).toHaveValue("West");
  await first.fill("Cancelled");
  await first.press("Escape");
  await expect(modal).toHaveCount(0);
  await ui.check("West");
  await expect(objects).toBeFocused();
  await objects.press("Enter");
  await expect(first).toHaveValue("West");
  await modal.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await objects.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit diagram text" }).click();
  const a11y = await new AxeBuilder({ page }).include("dialog[open]").analyze();
  expect(a11y.violations).toEqual([]);
  const bounds = await modal.boundingBox(),
    viewport = page.viewportSize();
  expect(bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.height).toBeLessThanOrEqual(viewport.height);
  await first.fill("North 😀");
  await modal
    .getByRole("textbox", { name: "Item 3 text", exact: true })
    .fill("South\n一");
  await first.press("Control+Enter");
  await expect(modal).toHaveCount(0);
  await ui.check("North 😀");
  await expect(objects).toBeFocused();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ui.check("West");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await ui.check("North 😀");
  const assertEdited = ({ frames }, count) => {
    expect(frames).toHaveLength(count);
    for (const frame of frames) {
      expect(P.getShapeDiagramTextEntries(frame).map((e) => e.text)).toEqual([
        "North 😀",
        "Central",
        "South\n一",
      ]);
      expect(readShapeDiagram(frame).drawing).toBeNull();
    }
  };
  const edited = await ui.download();
  assertEdited(edited, 1);
  await objects.click();
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await page
    .getByRole("button", { name: "New presentation", exact: true })
    .click();
  await expect(objects).toHaveCount(0);
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(1);
  await ui.check("North 😀");
  const forward = await ui.download();
  assertEdited(forward, 1);
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await ui.importDeck(forward.bytes);
  await objects.click();
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await ui.importDeck(edited.bytes);
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(2);
  await ui.check("North 😀");
  assertEdited(await ui.download(), 2);
  expect(ui.errors).toEqual([]);
});

test("editing one frame detaches shared diagram data and undo restores both frames", async ({
  page,
}) => {
  const { p, frame } = await diagramSpacerDeck(),
    peer = P.copyShape(P.getSlides(p)[0], frame);
  let sourceId;
  walkElements(frame[SHAPE_ELEMENT], (e) => {
    if (e.name.namespaceURI === NS.diagram && e.name.localName === "relIds")
      sourceId = e.attrs.find((a) => a.name.localName === "dm").value;
  });
  walkElements(peer[SHAPE_ELEMENT], (e) => {
    if (e.name.namespaceURI === NS.diagram && e.name.localName === "relIds")
      e.attrs = e.attrs.map((a) =>
        a.name.localName === "dm" ? { ...a, value: sourceId } : a,
      );
  });
  commitAndRefresh(peer);
  P.setShapeBounds(peer, { ...P.getShapeBounds(peer), y: 120 * 36000 });
  const ui = await editor(page, p);
  await ui.importDeck(undefined, 2);
  await ui.objects.first().click();
  await ui.objects.first().press("Enter");
  await ui.modal
    .getByRole("textbox", { name: "Item 2 text", exact: true })
    .fill("Independent");
  await ui.modal.getByRole("button", { name: "Apply", exact: true }).click();
  await ui.check("Independent");
  let saved = await ui.download();
  expect(P.getShapeDiagramTextEntries(saved.frames[0])[1].text).toBe(
    "Independent",
  );
  expect(P.getShapeDiagramTextEntries(saved.frames[1])[1].text).toBe("Central");
  expect(readShapeDiagram(saved.frames[0]).data.part.name).not.toBe(
    readShapeDiagram(saved.frames[1]).data.part.name,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(ui.svg).not.toContain("Independent");
  saved = await ui.download();
  expect(readShapeDiagram(saved.frames[0]).data.part.name).toBe(
    readShapeDiagram(saved.frames[1]).data.part.name,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await ui.check("Independent");
  expect(ui.errors).toEqual([]);
});

test("unsupported semantic layouts retain their saved drawing and explain unavailable editing", async ({
  page,
}) => {
  const { p, diagram } = await diagramSpacerDeck(),
    decode = (b) => new TextDecoder().decode(b),
    encode = (s) => new TextEncoder().encode(s);
  diagram.layout.part.data = encode(
    decode(diagram.layout.part.data).replace('type="lin"', 'type="cycle"'),
  );
  diagram.data.part.data = encode(
    decode(diagram.data.part.data).replace(
      "</d:dataModel>",
      `<d:extLst><a:ext uri="${NS.diagramDrawing}"><c:dataModelExt xmlns:c="${NS.diagramDrawing}" relId="savedDrawing0"/></a:ext></d:extLst></d:dataModel>`,
    ),
  );
  const original = diagram.data.part.data.slice(),
    ui = await editor(page, p);
  await ui.importDeck();
  await expect.poll(ui.svg).toContain('data-pptx-diagram="saved-layout"');
  await ui.objects.click();
  await ui.objects.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "layout isn’t supported" }),
  ).toContainText("layout isn’t supported for text editing yet");
  await expect(ui.modal).toHaveCount(0);
  const saved = await ui.download();
  expect(readShapeDiagram(saved.frames[0]).drawing).not.toBeNull();
  expect(readShapeDiagram(saved.frames[0]).data.part.data).toEqual(original);
  expect(ui.errors).toEqual([]);
});
