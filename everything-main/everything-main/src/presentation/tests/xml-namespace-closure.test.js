import { describe, it, expect } from "vitest";
import {
  NS,
  attr,
  elem,
  qname,
  parseFragment,
  serializeFragment,
  withInheritedNamespaces,
} from "../lib/pptx/src/internal/xml/index.ts";
import { P, createDeck, parseDeck } from "../src/model.js";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
const children = (e) => e.children.filter((c) => c.kind === "element");

describe("namespace closure when serializing edited XML", () => {
  it("declares authored element and attribute namespaces without changing the AST", () => {
    const tree = elem(qname("a", "object", NS.dml), {
      attrs: [
        attr(qname("r", "id", NS.officeDocRels), "rId8"),
        attr(qname("xml", "space", NS.xml), "preserve"),
      ],
    });
    const before = structuredClone(tree),
      xml = serializeFragment(tree),
      restored = parseFragment(xml);
    expect(restored.name.namespaceURI).toBe(NS.dml);
    expect(restored.attrs.map((a) => a.name.namespaceURI)).toEqual([
      NS.officeDocRels,
      NS.xml,
    ]);
    expect(xml).not.toContain("xmlns:xml=");
    expect(tree).toEqual(before);
    expect(serializeFragment(tree)).toBe(xml);
  });
  it("uses another prefix for inserted names without changing existing QName-valued attributes", () => {
    const tree = parseFragment(
      `<r xmlns:a="urn:extension" xmlns:mc="${NS.mc}" xmlns:ns1="urn:reserved"><a:old/></r>`,
    );
    tree.children.unshift(
      elem(qname("a", "new", NS.dml), {
        attrs: [
          attr(qname("mc", "Ignorable", NS.mc), "a"),
          attr(qname("a", "ref", NS.officeDocRels), "a:Original"),
        ],
      }),
    );
    const restored = parseFragment(serializeFragment(tree)),
      [added, old] = children(restored);
    expect(added.name.namespaceURI).toBe(NS.dml);
    expect(added.name.prefix).not.toBe("a");
    expect(added.name.prefix).not.toBe("ns1");
    expect(added.attrs[1].name.namespaceURI).toBe(NS.officeDocRels);
    expect(added.attrs.map((a) => a.value)).toEqual(["a", "a:Original"]);
    expect(restored.prefixDecls.get("a")).toBe("urn:extension");
    expect(added.prefixDecls.has("a")).toBe(false);
    expect(old.name.namespaceURI).toBe("urn:extension");
  });
  it("retains explicit same-element bindings when element and attribute prefixes collide", () => {
    const tree = elem(qname("p", "node", "urn:element"), {
      prefixDecls: new Map([["p", "urn:value"]]),
      attrs: [attr(qname("p", "key", "urn:attribute"), "p:Value")],
    });
    const restored = parseFragment(serializeFragment(tree));
    expect(restored.prefixDecls.get("p")).toBe("urn:value");
    expect(restored.name.namespaceURI).toBe("urn:element");
    expect(restored.attrs[0].name.namespaceURI).toBe("urn:attribute");
    expect(restored.attrs[0].value).toBe("p:Value");
  });
  it("handles default namespace resets and namespaced attributes without a prefix", () => {
    const tree = parseFragment('<root xmlns="urn:root"><first/></root>');
    tree.children.push(
      elem(qname("", "plain", ""), {
        attrs: [
          attr(qname("", "plain", ""), "one"),
          attr(qname("", "qualified", "urn:attr"), "two"),
        ],
      }),
    );
    tree.children.push(elem(qname("", "last", "urn:root")));
    const [first, plain, last] = children(
      parseFragment(serializeFragment(tree)),
    );
    expect(first.name.namespaceURI).toBe("urn:root");
    expect(plain.name.namespaceURI).toBe("");
    expect(plain.attrs.map((a) => a.name.namespaceURI)).toEqual([
      "",
      "urn:attr",
    ]);
    expect(last.name.namespaceURI).toBe("urn:root");
  });
  it("leaves well-scoped names and nested declarations byte-identical", () => {
    const xml =
      '<a:r xmlns:a="urn:outer" xmlns="urn:default"><a:c xmlns:a="urn:inner" v="a:T"><a:d/></a:c><a:tail/><plain xmlns=""/></a:r>';
    expect(serializeFragment(parseFragment(xml))).toBe(xml);
  });
  it("closes detached fragments over declarations used only in extension values", () => {
    const source = parseFragment(
      '<s xmlns:t="urn:table" xmlns:e="urn:extension"><t:style ref="e:Type"/></s>',
    );
    const style = children(source)[0],
      detached = withInheritedNamespaces(style, [source]);
    const target = parseFragment(
      '<r xmlns:e="urn:different" xmlns:t="urn:other"/>',
    );
    target.children.push(detached);
    const copy = children(parseFragment(serializeFragment(target)))[0];
    expect(copy.name.namespaceURI).toBe("urn:table");
    expect(copy.prefixDecls.get("e")).toBe("urn:extension");
    expect(copy.attrs[0].value).toBe("e:Type");
    expect(style.prefixDecls.size).toBe(0);
  });
  it("reuses a compatible in-scope alias and restores scope for siblings", () => {
    const tree = parseFragment(
      '<r xmlns:a="urn:one" xmlns:b="urn:two"><child xmlns:b="urn:three"/><tail/></r>',
    );
    children(tree)[0].children.push(elem(qname("a", "new", "urn:two")));
    children(tree)[1].children.push(elem(qname("a", "new", "urn:two")));
    const [child, tail] = children(parseFragment(serializeFragment(tree)));
    expect(children(child)[0].name.namespaceURI).toBe("urn:two");
    expect(children(tail)[0].name.prefix).toBe("b");
  });
});

