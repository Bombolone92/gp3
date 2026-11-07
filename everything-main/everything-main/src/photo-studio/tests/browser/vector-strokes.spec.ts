import { test, expect } from "@playwright/test";
import { newDocument, layer } from "../../src/model/document";
import { boot, openProject, panel, undo } from "./helpers";

test.beforeEach(async ({ page }) => {
  await boot(page, "default", "window.puter={};");
});

test("unsupported stroke descriptors produce an explicit compatibility notice", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { writePsd } = await import("/tests/browser/psd-codec.ts");
    const { openPsd } = await import("/src/model/psd.ts");
    const { ImageEngine } = await import("/src/engine/engine.ts");
    const engine = new ImageEngine(),
      results = [];
    try {
      for (const extra of [
        {},
        { blendMode: "multiply" },
        {
          lineDashSet: [
            { value: 4, units: "None" },
            { value: 2, units: "None" },
          ],
        },
      ]) {
        const width = 19,
          height = 13,
          data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4)
          data.set([37, 149, 211, 255], i);
        const bytes = writePsd(
          {
            width,
            height,
            imageData: { width, height, data },
            children: [
              {
                name: "Unsupported stroke",
                vectorStroke: {
                  strokeEnabled: true,
                  fillEnabled: false,
                  lineWidth: { value: 2, units: "Pixels" },
                  ...extra,
                } as any,
              },
            ],
          },
          { noBackground: true },
        );
        const loaded = await openPsd(
          new Blob([bytes]),
          "Unsupported.psd",
          engine,
        );
        try {
          results.push({
            notice: loaded.notice,
            kind: loaded.document.layers[0].kind,
            count: loaded.document.layers.length,
          });
        } finally {
          loaded.assets.clear();
        }
      }
      return results;
    } finally {
      engine.dispose();
    }
  });
  for (const result of results) {
    expect(result.notice).toContain("unsupported");
    expect(result.kind).toBe("image");
    expect(result.count).toBe(1);
  }
});

