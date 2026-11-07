import { test, expect } from "@playwright/test";

// Multi-stop controls use native premultiplied sRGB interpolation, independently
// of the special two-color power transfer. Exercise image and editor paints.
for (const gradientRendering of ["svg", "css"])
  test(`reflected gradient tiles preserve multi-stop alpha in ${gradientRendering}`, async ({
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
        { renderSlideToSvg } = await import("/lib/pptx-preview/src/index.ts"),
        lists = [
          [
            [0, "#8F2D73", 1],
            [1, "#16827C", 1],
          ],
          [
            [0, "#8F2D73", 0.2],
            [1, "#16827C", 0.8],
          ],
          [
            [0, "#8F2D73", 0.2],
            [0.4, "#D9B744", 0.8],
            [1, "#16827C", 0.5],
          ],
          [
            [0, "#371B96", 0.35],
            [0.25, "#E48F23", 0],
            [0.32, "#18A46D", 0.75],
            [0.62, "#C41B68", 0.5],
            [1, "#47B2D9", 0],
          ],
          [
            [0, "#C02040", 1],
            [0.49998, "#C02040", 1],
            [0.50002, "#2050C0", 1],
            [1, "#2050C0", 1],
          ],
          [
            [0, "#371B96", 0.5],
            [0.25, "#E48F23", 0.5],
            [0.75, "#18A46D", 0.5],
            [1, "#C41B68", 0.5],
          ],
        ],
        tile = { left: 0.15, top: 0.2, right: 0.45, bottom: 0.35 },
        configurations = [
          { angleDeg: 0, scaled: false },
          { angleDeg: 45, scaled: true },
          { tileRect: tile, angleDeg: 0, scaled: false },
          { tileRect: tile, angleDeg: 45, scaled: false },
          { tileRect: tile, angleDeg: 45, scaled: true },
          {
            tileRect: { left: -0.25, top: -0.4, right: 0.1, bottom: 0.15 },
            angleDeg: 90,
            scaled: false,
          },
          { tileRect: { left: 0.7, right: 0.6 }, angleDeg: 135, scaled: true },
          // A large outset makes minimum-unit stop spacing visibly resolvable
          // without depending on a browser's subpixel edge rasterization.
          {
            tileRect: { left: -4999.5, right: -4999.5 },
            angleDeg: 0,
            scaled: false,
          },
          {
            tileRect: { left: -0.5, right: -0.5 },
            angleDeg: 0,
            scaled: false,
          },
        ],
        canvas = document.createElement("canvas"),
        output = [];
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      for (const stops of lists)
        for (const config of configurations)
          for (const background of ["#FFFFFF", "#203040"])
            for (const preset of ["rect", "ellipse", "diamond"]) {
              const p = createDeck("blank"),
                s = P.getSlides(p)[0],
                shape = P.addSlideShape(s, {
                  x: P.emu(40 * 9525),
                  y: P.emu(30 * 9525),
                  w: P.emu(300 * 9525),
                  h: P.emu(180 * 9525),
                  preset,
                });
              P.setSlideBackground(s, background);
              P.setShapeGradientFill(shape, {
                ...config,
                stops: stops.map(([offset, color, opacity]) => ({
                  offset,
                  color,
                  opacity,
                })),
              });
              P.setShapeStroke(shape, { color: "#10C030", widthEmu: 4 * 9525 });
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
              ctx.clearRect(0, 0, 1280, 720);
              ctx.drawImage(image, 0, 0, 1280, 720);
              for (const u of [0.28, 0.52, 0.73])
                for (const v of [0.35, 0.65]) {
                  const x = 40 + Math.floor(u * 300),
                    y = 30 + Math.floor(v * 180);
                  const patch = ctx.getImageData(x - 1, y - 1, 3, 3).data;
                  output.push({
                    config,
                    stops,
                    background,
                    preset,
                    x: x - 40 + 0.5,
                    y: y - 30 + 0.5,
                    rgba: [0, 1, 2, 3].map(
                      (channel) =>
                        Array.from(
                          { length: 9 },
                          (_, i) => patch[i * 4 + channel],
                        ).reduce((a, b) => a + b, 0) / 9,
                    ),
                  });
                }
              if (preset === "rect")
                output.push({
                  stroke: [...ctx.getImageData(40, 120, 1, 1).data],
                });
            }
      return output;
    }, gradientRendering);
    const rgb = (hex) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (const sample of samples) {
      if (sample.stroke) {
        expect(sample.stroke).toEqual([16, 192, 48, 255]);
        continue;
      }
      const { config, x, y, stops } = sample,
        tile = config.tileRect ?? {},
        l = tile.left ?? 0,
        top = tile.top ?? 0,
        w = 300 * (1 - l - (tile.right ?? 0)),
        h = 180 * (1 - top - (tile.bottom ?? 0)),
        angle = (config.angleDeg * Math.PI) / 180,
        c = config.angleDeg === 90 ? 0 : Math.cos(angle),
        s = config.angleDeg === 0 ? 0 : Math.sin(angle),
        nx = config.scaled ? c / w : c,
        ny = config.scaled ? s / h : s,
        span = config.scaled
          ? Math.abs(c) + Math.abs(s)
          : Math.abs(c) * w + Math.abs(s) * h,
        q =
          0.5 +
          ((x - 300 * l - w / 2) * nx + (y - 180 * top - h / 2) * ny) / span,
        expectedAt = (phase) => {
          const t = config.tileRect
              ? 1 - Math.abs((((phase % 2) + 2) % 2) - 1)
              : Math.max(0, Math.min(1, phase)),
            i = stops
              .slice(0, -1)
              .findIndex(
                (a, j) =>
                  a[0] <= t && t <= stops[j + 1][0] && a[0] !== stops[j + 1][0],
              ),
            a = stops[i],
            b = stops[i + 1],
            f = (t - a[0]) / (b[0] - a[0]),
            alpha = a[2] * (1 - f) + b[2] * f,
            A = rgb(a[1]),
            B = rgb(b[1]),
            bg = rgb(sample.background),
            expected = A.map((v, j) => {
              const color =
                stops.length === 2
                  ? (v +
                      (B[j] - v) *
                        (B[j] >= v ? 1 - (1 - f) ** 1.875 : f ** 1.875)) *
                    alpha
                  : v * a[2] * (1 - f) + B[j] * b[2] * f;
              return color + bg[j] * (1 - alpha);
            });
          return expected;
        },
        // Average the same 3×3 patch in paint and reference. This measures
        // interpolated color rather than an individual browser dither cell;
        // reflection seams and systematic composition errors remain visible.
        neighborhood = [-1, 0, 1].flatMap((dx) =>
          [-1, 0, 1].map((dy) => expectedAt(q + (dx * nx + dy * ny) / span)),
        );
      for (let j = 0; j < 3; j++)
        // The gradient layers, filter and backdrop cross eight-bit surfaces.
        expect(
          Math.abs(
            sample.rgba[j] - neighborhood.reduce((sum, c) => sum + c[j], 0) / 9,
          ),
          JSON.stringify(sample),
        ).toBeLessThanOrEqual(5);
      expect(sample.rgba[3]).toBe(255);
    }
  });
