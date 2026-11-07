import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck, preview } from "../src/model.js";

const solid = '<a:solidFill><a:srgbClr val="1267B2"/></a:solidFill>';
const line = (width, fill = solid) =>
  `<a:ln${width == null ? "" : ` w="${width}"`}>${fill}</a:ln>`;
const style = (index) =>
  index == null
    ? ""
    : `<p:style><a:lnRef idx="${index}"><a:srgbClr val="FF0000"/></a:lnRef><a:fillRef idx="0"><a:srgbClr val="FFFFFF"/></a:fillRef><a:effectRef idx="0"><a:srgbClr val="000000"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="000000"/></a:fontRef></p:style>`;
async function fixture({
  ownWidth,
  index = 2,
  layoutWidth,
  layoutIndex,
  masterWidth = 50800,
  placeholder = false,
  fill = solid,
  edit,
} = {}) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.addSlideShape(s, {
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(7),
    h: P.inches(3),
    preset: "rect",
  });
  const files = unzipSync(await P.savePresentation(p));
  const names = [
    P.getSlidePartName(s),
    P.getSlideLayoutPartName(P.getSlideLayout(s)),
    P.getSlideMasterPartName(s),
  ].map((n) => n.slice(1));
  const slot = (width, ref, kind, content = solid) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="99" name="Outline probe"/><p:cNvSpPr/><p:nvPr>${placeholder ? `<p:ph type="body" idx="4"/>` : ""}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="6400800" cy="2743200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>${line(width, content)}</p:spPr>${style(ref)}<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>${kind}</a:t></a:r></a:p></p:txBody></p:sp>`;
  for (let i = 0; i < 3; i++)
    files[names[i]] = strToU8(
      strFromU8(files[names[i]])
        .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
        .replace(
          "</p:spTree>",
          (i === 0
            ? slot(ownWidth, index, "Width inheritance", fill)
            : placeholder
              ? slot(
                  i === 1 ? layoutWidth : masterWidth,
                  i === 1 ? layoutIndex : null,
                  "",
                )
              : "") + "</p:spTree>",
        ),
    );
  const theme = Object.keys(files).find((n) =>
    /^ppt\/theme\/theme\d+\.xml$/.test(n),
  );
  files[theme] = strToU8(
    strFromU8(files[theme]).replace(
      /<a:lnStyleLst>[\s\S]*?<\/a:lnStyleLst>/,
      `<a:lnStyleLst>${[12700, 38100, 76200].map((w) => line(w)).join("")}</a:lnStyleLst>`,
    ),
  );
  edit?.(files, { names, theme });
  const bytes = zipSync(files),
    pres = await parseDeck(bytes),
    slide = P.getSlides(pres)[0],
    shape = P.getSlideShapes(slide)[0];
  return { pres, slide, shape, bytes, names, theme };
}
const cases = [
  [{}, 38100],
  [{ index: 1 }, 12700],
  [{ index: 3 }, 76200],
  [{ ownWidth: 19050 }, 19050],
  [{ ownWidth: 0 }, 0],
  [{ placeholder: true, layoutWidth: 63500 }, 38100],
  [{ placeholder: true, index: null, layoutWidth: 63500 }, 63500],
  [{ placeholder: true, index: null, layoutIndex: 1 }, 12700],
  [
    { placeholder: true, index: null, layoutIndex: 1, layoutWidth: 63500 },
    63500,
  ],
  [{ placeholder: true, index: null }, 50800],
  [{ index: 0 }, undefined],
  [{ index: 99 }, undefined],
  [{ index: "2x" }, undefined],
  [{ index: -1 }, undefined],
  [{ index: 1.5 }, undefined],
  [{ index: null }, undefined],
  [{ ownWidth: "bad" }, 38100],
  [{ ownWidth: -5 }, 38100],
  [{ ownWidth: 1.5 }, 38100],
  [{ ownWidth: "bad", index: null }, undefined],
  [{ ownWidth: -5, index: null }, undefined],
  [{ ownWidth: "1e4" }, 38100],
  [{ ownWidth: "0x10" }, 38100],
  [{ index: "0x2" }, undefined],
];
describe("independent outline width inheritance", () => {
  it.each(cases)("resolves %j", async (options, width) => {
    const f = await fixture(options),
      before = unzipSync(await P.savePresentation(f.pres));
    expect(P.getShapeStrokeEffective(f.pres, f.shape)).toMatchObject({
      kind: "solid",
      color: "#1267B2",
    });
    expect(P.getShapeStrokeEffective(f.pres, f.shape).widthEmu).toBe(width);
    const svg = preview(f.pres, f.slide);
    expect(svg).not.toContain("NaN");
    expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
    expect(P.getShapeStroke(f.shape).widthEmu).toBe(
      Number.isInteger(options.ownWidth) && options.ownWidth >= 0
        ? options.ownWidth
        : undefined,
    );
  });
  it("keeps explicit no-fill and observes subsequent width edits", async () => {
    const f = await fixture({ fill: "<a:noFill/>" });
    expect(P.getShapeStrokeEffective(f.pres, f.shape)).toEqual({
      kind: "none",
    });
    P.setShapeStroke(f.shape, { color: "#004400", widthEmu: P.pt(8) });
    expect(P.getShapeStrokeEffective(f.pres, f.shape).widthEmu).toBe(P.pt(8));
  });
  it("inherits color while keeping a locally specified width", async () => {
    const f = await fixture({
      placeholder: true,
      index: null,
      ownWidth: 25400,
      fill: "",
    });
    expect(P.getShapeStrokeEffective(f.pres, f.shape)).toEqual({
      kind: "solid",
      color: "#1267B2",
      widthEmu: 25400,
    });
  });
  it("observes theme byte replacement", async () => {
    const f = await fixture(),
      pkg = P._internalPackageOf(f.pres),
      part = pkg.getPart("/" + f.theme);
    expect(P.getShapeStrokeEffective(f.pres, f.shape).widthEmu).toBe(38100);
    part.data = strToU8(strFromU8(part.data).replace('w="38100"', 'w="88900"'));
    expect(P.getShapeStrokeEffective(f.pres, f.shape).widthEmu).toBe(88900);
  });
  it("preserves authored widths through copy, target-theme import, and save/reload", async () => {
    const source = await fixture(),
      target = await fixture();
    const pkg = P._internalPackageOf(target.pres),
      part = pkg.getPart("/" + target.theme);
    part.data = strToU8(
      strFromU8(part.data).replace('w="38100"', 'w="101600"'),
    );
    const copied = P.copyShape(source.slide, source.shape);
    expect(P.getShapeStrokeEffective(source.pres, copied).widthEmu).toBe(38100);
    const imported = P.importSlide(
      target.pres,
      source.slide,
      P.getSlideLayout(target.slide),
    );
    const returned = P.importSlide(
      source.pres,
      imported,
      P.getSlideLayout(source.slide),
    );
    for (const [pres, slide, expected] of [
      [target.pres, imported, 101600],
      [source.pres, returned, 38100],
    ]) {
      for (const shape of P.getSlideShapes(slide)) {
        expect(P.getShapeStroke(shape).widthEmu).toBeUndefined();
        expect(P.getShapeStrokeEffective(pres, shape).widthEmu).toBe(expected);
        P.setShapeRotation(shape, 13);
      }
      const reopened = await parseDeck(await P.savePresentation(pres));
      for (const shape of P.getSlideShapes(P.getSlides(reopened).at(-1))) {
        expect(P.getShapeStroke(shape).widthEmu).toBeUndefined();
        expect(P.getShapeStrokeEffective(reopened, shape).widthEmu).toBe(
          expected,
        );
        expect(P.getShapeRotation(shape)).toBe(13);
      }
    }
  });
  it("uses the owning master's theme and observes relationship edits", async () => {
    const f = await fixture(),
      pkg = P._internalPackageOf(f.pres);
    const source = pkg.getPart("/" + f.theme),
      other = {
        ...source,
        name: "/ppt/theme/alternate.xml",
        data: strToU8(strFromU8(source.data).replace('w="38100"', 'w="63500"')),
      };
    pkg.parts.push(other);
    const master = "/" + f.names[2],
      rels = pkg.getRels(master);
    const rel = rels.items.find((r) => r.type.endsWith("/theme"));
    expect(P.getShapeStrokeEffective(f.pres, f.shape).widthEmu).toBe(38100);
    rel.target = "../theme/alternate.xml";
    pkg.setRels(master, rels);
    expect(P.getShapeStrokeEffective(f.pres, f.shape).widthEmu).toBe(63500);
    rel.target = "../theme/theme1.xml";
    pkg.setRels(master, rels);
    expect(P.getShapeStrokeEffective(f.pres, f.shape).widthEmu).toBe(38100);
  });
});