for (const backend of ["default", "WebGL"])
  test(`stroke paint, editing, picking and PSD/PSB input round trips (${backend})`, async ({
    page,
  }) => {
    if (backend === "WebGL") {
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "gpu", { value: undefined }),
      );
      await page.reload();
      await expect(page.locator("#engine-status")).toHaveText("WebGL2");
    }
    const results = await page.evaluate(async () => {
      const { writePsd, readPsd } = await import("/tests/browser/psd-codec.ts");
      const { openPsd, savePsd } = await import("/src/model/psd.ts");
      const { serialize, deserialize } =
        await import("/src/model/serialization.ts");
      const { ImageEngine } = await import("/src/engine/engine.ts");
      const { Renderer } = await import("/src/renderer/renderer.ts");
      const { hitLayer } = await import("/src/ui/hit-test.ts");
      const { setVectorColor, vectorHexColor } =
        await import("/src/color/vector.ts");
      const { History } = await import("/src/history/history.ts");
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        ),
        results = [];
      let geometryCalls = 0;
      const raster = engine.vectorStroke.bind(engine);
      engine.vectorStroke = (...args) => {
        geometryCalls++;
        return raster(...args);
      };
      try {
        for (const depth of [8, 16, 32] as const)
          for (const psb of [false, true]) {
            const width = depth === 8 ? 37 : 53,
              height = psb ? 39 : 31,
              box = [4.25, 3.375, 23.5, 22.125];
            const mask = {
              paths: [
                {
                  open: false,
                  operation: "combine" as const,
                  fillRule: "non-zero" as const,
                  knots: [
                    [box[0], box[1]],
                    [box[2], box[1]],
                    [box[2], box[3]],
                    [box[0], box[3]],
                  ].map(([x, y]) => ({
                    linked: false,
                    points: [x, y, x, y, x, y],
                  })),
                },
              ],
            };
            const fill = depth === 32 ? [-0.125, 2.25, 0.4] : [0.2, 0.6, 0.9],
              ink = depth === 32 ? [3, 0.12, -0.2] : [0.9, 0.1, 0.35],
              opacity = 0.375;
            const style = {
              strokeEnabled: true,
              fillEnabled: true,
              lineWidth: { value: 0.72, units: "Points" as const },
              lineDashOffset: { value: -2.125, units: "Points" as const },
              resolution: 150,
              lineAlignment: "center" as const,
              lineCapType: "square" as const,
              lineJoinType: "miter" as const,
              miterLimit: 5.25,
              opacity,
              scaleLock: false,
              strokeAdjust: false,
              lineDashSet: [],
              blendMode: "normal" as const,
              content: {
                type: "color" as const,
                color: { r: ink[0] * 255, g: ink[1] * 255, b: ink[2] * 255 },
              },
            };
            const input = writePsd(
              {
                width,
                height,
                children: [
                  {
                    name: "Editable stroke",
                    vectorFill: {
                      type: "color",
                      color: {
                        r: fill[0] * 255,
                        g: fill[1] * 255,
                        b: fill[2] * 255,
                      },
                    },
                    vectorMask: mask,
                    vectorStroke: style,
                  },
                ],
                imageData: {
                  width,
                  height,
                  data: new Uint8ClampedArray(width * height * 4),
                },
              },
              { psb, noBackground: true },
            );
            const loaded = await openPsd(
              new Blob([input]),
              "Shape.psd",
              engine,
            );
            loaded.document.bitsPerChannel = depth;
            let project: Awaited<ReturnType<typeof deserialize>> | undefined,
              reopened: Awaited<ReturnType<typeof openPsd>> | undefined;
            try {
              const l = loaded.document.layers[0];
              await renderer.render(loaded.document, loaded.assets);
              const encoded = readPsd(input, {
                  skipLayerImageData: true,
                  skipCompositeImageData: true,
                }).children![0],
                anchors = encoded.vectorMask!.paths[0].knots,
                // PSD signed 8.24 coordinates are decoded before Skia's float32
                // geometry boundary. Preserve these fractions in the oracle too.
                sourceBox = [
                  ...anchors[0].points.slice(2, 4),
                  ...anchors[2].points.slice(2, 4),
                ].map(Math.fround),
                pixels = await renderer.rawPixels(),
                f = fill.map((v) =>
                  depth === 8 ? Math.round(v * 255) / 255 : v,
                ),
                s = ink.map((v) =>
                  depth === 8 ? Math.round(v * 255) / 255 : v,
                ),
                encodedOpacity = encoded.vectorStroke!.opacity!;
              const area = (x: number, y: number, b: number[]) =>
                Math.max(0, Math.min(x + 1, b[2]) - Math.max(x, b[0])) *
                Math.max(0, Math.min(y + 1, b[3]) - Math.max(y, b[1]));
              const outer = sourceBox.map((v, i) => v + (i < 2 ? -0.75 : 0.75)),
                inner = sourceBox.map((v, i) => v + (i < 2 ? 0.75 : -0.75));
              let error = 0;
              for (let y = 0; y < height; y++)
                for (let x = 0; x < width; x++) {
                  const i = (y * width + x) * 4,
                    F = area(x, y, sourceBox),
                    S = area(x, y, outer) - area(x, y, inner),
                    I = F - area(x, y, inner),
                    a = F + encodedOpacity * (S - I);
                  const expected = [
                    ...f.map((v, c) =>
                      a
                        ? (v * (F - encodedOpacity * I) +
                            s[c] * encodedOpacity * S) /
                          a
                        : 0,
                    ),
                    a,
                  ];
                  for (let c = 0; c < 4; c++) {
                    const value =
                      depth === 8
                        ? Math.round(
                            Math.max(0, Math.min(1, expected[c])) * 255,
                          )
                        : expected[c];
                    if (c === 3 || a)
                      error = Math.max(error, Math.abs(pixels[i + c] - value));
                  }
                }
              const calls = geometryCalls,
                before = structuredClone(l.vector!);
              const history = new History(loaded.document);
              history.execute("Stroke color", (d) => {
                d.layers[0].vector!.stroke!.color = vectorHexColor("#ab31d0");
              });
              history.undo();
              const undo =
                JSON.stringify(history.document.layers[0].vector) ===
                JSON.stringify(before);
              setVectorColor(l, "#35b98a");
              l.vector!.stroke!.color = vectorHexColor("#ce7643");
              l.vector!.stroke!.opacity = 0.625;
              await renderer.render(loaded.document, loaded.assets);
              const colorReusesGeometry = geometryCalls === calls;
              l.vector!.stroke!.fillEnabled = false;
              await renderer.render(loaded.document, loaded.assets);
              const reader = (
                item: any,
                parents: any[],
                x: number,
                y: number,
              ) =>
                renderer.pickCoverage(
                  loaded.document,
                  loaded.assets,
                  item,
                  parents,
                  x,
                  y,
                );
              const center = await hitLayer(
                loaded.document,
                loaded.assets,
                12,
                12,
                reader,
              );
              const edge = await hitLayer(
                loaded.document,
                loaded.assets,
                3.875,
                10,
                reader,
              );
              const missed = await hitLayer(
                loaded.document,
                loaded.assets,
                2.5,
                10,
                reader,
              );
              l.transform = {
                x: -2.125,
                y: 6.375,
                width: l.transform.width * 1.35,
                height: l.transform.height * 0.8,
                rotation: 17,
              };
              await renderer.render(loaded.document, loaded.assets);
              const edited = await renderer.rawPixels();
              project = await deserialize(
                await serialize(loaded.document, loaded.assets),
              );
              await renderer.render(project.document, project.assets);
              const native = await renderer.rawPixels();
              const saved = await savePsd(
                project.document,
                async (d) => {
                  await renderer.render(d, project!.assets);
                  return renderer.rawPixels();
                },
                undefined,
                (id) => project!.assets.blob(id),
              );
              const decoded = readPsd(await saved.arrayBuffer(), {
                useRawData: true,
                skipThumbnail: true,
              });
              reopened = await openPsd(saved, "Reopened.psd", engine);
              await renderer.render(reopened.document, reopened.assets);
              const output = await renderer.rawPixels();
              let difference = 0,
                worst = { i: 0, old: 0, new: 0, oldAlpha: 0, newAlpha: 0 };
              for (let i = 0; i < edited.length; i++)
                if (
                  i % 4 === 3 ||
                  edited[i - (i % 4) + 3] ||
                  output[i - (i % 4) + 3]
                ) {
                  const delta = Math.abs(output[i] - edited[i]);
                  if (delta > difference) {
                    difference = delta;
                    worst = {
                      i,
                      old: edited[i],
                      new: output[i],
                      oldAlpha: edited[i - (i % 4) + 3],
                      newAlpha: output[i - (i % 4) + 3],
                    };
                  }
                }
              results.push({
                depth,
                psb,
                error,
                notice: loaded.notice,
                kind: l.kind,
                undo,
                colorReusesGeometry,
                picking: !center && edge?.id === l.id && !missed,
                nativeExact: native.every((v, i) => v === edited[i]),
                difference,
                worst,
                nativeStroke:
                  JSON.stringify(project.document.layers[0].vector!.stroke) ===
                  JSON.stringify(l.vector!.stroke),
                descriptor: decoded.children![0].vectorStroke,
                reopenedKind: reopened.document.layers[0].kind,
              });
            } finally {
              loaded.assets.clear();
              project?.assets.clear();
              reopened?.assets.clear();
            }
          }
        return results;
      } finally {
        renderer.dispose();
        engine.dispose();
      }
    });
    for (const r of results) {
      expect(r.notice).toBe("");
      expect(r.kind).toBe("vector");
      expect(r.reopenedKind).toBe("vector");
      expect(r.error, `${r.depth}/${r.psb}`).toBeLessThanOrEqual(
        r.depth === 8 ? 1 : 1e-6,
      );
      expect(r.difference, JSON.stringify(results)).toBeLessThanOrEqual(
        r.depth === 8 ? 1 : 1e-4,
      );
      expect(
        r.undo &&
          r.colorReusesGeometry &&
          r.picking &&
          r.nativeExact &&
          r.nativeStroke,
      ).toBe(true);
      expect(r.descriptor).toMatchObject({
        strokeEnabled: true,
        fillEnabled: false,
        lineWidth: { value: 0.72, units: "Points" },
        lineDashOffset: { value: -2.125, units: "Points" },
        resolution: 150,
        lineAlignment: "center",
        lineCapType: "square",
        lineJoinType: "miter",
        miterLimit: 5.25,
        opacity: 0.625,
      });
    }
  });

