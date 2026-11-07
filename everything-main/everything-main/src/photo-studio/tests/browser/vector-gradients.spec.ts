import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { newDocument, layer } from "../../src/model/document";
import { Assets } from "../../src/model/assets";
import { serialize } from "../../src/model/serialization";
import { boot, type Backend, openFiles, panel, undo } from "./helpers";

for (const backend of ["default", "WebGL"]) {
  test(`native gradient fills ignore stale caches and retain edited PSD/PSB semantics (${backend})`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    await boot(page, backend as Backend, "window.puter={};");
    const result = await page.evaluate(async () => {
      const { writePsdWithPreciseStrokes } =
          await import("/src/model/psd-stroke-writer.ts"),
        { writeHighDepthPsd } = await import("/src/model/psd-high-depth.ts"),
        { readPsdWithPatternResources } =
          await import("/src/model/psd-patterns.ts"),
        { savePsd, openPsd } = await import("/src/model/psd.ts"),
        { serialize, deserialize } =
          await import("/src/model/serialization.ts"),
        { gradientSampler } = await import("/src/model/vector-gradient.ts"),
        { vectorPaintMatrix } = await import("/src/model/vector.ts"),
        { Renderer } = await import("/src/renderer/renderer.ts"),
        { ImageEngine } = await import("/src/engine/engine.ts");
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        ),
        checks = [],
        outputs = [];
      const raw = async (d, a) => {
        await renderer.render(d, a);
        return renderer.rawPixels();
      };
      const difference = (a, b) =>
        a.reduce((r, v, i) => Math.max(r, Math.abs(v - b[i])), 0);
      try {
        for (const depth of [8, 16, 32])
          for (const psb of [false, true])
            for (const style of [
              "linear",
              "radial",
              "angle",
              "reflected",
              "diamond",
            ]) {
              const width = psb ? 64 : 32,
                height = 32,
                bounds = { left: -3, top: 5, right: 17, bottom: 21 };
              const fill = {
                type: "solid",
                name: "Independent Classic",
                style,
                angle: 37,
                scalePercent: 137.375,
                offsetPercent: { x: 12.375, y: -7.25 },
                interpolationSamples: 812.125,
                align: !psb,
                dither: false,
                colorStops: [
                  {
                    location: 0,
                    midpoint: 0.15,
                    colorType: "Clry.UsrS",
                    color: { r: 23.125, g: 71.25, b: 163.5 },
                  },
                  {
                    location: 0.3125,
                    midpoint: 0.25,
                    colorType: "Clry.UsrS",
                    color: { r: 241.5, g: 32.125, b: 44.25 },
                  },
                  {
                    location: 1,
                    midpoint: 0.75,
                    colorType: "Clry.UsrS",
                    color: { r: 211.375, g: 217.625, b: 53.75 },
                  },
                ],
                opacityStops: [
                  { location: 0, midpoint: 0.5, opacityPercent: 13.125 },
                  { location: 0.625, midpoint: 0.3, opacityPercent: 87.375 },
                  { location: 1, midpoint: 0.7, opacityPercent: 52.875 },
                ],
              };
              const pixels = (w, h) => {
                const data =
                    depth === 8
                      ? new Uint8ClampedArray(w * h * 4)
                      : depth === 16
                        ? new Uint16Array(w * h * 4)
                        : new Float32Array(w * h * 4),
                  max = depth === 8 ? 255 : depth === 16 ? 65535 : 1;
                for (let i = 0; i < w * h; i++)
                  data.set([max, 0, max, max], i * 4);
                return { width: w, height: h, data };
              };
              const leaf = {
                name: "Gradient",
                ...bounds,
                opacity: 160 / 255,
                vectorFill: fill,
                vectorMask: {
                  fillStartsWithAllPixels: false,
                  paths: [
                    {
                      open: false,
                      operation: "combine",
                      fillRule: "non-zero",
                      knots: [
                        [-3, 5],
                        [17, 5],
                        [17, 21],
                        [-3, 21],
                      ].map(([x, y]) => ({
                        linked: false,
                        points: [x, y, x, y, x, y],
                      })),
                    },
                  ],
                },
                imageData: pixels(20, 16),
                mask: {
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  defaultColor: 0,
                  userMaskDensity: 192 / 255,
                },
              };
              const input = {
                  width,
                  height,
                  bitsPerChannel: depth,
                  imageData: pixels(width, height),
                  children: [leaf],
                },
                bytes =
                  depth === 8
                    ? writePsdWithPreciseStrokes(input, {
                        psb,
                        noBackground: true,
                      })
                    : writeHighDepthPsd(input, psb),
                loaded = await openPsd(
                  new Blob([bytes]),
                  "Independent.psd",
                  engine,
                );
              let saved;
              try {
                const l = loaded.document.layers[0],
                  before = await raw(loaded.document, loaded.assets);
                const expected = gradientSampler(
                    l.vector.fill,
                    vectorPaintMatrix(l),
                  )(6, 12),
                  index = (12 * width + 6) * 4;
                expected[3] *= (160 / 255) * (1 - 192 / 255);
                const scalarError = Math.max(
                  ...expected.map((v, c) =>
                    Math.abs(
                      before[index + c] -
                        (depth === 8 ? Math.round(v * 255) : v),
                    ),
                  ),
                );
                saved = await deserialize(
                  await serialize(loaded.document, loaded.assets),
                );
                const native = await raw(saved.document, saved.assets),
                  unchanged = await savePsd(
                    saved.document,
                    (d) => raw(d, saved.assets),
                    undefined,
                    (id) => saved.assets.blob(id),
                  );
                const initial = readPsdWithPatternResources(
                  new Uint8Array(await unchanged.arrayBuffer()),
                  { useRawData: true, skipCompositeImageData: true },
                ).children[0];
                const sl = saved.document.layers[0];
                sl.transform.x += 4;
                sl.transform.y -= 3;
                const moved = await raw(saved.document, saved.assets),
                  output = await savePsd(
                    saved.document,
                    (d) => raw(d, saved.assets),
                    undefined,
                    (id) => saved.assets.blob(id),
                  ),
                  outputBytes = new Uint8Array(await output.arrayBuffer());
                const decoded = readPsdWithPatternResources(outputBytes, {
                    useRawData: true,
                    skipCompositeImageData: true,
                  }).children[0],
                  reopened = await openPsd(output, "Reopened.psd", engine);
                try {
                  const after = await raw(reopened.document, reopened.assets);
                  const pick = await renderer.pickCoverage(
                    reopened.document,
                    reopened.assets,
                    reopened.document.layers[0],
                    [],
                    10.5,
                    9.5,
                  );
                  checks.push({
                    depth,
                    psb,
                    style,
                    kind: l.kind,
                    notice: loaded.notice ?? "",
                    frame: l.vector.fill.frame,
                    nativeFill: saved.document.layers[0].vector.fill,
                    sourceFill: l.vector.fill,
                    scalarError,
                    actual: Array.from(before.slice(index, index + 4)),
                    expected,
                    nativeDifference: difference(before, native),
                    exportDifference: difference(moved, after),
                    changed: difference(before, moved) > 0,
                    initialFill: initial.vectorFill,
                    editedFill: decoded.vectorFill,
                    fill,
                    bounds: [
                      decoded.left,
                      decoded.top,
                      decoded.right,
                      decoded.bottom,
                    ],
                    noCache: !decoded.rawData.channels.some(
                      (c) => c.data && c.id !== -2 && c.id !== -3,
                    ),
                    pickError: Math.abs(
                      pick -
                        (depth === 8
                          ? after[(9 * width + 10) * 4 + 3] / 255
                          : after[(9 * width + 10) * 4 + 3]),
                    ),
                  });
                  outputs.push({
                    name: `${depth}-${psb ? "psb" : "psd"}-${style}.psd`,
                    bytes: Array.from(outputBytes),
                  });
                } finally {
                  reopened.assets.clear();
                }
              } finally {
                loaded.assets.clear();
                saved?.assets.clear();
              }
            }
      } finally {
        renderer.dispose();
        engine.dispose();
      }
      return { checks, outputs };
    });
    for (const c of result.checks) {
      expect(c.kind).toBe("vector");
      expect(c.notice).toBe("");
      expect(c.frame).toEqual(
        c.psb
          ? { x: 0, y: 0, width: 64, height: 32 }
          : { x: -3, y: 5, width: 20, height: 16 },
      );
      expect(c.nativeFill).toEqual(c.sourceFill);
      expect(c.initialFill).toEqual(c.fill);
      expect(c.editedFill).toEqual(c.fill);
      expect(c.scalarError, JSON.stringify(c)).toBeLessThanOrEqual(
        c.depth === 8 ? 1 : 2 ** -20,
      );
      expect(c.nativeDifference).toBe(0);
      expect(c.exportDifference).toBe(0);
      expect(c.changed).toBe(true);
      expect(c.bounds).toEqual([1, 2, 21, 18]);
      expect(c.noCache).toBe(true);
      expect(c.pickError).toBeLessThanOrEqual(
        c.depth === 8 ? 1 / 255 : 2 ** -20,
      );
    }
    const directory = `/tmp/photo-editor-native-gradient-exports/${backend}`;
    await mkdir(directory, { recursive: true });
    for (const file of result.outputs)
      await writeFile(`${directory}/${file.name}`, new Uint8Array(file.bytes));
  });
}

