import { test, expect } from "@playwright/test";
import { createGeometryDeck, holeGeometry } from "../tests/geometry-fixture.js";
import { P, parseDeck } from "../src/model.js";

const cases = [
  [
    [0, "#FF0000", 1],
    [1, "#0000FF", 1],
  ],
  [
    [0, "#000000", 1],
    [1, "#FFFFFF", 1],
  ],
  [
    [0, "#FFFFFF", 1],
    [1, "#000000", 1],
  ],
  [
    [0, "#204080", 0.25],
    [1, "#C09030", 0.75],
  ],
  [
    [0, "#FF0000", 0],
    [1, "#0000FF", 1],
  ],
  [
    [0, "#FF0000", 1],
    [1, "#0000FF", 0.2],
  ],
  [
    [0, "#FF0000", 0.5],
    [1, "#0000FF", 0.5],
  ],
  [
    [0, "#204080", 0.25],
    [0.37, "#C09030", 0.75],
    [1, "#204080", 0.25],
  ],
  [
    [0, "#FF0000", 0],
    [0.73, "#0000FF", 1],
    [1, "#FF0000", 0],
  ],
];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Native reference controls establish the gamma exponent and straight-RGB
// interpolation, including hidden RGB at zero alpha and off-center symmetry.
for (const gradientRendering of ["svg", "css"])
  test(`two-stop nonlinear gradient colors in ${gradientRendering}`, async ({
    page,
  }) => {
    await page.route("https://js.puter.com/v2/", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
      }),
    );
    await page.goto("/");
    const samples = await page.evaluate(
      async ({ cases, gradientRendering }) => {
        const { P, createDeck } = await import("/src/model.js"),
          { renderSlideToSvg } = await import("/lib/pptx-preview/src/index.ts");
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d", { willReadFrequently: true }),
          output = [];
        for (let index = 0; index < cases.length; index++)
          for (const background of ["#FFFFFF", "#203040"])
            for (const preset of ["rect", "ellipse", "diamond"])
              for (const angleDeg of [0, 90]) {
                const p = createDeck("blank"),
                  s = P.getSlides(p)[0];
                P.setSlideBackground(s, background);
                const shape = P.addSlideShape(s, {
                  x: P.emu(40 * 9525),
                  y: P.emu(30 * 9525),
                  w: P.emu(300 * 9525),
                  h: P.emu(180 * 9525),
                  preset,
                });
                P.setShapeGradientFill(shape, {
                  angleDeg,
                  stops: cases[index].map(([offset, color, opacity]) => ({
                    offset,
                    color,
                    opacity,
                  })),
                });
                P.setShapeStroke(shape, {
                  color: "#10C030",
                  widthEmu: 4 * 9525,
                });
                const im = new Image();
                im.src =
                  "data:image/svg+xml," +
                  encodeURIComponent(
                    renderSlideToSvg(p, s, {
                      textLayout: "svg",
                      gradientRendering,
                    }),
                  );
                await im.decode();
                ctx.clearRect(0, 0, 1280, 720);
                ctx.drawImage(im, 0, 0, 1280, 720);
                for (const fraction of [0.2, 0.4, 0.6, 0.8]) {
                  const x =
                      40 + (angleDeg === 0 ? Math.floor(fraction * 300) : 150),
                    y =
                      30 + (angleDeg === 90 ? Math.floor(fraction * 180) : 90);
                  output.push({
                    index,
                    background,
                    preset,
                    angleDeg,
                    t:
                      angleDeg === 0
                        ? (x - 40 + 0.5) / 300
                        : (y - 30 + 0.5) / 180,
                    rgba: [...ctx.getImageData(x, y, 1, 1).data],
                  });
                }
                // Stroke stays outside the fill's color transfer.
                if (preset === "rect")
                  output.push({
                    stroke: true,
                    rgba: [...ctx.getImageData(40, 120, 1, 1).data],
                  });
              }
        return output;
      },
      { cases, gradientRendering },
    );
    for (const sample of samples) {
      if (sample.stroke) {
        expect(sample.rgba).toEqual([16, 192, 48, 255]);
        continue;
      }
      const stops = cases[sample.index],
        pair = stops
          .slice(0, -1)
          .findIndex((a, i) => a[0] <= sample.t && sample.t <= stops[i + 1][0]);
      const a = stops[pair],
        b = stops[pair + 1],
        t = (sample.t - a[0]) / (b[0] - a[0]),
        alpha = a[2] * (1 - t) + b[2] * t;
      const first = rgb(a[1]),
        last = rgb(b[1]),
        bg = rgb(sample.background);
      const expected = first.map(
        (c, i) =>
          (c +
            (last[i] - c) *
              (last[i] >= c ? 1 - (1 - t) ** 1.875 : t ** 1.875)) *
            alpha +
          bg[i] * (1 - alpha),
      );
      for (let i = 0; i < 3; i++)
        expect(
          Math.abs(sample.rgba[i] - expected[i]),
          JSON.stringify(sample),
        ).toBeLessThanOrEqual(5);
      expect(sample.rgba[3]).toBe(255);
    }
  });