test("stroke properties change editable paint and geometry with undo", async ({
  page,
}) => {
  const doc = newDocument(80, 60, "Stroke controls"),
    l = layer("vector", "Shape", 80, 60);
  const box = { x: 12, y: 10, width: 50, height: 35 };
  l.vector = {
    reference: box,
    fill: { rgb: [0.3, 0.7, 0.1], space: "srgb" },
    mask: {
      paths: [
        {
          open: false,
          operation: "combine",
          fillRule: "non-zero",
          knots: [
            [12, 10],
            [62, 10],
            [62, 45],
            [12, 45],
          ].map(([x, y]) => ({ linked: false, points: [x, y, x, y, x, y] })),
        },
      ],
    },
  };
  l.transform = { ...box, rotation: 0 };
  doc.layers = [l];
  await openProject(page, doc, [], "Stroke.photo");
  await expect(page.locator("#layer-count")).toHaveText("1");
  // Vector stroke controls live in the docked Properties panel.
  const props = await panel(page, "Properties");
  await props.getByLabel("Show stroke").check();
  const width = props.getByLabel("Stroke width (pixels)", { exact: true });
  await expect(width).toHaveValue("1");
  await width.fill("3.5");
  // Commit by leaving the field (change on blur): committing with Enter keeps the
  // field focused and the vector Properties editor then shows stale values after
  // Undo (see the fixme in vector-patterns).
  await width.blur();
  await expect(width).toHaveValue("3.5");
  await undo(page);
  await expect(width).toHaveValue("1");
  await props
    .getByLabel("Stroke alignment", { exact: true })
    .selectOption("outside");
  await props.getByLabel("Stroke cap", { exact: true }).selectOption("round");
  await props.getByLabel("Stroke join", { exact: true }).selectOption("bevel");
  await props.getByLabel("Show fill").uncheck();
  await expect(props.getByLabel("Show fill")).not.toBeChecked();
  const dashes = props.getByLabel("Dash and gap lengths (pixels)", {
    exact: true,
  });
  await dashes.fill("4, 2, 3");
  await dashes.blur();
  await expect(dashes).toHaveValue("4, 2, 3");
  await undo(page);
  await expect(dashes).toHaveValue("");
  const offset = props.getByLabel("Dash offset (points)", { exact: true });
  await offset.fill("-1.125");
  await offset.blur();
  await expect(offset).toHaveValue("-1.125");
  await undo(page);
  await expect(offset).toHaveValue("0");
  await props.getByLabel("Show stroke").uncheck();
  await expect(props.getByLabel("Show stroke")).not.toBeChecked();
});

