import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { diagramDeck } from "../tests/diagram-copy-fixture.js";
import { P } from "../src/model.js";
import { NS, parseXml } from "../lib/pptx/src/internal/xml/index.ts";
import { resolveTarget } from "../lib/pptx/src/internal/opc/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";

// The saved SmartArt remains a semantic diagram, including its last layout.
// Rendering it is a separate feature; this test verifies the real clipboard
// and download paths do not delete it or leave its dependencies dangling.
test("SmartArt survives copying across presentations and .pptx download", async ({
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
    name: "Diagrams.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(
      await P.savePresentation(await diagramDeck({ count: 1 })),
    ),
  });
  const objects = page.locator(".object-hit");
  await expect(objects).toHaveCount(1);
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
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const p = await P.loadPresentation(
    await readFile(await (await download).path()),
  );
  const s = P.getSlides(p)[0],
    pkg = P._internalPackageOf(p),
    owner = P.getSlidePartName(s),
    rels = pkg.getRels(owner);
  expect(P.getSlideShapes(s)).toHaveLength(1);
  const dataRel = rels.items.find((r) => r.type === REL_TYPES.diagramData);
  expect(dataRel).toBeDefined();
  const data = pkg.getPart(resolveTarget(owner, dataRel.target));
  const walk = function* (e) {
    yield e;
    for (const c of e.children) if (c.kind === "element") yield* walk(c);
  };
  const ref = [
    ...walk(parseXml(new TextDecoder().decode(data.data)).root),
  ].find(
    (e) =>
      e.name.namespaceURI === NS.diagramDrawing &&
      e.name.localName === "dataModelExt",
  );
  const id = ref.attrs.find((a) => a.name.localName === "relId").value;
  expect(rels.items.find((r) => r.id === id)?.type).toBe(
    REL_TYPES.diagramDrawing,
  );
  const drawing = pkg.getPart(
    resolveTarget(owner, rels.items.find((r) => r.id === id).target),
  );
  expect(new TextDecoder().decode(drawing.data)).toContain("Rendered 0");
  for (const part of pkg.parts) {
    if (part.name.endsWith(".rels")) continue;
    for (const r of pkg.getRels(part.name)?.items ?? [])
      if (r.targetMode === "Internal")
        expect(
          pkg.getPart(resolveTarget(part.name, r.target)),
          `${part.name} ${r.id}`,
        ).not.toBeNull();
  }
});