for (const backend of ["default", "WebGL"]) {
  test(`gradient opacity combines with strokes, geometry caches and document transforms (${backend})`, async ({
    page,
  }) => {
    await boot(page, backend as Backend, "window.puter={};");
    const result = await page.evaluate(async () => {
      const { newDocument, layer, cropDocument, resizeDocument } =
          await import("/src/model/document.ts"),
        { Assets } = await import("/src/model/assets.ts"),
        { Renderer } = await import("/src/renderer/renderer.ts"),
        { ImageEngine } = await import("/src/engine/engine.ts"),
        { savePsd, openPsd } = await import("/src/model/psd.ts"),
        { gradientSampler } = await import("/src/model/vector-gradient.ts"),
        { vectorPaintMatrix } = await import("/src/model/vector.ts"),
        { serialize, deserialize } =
          await import("/src/model/serialization.ts");
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        ),
        assets = new Assets(),
        doc = newDocument(32, 32),
        l = layer("vector", "HDR gradient", 32, 32);
      doc.bitsPerChannel = 32;
      const fill = {
        type: "solid",
        name: "HDR",
        frame: { x: 4, y: 4, width: 24, height: 24 },
        style: "linear",
        angle: 37,
        interpolationSamples: 0,
        colorStops: [
          {
            location: 0,
            midpoint: 0.5,
            color: { r: 510, g: -127.5, b: 382.5 },
          },
          { location: 1, midpoint: 0.5, color: { r: 255, g: 0, b: 510 } },
        ],
        opacityStops: [
          { location: 0, midpoint: 0.5, opacityPercent: 0 },
          { location: 1, midpoint: 0.5, opacityPercent: 100 },
        ],
      };
      l.vector = {
        reference: { x: 4, y: 4, width: 24, height: 24 },
        psdBounds: { left: 4, top: 4, right: 28, bottom: 28 },
        fill,
        mask: {
          paths: [
            {
              open: false,
              operation: "combine",
              fillRule: "non-zero",
              knots: [
                [4, 4],
                [28, 4],
                [28, 28],
                [4, 28],
              ].map(([x, y]) => ({
                linked: false,
                points: [x, y, x, y, x, y],
              })),
            },
          ],
          fillStartsWithAllPixels: false,
        },
        stroke: {
          enabled: true,
          fillEnabled: true,
          alignment: "inside",
          cap: "butt",
          join: "miter",
          miterLimit: 4,
          lineDashSet: [],
          lineDashOffset: { units: "None", value: 0 },
          resolution: 72,
          lineWidth: { units: "Pixels", value: 2 },
          opacity: 0.375,
          color: { rgb: [0.21, 0.73, 1.61], space: "document" },
        },
      };
      l.transform = { ...l.vector.reference, rotation: 0 };
      doc.layers = [l];
      let calls = 0;
      const original = engine.vectorStroke.bind(engine);
      engine.vectorStroke = (...args) => {
        calls++;
        return original(...args);
      };
      const raw = async (d, a = assets) => {
        await renderer.render(d, a);
        return renderer.rawPixels();
      };
      const difference = (a, b) =>
        a.reduce((r, v, i) => Math.max(r, Math.abs(v - b[i])), 0);
      const compositingDifference = (a, b) => {
        let error = 0;
        for (let i = 0; i < a.length; i += 4) {
          error = Math.max(error, Math.abs(a[i + 3] - b[i + 3]));
          for (let c = 0; c < 3; c++)
            error = Math.max(
              error,
              Math.abs(a[i + c] * a[i + 3] - b[i + c] * b[i + 3]),
            );
        }
        return error;
      };
      try {
        const first = await raw(doc),
          samples = [];
        for (const [x, y, edge] of [
          [5, 12, true],
          [15, 12, false],
        ]) {
          const rgba = gradientSampler(fill, vectorPaintMatrix(l))(x, y),
            alpha = edge ? rgba[3] + 0.375 * (1 - rgba[3]) : rgba[3],
            index = (y * 32 + x) * 4;
          const expected = rgba.slice();
          if (edge)
            for (let c = 0; c < 3; c++)
              expected[c] =
                (rgba[c] * rgba[3] * (1 - 0.375) +
                  l.vector.stroke.color.rgb[c] * 0.375) /
                alpha;
          expected[3] = alpha;
          samples.push(
            Math.max(...expected.map((v, c) => Math.abs(first[index + c] - v))),
          );
        }
        const initialCalls = calls;
        fill.angle = 73;
        await raw(doc);
        const paintReusesGeometry = calls === initialCalls;
        l.pixelMask = {
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          reference: { ...l.transform },
          matrix: [1, 0, 0, 1, 0, 0],
          defaultColor: 0,
          userMaskDensity: 192 / 255,
          positionRelativeToLayer: false,
          fromVectorData: false,
        };
        l.opacity = 160 / 255;
        const before = await raw(doc),
          exported = await savePsd(
            doc,
            (d) => raw(d),
            undefined,
            (id) => assets.blob(id),
          ),
          loaded = await openPsd(exported, "HDR.psd", engine);
        let hdrDifference;
        try {
          hdrDifference = difference(
            before,
            await raw(loaded.document, loaded.assets),
          );
        } finally {
          loaded.assets.clear();
        }
        delete l.vector.stroke;
        delete l.pixelMask;
        l.opacity = 1;
        fill.align = false;
        fill.frame = { x: 0, y: 0, width: 32, height: 32 };
        const uncropped = await raw(doc);
        cropDocument(doc, { x: 3, y: 5, width: 24, height: 24 });
        const cropped = await raw(doc);
        let cropError = 0;
        for (let y = 0; y < 24; y++)
          for (let x = 0; x < 24; x++)
            for (let c = 0; c < 4; c++)
              cropError = Math.max(
                cropError,
                Math.abs(
                  cropped[(y * 24 + x) * 4 + c] -
                    uncropped[((y + 5) * 32 + x + 3) * 4 + c],
                ),
              );
        const cropPsd = await savePsd(
            doc,
            (d) => raw(d),
            undefined,
            (id) => assets.blob(id),
          ),
          cropReopened = await openPsd(cropPsd, "Cropped.psd", engine);
        let cropDifference;
        try {
          cropDifference = compositingDifference(
            cropped,
            await raw(cropReopened.document, cropReopened.assets),
          );
        } finally {
          cropReopened.assets.clear();
        }
        resizeDocument(doc, 48, 36);
        const resized = await raw(doc),
          resizedPsd = await savePsd(
            doc,
            (d) => raw(d),
            undefined,
            (id) => assets.blob(id),
          ),
          resizeReopened = await openPsd(resizedPsd, "Resized.psd", engine);
        let resizeDifference;
        try {
          resizeDifference = compositingDifference(
            resized,
            await raw(resizeReopened.document, resizeReopened.assets),
          );
        } finally {
          resizeReopened.assets.clear();
        }
        fill.style = "radial";
        let error = "",
          renders = 0;
        try {
          await savePsd(
            doc,
            async () => {
              renders++;
              return resized;
            },
            undefined,
            (id) => assets.blob(id),
          );
        } catch (e) {
          error = String(e);
        }
        const native = await deserialize(await serialize(doc, assets));
        let nativeDifference;
        try {
          nativeDifference = difference(
            await raw(doc),
            await raw(native.document, native.assets),
          );
        } finally {
          native.assets.clear();
        }
        return {
          samples,
          paintReusesGeometry,
          hdrDifference,
          cropError,
          cropDifference,
          resizeDifference,
          error,
          renders,
          nativeDifference,
        };
      } finally {
        renderer.dispose();
        engine.dispose();
        assets.clear();
      }
    });
    result.samples.forEach((error) => expect(error).toBeLessThan(2 ** -20));
    expect(result.paintReusesGeometry).toBe(true);
    expect(result.hdrDifference).toBe(0);
    expect(result.cropError).toBe(0);
    // Unlike the exact power-of-two translation cases above, these dimensions
    // require PSD's signed 8.24 path rounding. A rectangle's per-pixel coverage
    // error is bounded by the sum of x/y half-quanta; HDR RGB reaches 2 here.
    // Compare alpha and premultiplied contributions because a new sub-quantum
    // edge sliver legitimately exposes straight RGB at formerly zero alpha.
    expect(result.cropDifference, JSON.stringify(result)).toBeLessThanOrEqual(
      (2 * (24 + 24)) / 2 ** 25 + 2 ** -20,
    );
    expect(result.resizeDifference, JSON.stringify(result)).toBeLessThanOrEqual(
      (2 * (48 + 36)) / 2 ** 25 + 2 ** -20,
    );
    expect(result.error).toContain("cannot represent");
    expect(result.renders).toBe(0);
    expect(result.nativeDifference).toBe(0);
  });
}