test("open path controls create center strokes and keep unsupported compound strokes disabled", async ({
  page,
}) => {
  for (const compound of [false, true]) {
    const doc = newDocument(80, 60, "Open paths"),
      l = layer("vector", compound ? "Compound" : "Single", 80, 60);
    const reference = { x: 10, y: 12, width: 30, height: 28 },
      contour = {
        open: true,
        operation: "combine" as const,
        fillRule: "non-zero" as const,
        knots: [
          [10, 12],
          [40, 40],
        ].map(([x, y]) => ({ linked: false, points: [x, y, x, y, x, y] })),
      };
    l.vector = {
      reference,
      mask: {
        paths: compound ? [contour, structuredClone(contour)] : [contour],
      },
      fill: { rgb: [0.3, 0.7, 0.1], space: "srgb" },
    };
    if (compound)
      l.vector.stroke = {
        enabled: false,
        fillEnabled: true,
        lineWidth: { value: 1, units: "Pixels" },
        lineDashOffset: { value: 0, units: "Points" },
        resolution: 72,
        cap: "butt",
        join: "miter",
        alignment: "center",
        miterLimit: 100,
        opacity: 1,
        color: { rgb: [0, 0, 0], space: "srgb" },
      };
    l.transform = { ...reference, rotation: 0 };
    doc.layers = [l];
    // The workspace opens each project in its own document tab, so the second
    // file no longer asks to replace the first.
    await openProject(
      page,
      doc,
      [],
      compound ? "Compound.photo" : "Single.photo",
    );
    const props = await panel(page, "Properties");
    await expect(props.getByLabel("Layer name", { exact: true })).toHaveValue(
      l.name,
    );
    if (compound) {
      await expect(props.getByLabel("Show stroke")).toBeDisabled();
      const input = props.getByLabel("Dash and gap lengths (pixels)", {
        exact: true,
      });
      await input.fill("4, 2");
      await input.press("Enter");
      expect(
        await input.evaluate((e: HTMLInputElement) => e.validationMessage),
      ).toContain("single combined path");
      await input.fill("");
      await input.press("Enter");
      await expect(props.getByLabel("Show stroke")).toBeDisabled();
    } else {
      await props.getByLabel("Show stroke").check();
      await expect(
        props.getByLabel("Stroke width (pixels)", { exact: true }),
      ).toHaveValue("1");
      await expect(
        props.getByLabel("Stroke alignment", { exact: true }),
      ).toHaveCount(0);
      await props
        .getByLabel("Stroke cap", { exact: true })
        .selectOption("round");
      await expect(props.getByLabel("Stroke cap", { exact: true })).toHaveValue(
        "round",
      );
    }
  }
});

