import { P, createDeck } from "../src/model.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// Independent rectangle/triangle controls opened in the native reference before
// changing the renderer. Dimensions and widths vary between the two rows.
export async function strokeJoinFixture() {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.setSlideBackground(s, "#FFFFFF");
  const joins = ["", "<a:round/>", "<a:miter/>", "<a:bevel/>"];
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 4; col++) {
      const sh = P.addSlideShape(s, {
        preset: row ? "triangle" : "rect",
        x: P.inches(0.6 + col * 3.1),
        y: P.inches(0.7 + row * 3.4),
        w: P.inches(2.1),
        h: P.inches(2),
      });
      P.setShapeNoFill(sh);
      P.setShapeStroke(sh, { color: "#1267B2", widthEmu: P.pt(row ? 15 : 7) });
    }
  const files = unzipSync(await P.savePresentation(p)),
    name = P.getSlidePartName(s).slice(1);
  let index = 0;
  files[name] = strToU8(
    strFromU8(files[name]).replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, (el) =>
      el.replace("</a:ln>", `${joins[index++ % 4]}</a:ln>`),
    ),
  );
  return zipSync(files);
}

export async function strokeJoinEdgeFixture() {
  const { geometryImage, triangleGeometry } =
    await import("./geometry-fixture.js");
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.setSlideBackground(s, "#FFFFFF");
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++) {
      const bounds = {
        x: P.inches(0.6 + col * 3.1),
        y: P.inches(0.65 + row * 2.1),
        w: P.inches(2.1),
        h: P.inches(1.4),
      };
      const sh =
        row === 0
          ? P.addSlideImage(s, geometryImage, bounds)
          : P.addSlideShape(s, {
              ...bounds,
              preset: row === 1 ? "triangle" : "star5",
            });
      if (row) P.setShapeNoFill(sh);
      P.setShapeStroke(sh, { color: "#1267B2", widthEmu: P.pt(9) });
    }
  const files = unzipSync(await P.savePresentation(p)),
    name = P.getSlidePartName(s).slice(1),
    joins = ["", "<a:round/>", '<a:miter lim="350000"/>', "<a:bevel/>"];
  let index = 0;
  files[name] = strToU8(
    strFromU8(files[name]).replace(/<p:(pic|sp)\b[\s\S]*?<\/p:\1>/g, (el) => {
      const n = index++;
      if (n >= 4 && n < 8)
        el = el.replace(
          /<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/,
          triangleGeometry,
        );
      return el.replace(/<a:ln\b[\s\S]*?<\/a:ln>/, (line) =>
        line.replace("</a:ln>", `${joins[n % 4]}</a:ln>`),
      );
    }),
  );
  return zipSync(files);
}
