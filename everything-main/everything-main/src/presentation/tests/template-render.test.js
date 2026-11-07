import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { P, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { createMappedColorDeck } from "./fixtures.js";

const render = (pres, options = {}) =>
  renderSlideToSvg(pres, P.getSlides(pres)[0], {
    textLayout: "svg",
    ...options,
  }).replace(/pkdef-[a-z0-9]+/g, "definition");
const fixture = async () => {
  const pres = await parseDeck(
    await createMappedColorDeck({ decorations: true, painted: true }),
  );
  const slide = P.getSlides(pres)[0];
  const layout = P.getSlideLayout(slide);
  const pkg = P._internalPackageOf(pres);
  return {
    pres,
    slide,
    layout,
    pkg,
    masterPart: pkg.getPart(P.getSlideMasterPartName(slide)),
    layoutPart: pkg.getPart(P.getSlideLayoutPartName(layout)),
  };
};
const replace = (part, from, to) => {
  part.data = strToU8(strFromU8(part.data).replaceAll(from, to));
};
const expectFresh = async (pres) => {
  expect(render(pres)).toBe(
    render(await parseDeck(await P.savePresentation(pres))),
  );
};

describe("template rendering", () => {
  it("refreshes cached decorations after layout and master byte replacement", async () => {
    const c = await fixture();
    const original = render(c.pres);
    expect(original).toContain("Mapped layout");
    expect(original).toContain("Mapped master");
    expect(render(c.pres)).toBe(original);
    replace(c.layoutPart, "Mapped layout", "Changed layout");
    replace(c.masterPart, "Mapped master", "Changed master");
    const changed = render(c.pres);
    expect(changed).toContain("Changed layout");
    expect(changed).toContain("Changed master");
    expect(changed).not.toContain("Mapped master");
    await expectFresh(c.pres);
  });

  it("follows live master relationships, removals, and replacement parts", async () => {
    const c = await fixture();
    render(c.pres);
    const name = "/ppt/slideMasters/replacement.xml";
    const replacement = c.pkg.addPart(
      name,
      c.masterPart.contentType,
      c.masterPart.data,
    );
    replace(replacement, "Mapped master", "Replacement master");
    const rels = c.pkg.getRels(c.layoutPart.name);
    rels.items.find((r) => r.type.endsWith("/slideMaster")).target = name;
    c.pkg.setRels(c.layoutPart.name, rels);
    expect(render(c.pres)).toContain("Replacement master");
    expect(render(c.pres)).not.toContain("Mapped master");
    c.pkg.removePart(name);
    expect(render(c.pres)).not.toContain("Replacement master");
    c.pkg.addPart(name, replacement.contentType, c.masterPart.data);
    expect(render(c.pres)).toContain("Mapped master");
    await expectFresh(c.pres);
  });

  it("keeps theme and font resolution live without changing cached shape bytes", async () => {
    const c = await fixture();
    const original = render(c.pres);
    const layoutBytes = c.layoutPart.data;
    const masterBytes = c.masterPart.data;
    P.setPresentationTheme(c.pres, { light1: "#123456", dark1: "#FEDCBA" });
    const changed = render(c.pres);
    expect(changed).not.toBe(original);
    expect(changed).toContain("#123456");
    expect(changed).toContain("#FEDCBA");
    expect(c.layoutPart.data).toBe(layoutBytes);
    expect(c.masterPart.data).toBe(masterBytes);
    expect(render(c.pres, { resolveFontFamily: () => "FirstFace" })).toContain(
      "FirstFace",
    );
    expect(render(c.pres, { resolveFontFamily: () => "SecondFace" })).toContain(
      "SecondFace",
    );
    await expectFresh(c.pres);
  });

  it("resolves current image relationships and bytes through cached decoration handles", async () => {
    const c = await fixture();
    const first =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGMwSJjwH4QZYAwARzQIfaOzYgMAAAAASUVORK5CYII=";
    const second =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5wAAAABJRU5ErkJggg==";
    const firstPart = c.pkg.addPart(
      "/ppt/media/template-first.png",
      "image/png",
      Buffer.from(first, "base64"),
    );
    const secondPart = c.pkg.addPart(
      "/ppt/media/template-second.png",
      "image/png",
      Buffer.from(second, "base64"),
    );
    const rels = c.pkg.getRels(c.masterPart.name);
    rels.items.push({
      id: "rIdTemplateImage",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      target: firstPart.name,
      targetMode: "Internal",
    });
    c.pkg.setRels(c.masterPart.name, rels);
    replace(
      c.masterPart,
      "</p:spTree>",
      '<p:pic><p:nvPicPr><p:cNvPr id="5000" name="Template image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdTemplateImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree>',
    );
    expect(render(c.pres)).toContain(first);
    const bytes = c.masterPart.data;
    rels.items.find((r) => r.id === "rIdTemplateImage").target =
      secondPart.name;
    c.pkg.setRels(c.masterPart.name, rels);
    expect(render(c.pres)).toContain(second);
    expect(render(c.pres)).not.toContain(first);
    secondPart.data = firstPart.data;
    expect(render(c.pres)).toContain(first);
    expect(render(c.pres)).not.toContain(second);
    expect(c.masterPart.data).toBe(bytes);
    await expectFresh(c.pres);
  });

  it("isolates public handles and presentations while keeping rendering read-only", async () => {
    const c = await fixture();
    const other = await fixture();
    const original = render(c.pres);
    const before = unzipSync(await P.savePresentation(c.pres));
    const symbol = Symbol.for("@office-kit/pptx.shape.element");
    for (const shape of [
      ...P.getSlideLayoutShapes(c.pres, c.layout),
      ...P.getSlideMasterShapes(c.pres, c.layout),
    ])
      shape[symbol].children = [];
    expect(render(c.pres)).toBe(original);
    expect(unzipSync(await P.savePresentation(c.pres))).toEqual(before);
    replace(c.masterPart, "Mapped master", "Private master");
    expect(render(c.pres)).toContain("Private master");
    expect(render(other.pres)).toBe(original);
  });
});