test("solid stroke geometry has exact fractional alignment, winding overlaps and no viewport outline", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { ImageEngine } = await import("/src/engine/engine.ts");
    const engine = new ImageEngine();
    const rect = (
      x: number,
      y: number,
      w: number,
      h: number,
      operation = "combine",
    ) => ({
      open: false,
      operation,
      fillRule: "even-odd",
      knots: [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ].map(([a, b]) => ({ linked: false, points: [a, b, a, b, a, b] })),
    });
    const style = {
      enabled: true,
      fillEnabled: true,
      lineWidth: { value: 1.5, units: "Pixels" },
      lineDashOffset: { value: 0, units: "Points" },
      resolution: 300,
      cap: "butt",
      join: "miter",
      alignment: "center",
      miterLimit: 4,
      opacity: 0.4,
      color: { rgb: [0, 1, 0], space: "document" },
    };
    const viewport = { x: 0, y: 0, width: 23, height: 19 };
    const area = (x: number, y: number, box: number[]) =>
      Math.max(0, Math.min(x + 1, box[2]) - Math.max(x, box[0])) *
      Math.max(0, Math.min(y + 1, box[3]) - Math.max(y, box[1]));
    const results = [];
    try {
      const box = [3.25, 2.375, 16.125, 14.75];
      for (const alignment of ["inside", "center", "outside"]) {
        const s = { ...style, alignment };
        const mask = {
          paths: [rect(box[0], box[1], box[2] - box[0], box[3] - box[1])],
        };
        const before = JSON.stringify(mask);
        const r = await engine.vectorStroke(
          mask as any,
          viewport,
          [1, 0, 0, 1, 0, 0],
          s as any,
        );
        const outer =
          alignment === "inside"
            ? box
            : box.map(
                (v, i) =>
                  v + (i < 2 ? -1 : 1) * (alignment === "center" ? 0.75 : 1.5),
              );
        const inner =
          alignment === "outside"
            ? box
            : box.map(
                (v, i) =>
                  v + (i < 2 ? 1 : -1) * (alignment === "center" ? 0.75 : 1.5),
              );
        let error = 0;
        for (let y = 0; y < viewport.height; y++)
          for (let x = 0; x < viewport.width; x++) {
            const i = y * viewport.width + x,
              f = area(x, y, box),
              edge = area(x, y, outer) - area(x, y, inner);
            const overlap = alignment === "outside" ? 0 : f - area(x, y, inner);
            error = Math.max(
              error,
              Math.abs(r.coverage[i] - f),
              Math.abs(r.strokeCoverage[i] - edge),
              Math.abs(r.overlapCoverage[i] - overlap),
            );
          }
        results.push({
          alignment,
          error,
          unchanged: before === JSON.stringify(mask),
        });
      }
      // Thick inside outlines cover a thin shape rather than cancelling when
      // offset contours overlap. Subtraction outlines include the hole edge.
      const thick = await engine.vectorStroke(
        { paths: [rect(5, 5, 1.25, 7)] } as any,
        viewport,
        [1, 0, 0, 1, 0, 0],
        {
          ...style,
          alignment: "inside",
          lineWidth: { value: 8, units: "Pixels" },
        } as any,
      );
      results.push({
        thickDifference: Math.max(
          ...thick.coverage.map((v, i) =>
            Math.abs(v - thick.strokeCoverage[i]),
          ),
        ),
      });
      const mask = {
        paths: [rect(2, 2, 16, 13), rect(6, 5, 6, 5, "subtract")],
      };
      const ring = await engine.vectorStroke(
        mask as any,
        viewport,
        [1, 0, 0, 1, 0, 0],
        {
          ...style,
          alignment: "inside",
          lineWidth: { value: 1, units: "Pixels" },
        } as any,
      );
      results.push({
        holeInside: ring.strokeCoverage[6 * 23 + 6],
        holeEdge: ring.strokeCoverage[6 * 23 + 5],
        outerEdge: ring.strokeCoverage[3 * 23 + 2],
      });
      const inverted = await engine.vectorStroke(
        { paths: [rect(6, 5, 6, 5)], invert: true } as any,
        viewport,
        [1, 0, 0, 1, 0, 0],
        {
          ...style,
          alignment: "inside",
          lineWidth: { value: 1, units: "Pixels" },
        } as any,
      );
      const cropped = await engine.vectorStroke(
        { paths: [rect(6, 5, 6, 5)], invert: true } as any,
        { x: 4, y: 3, width: 12, height: 11 },
        [1, 0, 0, 1, 0, 0],
        {
          ...style,
          alignment: "inside",
          lineWidth: { value: 1, units: "Pixels" },
        } as any,
      );
      let cropError = 0;
      for (let y = 0; y < 11; y++)
        for (let x = 0; x < 12; x++)
          cropError = Math.max(
            cropError,
            Math.abs(
              cropped.strokeCoverage[y * 12 + x] -
                inverted.strokeCoverage[(y + 3) * 23 + x + 4],
            ),
          );
      results.push({
        viewportEdge: inverted.strokeCoverage[0],
        holeEdge: inverted.strokeCoverage[6 * 23 + 5],
        cropError,
      });
      const empty = await engine.vectorStroke(
        { paths: [], fillStartsWithAllPixels: true },
        viewport,
        [1, 0, 0, 1, 0, 0],
        style as any,
      );
      const zero = await engine.vectorStroke(
        { paths: [rect(3, 3, 8, 7)] } as any,
        viewport,
        [1, 0, 0, 1, 0, 0],
        { ...style, lineWidth: { value: 0, units: "Pixels" } } as any,
      );
      results.push({
        emptyStroke: empty.strokeCoverage.every((v) => v === 0),
        zeroStroke: zero.strokeCoverage.every((v) => v === 0),
      });
      return results;
    } finally {
      engine.dispose();
    }
  });
  for (const r of results.slice(0, 3)) {
    expect(r.error).toBeLessThan(1e-6);
    expect(r.unchanged).toBe(true);
  }
  expect(results[3].thickDifference).toBeLessThan(1e-6);
  expect(results[4]).toEqual({ holeInside: 0, holeEdge: 1, outerEdge: 1 });
  expect(results[5]).toEqual({ viewportEdge: 0, holeEdge: 1, cropError: 0 });
  expect(results[6]).toEqual({ emptyStroke: true, zeroStroke: true });
});

