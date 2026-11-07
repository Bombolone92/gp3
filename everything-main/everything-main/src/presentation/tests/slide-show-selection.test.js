import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P, parseDeck } from "../src/model.js";
import {
  setCustomShows,
  setShowSelection,
  showSelectionDeck,
} from "./slide-show-fixture.js";
import { INTERNAL_PACKAGE } from "../lib/pptx/src/api/_internal-symbols.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";
import { partName } from "../lib/pptx/src/internal/opc/index.ts";

const encode = (value) => new TextEncoder().encode(value);
const decode = (value) => new TextDecoder().decode(value);
const all = { kind: "all" };
function selection(pres) {
  return P.getSlideShowSelection(pres);
}
function mainOf(pres) {
  return pres[INTERNAL_PACKAGE].getPart(partName("/ppt/presentation.xml"));
}

describe("authored slide-show selection", () => {
  it.each(["", "<p:sldAll/>"])(
    "reads %s as all slides without changing package bytes",
    async (xml) => {
      const pres = showSelectionDeck(xml);
      const before = unzipSync(await P.savePresentation(pres));
      expect(selection(pres)).toEqual(all);
      expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
    },
  );
  it.each([
    ['st="1" end="1"', { kind: "range", start: 1, end: 1 }],
    ['st="2" end="4"', { kind: "range", start: 2, end: 4 }],
    ['st=" +02 " end="0005"', { kind: "range", start: 2, end: 5 }],
  ])("retains one-based inclusive indexes %s", (attrs, expected) => {
    expect(selection(showSelectionDeck(`<p:sldRg ${attrs}/>`))).toEqual(
      expected,
    );
  });
  it.each([
    'st="0" end="2"',
    'st="-1" end="2"',
    'st="2" end="1"',
    'st="1.5" end="3"',
    'st="1e0" end="3"',
    'st="1"',
    'end="3"',
    'st="1" end="4294967296"',
    'st="one" end="2"',
  ])("rejects invalid range syntax %s without falling back to all", (attrs) => {
    expect(() => selection(showSelectionDeck(`<p:sldRg ${attrs}/>`))).toThrow(
      /slide range/i,
    );
  });
  it("uses namespace identity and understood compatibility branches", () => {
    const pres = showSelectionDeck(
      `<wrong:sldRg xmlns:wrong="urn:wrong" st="1" end="5"/><mc:AlternateContent xmlns:future="urn:future"><mc:Choice Requires="future"><p:custShow id="9"/></mc:Choice><mc:Fallback><alias:sldRg xmlns:alias="${NS.pml}" st="3" end="4"/></mc:Fallback></mc:AlternateContent>`,
    );
    expect(selection(pres)).toEqual({ kind: "range", start: 3, end: 4 });
  });
  it("rejects conflicting selected ranges", () => {
    expect(() =>
      selection(showSelectionDeck('<p:sldAll/><p:sldRg st="1" end="2"/>')),
    ).toThrow(/multiple.*slide show/i);
  });
  it("selects base DrawingML and PresentationML choices without borrowing a fallback", () => {
    const pres = showSelectionDeck(
      `<mc:AlternateContent xmlns:d="${NS.dml}"><mc:Choice Requires="p d"><p:sldRg st="2" end="4"/></mc:Choice><mc:Fallback><p:sldAll/></mc:Fallback></mc:AlternateContent>`,
    );
    expect(selection(pres)).toEqual({ kind: "range", start: 2, end: 4 });
  });
  it("resolves custom metadata from relocated presentation and properties owners", async () => {
    const pres = showSelectionDeck('<p:custShow id="7"/>', {
      customShows: [{ id: 7, sequence: [3, 1] }],
    });
    const pkg = pres[INTERNAL_PACKAGE];
    const main = mainOf(pres);
    const props = pkg.getPart(partName("/ppt/presProps.xml"));
    pkg.addPart(partName("/settings/show.xml"), props.contentType, props.data);
    pkg.addPart(partName("/deck/main.xml"), main.contentType, main.data);
    const rels = pkg.getRels(main.name);
    for (const rel of rels.items)
      rel.target = rel.type.endsWith("/presProps")
        ? "../settings/show.xml"
        : `/ppt/${rel.target}`;
    pkg.setRels(partName("/deck/main.xml"), rels);
    const root = pkg.getPart(partName("/_rels/.rels"));
    root.data = encode(
      decode(root.data).replace(
        'Target="ppt/presentation.xml"',
        'Target="./deck/main.xml"',
      ),
    );
    pkg.removePart(main.name);
    pkg.removePart(props.name);
    const restored = await P.loadPresentation(await P.savePresentation(pres));
    expect(selection(restored)).toEqual({
      kind: "custom",
      id: 7,
      slidePartNames: ["/ppt/slides/slide4.xml", "/ppt/slides/slide2.xml"],
    });
  });
  it.each([0, 7, 4294967295])(
    "resolves custom show %s in authored order with repeated references",
    async (id) => {
      const pres = showSelectionDeck(`<p:custShow id="${id}"/>`, {
        customShows: [{ id, sequence: [3, 1, 3] }],
      });
      P.setSlideHidden(P.getSlides(pres)[1], true);
      const expected = {
        kind: "custom",
        id,
        slidePartNames: [3, 1, 3].map((i) =>
          P.getSlidePartName(P.getSlides(pres)[i]),
        ),
      };
      const before = unzipSync(await P.savePresentation(pres));
      expect(selection(pres)).toEqual(expected);
      expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
      expect(
        selection(await parseDeck(await P.savePresentation(pres))),
      ).toEqual(expected);
    },
  );
  it.each(["-1", "1.0", "4294967296", "", "NaN"])(
    "rejects invalid custom show id %s",
    (id) => {
      expect(() =>
        selection(showSelectionDeck(`<p:custShow id="${id}"/>`)),
      ).toThrow(/custom slide show.*identifier/i);
    },
  );
  it("reports missing and ambiguous custom shows", () => {
    const pres = showSelectionDeck('<p:custShow id="7"/>');
    expect(() => selection(pres)).toThrow(/custom slide show.*not found/i);
    setCustomShows(pres, [
      { id: 7, sequence: [0] },
      { id: 7, sequence: [1] },
    ]);
    expect(() => selection(pres)).toThrow(/custom slide show.*ambiguous/i);
  });
  it("keeps an explicitly empty custom sequence empty", () => {
    const pres = showSelectionDeck('<p:custShow id="7"/>', {
      customShows: [{ id: 7, sequence: [] }],
    });
    expect(selection(pres)).toEqual({
      kind: "custom",
      id: 7,
      slidePartNames: [],
    });
  });
  it.each(["relative", "absolute", "escaped", "alias"])(
    "resolves %s slide targets through presentation relationships",
    (form) => {
      const pres = showSelectionDeck('<p:custShow id="7"/>', {
        customShows: [{ id: 7, sequence: [2] }],
      });
      const pkg = pres[INTERNAL_PACKAGE];
      const main = mainOf(pres);
      const rels = pkg.getRels(main.name);
      const target = P.getSlidePartName(P.getSlides(pres)[2]);
      const rel = rels.items.find(
        (rel) => rel.target === target.slice("/ppt/".length),
      );
      rel.target =
        form === "absolute"
          ? target
          : form === "escaped"
            ? "slides/%73lide3.xml"
            : "./slides/../slides/slide3.xml";
      pkg.setRels(main.name, rels);
      if (form === "alias")
        main.data = encode(
          decode(main.data)
            .replace(/r:id=/g, `alias:id=`)
            .replace("xmlns:r=", "xmlns:alias="),
        );
      expect(selection(pres).slidePartNames).toEqual([target]);
    },
  );
  it.each(["missing", "external", "wrong type", "duplicate ID"])(
    "rejects a custom reference with %s relationship",
    (reason) => {
      const pres = showSelectionDeck('<p:custShow id="7"/>', {
        customShows: [{ id: 7, sequence: [2] }],
      });
      const pkg = pres[INTERNAL_PACKAGE];
      const main = mainOf(pres);
      const rels = pkg.getRels(main.name);
      const rel = rels.items.find((rel) => rel.target === "slides/slide3.xml");
      if (reason === "missing")
        rels.items = rels.items.filter((r) => r !== rel);
      if (reason === "external") rel.targetMode = "External";
      if (reason === "wrong type") rel.type = "urn:wrong";
      if (reason === "duplicate ID")
        rels.items.push({ ...rel, target: "slides/slide4.xml" });
      pkg.setRels(main.name, rels);
      expect(() => selection(pres)).toThrow(/custom slide show.*relationship/i);
    },
  );
  it("re-reads changed selection and custom definitions without leaking between packages", () => {
    const pres = showSelectionDeck('<p:custShow id="7"/>', {
      customShows: [{ id: 7, sequence: [2] }],
    });
    const other = showSelectionDeck('<p:sldRg st="2" end="3"/>');
    expect(selection(pres).slidePartNames).toEqual(["/ppt/slides/slide3.xml"]);
    setCustomShows(pres, [{ id: 7, sequence: [4, 0] }]);
    expect(selection(pres).slidePartNames).toEqual([
      "/ppt/slides/slide5.xml",
      "/ppt/slides/slide1.xml",
    ]);
    setShowSelection(pres, '<p:sldRg st="3" end="4"/>');
    expect(selection(pres)).toEqual({ kind: "range", start: 3, end: 4 });
    expect(selection(other)).toEqual({ kind: "range", start: 2, end: 3 });
  });
  it("keeps destination show settings through slide import and a return copy", async () => {
    const source = showSelectionDeck('<p:custShow id="7"/>', {
      customShows: [{ id: 7, sequence: [3, 1] }],
    });
    const target = showSelectionDeck('<p:sldRg st="2" end="3"/>');
    const slide = P.getSlides(source)[3];
    const copied = P.importSlide(
      target,
      slide,
      P.getSlideLayout(P.getSlides(target)[0]),
    );
    P.importSlide(source, copied, P.getSlideLayout(slide));
    expect(
      selection(await parseDeck(await P.savePresentation(target))),
    ).toEqual({ kind: "range", start: 2, end: 3 });
    expect(
      selection(await parseDeck(await P.savePresentation(source))),
    ).toEqual({
      kind: "custom",
      id: 7,
      slidePartNames: ["/ppt/slides/slide4.xml", "/ppt/slides/slide2.xml"],
    });
  });
});
