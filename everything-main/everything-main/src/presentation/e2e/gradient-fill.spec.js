import { test, expect } from "@playwright/test";

// Ordinary gradients interpolate after premultiplication by alpha.
// Sample the rendered SVG rather than checking its implementation structure.
for (const gradientRendering of ["svg", "css"])
  test(`gradient transparency preserves native color interpolation in ${gradientRendering}`, async ({
    page,
  }) => {
    await page.route("https://js.puter.com/v2/", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
      }),
    );
    await page.goto("/");
    const samples = await page.evaluate(async (gradientRendering) => {
      const { P, createDeck } = await import("/src/model.js"),
        { renderSlideToSvg } = await import("/lib/pptx-preview/src/index.ts");
      const samples = [];
      for (const alphas of [
        [0, 1, 1],
        [0.25, 1, 1],
        [0.5, 1, 1],
        [1, 1, 1],
        [1, 0, 1],
        [0.5, 0, 0.5],
        [0.25, 0.25, 0.25],
      ])
        for (const background of ["#FFFFFF", "#000000"]) {
          const p = createDeck("blank"),
            s = P.getSlides(p)[0];
          P.setSlideBackground(s, background);
          const shape = P.addSlideShape(s, {
            x: P.emu(0),
            y: P.emu(0),
            w: P.emu(300 * 9525),
            h: P.emu(180 * 9525),
            preset: "rect",
          });
          P.setShapeGradientFill(shape, {
            angleDeg: 0,
            stops: [
              { offset: 0, color: "#FF0000", opacity: alphas[0] },
              { offset: 0.5, color: "#00FF00", opacity: alphas[1] },
              { offset: 1, color: "#0000FF", opacity: alphas[2] },
            ],
          });
          const image = new Image();
          image.src =
            "data:image/svg+xml," +
            encodeURIComponent(
              renderSlideToSvg(p, s, { textLayout: "svg", gradientRendering }),
            );
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0, 1280, 720);
          for (const x of [75, 150, 225])
            samples.push({
              alphas,
              background,
              x,
              rgba: [...ctx.getImageData(x, 90, 1, 1).data],
            });
        }
      return samples;
    }, gradientRendering);
    for (const { alphas, background, x, rgba } of samples) {
      // Interpolate premultiplied colors at pixel centers, then composite over
      // the background. A zero-alpha middle stop contributes no hidden color.
      const interval = x < 150 ? 0 : 1,
        t = (x + 0.5 - interval * 150) / 150;
      const a = alphas[interval],
        b = alphas[interval + 1],
        alpha = a * (1 - t) + b * t;
      const bg = background === "#FFFFFF" ? 255 : 0;
      const colors = [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
      ];
      const expected = colors[interval].map(
        (v, c) =>
          v * a * (1 - t) + colors[interval + 1][c] * b * t + bg * (1 - alpha),
      );
      expected.push(255);
      for (let c = 0; c < 4; c++)
        expect(Math.abs(rgba[c] - expected[c])).toBeLessThanOrEqual(3);
    }
  });

test("CSS and SVG gradient paints agree after transforms and effects", async ({
  page,
}) => {
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/");
  const comparisons = await page.evaluate(async () => {
    const { P, createDeck } = await import("/src/model.js"),
      { renderSlideToSvg } = await import("/lib/pptx-preview/src/index.ts");
    const output = [],
      canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    for (const angle of [0, 30, 90, 140, 225, 315])
      for (const scaled of [false, true])
        for (const [w, h] of [
          [300, 180],
          [180, 300],
        ])
          for (const shadow of [false, true]) {
            const p = createDeck("blank"),
              s = P.getSlides(p)[0],
              shape = P.addSlideShape(s, {
                x: P.emu(200 * 9525),
                y: P.emu(150 * 9525),
                w: P.emu(w * 9525),
                h: P.emu(h * 9525),
                preset: "rect",
              });
            P.setSlideBackground(s, "#203040");
            P.setShapeGradientFill(shape, {
              angleDeg: angle,
              scaled,
              stops: [
                { offset: 0, color: "#F02040", opacity: 0.27 },
                { offset: 0.55, color: "#20D060", opacity: 0.81 },
                { offset: 1, color: "#3050E0", opacity: 0.45 },
              ],
            });
            P.setShapeRotation(shape, 23);
            P.setShapeFlip(shape, { horizontal: true });
            P.setShapeStroke(shape, { color: "#102030", widthEmu: 19050 });
            if (shadow)
              P.setShapeShadow(shape, {
                color: "#456789",
                opacity: 0.5,
                blurEmu: 38000,
                offsetEmu: 70000,
              });
            const pixels = [];
            for (const gradientRendering of ["svg", "css"]) {
              const image = new Image();
              image.src =
                "data:image/svg+xml," +
                encodeURIComponent(
                  renderSlideToSvg(p, s, {
                    textLayout: "svg",
                    gradientRendering,
                  }),
                );
              await image.decode();
              context.clearRect(0, 0, 1280, 720);
              context.drawImage(image, 0, 0, 1280, 720);
              const samples = [];
              for (const [u, v] of [
                [0.2, 0.3],
                [0.5, 0.5],
                [0.8, 0.7],
              ]) {
                const x = (0.5 - u) * w,
                  y = (v - 0.5) * h,
                  t = (23 * Math.PI) / 180;
                samples.push([
                  ...context.getImageData(
                    Math.floor(200 + w / 2 + x * Math.cos(t) - y * Math.sin(t)),
                    Math.floor(150 + h / 2 + x * Math.sin(t) + y * Math.cos(t)),
                    1,
                    1,
                  ).data,
                ]);
              }
              pixels.push(samples);
            }
            output.push({ angle, scaled, w, h, shadow, pixels });
          }
    return output;
  });
  for (const row of comparisons)
    for (let point = 0; point < 3; point++)
      for (let channel = 0; channel < 4; channel++)
        expect(
          Math.abs(
            row.pixels[0][point][channel] - row.pixels[1][point][channel],
          ),
          JSON.stringify(row),
        ).toBeLessThanOrEqual(4);
});