test("open cubic strokes preserve caps, joins and their real endpoints", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { ImageEngine } = await import("/src/engine/engine.ts");
    const engine = new ImageEngine(),
      viewport = { x: 0, y: 0, width: 25, height: 21 },
      results = [];
    const mask = {
      paths: [
        {
          operation: "combine",
          fillRule: "non-zero",
          open: true,
          knots: [
            { linked: false, points: [3.375, 13.25, 3.375, 13.25, 5.5, -2.5] },
            { linked: false, points: [16.25, 1.5, 20.5, 10.375, 20.5, 10.375] },
            { linked: false, points: [14.5, 17.25, 14.5, 17.25, 14.5, 17.25] },
          ],
        },
      ],
    };
    try {
      for (const cap of ["butt", "square", "round"])
        for (const join of ["miter", "bevel", "round"]) {
          const r = await engine.vectorStroke(
            mask as any,
            viewport,
            [1, 0, 0, 1, 0, 0],
            {
              enabled: true,
              fillEnabled: false,
              lineWidth: { value: 2.75, units: "Pixels" },
              lineDashOffset: { value: 0, units: "Points" },
              resolution: 72,
              cap,
              join,
              alignment: "center",
              miterLimit: 3,
              opacity: 1,
              color: { rgb: [1, 0, 0], space: "document" },
            } as any,
          );
          const scale = 128,
            canvas = document.createElement("canvas");
          canvas.width = 25 * scale;
          canvas.height = 21 * scale;
          const c = canvas.getContext("2d", { willReadFrequently: true })!;
          c.scale(scale, scale);
          c.lineWidth = 2.75;
          c.lineCap = (cap === "square" ? "butt" : cap) as CanvasLineCap;
          c.lineJoin = join as CanvasLineJoin;
          c.miterLimit = 3;
          c.beginPath();
          c.moveTo(3.375, 13.25);
          c.bezierCurveTo(5.5, -2.5, 16.25, 1.5, 20.5, 10.375);
          c.lineTo(14.5, 17.25);
          c.stroke();
          if (cap === "square") {
            // Analytic tangent rectangles avoid the native square-cap bug on
            // mixed curve/line paths. These are the specified square cap regions.
            const square = (x: number, y: number, dx: number, dy: number) => {
              const factor = 2.75 / 2 / Math.hypot(dx, dy);
              dx *= factor;
              dy *= factor;
              c.beginPath();
              c.moveTo(x - dy, y + dx);
              c.lineTo(x + dy, y - dx);
              c.lineTo(x + dy + dx, y - dx + dy);
              c.lineTo(x - dy + dx, y + dx + dy);
              c.closePath();
              c.fill();
            };
            square(3.375, 13.25, 3.375 - 5.5, 13.25 + 2.5);
            square(14.5, 17.25, 14.5 - 20.5, 17.25 - 10.375);
          }
          const pixels = c.getImageData(0, 0, canvas.width, canvas.height).data;
          let error = 0;
          let worst = { x: 0, y: 0, actual: 0, reference: 0 };
          for (let y = 0; y < 21; y++)
            for (let x = 0; x < 25; x++) {
              let sum = 0;
              for (let dy = 0; dy < scale; dy++)
                for (let dx = 0; dx < scale; dx++)
                  sum +=
                    pixels[
                      ((y * scale + dy) * canvas.width + x * scale + dx) * 4 + 3
                    ];
              const reference = sum / (255 * scale * scale),
                delta = Math.abs(r.strokeCoverage[y * 25 + x] - reference);
              if (delta > error) {
                error = delta;
                worst = {
                  x,
                  y,
                  actual: r.strokeCoverage[y * 25 + x],
                  reference,
                };
              }
            }
          results.push({
            cap,
            join,
            error,
            worst,
            fillDisabled: r.coverage.every((v) => v === 0),
            noOverlap: r.overlapCoverage.every((v) => v === 0),
          });
        }
      return results;
    } finally {
      engine.dispose();
    }
  });
  for (const r of results) {
    expect(r.error, JSON.stringify(results)).toBeLessThan(0.012);
    expect(r.fillDisabled).toBe(true);
    expect(r.noOverlap).toBe(true);
  }
});