test("gradient controls preserve precision, stops, undo and layer locks", async ({
  page,
}) => {
  await boot(page, "default", "window.puter={};");
  const doc = newDocument(37, 29),
    assets = new Assets(),
    l = layer("vector", "Gradient", 37, 29);
  l.vector = {
    reference: { x: 0, y: 0, width: 37, height: 29 },
    mask: { paths: [], fillStartsWithAllPixels: true },
    fill: {
      type: "solid",
      name: "Independent",
      angle: 37.12345678901235,
      frame: { x: 0, y: 0, width: 37, height: 29 },
      colorStops: [
        { location: 0, midpoint: 0.5, color: { r: 0, g: 0, b: 0 } },
        { location: 1, midpoint: 0.5, color: { r: 255, g: 255, b: 255 } },
      ],
      opacityStops: [],
    },
  };
  doc.layers = [l];
  const bundle = await serialize(doc, assets);
  assets.clear();
  await openFiles(page, {
    name: "Gradient.photo",
    mimeType: bundle.type,
    buffer: Buffer.from(await bundle.arrayBuffer()),
  });
  // Layer controls live in the docked Properties panel.
  const props = await panel(page, "Properties");
  await expect(page.locator("#layer-count")).toHaveText("1");
  const angle = props.getByLabel("Gradient angle (°)", { exact: true });
  await expect(angle).toHaveValue("37.12345678901235");
  await angle.fill("-13.987654321012345");
  // Commit by leaving the field (change on blur): committing with Enter keeps the
  // field focused and the vector Properties editor then shows stale values after
  // Undo (see the fixme in vector-patterns).
  await angle.blur();
  await expect(angle).toHaveValue("-13.987654321012345");
  await undo(page);
  await expect(angle).toHaveValue("37.12345678901235");
  await props
    .getByRole("button", { name: "Add color stop", exact: true })
    .click();
  await expect(
    props.getByLabel("Color stop 3 position (%)", { exact: true }),
  ).toHaveValue("50");
  await undo(page);
  await expect(
    props.getByLabel("Color stop 3 position (%)", { exact: true }),
  ).toHaveCount(0);
  await props
    .getByRole("button", { name: "Add opacity stop", exact: true })
    .click();
  await expect(
    props.getByLabel("Opacity stop 1 opacity (%)", { exact: true }),
  ).toHaveValue("100");
  await props
    .getByRole("button", { name: "Remove opacity stop 1", exact: true })
    .click();
  await expect(
    props.getByLabel("Opacity stop 1 opacity (%)", { exact: true }),
  ).toHaveCount(0);
  await props
    .getByLabel("Align gradient with layer", { exact: true })
    .uncheck();
  await undo(page);
  await expect(
    props.getByLabel("Align gradient with layer", { exact: true }),
  ).toBeChecked();
  await props.getByLabel("Lock layer", { exact: true }).check();
  await expect(angle).toBeDisabled();
  await expect(
    props.getByRole("button", { name: "Add color stop", exact: true }),
  ).toBeDisabled();
});