test("gradient color transfer leaves outlines and opaque shape shadows intact", async ({
  page,
}) => {
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/");
  const differences = await page.evaluate(async () => {
    const { P, createDeck } = await import("/src/model.js"),
      { renderSlideToSvg } = await import("/lib/pptx-preview/src/index.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const output = [];
    for (const preset of ["rect", "ellipse", "diamond"]) {
      const p = createDeck("blank"),
        s = P.getSlides(p)[0],
        shape = P.addSlideShape(s, {
          x: P.emu(200 * 9525),
          y: P.emu(200 * 9525),
          w: P.emu(300 * 9525),
          h: P.emu(180 * 9525),
          preset,
        });
      P.setShapeStroke(shape, { color: "#10C030", widthEmu: 4 * 9525 });
      P.setShapeShadow(shape, {
        color: "#A020C0",
        opacity: 0.75,
        blurEmu: 12 * 9525,
        offsetEmu: 25 * 9525,
      });
      const pixels = [];
      for (const gradient of [false, true]) {
        if (gradient)
          P.setShapeGradientFill(shape, {
            angleDeg: 30,
            stops: [
              { offset: 0, color: "#F02030" },
              { offset: 1, color: "#1020F0" },
            ],
          });
        else P.setShapeFill(shape, "#FFFFFF");
        const im = new Image();
        im.src =
          "data:image/svg+xml," +
          encodeURIComponent(renderSlideToSvg(p, s, { textLayout: "svg" }));
        await im.decode();
        ctx.clearRect(0, 0, 1280, 720);
        ctx.drawImage(im, 0, 0, 1280, 720);
        pixels.push(ctx.getImageData(150, 150, 450, 330).data);
      }
      let max = 0,
        changed = 0;
      for (let y = 0; y < 330; y++)
        for (let x = 0; x < 450; x++) {
          // Beyond the bounds both fills have identical opaque silhouettes.
          if (x >= 46 && x <= 354 && y >= 46 && y <= 234) continue;
          for (let c = 0; c < 4; c++) {
            const i = (y * 450 + x) * 4 + c,
              d = Math.abs(pixels[0][i] - pixels[1][i]);
            max = Math.max(max, d);
            if (d) changed++;
          }
        }
      output.push({ preset, max, changed });
    }
    return output;
  });
  for (const d of differences)
    expect(d.max, JSON.stringify(d)).toBeLessThanOrEqual(1);
});

test("nonlinear fills preserve custom geometry holes and their outlines", async ({
  page,
}) => {
  const p = await parseDeck(
    await createGeometryDeck({
      geometry: holeGeometry,
      level: "local",
      shapeKind: "shape",
      bounds: {
        x: P.emu(40 * 9525),
        y: P.emu(30 * 9525),
        w: P.emu(300 * 9525),
        h: P.emu(180 * 9525),
      },
    }),
  );
  const s = P.getSlides(p)[0],
    shape = P.getSlideShapes(s).find(
      (shape) => P.getShapeGeometryEffective(p, shape)?.kind === "custom",
    );
  P.setSlideBackground(s, "#203040");
  P.setShapeGradientFill(shape, {
    angleDeg: 0,
    stops: [
      { offset: 0, color: "#FF0000", opacity: 0.2 },
      { offset: 1, color: "#0000FF", opacity: 0.8 },
    ],
  });
  P.setShapeStroke(shape, { color: "#10C030", widthEmu: 4 * 9525 });
  const bytes = Buffer.from(await P.savePresentation(p)).toString("base64");
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/");
  const samples = await page.evaluate(async (bytes) => {
    const { P, parseDeck } = await import("/src/model.js"),
      { renderSlideToSvg } = await import("/lib/pptx-preview/src/index.ts");
    const p = await parseDeck(
        Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)),
      ),
      im = new Image();
    im.src =
      "data:image/svg+xml," +
      encodeURIComponent(
        renderSlideToSvg(p, P.getSlides(p)[0], { textLayout: "svg" }),
      );
    await im.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(im, 0, 0, 1280, 720);
    return [70, 310, 190, 40, 115].map((x) => ({
      x,
      pixel: [...ctx.getImageData(x, 120, 1, 1).data],
    }));
  }, bytes);
  expect(samples[2].pixel).toEqual([32, 48, 64, 255]);
  expect(samples[3].pixel).toEqual([16, 192, 48, 255]);
  expect(samples[4].pixel).toEqual([16, 192, 48, 255]);
  for (const { x, pixel } of samples.slice(0, 2)) {
    const t = (x - 40 + 0.5) / 300,
      alpha = 0.2 + 0.6 * t;
    const expected = [
      255 * (1 - t ** 1.875) * alpha + 32 * (1 - alpha),
      48 * (1 - alpha),
      255 * (1 - (1 - t) ** 1.875) * alpha + 64 * (1 - alpha),
      255,
    ];
    for (let i = 0; i < 4; i++)
      expect(Math.abs(pixel[i] - expected[i])).toBeLessThanOrEqual(5);
  }
});