describe("cross-deck styles with different namespace prefixes", () => {
  it.each([false, true])(
    "imports, copies and exports with a conflicting conventional prefix: %s",
    async (conflict) => {
      const source = createDeck("blank"),
        slide = P.getSlides(source)[0];
      P.addSlideTable(slide, {
        x: 0,
        y: 0,
        w: P.inches(3),
        h: P.inches(1),
        rows: [["Namespace", "Test"]],
      });
      const id = "{859A08D1-427C-40A4-B185-E8F042EF85E8}",
        files = unzipSync(await P.savePresentation(source));
      let xml = strFromU8(files["ppt/slides/slide1.xml"])
        .replace(
          /<a:tableStyleId>[\s\S]*?<\/a:tableStyleId>/,
          `<a:tableStyleId>${id}</a:tableStyleId>`,
        )
        .replaceAll("xmlns:a=", "xmlns:d=")
        .replace(/(<\/?|\s)a:/g, "$1d:")
        .replaceAll("xmlns:p=", "xmlns:s=")
        .replace(/(<\/?|\s)p:/g, "$1s:");
      if (conflict)
        xml = xml.replace(
          "<s:sld ",
          '<s:sld xmlns:a="urn:unrelated-extension" ',
        );
      files["ppt/slides/slide1.xml"] = strToU8(xml);
      files["ppt/tableStyles.xml"] = strToU8(
        `<s:tblStyleLst xmlns:s="${NS.dml}" xmlns:e="urn:source-extension" xmlns:mc="${NS.mc}" def="${id}"><s:tblStyle styleId="${id}" styleName="Namespace test" mc:Ignorable="e" e:hint="e:Type"><s:wholeTbl><s:tcStyle><s:fill><s:solidFill><s:srgbClr val="F04080"/></s:solidFill></s:fill></s:tcStyle></s:wholeTbl></s:tblStyle></s:tblStyleLst>`,
      );
      const loaded = await parseDeck(zipSync(files)),
        before = unzipSync(await P.savePresentation(loaded));
      const target = createDeck("blank");
      const imported = P.importSlide(
        target,
        P.getSlides(loaded)[0],
        P.getSlideLayouts(target)[0],
      );
      const copied = P.copyShape(
        P.addBlankSlide(target),
        P.getSlideTables(imported)[0],
      );
      expect(
        P.getTableStyleResolver(target, copied).cell(
          P.getTableCell(copied, 0, 0),
        ).fill,
      ).toMatchObject({ color: "#F04080" });
      const output = await P.savePresentation(target),
        reload = await parseDeck(output);
      for (const s of P.getSlides(reload))
        for (const table of P.getSlideTables(s))
          expect(
            P.getTableStyleResolver(reload, table).cell(
              P.getTableCell(table, 0, 0),
            ).fill,
          ).toMatchObject({ color: "#F04080" });
      const parts = unzipSync(output),
        copiedSlide = parseFragment(
          strFromU8(parts["ppt/slides/slide2.xml"]).replace(
            /<\?xml[^?]*\?>/,
            "",
          ),
        );
      const findStyle = (e) =>
        e.name.namespaceURI === NS.dml && e.name.localName === "tableStyle"
          ? e
          : children(e).map(findStyle).find(Boolean);
      const style = findStyle(copiedSlide);
      expect(style.prefixDecls.get("e")).toBe("urn:source-extension");
      expect(style.attrs.find((a) => a.name.localName === "hint").value).toBe(
        "e:Type",
      );
      expect(unzipSync(await P.savePresentation(loaded))).toEqual(before);
    },
  );
});
